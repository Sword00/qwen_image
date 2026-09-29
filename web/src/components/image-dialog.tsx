"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ImagePlusIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { imageUrl, uploadUrl } from "@/lib/client-api";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { textEncoderLabel } from "@/lib/presets";
import type { GenerationParams, Job } from "@/lib/types";

interface Props {
  job: Job | null;
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (dir: -1 | 1) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onLoadParams: (params: GenerationParams) => void;
  onRegenerate: (params: GenerationParams, keepSeed: boolean) => void;
  onAddReference: (job: Job) => void;
  onEditImage: (job: Job) => void;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制${label}`);
  } catch {
    toast.error("无法复制到剪贴板");
  }
}

export function ImageDialog({
  job,
  hasPrev,
  hasNext,
  onNavigate,
  onClose,
  onDelete,
  onLoadParams,
  onRegenerate,
  onAddReference,
  onEditImage,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!job) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(-1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job, hasPrev, hasNext, onNavigate]);

  const p = job?.params;
  const duration = job?.startedAt && job.finishedAt ? job.finishedAt - job.startedAt : undefined;

  return (
    <>
      <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-2rem))]">
          {job && p ? (
            <div className="grid max-h-[92vh] md:grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative flex items-center justify-center bg-black/90 md:min-h-[60vh]">
                {job.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(job.id)}
                    alt={p.prompt}
                    width={job.image.width}
                    height={job.image.height}
                    className="max-h-[50vh] w-full object-contain md:max-h-[92vh]"
                  />
                ) : (
                  <p className="p-10 text-sm text-muted-foreground">没有图片。</p>
                )}
                {hasPrev ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="上一张图片"
                    className="absolute top-1/2 left-2 -translate-y-1/2 opacity-80"
                    onClick={() => onNavigate(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                ) : null}
                {hasNext ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="下一张图片"
                    className="absolute top-1/2 right-2 -translate-y-1/2 opacity-80"
                    onClick={() => onNavigate(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                ) : null}
              </div>

              <ScrollArea className="max-h-[42vh] md:max-h-[92vh]">
                <div className="flex flex-col gap-4 p-5 pr-12">
                  <DialogHeader>
                    <DialogTitle>图片信息</DialogTitle>
                    <DialogDescription>
                      {formatDateTime(job.finishedAt ?? job.createdAt)}
                      {job.image ? ` · ${job.image.width}×${job.image.height} · ${formatBytes(job.image.bytes)}` : ""}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">提示词</span>
                      <Button variant="ghost" size="xs" onClick={() => void copy(p.prompt, "提示词")}>
                        <CopyIcon data-icon="inline-start" />
                        复制
                      </Button>
                    </div>
                    <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {p.prompt}
                    </p>
                  </div>

                  {p.negativePrompt ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">负面提示词</span>
                      <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                        {p.negativePrompt}
                      </p>
                    </div>
                  ) : null}

                  {p.references?.length ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">参考图 {p.references.length} 张</span>
                      <div className="flex flex-wrap gap-2">
                        {p.references.map((id, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={id}
                            src={uploadUrl(id)}
                            alt={`参考图 ${i + 1}`}
                            className="size-16 rounded-md border object-cover"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <Separator />

                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">引擎</dt>
                    <dd>{p.engine === "comfyui" ? "ComfyUI · GGUF" : "mflux · MLX"}</dd>
                    <dt className="text-muted-foreground">模型</dt>
                    <dd className="break-all">
                      {p.engine === "comfyui" ? p.gguf : p.quantize ? `Qwen-Image-2.1 bf16 → ${p.quantize}bit` : "Qwen-Image-2.1 bf16"}
                    </dd>
                    {p.engine === "comfyui" ? (
                      <>
                        <dt className="text-muted-foreground">文本编码器</dt>
                        <dd className="break-all">{textEncoderLabel(p.textEncoder)}</dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">尺寸</dt>
                    <dd className="tabular-nums">
                      {p.width} × {p.height}
                    </dd>
                    <dt className="text-muted-foreground">步数 / CFG</dt>
                    <dd className="tabular-nums">
                      {p.steps} / {p.cfg}
                    </dd>
                    <dt className="text-muted-foreground">种子</dt>
                    <dd className="flex items-center gap-1 tabular-nums">
                      {p.seed}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="复制种子"
                        onClick={() => void copy(String(p.seed), "种子")}
                      >
                        <CopyIcon />
                      </Button>
                    </dd>
                    <dt className="text-muted-foreground">采样器</dt>
                    <dd>
                      {p.engine === "comfyui" ? `${p.sampler} · ${p.scheduler}` : "euler · linear"}
                    </dd>
                    <dt className="text-muted-foreground">耗时</dt>
                    <dd>{formatDuration(duration)}</dd>
                    <dt className="text-muted-foreground">状态</dt>
                    <dd>
                      <Badge variant={job.status === "done" ? "secondary" : "destructive"}>
                        {job.status === "done" ? "已完成" : job.status === "failed" ? "失败" : "已取消"}
                      </Badge>
                    </dd>
                  </dl>

                  {job.error ? (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs break-words text-destructive">
                      {job.error}
                    </p>
                  ) : null}

                  <Separator />

                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => onEditImage(job)}>
                      <PencilLineIcon data-icon="inline-start" />
                      编辑此图片
                    </Button>
                    <Tooltip>
                      <TooltipTrigger render={<Button variant="outline" onClick={() => onAddReference(job)} />}>
                        <ImagePlusIcon data-icon="inline-start" />
                        添加为参考图
                      </TooltipTrigger>
                      <TooltipContent>添加到生成表单的参考图列表（最多 3 张）</TooltipContent>
                    </Tooltip>
                    <Button variant="outline" onClick={() => onLoadParams(p)}>
                      <SlidersHorizontalIcon data-icon="inline-start" />
                      加载设置
                    </Button>
                    <Tooltip>
                      <TooltipTrigger render={<Button variant="outline" onClick={() => onRegenerate(p, true)} />}>
                        <RefreshCwIcon data-icon="inline-start" />
                        使用相同种子重新生成
                      </TooltipTrigger>
                      <TooltipContent>使用相同设置和种子重新生成</TooltipContent>
                    </Tooltip>
                    <Button variant="outline" onClick={() => onRegenerate(p, false)}>
                      <RefreshCwIcon data-icon="inline-start" />
                      使用新种子重新生成
                    </Button>
                    {job.image ? (
                      <Button variant="outline" render={<a href={imageUrl(job.id, true)} download />}>
                        <DownloadIcon data-icon="inline-start" />
                        下载
                      </Button>
                    ) : null}
                    <Button variant="destructive" className="col-span-2" onClick={() => setConfirmDelete(true)}>
                      <Trash2Icon data-icon="inline-start" />
                      删除
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除这张图片吗？</AlertDialogTitle>
            <AlertDialogDescription>图片文件和生成记录都会被删除，且无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (job) onDelete(job.id);
                setConfirmDelete(false);
                onClose();
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
