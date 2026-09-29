"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ActiveJobs } from "@/components/active-jobs";
import { Gallery } from "@/components/gallery";
import { GeneratorForm, type LoadRequest, type ReferenceRequest } from "@/components/generator-form";
import { api } from "@/lib/client-api";
import { Header } from "@/components/header";
import { useJobs } from "@/hooks/use-jobs";
import type { GenerationParams, Job } from "@/lib/types";

export default function Home() {
  const { active, finished, previews, engine, connected, loaded, createJobs, cancelJob, deleteJobs, startComfy } =
    useJobs();
  const [loadRequest, setLoadRequest] = useState<LoadRequest | null>(null);
  const [referenceRequest, setReferenceRequest] = useState<ReferenceRequest | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(
    async (params: GenerationParams, count: number) => {
      try {
        await createJobs(params, count);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "添加任务失败");
      }
    },
    [createJobs],
  );

  const handleLoadParams = useCallback((params: GenerationParams) => {
    setLoadRequest({ params, nonce: Date.now() });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("已加载设置。调整需要的参数后即可开始生成。");
  }, []);

  /** 将图库图像传给参考图列表；add 追加到当前列表，replace 用这些图像替换当前列表。 */
  const handleReferences = useCallback(async (jobs: Job[], mode: "add" | "replace") => {
    if (jobs.length === 0) return;
    try {
      const ids: string[] = [];
      for (const job of jobs) {
        const info = await api.uploadFromJob(job.id);
        ids.push(info.id);
      }
      setReferenceRequest({ ids, mode, nonce: Date.now() });
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加参考图失败");
    }
  }, []);

  const handleRegenerate = useCallback(
    (params: GenerationParams, keepSeed: boolean) => {
      void handleSubmit({ ...params, seed: keepSeed ? params.seed : null }, 1);
    },
    [handleSubmit],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Header engine={engine} connected={connected} onStartComfy={() => void startComfy()} />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
          <div
            ref={formRef}
            className="scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
          >
            <GeneratorForm
              engine={engine}
              loadRequest={loadRequest}
              referenceRequest={referenceRequest}
              onSubmit={handleSubmit}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <ActiveJobs jobs={active} previews={previews} onCancel={(id) => void cancelJob(id)} />
            <Gallery
              jobs={finished}
              loaded={loaded}
              onDelete={(ids) => void deleteJobs(ids)}
              onLoadParams={handleLoadParams}
              onRegenerate={handleRegenerate}
              onAddReferences={(jobs) => void handleReferences(jobs, "add")}
              onEditImage={(job) => void handleReferences([job], "replace")}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
