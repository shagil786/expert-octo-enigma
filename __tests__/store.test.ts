import { describe, expect, it } from "vitest";
import {
  computeRun,
  createJob,
  FAIL_URL,
  getJob,
  getRunRecord,
  startRun,
  type RunRecord,
} from "@/lib/server/store";
import { isTerminalStage } from "@/lib/types";

function makeRecord(sourceUrl: string, startedAt = START): RunRecord {
  return { id: "r_test", jobId: "j_test", sourceUrl, startedAt };
}

const START = 1_000_000;

describe("computeRun — happy path", () => {
  it("starts QUEUED at progress 0", () => {
    const run = computeRun(makeRecord("https://cdn.example.com/videos/ok.mp4"), START);
    expect(run.stage).toBe("QUEUED");
    expect(run.progressPct).toBe(0);
  });

  it("reaches TRANSCODING partway through the timeline", () => {
    // Timeline: QUEUED 2s, DOWNLOADING 6s, PROBING 2.5s → TRANSCODING starts at 10.5s.
    const run = computeRun(
      makeRecord("https://cdn.example.com/videos/ok.mp4"),
      START + 12_000,
    );
    expect(run.stage).toBe("TRANSCODING");
    expect(run.progressPct).toBeGreaterThan(0);
    expect(run.progressPct).toBeLessThanOrEqual(100);
  });

  it("monotonically increases progress over the run", () => {
    const record = makeRecord("https://cdn.example.com/videos/ok.mp4");
    const t1 = computeRun(record, START + 3_000);
    const t2 = computeRun(record, START + 15_000);
    const t3 = computeRun(record, START + 26_000);
    expect(t2.progressPct).toBeGreaterThanOrEqual(t1.progressPct);
    expect(t3.progressPct).toBeGreaterThanOrEqual(t2.progressPct);
  });

  it("COMPLETES after the full timeline with a result", () => {
    const run = computeRun(
      makeRecord("https://cdn.example.com/videos/ok.mp4"),
      START + 30_000,
    );
    expect(run.stage).toBe("COMPLETED");
    expect(run.progressPct).toBe(100);
    expect(run.result).toBeDefined();
    expect(run.result!.renditions.length).toBeGreaterThan(0);
  });
});

describe("computeRun — failure path", () => {
  it("fails partway for the magic corrupt URL", () => {
    const run = computeRun(makeRecord(FAIL_URL), START + 20_000);
    expect(run.stage).toBe("FAILED");
    expect(isTerminalStage(run.stage)).toBe(true);
    expect(run.error).toBeTruthy();
    expect(run.progressPct).toBeGreaterThan(0);
  });

  it("is still active early on for the corrupt URL (fails only later)", () => {
    const run = computeRun(makeRecord(FAIL_URL), START + 2_000);
    expect(run.stage).toBe("DOWNLOADING");
    expect(isTerminalStage(run.stage)).toBe(false);
  });
});

describe("computeRun — edge cases", () => {
  it("never fails before the timeline (only magic URL fails)", () => {
    const run = computeRun(makeRecord(FAIL_URL), START + 13_000);
    expect(run.stage).not.toBe("FAILED");
  });

  it("handles a clock before start (negative elapsed) without crashing", () => {
    const run = computeRun(makeRecord("https://x.test/a.mp4"), START - 5_000);
    expect(run.stage).toBe("QUEUED");
    expect(run.progressPct).toBe(0);
  });
});

describe("store ownership", () => {
  it("does not expose a job or run to another user", () => {
    const job = createJob({ sourceUrl: "https://cdn.example.com/videos/private.mp4" }, "u_owner");
    const run = startRun(job.id, "u_owner");

    expect(getJob(job.id, "u_other")).toBeNull();
    expect(run).not.toBeNull();
    expect(getRunRecord(run!.id, "u_other")).toBeNull();
    expect(getRunRecord(run!.id, "u_owner")).not.toBeNull();
  });
});
