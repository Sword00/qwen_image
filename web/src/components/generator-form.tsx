"use client";

import { cn } from "cn";
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  DicesIcon,
  EraserIcon,
  ImagePlusIcon,
  LightbulbIcon,
  Loader2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, uploadUrl } from "@/lib/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ASPECT_RATIOS,
  CFG_MAX,
  CFG_MIN,
  DEFAULT_PARAMS,
  FALLBACK_SAMPLERS,
  FALLBACK_SCHEDULERS,
  KNOWN_GGUF_FILES,
  KNOWN_TEXT_ENCODERS,
  MAX_BATCH,
  MAX_REFERENCES,
  MFLUX_QUANTIZE_OPTIONS,
  pickGguf,
  pickTextEncoder,
  QUALITY_PRESETS,
  resolutionFor,
  round32,
  SAMPLE_PROMPTS,
  SIZE_MAX,
  SIZE_MIN,
  STEPS_MAX,
  GGUF_TEXT_ENCODER_SUPPORTS_EDIT,
  isGgufTextEncoder,
  STEPS_MIN,
  STYLE_PRESETS,
  textEncoderLabel,
} from "@/lib/presets";
import type { Engine, EngineStatus, GenerationParams } from "@/lib/types";

const STORAGE_KEY = "qwen21.form.v1";

export interface LoadRequest {
  params: GenerationParams;
  nonce: number;
}

export interface ReferenceRequest {
  /** 上传 ID 列表。 */
  ids: string[];
  /** add：追加到当前列表（超过最大数量的部分会丢弃）；replace：用这些图像替换当前列表。 */
  mode: "add" | "replace";
  nonce: number;
}

interface Props {
  engine: EngineStatus | null;
  loadRequest: LoadRequest | null;
  referenceRequest: ReferenceRequest | null;
  onSubmit: (params: GenerationParams, count: number) => Promise<unknown>;
}

const ENGINE_ITEMS: { value: Engine; label: string }[] = [
  { value: "comfyui", label: "ComfyUI · GGUF (PyTorch MPS)" },
  { value: "mflux", label: "mflux · MLX（bf16 原始权重）" },
];

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function ggufLabel(file: string): string {
  const m = /-(Q\d[^.]*)\.gguf$/i.exec(file);
  return m ? m[1] : file;
}


const noopSubscribe = () => () => {};

function readSavedRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface Saved {
  form?: Partial<GenerationParams>;
  count?: number;
}

function parseSaved(raw: string | null): Saved | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Saved;
  } catch {
    return null;
  }
}

export function GeneratorForm({ engine, loadRequest, referenceRequest, onSubmit }: Props) {
  // 服务端渲染使用默认值，浏览器中使用上次保存的设置。
  const savedRaw = useSyncExternalStore(noopSubscribe, readSavedRaw, () => null);
  const saved = useMemo(() => parseSaved(savedRaw), [savedRaw]);
  const [formOverride, setFormOverride] = useState<GenerationParams | null>(null);
  const [countOverride, setCountOverride] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  const [appliedRefNonce, setAppliedRefNonce] = useState<number | null>(null);
  const [refNotice, setRefNotice] = useState<{ nonce: number; mode: "add" | "replace"; total: number; dropped: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useMemo<GenerationParams>(
    () => formOverride ?? { ...DEFAULT_PARAMS, ...(saved?.form ?? {}) },
    [formOverride, saved],
  );
  const count = countOverride ?? saved?.count ?? 1;
  const setCount = setCountOverride;

  const ggufFiles = engine?.comfy.ggufFiles.length ? engine.comfy.ggufFiles : KNOWN_GGUF_FILES;
  const textEncoders = engine?.comfy.textEncoders.length ? engine.comfy.textEncoders : KNOWN_TEXT_ENCODERS;
  const samplers = engine?.comfy.samplers.length ? engine.comfy.samplers : FALLBACK_SAMPLERS;
  const schedulers = engine?.comfy.schedulers.length ? engine.comfy.schedulers : FALLBACK_SCHEDULERS;

  // 从图库加载设置：在渲染过程中同步派生状态。
  if (loadRequest && loadRequest.nonce !== appliedNonce) {
    setAppliedNonce(loadRequest.nonce);
    setFormOverride({ ...DEFAULT_PARAMS, ...loadRequest.params });
    setAdvancedOpen(true);
  }

  // 从图库“添加为参考图”或“编辑此图”：在渲染过程中同步派生状态。
  if (referenceRequest && referenceRequest.nonce !== appliedRefNonce) {
    setAppliedRefNonce(referenceRequest.nonce);
    const incoming = referenceRequest.ids;
    const merged =
      referenceRequest.mode === "replace"
        ? incoming
        : [...form.references, ...incoming.filter((id) => !form.references.includes(id))];
    const next = merged.slice(0, MAX_REFERENCES);
    setFormOverride({ ...form, references: next });
    setRefNotice({
      nonce: referenceRequest.nonce,
      mode: referenceRequest.mode,
      total: next.length,
      dropped: merged.length - next.length,
    });
  }

  // 通知参考图应用结果；Toast 属于外部系统，因此放在 effect 中调用。
  useEffect(() => {
    if (!refNotice) return;
    if (refNotice.dropped > 0) {
      toast.warning(`参考图最多 ${MAX_REFERENCES} 张，${refNotice.dropped} 张未添加。`);
    } else if (refNotice.mode === "replace") {
      toast("将使用此图片作为参考图。请在提示词中写明修改内容，然后开始生成。");
    } else {
      toast(`参考图 ${refNotice.total}/${MAX_REFERENCES} 张。可以在提示词中用“第一张”“第二张”指代。`);
    }
  }, [refNotice]);

  // 保存最新设置（仅在用户修改内容后保存）。
  useEffect(() => {
    if (formOverride === null && countOverride === null) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, count }));
      } catch {
        /* 没有存储空间时跳过 */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [form, count, formOverride, countOverride]);

  const set = (patch: Partial<GenerationParams>) => setFormOverride({ ...form, ...patch });
  const patchFn = (fn: (f: GenerationParams) => Partial<GenerationParams>) =>
    setFormOverride((prev) => {
      const base = prev ?? { ...DEFAULT_PARAMS, ...(saved?.form ?? {}) };
      return { ...base, ...fn(base) };
    });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_REFERENCES - form.references.length;
    if (room <= 0) {
          toast.error(`参考图最多 ${MAX_REFERENCES} 张`);
      return;
    }
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, room);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        try {
          const info = await api.upload(file);
          patchFn((f) => ({ references: [...f.references, info.id].slice(0, MAX_REFERENCES) }));
        } catch (err) {
          toast.error(`${file.name}：${err instanceof Error ? err.message : "上传失败"}`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeReference = (id: string) => patchFn((f) => ({ references: f.references.filter((r) => r !== id) }));
  const editing = form.references.length > 0;

  const applyQuality = (id: string) => {
    const preset = QUALITY_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const ratioId = form.ratioId && form.ratioId !== "custom" ? form.ratioId : "1:1";
    const { width, height } = resolutionFor(ratioId, preset.megapixels);
    set({
      presetId: id,
      ratioId,
      steps: preset.steps,
      width,
      height,
      gguf: pickGguf(ggufFiles, preset.gguf),
      // 如果预设所需编码器已安装则使用它，否则保留当前选择。
      textEncoder: preset.textEncoder
        ? pickTextEncoder(textEncoders, preset.textEncoder)
        : textEncoders.includes(form.textEncoder)
          ? form.textEncoder
          : pickTextEncoder(textEncoders),
      quantize: preset.quantize ?? 8,
    });
  };

  const applyRatio = (id: string) => {
    const preset = QUALITY_PRESETS.find((p) => p.id === form.presetId);
    const megapixels = preset ? preset.megapixels : (form.width * form.height) / (1024 * 1024);
    const { width, height } = resolutionFor(id, megapixels);
    set({ ratioId: id, width, height });
  };

  const setSize = (patch: { width?: number; height?: number }) => {
    set({ ...patch, ratioId: "custom", presetId: "custom" });
  };

  const finalPrompt = useMemo(() => {
    const style = STYLE_PRESETS.find((s) => s.id === form.styleId);
    const base = form.prompt.trim();
    return style?.suffix && base ? `${base}, ${style.suffix}` : base;
  }, [form.prompt, form.styleId]);

  const canSubmit = form.prompt.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(
        {
          ...form,
          prompt: finalPrompt,
          gguf: form.gguf || pickGguf(ggufFiles),
          textEncoder: form.textEncoder || pickTextEncoder(textEncoders),
        },
        count,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modelSummary =
    form.engine === "comfyui" ? `GGUF ${ggufLabel(form.gguf)}` : form.quantize ? `mflux ${form.quantize}bit` : "mflux bf16";

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          图片生成
        </CardTitle>
        <CardDescription>输入提示词并选择预设即可开始生成。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* 提示词 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="prompt">提示词</Label>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => set({ prompt: SAMPLE_PROMPTS[Math.floor(Math.random() * SAMPLE_PROMPTS.length)] })}
                    />
                  }
                >
                  <LightbulbIcon data-icon="inline-start" />
                  示例
                </TooltipTrigger>
                <TooltipContent>随机填入示例提示词</TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="xs" disabled={!form.prompt} onClick={() => set({ prompt: "" })}>
                <EraserIcon data-icon="inline-start" />
                清空
              </Button>
            </div>
          </div>
          <Textarea
            id="prompt"
            value={form.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void handleSubmit();
            }}
            placeholder='例如：写有 "QWEN IMAGE 2.1" 的霓虹商店招牌，雨夜，湿润路面的倒影'
            className="min-h-28 resize-y text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {editing
                ? "写明如何修改参考图。多张图片时可以用“第一张”“第二张”指代。"
                : "支持中文和英文。需要生成文字时请用引号括起来。"}
            </span>
            <span className="tabular-nums">{form.prompt.length} 字</span>
          </div>
        </div>

        {/* 参考图 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>
              参考图 <span className="font-normal text-muted-foreground">（可选 · 图片编辑）</span>
            </Label>
            <Button
              variant="ghost"
              size="xs"
              disabled={uploading || form.references.length >= MAX_REFERENCES}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <ImagePlusIcon data-icon="inline-start" />
              )}
              添加图片
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "rounded-lg border border-dashed p-2 transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            {form.references.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                拖放图片或点击[添加图片]。最多 {MAX_REFERENCES} 张。添加后，提示词会被视为编辑指令。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {form.references.map((id, i) => (
                  <div key={id} className="group relative size-20 overflow-hidden rounded-md border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadUrl(id)} alt={`参考图 ${i + 1}`} className="size-full object-cover" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      aria-label="移除参考图"
                      onClick={() => removeReference(id)}
                      className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {editing ? (
            form.engine === "comfyui" ? (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">输出尺寸匹配第一张参考图</span>
                  <Switch
                    size="sm"
                    checked={form.followReferenceSize}
                    onCheckedChange={(checked) => set({ followReferenceSize: checked })}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  例如：“把背景换成夕阳海滩”，“让第一张图片的人物穿上第二张图片的衣服”。参考图越多，占用内存越多。
                </p>
                {isGgufTextEncoder(form.textEncoder) && !GGUF_TEXT_ENCODER_SUPPORTS_EDIT ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    当前 GGUF 文本编码器不支持参考图编辑，此任务会自动切换到 int8 编码器。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">变化强度（mflux 仅将第一张图片用于 img2img）</span>
                  <span className="tabular-nums">{form.imageStrength.toFixed(2)}</span>
                </div>
                <Slider
                  value={[form.imageStrength]}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => set({ imageStrength: Array.isArray(v) ? v[0] : v })}
                />
              </div>
            )
          ) : null}
        </div>

        {/* 风格 */}
        <div className="flex flex-col gap-2">
          <Label>风格</Label>
          <ToggleGroup
            value={[form.styleId ?? "none"]}
            onValueChange={(v) => v[0] && set({ styleId: String(v[0]) })}
            variant="outline"
            size="sm"
            className="flex-wrap"
          >
            {STYLE_PRESETS.map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} aria-label={s.name}>
                {s.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* 质量预设 */}
        <div className="flex flex-col gap-2">
          <Label>质量预设</Label>
          <ToggleGroup
            value={[form.presetId ?? "custom"]}
            onValueChange={(v) => v[0] && applyQuality(String(v[0]))}
            variant="outline"
            className="grid w-full grid-cols-2 sm:grid-cols-3"
          >
            {QUALITY_PRESETS.map((p) => (
              <ToggleGroupItem
                key={p.id}
                value={p.id}
                className="h-auto flex-col items-start gap-0.5 px-3 py-2 text-left"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{p.description}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* 比例 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>画面比例</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {form.width} × {form.height}
            </span>
          </div>
          <ToggleGroup
            value={[form.ratioId ?? "custom"]}
            onValueChange={(v) => v[0] && applyRatio(String(v[0]))}
            variant="outline"
            size="sm"
            className="flex-wrap"
          >
            {ASPECT_RATIOS.map((r) => {
              const w = r.w >= r.h ? 16 : Math.round((16 * r.w) / r.h);
              const h = r.h >= r.w ? 16 : Math.round((16 * r.h) / r.w);
              return (
                <ToggleGroupItem key={r.id} value={r.id} aria-label={`比例 ${r.label}`} className="gap-1.5">
                  <span
                    className="inline-block rounded-[2px] border border-current opacity-70"
                    style={{ width: w, height: h }}
                  />
                  {r.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

            {/* 高级设置 */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="-mx-2 w-[calc(100%+1rem)] justify-between" />}
          >
            <span className="flex items-center gap-2">
              高级设置
              <Badge variant="secondary" className="font-normal">
                {modelSummary} · {form.steps} 步 · CFG {form.cfg} · {form.seed === null ? "随机种子" : `种子 ${form.seed}`}
              </Badge>
            </span>
            <ChevronDownIcon className={"transition-transform " + (advancedOpen ? "rotate-180" : "")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-5 pt-3">
            {/* 引擎 */}
            <div className="grid gap-2">
              <Label htmlFor="engine">运行引擎</Label>
              <Select
                value={form.engine}
                onValueChange={(v) => v && set({ engine: v as Engine })}
                items={ENGINE_ITEMS}
              >
                <SelectTrigger id="engine" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENGINE_ITEMS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.engine === "comfyui"
                  ? "使用 ComfyUI 运行 GGUF 量化模型。模型会保留在内存中，连续生成更快。"
                  : engine?.mflux.available
                    ? "使用 MLX 运行 bf16 原始权重。每次运行都要重新加载模型，开始第一步需要 1~2 分钟。"
                    : "找不到 mflux 命令。请使用 `uv tool install mflux` 安装。"}
              </p>
            </div>

            {form.engine === "comfyui" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="gguf">扩散模型（GGUF）</Label>
                  <Select
                    value={ggufFiles.includes(form.gguf) ? form.gguf : ggufFiles[0]}
                    onValueChange={(v) => v && set({ gguf: String(v), presetId: "custom" })}
                    items={ggufFiles.map((f) => ({ value: f, label: ggufLabel(f) }))}
                  >
                    <SelectTrigger id="gguf" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ggufFiles.map((f) => (
                        <SelectItem key={f} value={f}>
                          {ggufLabel(f)}
                          <span className="ml-2 text-xs text-muted-foreground">{f}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="te">文本编码器</Label>
                  <Select
                    value={textEncoders.includes(form.textEncoder) ? form.textEncoder : textEncoders[0]}
                    onValueChange={(v) => v && set({ textEncoder: String(v) })}
                    items={textEncoders.map((f) => ({ value: f, label: textEncoderLabel(f) }))}
                  >
                    <SelectTrigger id="te" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {textEncoders.map((f) => (
                        <SelectItem key={f} value={f}>
                          {textEncoderLabel(f)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="quantize">Transformer 量化</Label>
                <Select
                  value={form.quantize === null ? "none" : String(form.quantize)}
                  onValueChange={(v) => v && set({ quantize: v === "none" ? null : Number(v), presetId: "custom" })}
                  items={MFLUX_QUANTIZE_OPTIONS.map((o) => ({
                    value: o.value === null ? "none" : String(o.value),
                    label: o.label,
                  }))}
                >
                  <SelectTrigger id="quantize" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MFLUX_QUANTIZE_OPTIONS.map((o) => (
                      <SelectItem key={String(o.value)} value={o.value === null ? "none" : String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  文本编码器（17.5GB）始终以 bf16 运行。36GB 设备建议使用 8 位量化。
                </p>
              </div>
            )}

            <Separator />

            {/* 步数 */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="steps">采样步数</Label>
                <Input
                  id="steps"
                  type="number"
                  min={STEPS_MIN}
                  max={STEPS_MAX}
                  value={form.steps}
                  onChange={(e) =>
                    set({
                      steps: Math.min(STEPS_MAX, Math.max(STEPS_MIN, Number(e.target.value) || STEPS_MIN)),
                      presetId: "custom",
                    })
                  }
                  className="h-7 w-20 text-right tabular-nums"
                />
              </div>
              <Slider
                value={[form.steps]}
                min={STEPS_MIN}
                max={STEPS_MAX}
                step={1}
                onValueChange={(v) => set({ steps: Array.isArray(v) ? v[0] : v, presetId: "custom" })}
              />
              <p className="text-xs text-muted-foreground">官方建议值为 40。降到约 20 步可以提速一倍，但细节会减少。</p>
            </div>

            {/* CFG + 负面提示词 */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="cfg">CFG（引导强度）</Label>
                <Input
                  id="cfg"
                  type="number"
                  min={CFG_MIN}
                  max={CFG_MAX}
                  step={0.1}
                  value={form.cfg}
                  onChange={(e) =>
                    set({ cfg: Math.min(CFG_MAX, Math.max(CFG_MIN, Number(e.target.value) || CFG_MIN)) })
                  }
                  className="h-7 w-20 text-right tabular-nums"
                />
              </div>
              <Slider
                value={[form.cfg]}
                min={CFG_MIN}
                max={CFG_MAX}
                step={0.1}
                onValueChange={(v) => set({ cfg: Math.round((Array.isArray(v) ? v[0] : v) * 10) / 10 })}
              />
              <div className="grid gap-2">
                <Label htmlFor="negative" className="text-muted-foreground">
                  负面提示词
                </Label>
                <Textarea
                  id="negative"
                  value={form.negativePrompt}
                  onChange={(e) => set({ negativePrompt: e.target.value })}
                  placeholder="blurry, low quality, watermark"
                  className="min-h-16 resize-y text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {form.cfg <= 1
                    ? "Qwen-Image-2.1 针对无引导（CFG 1）进行了训练。使用负面提示词时，请将 CFG 调到 2~4。"
                    : "CFG 大于 1 时，每一步会计算两次，生成时间约增加一倍。"}
                </p>
              </div>
            </div>

            <Separator />

            {/* 种子 */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="seed">种子</Label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">每次随机</span>
                  <Switch
                    checked={form.seed === null}
                    onCheckedChange={(checked) => set({ seed: checked ? null : randomSeed() })}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Input
                  id="seed"
                  type="number"
                  min={0}
                  max={2_147_483_647}
                  disabled={form.seed === null}
                  value={form.seed ?? ""}
                  placeholder="随机"
                  onChange={(e) => set({ seed: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                  className="tabular-nums"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="生成新种子"
                        onClick={() => set({ seed: randomSeed() })}
                      />
                    }
                  >
                    <DicesIcon />
                  </TooltipTrigger>
                  <TooltipContent>生成并固定一个新种子</TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                连续生成多张时，固定种子会逐张递增 1。
              </p>
            </div>

            {/* 尺寸 */}
            <div className="grid gap-2">
              <Label>尺寸（像素）</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  aria-label="宽度"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={32}
                  value={form.width}
                  onChange={(e) => setSize({ width: Number(e.target.value) || SIZE_MIN })}
                  onBlur={() => setSize({ width: round32(form.width) })}
                  className="tabular-nums"
                />
                <span className="text-muted-foreground">×</span>
                <Input
                  type="number"
                  aria-label="高度"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={32}
                  value={form.height}
                  onChange={(e) => setSize({ height: Number(e.target.value) || SIZE_MIN })}
                  onBlur={() => setSize({ height: round32(form.height) })}
                  className="tabular-nums"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="交换宽高"
                        onClick={() => setSize({ width: form.height, height: form.width })}
                      />
                    }
                  >
                    <ArrowLeftRightIcon />
                  </TooltipTrigger>
                  <TooltipContent>交换宽度和高度</TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">
                尺寸会调整为 32 的倍数（{SIZE_MIN}~{SIZE_MAX}）。2048 级别会占用较多内存，速度可能变慢。
              </p>
            </div>

            {/* 采样器 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sampler">采样器</Label>
                <Select
                  value={samplers.includes(form.sampler) ? form.sampler : samplers[0]}
                  onValueChange={(v) => v && set({ sampler: String(v) })}
                  disabled={form.engine === "mflux"}
                  items={samplers.map((s) => ({ value: s, label: s }))}
                >
                  <SelectTrigger id="sampler" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {samplers.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scheduler">调度器</Label>
                <Select
                  value={schedulers.includes(form.scheduler) ? form.scheduler : schedulers[0]}
                  onValueChange={(v) => v && set({ scheduler: String(v) })}
                  disabled={form.engine === "mflux"}
                  items={schedulers.map((s) => ({ value: s, label: s }))}
                >
                  <SelectTrigger id="scheduler" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {schedulers.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.engine === "mflux" ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">mflux 仅支持 euler 采样器和线性调度器。</p>
              ) : null}
            </div>

            {/* 生成数量 */}
            <div className="grid gap-2">
              <Label>连续生成数量</Label>
              <ToggleGroup
                value={[String(count)]}
                onValueChange={(v) => v[0] && setCount(Number(v[0]))}
                variant="outline"
                size="sm"
              >
                {[1, 2, 4, MAX_BATCH].map((n) => (
                  <ToggleGroupItem key={n} value={String(n)} className="min-w-12">
                    {n} 张
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <div className="flex flex-col gap-2">
          <Button size="lg" className="w-full" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SparklesIcon data-icon="inline-start" />}
            {count > 1 ? `开始生成 ${count} 张` : "开始生成图片"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {editing && form.followReferenceSize && form.engine === "comfyui"
              ? "参考图尺寸"
              : `${form.width} × ${form.height}`}{" "}
            · {form.steps} 步 · {modelSummary}
            {editing ? ` · 编辑（参考图 ${form.references.length} 张）` : ""} · 也可以按 ⌘/Ctrl + Enter 开始
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
