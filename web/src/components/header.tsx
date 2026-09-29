"use client";

import { Loader2Icon, PlayIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineStatus } from "@/lib/types";

interface Props {
  engine: EngineStatus | null;
  connected: boolean;
  onStartComfy: () => void;
}

export function Header({ engine, connected, onStartComfy }: Props) {
  const comfy = engine?.comfy;
  const comfyState: "on" | "starting" | "off" | "unknown" = !comfy
    ? "unknown"
    : comfy.reachable
      ? "on"
      : comfy.starting
        ? "starting"
        : "off";

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 lg:px-8">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparklesIcon className="size-4" />
          </span>
          <div className="leading-tight">
            <h1 className="font-heading text-base font-semibold">Qwen Image 2.1 Studio</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Apple Silicon 本地图片生成</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
                  <span
                    className={
                      "size-1.5 rounded-full " + (connected ? "bg-emerald-500" : "bg-muted-foreground/50")
                    }
                  />
                  {connected ? "实时连接" : "正在重连"}
                </Badge>
              }
            />
            <TooltipContent>浏览器与服务器之间的实时事件连接状态</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant={comfyState === "on" ? "secondary" : "outline"} className="gap-1.5">
                  {comfyState === "starting" ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <span
                      className={
                        "size-1.5 rounded-full " +
                        (comfyState === "on"
                          ? "bg-emerald-500"
                          : comfyState === "off"
                            ? "bg-red-500"
                            : "bg-muted-foreground/50")
                      }
                    />
                  )}
                  ComfyUI
                  {comfyState === "on" && comfy?.version ? (
                    <span className="text-muted-foreground">{comfy.version}</span>
                  ) : null}
                </Badge>
              }
            />
            <TooltipContent>
              {comfyState === "on"
                ? `ComfyUI 已连接 · 队列 ${comfy?.queueRemaining ?? 0} 项`
                : comfyState === "starting"
                  ? "正在启动 ComfyUI 服务"
                  : comfyState === "off"
                    ? "ComfyUI 服务未运行，开始生成时会自动启动。"
                    : "正在检查状态"}
            </TooltipContent>
          </Tooltip>

          {comfyState === "off" ? (
            <Button size="sm" variant="outline" onClick={onStartComfy}>
              <PlayIcon data-icon="inline-start" />
              启动 ComfyUI
            </Button>
          ) : null}

          <Badge variant="outline" className="hidden gap-1.5 md:inline-flex">
            <span
              className={
                "size-1.5 rounded-full " + (engine?.mflux.available ? "bg-emerald-500" : "bg-muted-foreground/50")
              }
            />
            mflux
          </Badge>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
