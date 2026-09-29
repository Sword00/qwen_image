import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  DEFAULT_PARAMS,
  CFG_MAX,
  CFG_MIN,
  GGUF_TEXT_ENCODER_SUPPORTS_EDIT,
  isGgufTextEncoder,
  KNOWN_TEXT_ENCODERS,
  MAX_BATCH,
  MAX_REFERENCES,
  round32,
  STEPS_MAX,
  STEPS_MIN,
} from "@/lib/presets";
import type { CreateJobsRequest, GenerationParams, Job } from "@/lib/types";
import { removeJobFiles } from "@/lib/server/files";
import { publishEngineStatus, worker } from "@/lib/server/queue";
import { store } from "@/lib/server/store";
import { uploadExists } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: store.list() });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalize(input: Partial<GenerationParams>): GenerationParams {
  const p = { ...DEFAULT_PARAMS, ...input };
  const prompt = String(p.prompt ?? "").trim();
  if (!prompt) throw new Error("请输入提示词。");
  const engine = p.engine === "mflux" ? "mflux" : "comfyui";
  const seed =
    p.seed === null || p.seed === undefined || Number.isNaN(Number(p.seed))
      ? null
      : clamp(Math.floor(Number(p.seed)), 0, 2_147_483_647);
  const quantize = p.quantize === null ? null : clamp(Math.round(Number(p.quantize) || 8), 3, 8);
  const references = (Array.isArray(p.references) ? p.references : [])
    .filter((r): r is string => typeof r === "string" && uploadExists(r))
    .slice(0, MAX_REFERENCES);
  let textEncoder = String(p.textEncoder || DEFAULT_PARAMS.textEncoder);
  if (engine === "comfyui" && references.length > 0 && isGgufTextEncoder(textEncoder) && !GGUF_TEXT_ENCODER_SUPPORTS_EDIT) {
    // GGUF 编码器无法读取参考图时，改用 safetensors 编码器处理。
    textEncoder = KNOWN_TEXT_ENCODERS[0];
  }
  return {
    prompt,
    negativePrompt: String(p.negativePrompt ?? "").trim(),
    width: round32(Number(p.width) || 1024),
    height: round32(Number(p.height) || 1024),
    steps: clamp(Math.round(Number(p.steps) || 40), STEPS_MIN, STEPS_MAX),
    cfg: clamp(Math.round((Number(p.cfg) || 1) * 10) / 10, CFG_MIN, CFG_MAX),
    seed,
    sampler: String(p.sampler || "euler"),
    scheduler: String(p.scheduler || "simple"),
    engine,
    gguf: String(p.gguf || DEFAULT_PARAMS.gguf),
    textEncoder,
    quantize,
    references,
    followReferenceSize: p.followReferenceSize !== false,
    imageStrength: clamp(Number(p.imageStrength ?? 0.6) || 0.6, 0.05, 1),
    presetId: p.presetId,
    ratioId: p.ratioId,
    styleId: p.styleId,
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export async function POST(req: Request) {
  let body: CreateJobsRequest;
  try {
    body = (await req.json()) as CreateJobsRequest;
  } catch {
    return NextResponse.json({ error: "请求正文不是有效的 JSON。" }, { status: 400 });
  }
  let params: GenerationParams;
  try {
    params = normalize(body.params ?? {});
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  const count = clamp(Math.round(Number(body.count) || 1), 1, MAX_BATCH);

  const jobs: Job[] = [];
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    const seed = params.seed === null ? randomSeed() : (params.seed + i) % 2_147_483_647;
    const job: Job = {
      id: randomUUID(),
      createdAt: base + i,
      status: "queued",
      params: { ...params, seed },
      progress: { step: 0, total: params.steps, phase: "queued" },
    };
    store.upsert(job);
    jobs.push(job);
  }
  worker.kick();
  void publishEngineStatus();
  return NextResponse.json({ jobs }, { status: 201 });
}

/** 批量删除任务；运行中的任务会先取消。 */
export async function DELETE(req: Request) {
  let ids: string[] = [];
  try {
    const body = (await req.json()) as { ids?: string[] };
    ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  } catch {
    return NextResponse.json({ error: "请求正文不是有效的 JSON。" }, { status: 400 });
  }
  const deleted: string[] = [];
  for (const id of ids) {
    const job = store.get(id);
    if (!job) continue;
    if (job.status === "running" || job.status === "queued") await worker.cancel(id);
    removeJobFiles(job);
    store.remove(id);
    deleted.push(id);
  }
  void publishEngineStatus();
  return NextResponse.json({ deleted });
}
