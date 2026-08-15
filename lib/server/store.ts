import { randomUUID } from "node:crypto";
import { type EncodeResult, type EncodeRun, type Job, type JobStatus, type Stage } from "@/lib/types";

// In-memory store. A single Node process in `next dev`, so module-level Maps are fine.
//
// The run's progress is modeled as a PURE function of elapsed time: given a run record and a clock
// value we derive { stage, progressPct, ... }. Nothing mutates over time — a GET or SSE poll just
// asks "what state should this run be in right now?". That makes it trivial to unit-test.

const jobs = new Map<string, Job>();
const runs = new Map<string, RunRecord>();
const jobOwners = new Map<string, string>();

interface RunRecord {
  id: string;
  jobId: string;
  userId?: string;
  sourceUrl: string;
  startedAt: number; // epoch ms
}

/** The "magic" source URL that should always fail partway, so reviewers can see error handling. */
export const FAIL_URL = "https://cdn.example.com/videos/corrupt.mp4";

// --- run timeline (pure state machine) ---

interface TimelineSegment {
  stage: Exclude<Stage, "COMPLETED" | "FAILED">;
  durationMs: number;
  /** Stages that interpolate progress 0→100 internally (DOWNLOADING, TRANSCODING). */
  progress?: boolean;
}

/** Order and timing of the active stages. Sums to RUN_TOTAL_MS. */
const TIMELINE: TimelineSegment[] = [
  { stage: "QUEUED", durationMs: 2_000 },
  { stage: "DOWNLOADING", durationMs: 6_000, progress: true },
  { stage: "PROBING", durationMs: 2_500 },
  { stage: "TRANSCODING", durationMs: 12_000, progress: true },
  { stage: "PACKAGING", durationMs: 4_000 },
];

const RUN_TOTAL_MS = TIMELINE.reduce((sum, seg) => sum + seg.durationMs, 0); // 26.5s

/** When the FAIL_URL run dies, as a fraction of total elapsed time. */
const FAIL_AFTER_MS = 14_000;

/** Deterministic result payload produced once a run completes. */
function buildResult(): EncodeResult {
  return {
    durationSec: 96,
    renditions: [
      { label: "1080p", width: 1920, height: 1080, sizeMb: 12.4 },
      { label: "720p", width: 1280, height: 720, sizeMb: 6.1 },
      { label: "480p", width: 854, height: 480, sizeMb: 2.8 },
    ],
    warnings: ["Original audio channel layout normalized to stereo"],
  };
}

/**
 * Compute a run's current state from elapsed time. Pure: given (record, now) → EncodeRun.
 *
 * - Walks QUEUED → DOWNLOADING → PROBING → TRANSCODING → PACKAGING over ~26s, then COMPLETED.
 * - `sourceUrl === FAIL_URL` ends in FAILED partway through TRANSCODING.
 * - progressPct is cumulative (0–100) across the whole run, so it's monotonic.
 */
export function computeRun(record: RunRecord, now: number = Date.now()): EncodeRun {
  const elapsed = Math.max(0, now - record.startedAt);
  const base = { id: record.id, jobId: record.jobId };

  // Magic URL always fails partway (during TRANSCODING).
  if (record.sourceUrl === FAIL_URL && elapsed >= FAIL_AFTER_MS) {
    return {
      ...base,
      stage: "FAILED",
      progressPct: Math.min(100, Math.round((FAIL_AFTER_MS / RUN_TOTAL_MS) * 100)),
      error: "Source media is corrupt — decoding failed during transcoding.",
    };
  }

  // Completed: past the full timeline.
  if (elapsed >= RUN_TOTAL_MS) {
    return { ...base, stage: "COMPLETED", progressPct: 100, result: buildResult() };
  }

  // Walk the timeline to find the current segment.
  let acc = 0;
  for (const seg of TIMELINE) {
    const segmentEnd = acc + seg.durationMs;
    if (elapsed < segmentEnd) {
      const withinSegment = elapsed - acc;
      const pct = seg.progress
        ? Math.round((withinSegment / seg.durationMs) * 100)
        : withinSegment === 0
          ? Math.max(0, Math.round((acc / RUN_TOTAL_MS) * 100))
          : Math.min(100, Math.round((segmentEnd / RUN_TOTAL_MS) * 100));
      return { ...base, stage: seg.stage, progressPct: pct };
    }
    acc = segmentEnd;
  }

  // Unreachable — kept for type safety.
  return { ...base, stage: "COMPLETED", progressPct: 100, result: buildResult() };
}

// --- job/run CRUD (provided, lightly extended) ---

/** Derive a job's user-visible status from its latest run's current state. */
function jobWithDerivedStatus(job: Job): Job {
  if (!job.latestRunId) return job;
  const record = runs.get(job.latestRunId);
  if (!record) return job;

  const run = computeRun(record);
  let status: JobStatus;
  switch (run.stage) {
    case "COMPLETED":
      status = "COMPLETED";
      break;
    case "FAILED":
      status = "FAILED";
      break;
    default:
      status = "RUNNING";
  }
  return { ...job, status };
}

export function listJobs(userId = "u_demo"): Job[] {
  return [...jobs.values()]
    .filter((job) => jobOwners.get(job.id) === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(jobWithDerivedStatus);
}

export function getJob(id: string, userId = "u_demo"): Job | null {
  if (jobOwners.get(id) !== userId) return null;
  const job = jobs.get(id);
  return job ? jobWithDerivedStatus(job) : null;
}

export function createJob(input: { sourceUrl: string; title?: string }, userId = "u_demo"): Job {
  const id = `j_${randomUUID().slice(0, 8)}`;
  const sourceUrl = input.sourceUrl.trim();
  const job: Job = {
    id,
    title: input.title?.trim() || deriveTitle(sourceUrl),
    sourceUrl,
    status: "NEW",
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  jobOwners.set(id, userId);
  return job;
}

function deriveTitle(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "Untitled encode";
  } catch {
    return "Untitled encode";
  }
}

export function startRun(jobId: string, userId = "u_demo"): RunRecord | null {
  if (jobOwners.get(jobId) !== userId) return null;
  const job = jobs.get(jobId);
  if (!job) return null;
  const record: RunRecord = {
    id: `r_${randomUUID().slice(0, 8)}`,
    jobId,
    userId,
    sourceUrl: job.sourceUrl,
    startedAt: Date.now(),
  };
  runs.set(record.id, record);
  job.latestRunId = record.id;
  return record;
}

export function getRunRecord(id: string, userId = "u_demo"): RunRecord | null {
  const record = runs.get(id);
  return record && (record.userId ?? "u_demo") === userId ? record : null;
}

export function getRun(id: string, now: number = Date.now()): EncodeRun | null {
  const record = runs.get(id);
  return record ? computeRun(record, now) : null;
}

export function getRunForUser(id: string, userId: string, now: number = Date.now()): EncodeRun | null {
  const record = getRunRecord(id, userId);
  return record ? computeRun(record, now) : null;
}

export type { RunRecord };
