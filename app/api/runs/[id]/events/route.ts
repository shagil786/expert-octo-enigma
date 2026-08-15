import { json } from "@/lib/server/http";
import { getUserIdFromRequest } from "@/lib/server/auth";
import { getRunForUser, getRunRecord } from "@/lib/server/store";
import { isTerminalStage, type EncodeRun, type RunEvent, type Stage } from "@/lib/types";

// SSE endpoint. Authenticated via an `Authorization: Bearer <accessToken>` header — the client uses
// `@microsoft/fetch-event-source` (native EventSource can't set headers). Because computeRun() is a
// pure function of elapsed time, this endpoint simply polls it on an interval and streams changes.

const POLL_INTERVAL_MS = 600;

function messageFor(stage: Stage, progressPct: number): string {
  switch (stage) {
    case "QUEUED":
      return "Job queued — waiting for a worker…";
    case "DOWNLOADING":
      return `Downloading source media… ${progressPct}%`;
    case "PROBING":
      return "Probing media metadata…";
    case "TRANSCODING":
      return `Transcoding renditions… ${progressPct}%`;
    case "PACKAGING":
      return "Packaging output…";
    case "COMPLETED":
      return "Encode complete";
    case "FAILED":
      return "Encode failed";
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return json({ detail: "Not authenticated" }, 401);
  }
  if (!getRunRecord(id, userId)) {
    return json({ detail: "Run not found" }, 404);
  }

  const encoder = new TextEncoder();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastKey = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const tick = () => {
        const run = getRunForUser(id, userId);
        if (!run) {
          emit({ stage: "FAILED", progressPct: 0, message: "Run no longer exists" });
          cleanup();
          return;
        }
        const { stage, progressPct, error, result } = run as EncodeRun;
        const message = error ?? messageFor(stage, progressPct);
        const event: RunEvent = { stage, progressPct, message, error };

        // Only push when something actually changed (avoid flooding identical frames).
        const key = `${stage}|${progressPct}|${error ?? ""}`;
        if (isTerminalStage(stage)) {
          if (key !== lastKey) {
            lastKey = key;
            emit({
              ...event,
              message: message + (result ? ` (${result.durationSec}s, ${result.renditions.length} renditions)` : ""),
            });
          }
          cleanup();
          return;
        }
        if (key !== lastKey) {
          lastKey = key;
          emit(event);
        }
      };

      const cleanup = () => {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      tick();
      if (!closed) pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
