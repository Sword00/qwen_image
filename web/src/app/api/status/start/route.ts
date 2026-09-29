import { NextResponse } from "next/server";
import { comfy } from "@/lib/server/comfy";
import { publishEngineStatus } from "@/lib/server/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ComfyUI 未运行时启动它。准备过程需要约 1~2 分钟，因此立即响应并通过 SSE 通知进度。 */
export async function POST() {
  if (await comfy.isReachable()) return NextResponse.json({ starting: false, reachable: true });
  void comfy
    .ensureRunning()
    .catch((err) => console.error("[status] ComfyUI 启动失败：", err))
    .finally(() => void publishEngineStatus());
  return NextResponse.json({ starting: true, reachable: false });
}
