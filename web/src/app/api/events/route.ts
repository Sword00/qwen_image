import type { ServerEvent } from "@/lib/types";
import { subscribe } from "@/lib/server/events";
import { engineStatus } from "@/lib/server/queue";
import { store } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let ping: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ServerEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "snapshot", jobs: store.list() });
      void engineStatus().then((status) => send({ type: "engine", status }));
      unsubscribe = subscribe(send);
      // 每 15 秒发送一次引擎状态，同时保持连接并刷新状态。
      ping = setInterval(() => {
        void engineStatus()
          .then((status) => send({ type: "engine", status }))
          .catch(() => send({ type: "ping" }));
      }, 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* 连接已经关闭 */
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
