import fs from "node:fs";
import path from "node:path";
import type { Job } from "@/lib/types";
import { publish } from "./events";
import { ensureDirs, JOBS_FILE } from "./paths";

class JobStore {
  private jobs = new Map<string, Job>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    ensureDirs();
    this.load();
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  upsert(job: Job): Job {
    this.jobs.set(job.id, job);
    publish({ type: "job", job });
    this.scheduleSave();
    return job;
  }

  patch(id: string, update: (job: Job) => void): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    update(job);
    return this.upsert(job);
  }

  remove(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    this.jobs.delete(id);
    publish({ type: "job-removed", id });
    this.scheduleSave();
    return job;
  }

  private load(): void {
    if (!fs.existsSync(JOBS_FILE)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as { jobs?: Job[] };
      for (const job of raw.jobs ?? []) {
        // 服务器重启后无法继续运行中的任务；等待中的任务保持等待状态。
        if (job.status === "running") {
          job.status = "failed";
          job.error = "服务器已重启，生成已中断。";
          job.finishedAt = job.finishedAt ?? Date.now();
        }
        this.jobs.set(job.id, job);
      }
    } catch (err) {
      console.error("[store] 无法读取 jobs.json：", err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 300);
  }

  private save(): void {
    try {
      ensureDirs();
      const tmp = path.join(path.dirname(JOBS_FILE), `.jobs.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify({ jobs: this.list() }, null, 2));
      fs.renameSync(tmp, JOBS_FILE);
    } catch (err) {
      console.error("[store] 保存 jobs.json 失败：", err);
    }
  }
}

const g = globalThis as unknown as { __qwenStore?: JobStore };
export const store: JobStore = (g.__qwenStore ??= new JobStore());
