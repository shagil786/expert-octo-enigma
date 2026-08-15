"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useJob, useRun, useStartRun, jobKeys, runKeys } from "@/lib/client/hooks";
import { useRunStream } from "@/lib/client/use-run-stream";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const jobQuery = useJob(id);
  const startRun = useStartRun();

  // Start streaming immediately if the job already has a run; otherwise wait for "Start encode".
  const [runId, setRunId] = useState<string | null>(jobQuery.data?.latestRunId ?? null);

  // The job query is asynchronous, so latestRunId is usually unavailable on the first render.
  // Synchronize it once the query resolves so reloads resume an existing run.
  useEffect(() => {
    if (!runId && jobQuery.data?.latestRunId) {
      setRunId(jobQuery.data.latestRunId);
    }
  }, [jobQuery.data?.latestRunId, runId]);

  const runQuery = useRun(runId);
  const stream = useRunStream(runId, () => {
    // Terminal state reached — refresh the run (for the result) and the job (for the list badge).
    queryClient.invalidateQueries({ queryKey: runKeys.detail(runId ?? "") });
    queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
  });

  if (jobQuery.isLoading) return <p className="text-sm text-neutral-500">Loading job…</p>;
  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="text-sm text-red-600">
        Job not found.{" "}
        <Link href="/jobs" className="underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const job = jobQuery.data;

  const handleStart = async () => {
    const { runId: newRunId } = await startRun.mutateAsync(job.id);
    setRunId(newRunId);
    queryClient.invalidateQueries({ queryKey: jobKeys.detail(id) });
  };

  const running = !!runId && !stream.done;
  const failed = stream.done && stream.stage === "FAILED";
  const completed = stream.done && stream.stage === "COMPLETED";
  const result = completed ? runQuery.data?.result ?? null : null;

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="text-sm text-neutral-500 hover:underline">
        ← All jobs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{job.title}</h1>
          <p className="truncate text-sm text-neutral-500">{job.sourceUrl}</p>
        </div>
        <StatusBadge value={stream.stage ?? job.status} />
      </div>

      {/* Run controls */}
      {!runId && job.status !== "RUNNING" && (
        <div>
          <button
            onClick={handleStart}
            disabled={startRun.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {startRun.isPending ? "Starting…" : "Start encode"}
          </button>
        </div>
      )}

      {/* Live progress */}
      {runId && (
        <div className="space-y-3 rounded-md border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{stream.stage ?? "Waiting…"}</span>
            <span className="text-neutral-500">{stream.progressPct}%</span>
          </div>
          <ProgressBar value={stream.progressPct} failed={failed} />
          {!stream.connected && !stream.done && (
            <p className="text-xs text-neutral-400">Connecting…</p>
          )}

          {/* Streaming log */}
          {stream.log.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-200">
              {stream.log.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Error / failure */}
          {stream.error && <p className="text-sm text-red-600">{stream.error}</p>}
          {failed && (
            <button
              onClick={handleStart}
              disabled={startRun.isPending}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {startRun.isPending ? "Restarting…" : "Retry encode"}
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {completed && result && (
        <section className="space-y-4 rounded-md border border-neutral-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Output</h2>
          <p className="text-sm text-neutral-600">
            Duration: <span className="font-medium">{result.durationSec}s</span>
          </p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                <th className="pb-2">Label</th>
                <th className="pb-2">Resolution</th>
                <th className="pb-2">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {result.renditions.map((r) => (
                <tr key={r.label}>
                  <td className="py-2 font-medium">{r.label}</td>
                  <td className="py-2">
                    {r.width}×{r.height}
                  </td>
                  <td className="py-2">{r.sizeMb} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Warnings</p>
              <ul className="list-inside list-disc">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
