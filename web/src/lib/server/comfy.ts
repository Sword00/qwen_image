import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ComfyStatus, Job, JobImage, JobProgress, Phase } from "@/lib/types";
import { publish } from "./events";
import {
  COMFY_AUTOSTART,
  COMFY_LOG,
  COMFY_START_SCRIPT,
  COMFY_URL,
  OUTPUTS_DIR,
  WEB_IMAGES_DIR,
  envWithPath,
} from "./paths";
import { readPngSize } from "./png";
import { uploadPath } from "./uploads";

export class CancelledError extends Error {
  constructor() {
    super("用户已取消。");
    this.name = "CancelledError";
  }
}

type ProgressUpdate = Partial<JobProgress> & { promptId?: string };
type Updater = (update: ProgressUpdate) => void;

interface Waiter {
  jobId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  update: Updater;
}

/** 工作流节点编号 → 进度阶段。 */
const NODE_PHASE: Record<string, Phase> = {
  "1": "loading",
  "2": "loading",
  "3": "loading",
  "4": "encoding",
  "5": "encoding",
  "6": "sampling",
  "7": "decoding",
  "8": "saving",
  "10": "loading",
  "11": "loading",
  "12": "loading",
};

const STATUS_TTL_MS = 15_000;
const PREVIEW_INTERVAL_MS = 400;

interface ComfyHistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

type WorkflowNode = { class_type: string; inputs: Record<string, unknown> };

/**
 * 构建工作流。refNames 是上传到 ComfyUI input 目录的参考图文件名。
 * 有参考图时连接到 TextEncodeQwenImage21 的 images.image_N 输入；
 * 开启 followReferenceSize 时，输出潜空间使用编码器生成的尺寸（第一张参考图尺寸）。
 */
export function buildWorkflow(job: Job, refNames: string[] = []): Record<string, WorkflowNode> {
  const p = job.params;
  const editing = refNames.length > 0;
  const followRef = editing && p.followReferenceSize !== false;
  const resolution = Math.min(2048, Math.max(512, Math.round(Math.sqrt(p.width * p.height) / 32) * 32));

  const textEncodeInputs: Record<string, unknown> = {
    clip: ["2", 0],
    prompt: p.prompt,
    negative_prompt: p.negativePrompt ?? "",
    vae: ["3", 0],
    resolution,
  };
  refNames.forEach((_, i) => {
    textEncodeInputs[`images.image_${i + 1}`] = [String(10 + i), 0];
  });

  const wf: Record<string, WorkflowNode> = {
    "1": { class_type: "UnetLoaderGGUF", inputs: { unet_name: p.gguf } },
    "2": p.textEncoder.toLowerCase().endsWith(".gguf")
      ? { class_type: "CLIPLoaderGGUF", inputs: { clip_name: p.textEncoder, type: "qwen_image" } }
      : {
          class_type: "CLIPLoader",
          inputs: { clip_name: p.textEncoder, type: "qwen_image", device: "default" },
        },
    "3": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "4": { class_type: "TextEncodeQwenImage21", inputs: textEncodeInputs },
    "6": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["4", 1],
        latent_image: followRef ? ["4", 2] : ["5", 0],
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: p.sampler,
        scheduler: p.scheduler,
        denoise: 1,
      },
    },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["3", 0] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: `web/${job.id}` } },
  };
  if (!followRef) {
    wf["5"] = { class_type: "EmptyLatentImage", inputs: { width: p.width, height: p.height, batch_size: 1 } };
  }
  refNames.forEach((name, i) => {
    wf[String(10 + i)] = { class_type: "LoadImage", inputs: { image: name } };
  });
  return wf;
}

class ComfyClient {
  readonly clientId = randomUUID();
  private ws: WebSocket | null = null;
  private waiters = new Map<string, Waiter>(); // promptId -> waiter
  private lastPreviewAt = new Map<string, number>();
  private statusCache: { at: number; status: ComfyStatus } | null = null;
  private lastKnown: Pick<ComfyStatus, "ggufFiles" | "textEncoders" | "samplers" | "schedulers"> = {
    ggufFiles: [],
    textEncoders: [],
    samplers: [],
    schedulers: [],
  };
  private startPromise: Promise<void> | null = null;
  starting = false;

  // ---------- HTTP ----------

  private async fetchJson<T>(route: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${COMFY_URL}${route}`, { ...init, signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ComfyUI ${route} 响应 ${res.status}：${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.fetchJson("/system_stats", undefined, 2500);
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(force = false): Promise<ComfyStatus> {
    if (!force && this.statusCache && Date.now() - this.statusCache.at < STATUS_TTL_MS) {
      return { ...this.statusCache.status, starting: this.starting };
    }
    let status: ComfyStatus;
    try {
      type ObjectInfo = Record<string, { input: { required: Record<string, [string[]]> } }>;
      const [stats, unet, clip, clipGguf, ksampler, queue] = await Promise.all([
        this.fetchJson<{ system: { comfyui_version?: string } }>("/system_stats"),
        this.fetchJson<ObjectInfo>("/object_info/UnetLoaderGGUF"),
        this.fetchJson<ObjectInfo>("/object_info/CLIPLoader"),
        this.fetchJson<ObjectInfo>("/object_info/CLIPLoaderGGUF").catch(() => ({}) as ObjectInfo),
        this.fetchJson<ObjectInfo>("/object_info/KSampler"),
        this.fetchJson<{ queue_running: unknown[]; queue_pending: unknown[] }>("/queue"),
      ]);
      const ggufFiles = unet.UnetLoaderGGUF?.input.required.unet_name?.[0] ?? [];
      // safetensors 编码器（CLIPLoader）和 GGUF 编码器（CLIPLoaderGGUF）使用不同加载器；视觉塔（mmproj-*）不需要单独选择。
      const safetensorsEncoders = clip.CLIPLoader?.input.required.clip_name?.[0] ?? [];
      const ggufEncoders = (clipGguf.CLIPLoaderGGUF?.input.required.clip_name?.[0] ?? []).filter(
        (f) => f.toLowerCase().endsWith(".gguf") && !f.toLowerCase().startsWith("mmproj"),
      );
      const textEncoders = [...new Set([...safetensorsEncoders, ...ggufEncoders])];
      const samplers = ksampler.KSampler?.input.required.sampler_name?.[0] ?? [];
      const schedulers = ksampler.KSampler?.input.required.scheduler?.[0] ?? [];
      this.lastKnown = {
        ggufFiles: ggufFiles.filter((f) => f.toLowerCase().endsWith(".gguf")),
        textEncoders,
        samplers,
        schedulers,
      };
      status = {
        reachable: true,
        starting: false,
        version: stats.system?.comfyui_version,
        ...this.lastKnown,
        queueRemaining: queue.queue_running.length + queue.queue_pending.length,
      };
    } catch (err) {
      status = {
        reachable: false,
        starting: this.starting,
        ...this.lastKnown,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this.statusCache = { at: Date.now(), status };
    return status;
  }

  invalidateStatus(): void {
    this.statusCache = null;
  }

  // ---------- 自动启动服务器 ----------

  async ensureRunning(): Promise<void> {
    if (await this.isReachable()) return;
    if (!COMFY_AUTOSTART) {
      throw new Error(`无法连接 ComfyUI 服务器（${COMFY_URL}）。请先运行 ./run-comfyui.sh。`);
    }
    if (!this.startPromise) {
      this.startPromise = this.startServer().finally(() => {
        this.startPromise = null;
        this.starting = false;
        this.invalidateStatus();
      });
    }
    await this.startPromise;
  }

  private async startServer(): Promise<void> {
    if (!fs.existsSync(COMFY_START_SCRIPT)) {
      throw new Error(`找不到 ComfyUI 启动脚本：${COMFY_START_SCRIPT}`);
    }
    this.starting = true;
    this.invalidateStatus();
    void this.publishEngineStatus();
    console.log(`[comfy] 正在启动服务器：${COMFY_START_SCRIPT}`);
    const log = fs.openSync(COMFY_LOG, "a");
    const child = spawn(COMFY_START_SCRIPT, [], {
      cwd: path.dirname(COMFY_START_SCRIPT),
      detached: true,
      stdio: ["ignore", log, log],
      env: envWithPath(),
    });
    child.unref();
    fs.closeSync(log);

    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await this.isReachable()) {
        console.log("[comfy] 服务器已准备就绪。");
        return;
      }
      if (child.exitCode !== null) {
        throw new Error(`ComfyUI 服务器立即退出（exit ${child.exitCode}）。请检查 ${COMFY_LOG}。`);
      }
    }
    throw new Error("ComfyUI 服务器在 4 分钟内未准备就绪。");
  }

  async publishEngineStatus(): Promise<void> {
    // queue.ts 会合并 worker 信息并发布；动态导入用于避免循环引用。
    const { engineStatus } = await import("./queue");
    publish({ type: "engine", status: await engineStatus() });
  }

  // ---------- WebSocket ----------

  private ensureSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const url = `${COMFY_URL.replace(/^http/, "ws")}/ws?clientId=${this.clientId}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      if (this.waiters.size > 0) setTimeout(() => this.ensureSocket(), 1000);
    });
    ws.addEventListener("error", () => {
      /* 在 close 事件中重新连接 */
    });
    this.ws = ws;
  }

  private onMessage(data: unknown): void {
    if (typeof data === "string") {
      try {
        this.onJsonMessage(JSON.parse(data));
      } catch (err) {
        console.error("[comfy] 消息解析失败：", err);
      }
      return;
    }
    if (data instanceof ArrayBuffer) this.onBinaryMessage(data);
  }

  private onJsonMessage(msg: { type: string; data?: Record<string, unknown> }): void {
    const d = msg.data ?? {};
    const promptId = typeof d.prompt_id === "string" ? d.prompt_id : undefined;
    const waiter = promptId ? this.waiters.get(promptId) : undefined;
    switch (msg.type) {
      case "progress": {
        if (!waiter) return;
        // 模型加载等其他节点也会发送 progress，因此只将 KSampler（节点 6）的进度计为采样步数。
        if (d.node !== undefined && d.node !== null && String(d.node) !== "6") return;
        const value = Number(d.value ?? 0);
        const max = Number(d.max ?? 0);
        if (max > 0) waiter.update({ phase: "sampling", step: value, total: max });
        return;
      }
      case "executing": {
        if (!waiter) return;
        const node = d.node as string | null;
        if (node === null) {
          waiter.update({ phase: "finished" });
        } else if (NODE_PHASE[node]) {
          waiter.update({ phase: NODE_PHASE[node] });
        }
        return;
      }
      case "execution_success": {
        waiter?.resolve();
        return;
      }
      case "execution_error": {
        if (!waiter) return;
        const message = (d.exception_message as string) ?? "ComfyUI 执行错误";
        const nodeType = d.node_type ? ` [${d.node_type}]` : "";
        waiter.reject(new Error(`${message}${nodeType}`));
        return;
      }
      case "execution_interrupted": {
        waiter?.reject(new CancelledError());
        return;
      }
      default:
        return;
    }
  }

  private onBinaryMessage(buf: ArrayBuffer): void {
    if (buf.byteLength < 8) return;
    const view = new DataView(buf);
    const event = view.getUint32(0);
    let mime = "image/jpeg";
    let offset = 8;
    let promptId: string | undefined;
    if (event === 1) {
      // PREVIEW_IMAGE: [event][image type 1=JPEG 2=PNG][bytes]
      mime = view.getUint32(4) === 2 ? "image/png" : "image/jpeg";
    } else if (event === 4) {
      // PREVIEW_IMAGE_WITH_METADATA: [event][metadata length][metadata json][bytes]
      const metaLen = view.getUint32(4);
      offset = 8 + metaLen;
      try {
        const meta = JSON.parse(Buffer.from(buf, 8, metaLen).toString("utf8")) as Record<string, unknown>;
        if (typeof meta.image_type === "string") mime = meta.image_type;
        if (typeof meta.prompt_id === "string") promptId = meta.prompt_id;
      } catch {
        return;
      }
    } else {
      return;
    }
    const waiter = promptId ? this.waiters.get(promptId) : [...this.waiters.values()][0];
    if (!waiter) return;
    const now = Date.now();
    if (now - (this.lastPreviewAt.get(waiter.jobId) ?? 0) < PREVIEW_INTERVAL_MS) return;
    this.lastPreviewAt.set(waiter.jobId, now);
    const dataUrl = `data:${mime};base64,${Buffer.from(buf, offset).toString("base64")}`;
    publish({ type: "preview", id: waiter.jobId, dataUrl });
  }

  // ---------- 参考图 ----------

  /** 将参考图上传到 ComfyUI 的 input 目录，并返回 LoadImage 使用的文件名。 */
  private async uploadReferences(job: Job): Promise<string[]> {
    const names: string[] = [];
    for (const id of job.params.references ?? []) {
      const file = uploadPath(id);
      if (!fs.existsSync(file)) throw new Error(`找不到参考图：${id}`);
      const bytes = fs.readFileSync(file);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const form = new FormData();
      form.append("image", new Blob([ab], { type: "image/png" }), `${id}.png`);
      form.append("overwrite", "true");
      form.append("type", "input");
      form.append("subfolder", "qwen-studio");
      const res = await this.fetchJson<{ name: string; subfolder?: string }>(
        "/upload/image",
        { method: "POST", body: form },
        60_000,
      );
      names.push(res.subfolder ? `${res.subfolder}/${res.name}` : res.name);
    }
    return names;
  }

  // ---------- 执行 ----------

  async run(job: Job, update: Updater, onCancelReady: (cancel: () => Promise<void>) => void): Promise<JobImage> {
    update({ phase: "starting" });
    await this.ensureRunning();
    this.ensureSocket();

    const refNames = await this.uploadReferences(job);
    const res = await this.fetchJson<{ prompt_id?: string; error?: unknown; node_errors?: unknown }>(
      "/prompt",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildWorkflow(job, refNames), client_id: this.clientId }),
      },
      15_000,
    );
    if (!res.prompt_id) {
      throw new Error(`工作流提交失败：${JSON.stringify(res.error ?? res.node_errors ?? res).slice(0, 500)}`);
    }
    const promptId = res.prompt_id;
    update({ promptId, phase: "loading" });

    let cancelled = false;
    onCancelReady(async () => {
      cancelled = true;
      await this.cancelPrompt(promptId);
      this.waiters.get(promptId)?.reject(new CancelledError());
    });

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        jobId: job.id,
        update,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };
      // 定期检查历史记录，避免 WebSocket 断开时错过事件。
      const poll = setInterval(async () => {
        try {
          const hist = await this.fetchJson<Record<string, ComfyHistoryEntry>>(`/history/${promptId}`);
          const entry = hist[promptId];
          if (!entry?.status) return;
          if (entry.status.status_str === "success") waiter.resolve();
          else if (entry.status.status_str === "error") {
            const errMsg = entry.status.messages?.find((m) => m[0] === "execution_error")?.[1];
            waiter.reject(
              cancelled ? new CancelledError() : new Error(String(errMsg?.exception_message ?? "ComfyUI 执行错误")),
            );
          }
        } catch {
          /* 下一轮继续检查 */
        }
      }, 8000);
      const cleanup = () => {
        clearInterval(poll);
        this.waiters.delete(promptId);
        this.lastPreviewAt.delete(job.id);
      };
      this.waiters.set(promptId, waiter);
    });

    update({ phase: "saving" });
    const hist = await this.fetchJson<Record<string, ComfyHistoryEntry>>(`/history/${promptId}`);
    const outputs = hist[promptId]?.outputs ?? {};
    const image = Object.values(outputs)
      .flatMap((o) => o.images ?? [])
      .find((img) => img.type === "output");
    if (!image) throw new Error("ComfyUI 没有生成输出图像。");

    const src = path.join(OUTPUTS_DIR, image.subfolder ?? "", image.filename);
    const dest = path.join(WEB_IMAGES_DIR, `${job.id}.png`);
    fs.mkdirSync(WEB_IMAGES_DIR, { recursive: true });
    if (path.resolve(src) !== path.resolve(dest)) {
      if (!fs.existsSync(src)) throw new Error(`找不到输出文件：${src}`);
      fs.renameSync(src, dest);
    }
    const { width, height } = readPngSize(dest);
    return { file: dest, width, height, bytes: fs.statSync(dest).size };
  }

  private async cancelPrompt(promptId: string): Promise<void> {
    try {
      const queue = await this.fetchJson<{ queue_running: unknown[][]; queue_pending: unknown[][] }>("/queue");
      const running = queue.queue_running.some((item) => item[1] === promptId);
      const pending = queue.queue_pending.some((item) => item[1] === promptId);
      if (pending) {
        await this.fetchJson("/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delete: [promptId] }),
        }).catch(() => undefined);
      }
      if (running) {
        await fetch(`${COMFY_URL}/interrupt`, { method: "POST" }).catch(() => undefined);
      }
    } catch (err) {
      console.error("[comfy] 取消请求失败：", err);
    }
  }
}

const g = globalThis as unknown as { __qwenComfy?: ComfyClient };
export const comfy: ComfyClient = (g.__qwenComfy ??= new ComfyClient());
