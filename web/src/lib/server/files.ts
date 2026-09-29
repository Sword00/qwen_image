import fs from "node:fs";
import type { Job } from "@/lib/types";

export function removeJobFiles(job: Job): void {
  const file = job.image?.file;
  if (file && fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      console.error(`[jobs] 删除文件失败 ${file}：`, err);
    }
  }
}
