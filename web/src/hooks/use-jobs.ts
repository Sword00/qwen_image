"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { truncate } from "@/lib/format";
import type { EngineStatus, GenerationParams, Job, ServerEvent } from "@/lib/types";

interface State {
  jobs: Record<string, Job>;
  previews: Record<string, string>;
  engine: EngineStatus | null;
  connected: boolean;
  loaded: boolean;
}

export function useJobs() {
  const [state, setState] = useState<State>({
    jobs: {},
    previews: {},
    engine: null,
    connected: false,
    loaded: false,
  });
  const prevStatus = useRef<Record<string, Job["status"]>>({});

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let stopped = false;

    const handle = (event: ServerEvent) => {
      switch (event.type) {
        case "snapshot": {
          for (const j of event.jobs) prevStatus.current[j.id] = j.status;
          setState((s) => ({
            ...s,
            jobs: Object.fromEntries(event.jobs.map((j) => [j.id, j])),
            loaded: true,
          }));
          break;
        }
        case "job": {
          const job = event.job;
          const prev = prevStatus.current[job.id];
          prevStatus.current[job.id] = job.status;
          if (prev && prev !== job.status) {
            if (job.status === "done") {
              toast.success("图像生成完成", { description: truncate(job.params.prompt, 70) });
            } else if (job.status === "failed") {
              toast.error("图像生成失败", { description: job.error ? truncate(job.error, 140) : undefined });
            }
          }
          setState((s) => {
            const previews = { ...s.previews };
            if (job.status !== "running") delete previews[job.id];
            return { ...s, jobs: { ...s.jobs, [job.id]: job }, previews };
          });
          break;
        }
        case "job-removed": {
          delete prevStatus.current[event.id];
          setState((s) => {
            const jobs = { ...s.jobs };
            const previews = { ...s.previews };
            delete jobs[event.id];
            delete previews[event.id];
            return { ...s, jobs, previews };
          });
          break;
        }
        case "preview":
          setState((s) => ({ ...s, previews: { ...s.previews, [event.id]: event.dataUrl } }));
          break;
        case "engine":
          setState((s) => ({ ...s, engine: event.status }));
          break;
        default:
          break;
      }
    };

    const connect = () => {
      if (stopped) return;
      source = new EventSource("/api/events");
      source.onopen = () => setState((s) => ({ ...s, connected: true }));
      source.onmessage = (ev) => {
        try {
          handle(JSON.parse(ev.data) as ServerEvent);
        } catch (err) {
          console.error("事件解析失败", err);
        }
      };
      source.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        source?.close();
        source = null;
        retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      if (retry) window.clearTimeout(retry);
    };
  }, []);

  const jobs = useMemo(() => Object.values(state.jobs).sort((a, b) => b.createdAt - a.createdAt), [state.jobs]);
  const active = useMemo(
    () =>
      jobs
        .filter((j) => j.status === "running" || j.status === "queued")
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "running" ? -1 : 1;
          return a.createdAt - b.createdAt;
        }),
    [jobs],
  );
  const finished = useMemo(() => jobs.filter((j) => j.status !== "running" && j.status !== "queued"), [jobs]);

  const createJobs = useCallback(async (params: GenerationParams, count = 1) => {
    const res = await api.createJobs({ params, count });
    toast.info(count > 1 ? `已将 ${count} 个任务加入队列` : "已将任务加入队列");
    return res.jobs;
  }, []);

  const cancelJob = useCallback(async (id: string) => {
    try {
      await api.cancelJob(id);
      toast("已取消任务");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消任务失败");
    }
  }, []);

  const deleteJobs = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      if (ids.length === 1) await api.deleteJob(ids[0]);
      else await api.deleteJobs(ids);
      toast(ids.length > 1 ? `已删除 ${ids.length} 个项目` : "已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }, []);

  const startComfy = useCallback(async () => {
    try {
      const res = await api.startComfy();
      if (res.starting) toast.info("正在启动 ComfyUI，准备就绪大约需要 1~2 分钟。");
      else toast("ComfyUI 已经在运行");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "启动服务器失败");
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await api.status();
      setState((s) => ({ ...s, engine: status }));
    } catch {
      /* 通过 SSE 重新接收 */
    }
  }, []);

  return {
    jobs,
    active,
    finished,
    previews: state.previews,
    engine: state.engine,
    connected: state.connected,
    loaded: state.loaded,
    createJobs,
    cancelJob,
    deleteJobs,
    startComfy,
    refreshStatus,
  };
}
