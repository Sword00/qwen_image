export type Engine = "comfyui" | "mflux";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type Phase =
  | "queued"
  | "starting"
  | "loading"
  | "encoding"
  | "sampling"
  | "decoding"
  | "saving"
  | "finished";

export interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  /** 固定种子；为 null 时在创建任务时随机生成。 */
  seed: number | null;
  sampler: string;
  scheduler: string;
  engine: Engine;
  /** ComfyUI：diffusion_models 目录中的 GGUF 文件名。 */
  gguf: string;
  /** ComfyUI：text_encoders 目录中的文件名。 */
  textEncoder: string;
  /** mflux：Transformer 量化位数（null 表示 bf16）。 */
  quantize: number | null;
  /** 参考图（编辑原图）的上传 ID 列表；为空时执行文生图。 */
  references: string[];
  /** 有参考图时是否将输出尺寸匹配第一张参考图（ComfyUI）。 */
  followReferenceSize: boolean;
  /** mflux img2img 变化强度（0~1）；越接近 1，结果越偏离原图。 */
  imageStrength: number;
  presetId?: string;
  ratioId?: string;
  styleId?: string;
}

export interface JobProgress {
  step: number;
  total: number;
  phase: Phase;
  etaMs?: number;
}

export interface JobImage {
  file: string;
  width: number;
  height: number;
  bytes: number;
}

export interface Job {
  id: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: JobStatus;
  params: GenerationParams & { seed: number };
  progress: JobProgress;
  image?: JobImage;
  error?: string;
  promptId?: string;
}

export interface ComfyStatus {
  reachable: boolean;
  starting: boolean;
  version?: string;
  ggufFiles: string[];
  textEncoders: string[];
  samplers: string[];
  schedulers: string[];
  queueRemaining?: number;
  error?: string;
}

export interface EngineStatus {
  comfy: ComfyStatus;
  mflux: { available: boolean; path?: string };
  worker: { runningJobId?: string; queued: number };
}

export type ServerEvent =
  | { type: "snapshot"; jobs: Job[] }
  | { type: "job"; job: Job }
  | { type: "job-removed"; id: string }
  | { type: "preview"; id: string; dataUrl: string }
  | { type: "engine"; status: EngineStatus }
  | { type: "ping" };

export interface UploadInfo {
  id: string;
  width: number;
  height: number;
  bytes: number;
}

export interface CreateJobsRequest {
  params: GenerationParams;
  count?: number;
}
