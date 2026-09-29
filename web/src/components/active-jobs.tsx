"use client";

import { ImageIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration, truncate } from "@/lib/format";
import type { Job, Phase } from "@/lib/types";

const PHASE_LABEL: Record<Phase, string> = {
  queued: "排队中",
  starting: "准备中",
  loading: "正在加载模型",
  encoding: "正在处理提示词",
  sampling: "正在生成图片",
  decoding: "正在解码图片",
  saving: "保存中",
  finished: "即将完成",
};

function progressPercent(job: Job): number {
  const { phase, step, total } = job.progress;
  switch (phase) {
    case "queued":
      return 0;
    case "starting":
      return 2;
    case "loading":
      return 4;
    case "encoding":
      return 7;
    case "sampling":
      return total > 0 ? 8 + (88 * step) / total : 8;
    case "decoding":
      return 96;
    case "saving":
      return 98;
    case "finished":
      return 99;
    default:
      return 0;
  }
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return now;
}

interface Props {
  jobs: Job[];
  previews: Record<string, string>;
  onCancel: (id: string) => void;
}

export function ActiveJobs({ jobs, previews, onCancel }: Props) {
  const now = useNow(jobs.length > 0);
  if (jobs.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-heading text-base font-semibold">进行中</h2>
        <Badge variant="secondary">{jobs.length}</Badge>
      </div>
      <div className="flex flex-col gap-3">
        {jobs.map((job, index) => {
          const running = job.status === "running";
          const pct = progressPercent(job);
          const preview = previews[job.id];
          const elapsed = running && job.startedAt ? now - job.startedAt : undefined;
          const { phase, step, total, etaMs } = job.progress;
          const p = job.params;
          return (
            <Card key={job.id} className="overflow-hidden">
              <CardContent className="flex gap-4">
                <div
                  className="relative flex w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted sm:w-32"
                  style={{ aspectRatio: `${p.width} / ${p.height}` }}
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="生成预览" className="size-full object-cover" />
                  ) : running ? (
                    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground/60" />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <p className="line-clamp-2 flex-1 text-sm leading-snug" title={p.prompt}>
                      {truncate(p.prompt, 160)}
                    </p>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="取消"
                            onClick={() => onCancel(job.id)}
                          />
                        }
                      >
                        <XIcon />
                      </TooltipTrigger>
                      <TooltipContent>{running ? "停止生成" : "从队列移除"}</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{p.engine === "comfyui" ? "ComfyUI" : "mflux"}</Badge>
                    <Badge variant="outline" className="tabular-nums">
                      {p.width}×{p.height}
                    </Badge>
                    <Badge variant="outline" className="tabular-nums">
                      {p.steps} 步
                    </Badge>
                    <Badge variant="outline" className="tabular-nums">
                      种子 {p.seed}
                    </Badge>
                    {p.references?.length ? <Badge variant="secondary">编辑 · 参考图 {p.references.length} 张</Badge> : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className={running ? "text-foreground" : "text-muted-foreground"}>
                        {running ? PHASE_LABEL[phase] : `排队中 · 第 ${index + 1} 项`}
                        {running && phase === "sampling" && total > 0 ? (
                          <span className="ml-1 tabular-nums text-muted-foreground">
                            {step}/{total}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {running ? `${Math.round(pct)}%` : ""}
                        {elapsed !== undefined ? ` · 已用时 ${formatDuration(elapsed)}` : ""}
                        {running && etaMs !== undefined && phase === "sampling" ? ` · 约剩 ${formatDuration(etaMs)}` : ""}
                      </span>
                    </div>
                    <Progress
                      value={running ? pct : 0}
                      className={running && phase !== "sampling" ? "animate-pulse" : ""}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
