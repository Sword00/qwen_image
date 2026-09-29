import { NextResponse } from "next/server";
import { publishEngineStatus, worker } from "@/lib/server/queue";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = store.get(id);
  if (!job) return NextResponse.json({ error: "找不到该任务。" }, { status: 404 });
  if (job.status !== "running" && job.status !== "queued") {
    return NextResponse.json({ error: "已经结束的任务无法取消。" }, { status: 409 });
  }
  const updated = await worker.cancel(id);
  void publishEngineStatus();
  return NextResponse.json({ job: updated ?? store.get(id) });
}
