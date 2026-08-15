"use client";

import { useEffect, useRef, useState } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { getAccessToken } from "@/lib/client/token-store";
import { isTerminalStage, type RunEvent, type Stage } from "@/lib/types";

export interface RunStreamState {
  stage: Stage | null;
  progressPct: number;
  log: string[];
  error: string | null;
  connected: boolean;
  done: boolean;
}

const initialState: RunStreamState = {
  stage: null,
  progressPct: 0,
  log: [],
  error: null,
  connected: false,
  done: false,
};

/** Keep the latest onTerminal callback without re-subscribing the stream when it changes. */
const MAX_LOG_ENTRIES = 200;

/**
 * Subscribe to /api/runs/:id/events (SSE) and track live progress.
 *
 * Uses `@microsoft/fetch-event-source` because native EventSource can't send an Authorization header
 * (the SSE endpoint is Bearer-authenticated). Cleanup aborts the connection on unmount or when
 * runId changes, so no streams leak and no state is set after unmount.
 */
export function useRunStream(runId: string | null, onTerminal?: () => void): RunStreamState {
  const [state, setState] = useState<RunStreamState>(initialState);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!runId) return;

    let active = true;
    const controller = new AbortController();

    // Reset per run.
    setState(initialState);

    fetchEventSource(`/api/runs/${runId}/events`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${getAccessToken() ?? ""}`,
        accept: "text/event-stream",
      },
      signal: controller.signal,
      onopen: async (res) => {
        if (!active) return;
        if (res.ok) {
          setState((s) => ({ ...s, connected: true }));
          return;
        }
        // Non-200 (401/404) — surface and stop.
        let detail = `Failed to connect (${res.status})`;
        try {
          const body = (await res.json()) as { detail?: string };
          if (body?.detail) detail = body.detail;
        } catch {
          /* non-JSON */
        }
        setState((s) => ({ ...s, connected: false, error: detail }));
        controller.abort();
      },
      onmessage: (ev) => {
        if (!active) return;
        try {
          const event = JSON.parse(ev.data) as RunEvent;
          setState((s) => {
            const log = [...s.log, event.message].slice(-MAX_LOG_ENTRIES);
            return {
              ...s,
              stage: event.stage,
              progressPct: event.progressPct,
              log,
              error: event.error ?? s.error,
            };
          });

          if (isTerminalStage(event.stage)) {
            setState((s) => ({ ...s, done: true, connected: false }));
            onTerminalRef.current?.();
          }
        } catch {
          /* ignore malformed frames */
        }
      },
      onerror: () => {
        // fetch-event-source would auto-retry if we threw; we want one-shot behavior,
        // so surface the disconnect and stop.
        if (!active) return;
        setState((s) => ({ ...s, connected: false, error: "Stream disconnected" }));
        controller.abort();
      },
    }).catch(() => {
      if (active) setState((s) => ({ ...s, connected: false }));
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [runId]);

  return state;
}