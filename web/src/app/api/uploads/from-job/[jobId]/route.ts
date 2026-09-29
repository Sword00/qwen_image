import fs from "node:fs";
import { NextResponse } from "next/server";
import { store } from "@/lib/server/store";
import { copyToUploads } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 将图库生成结果复制到上传目录，以便作为参考图使用。 */
export async function POST(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const job = store.get(jobId);
  const file = job?.image?.file;
  if (!job || !file || !fs.existsSync(file)) {
    return NextResponse.json({ error: "找不到该图像。" }, { status: 404 });
  }
  return NextResponse.json(copyToUploads(file), { status: 201 });
}
