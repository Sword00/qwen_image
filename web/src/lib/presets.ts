import type { GenerationParams } from "@/lib/types";

export interface QualityPreset {
  id: string;
  name: string;
  description: string;
  steps: number;
  megapixels: number;
  /** ComfyUI 优先选择的 GGUF 量化（文件名中包含的字符串）。 */
  gguf?: string;
  /** ComfyUI 优先选择的文本编码器（文件名中包含的字符串）；没有时保留当前选择。 */
  textEncoder?: string;
  /** mflux 量化位数。 */
  quantize?: number;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: "turbo",
    name: "极速草稿",
    description: "12 步 · 640px",
    steps: 12,
    megapixels: 0.39,
    gguf: "Q5_K_M",
    textEncoder: "heretic",
  },
  { id: "draft", name: "快速草稿", description: "20 步 · 0.5MP · Q5", steps: 20, megapixels: 0.5, gguf: "Q5_K_M" },
  { id: "standard", name: "标准", description: "40 步 · 1MP · Q5", steps: 40, megapixels: 1, gguf: "Q5_K_M" },
  { id: "high", name: "高分辨率", description: "40 步 · 2.25MP", steps: 40, megapixels: 2.25 },
  {
    id: "lowmem",
    name: "低内存",
    description: "Q4 · 30 步 · 1MP",
    steps: 30,
    megapixels: 1,
    gguf: "Q4_K_M",
    quantize: 4,
  },
];

export interface AspectRatio {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const ASPECT_RATIOS: AspectRatio[] = [
  { id: "1:1", label: "1:1", w: 1, h: 1 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
  { id: "4:3", label: "4:3", w: 4, h: 3 },
  { id: "3:4", label: "3:4", w: 3, h: 4 },
  { id: "3:2", label: "3:2", w: 3, h: 2 },
  { id: "2:3", label: "2:3", w: 2, h: 3 },
  { id: "21:9", label: "21:9", w: 21, h: 9 },
];

export interface StylePreset {
  id: string;
  name: string;
  suffix: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "none", name: "无", suffix: "" },
  {
    id: "photo",
    name: "照片",
    suffix:
      "photorealistic photograph, natural lighting, realistic skin and material texture, shot on a full-frame camera",
  },
  {
    id: "cinematic",
    name: "电影场景",
    suffix: "cinematic still, dramatic lighting, shallow depth of field, anamorphic lens, subtle film grain",
  },
  {
    id: "illustration",
    name: "插画",
    suffix: "digital illustration, clean line art, flat shading, vibrant color palette",
  },
  {
    id: "watercolor",
    name: "水彩",
    suffix: "watercolor painting on textured paper, soft edges, pigment blooms, light washes",
  },
  {
    id: "3d",
    name: "3D 渲染",
    suffix: "3D render, soft studio lighting, subsurface scattering, high detail materials",
  },
  {
    id: "poster",
    name: "海报",
    suffix: "graphic poster design, bold typography, strong composition, print-ready layout",
  },
];

export const SIZE_MIN = 256;
export const SIZE_MAX = 2048;
export const STEPS_MIN = 1;
export const STEPS_MAX = 80;
export const CFG_MIN = 1;
export const CFG_MAX = 10;
export const MAX_BATCH = 8;
export const MAX_REFERENCES = 3;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const KNOWN_GGUF_FILES = ["qwen-image-2.1-Q5_K_M.gguf", "qwen-image-2.1-Q8_0.gguf", "qwen-image-2.1-Q4_K_M.gguf"];
export const KNOWN_TEXT_ENCODERS = ["qwen3vl_8b_int8_convrot.safetensors", "qwen3vl_8b_bf16.safetensors"];
export const HERETIC_TEXT_ENCODER = "qwen3vl_8b_heretic-Q4_K_M.gguf";
/**
 * GGUF 文本编码器是否支持参考图编辑。ComfyUI/custom_nodes/qwen-studio-gguf-qwen3vl 补充模块会加载
 * mmproj（视觉塔），因此为 true。设为 false 时，编辑任务会自动改用 safetensors 编码器。
 */
export const GGUF_TEXT_ENCODER_SUPPORTS_EDIT = true;

export function isGgufTextEncoder(file: string): boolean {
  return file.toLowerCase().endsWith(".gguf");
}

/** 将文本编码器文件名转换为人类可读标签。 */
export function textEncoderLabel(file: string): string {
  const lower = file.toLowerCase();
  const quant = /-(q\d[^.]*)\.gguf$/i.exec(file)?.[1]?.toUpperCase();
  if (lower.includes("heretic")) return `Heretic ${quant ?? ""} (GGUF · 降低拒答)`.replace("  ", " ");
  if (lower.endsWith(".gguf")) return `${file.replace(/\.gguf$/i, "")} (GGUF)`;
  if (lower.includes("int8")) return "Qwen3-VL 8B · int8 (9.4GB)";
  if (lower.includes("bf16")) return "Qwen3-VL 8B · bf16 (17.5GB)";
  if (lower.includes("w4a8")) return "Qwen3-VL 8B · w4a8 (6.3GB)";
  return file;
}
export const FALLBACK_SAMPLERS = ["euler", "euler_ancestral", "res_multistep", "dpmpp_2m", "dpmpp_2m_sde", "uni_pc", "ddim"];
export const FALLBACK_SCHEDULERS = ["simple", "normal", "beta", "sgm_uniform", "karras", "exponential"];
export const MFLUX_QUANTIZE_OPTIONS: { value: number | null; label: string }[] = [
  { value: 8, label: "8 位（推荐）" },
  { value: 6, label: "6 位" },
  { value: 4, label: "4 位" },
  { value: null, label: "不量化（bf16，占用较多内存）" },
];

export function round32(n: number): number {
  const v = Math.round(n / 32) * 32;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
}

export function resolutionFor(ratioId: string, megapixels: number): { width: number; height: number } {
  const ratio = ASPECT_RATIOS.find((r) => r.id === ratioId) ?? ASPECT_RATIOS[0];
  const pixels = megapixels * 1024 * 1024;
  const r = ratio.w / ratio.h;
  return { width: round32(Math.sqrt(pixels * r)), height: round32(Math.sqrt(pixels / r)) };
}

/** 从可用文件列表中选择包含预设所需量化的文件。 */
export function pickGguf(files: string[], prefer?: string): string {
  const list = files.length ? files : KNOWN_GGUF_FILES;
  if (prefer) {
    const hit = list.find((f) => f.includes(prefer));
    if (hit) return hit;
  }
  return list.find((f) => f.includes("Q5_K_M")) ?? list.find((f) => f.includes("Q8_0")) ?? list[0];
}

export function pickTextEncoder(files: string[], prefer?: string): string {
  const list = files.length ? files : KNOWN_TEXT_ENCODERS;
  if (prefer) {
    const hit = list.find((f) => f.toLowerCase().includes(prefer.toLowerCase()));
    if (hit) return hit;
  }
  return list.find((f) => f.includes("int8")) ?? list[0];
}

export const DEFAULT_PARAMS: GenerationParams = {
  prompt: "",
  negativePrompt: "",
  width: 1024,
  height: 1024,
  steps: 40,
  cfg: 1,
  seed: null,
  sampler: "euler",
  scheduler: "simple",
  engine: "comfyui",
  gguf: "qwen-image-2.1-Q5_K_M.gguf",
  textEncoder: KNOWN_TEXT_ENCODERS[0],
  quantize: 8,
  references: [],
  followReferenceSize: true,
  imageStrength: 0.6,
  presetId: "standard",
  ratioId: "1:1",
  styleId: "none",
};

export const SAMPLE_PROMPTS: string[] = [
  'A neon shop sign that reads "QWEN IMAGE 2.1", rainy night, reflections on wet pavement',
  "宣纸上的水墨虎，留白构图，笔触清晰，墨色浓淡有致",
  "A cozy Seoul alley cafe at dusk, warm window light, a cat sleeping on a wooden bench, gentle rain",
  "Product photo of a matte black ceramic coffee mug on a concrete slab, soft top light, minimal composition",
  "Isometric illustration of a tiny floating island with a lighthouse, pastel palette, clean vector style",
  'A vintage travel poster for Jeju Island with the text "JEJU" in bold letters, tangerine trees and the sea',
];
