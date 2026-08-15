"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import type { EncodeRun, Job } from "@/lib/types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

export const runKeys = {
  detail: (id: string) => ["runs", id] as const,
};

// Two worked examples to show the intended React Query pattern:
export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: ({ signal }) => api.get<Job[]>("/api/jobs", signal),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) => api.get<Job>(`/api/jobs/${id}`, signal),
  });
}

/** Create a job (POST /api/jobs). On success the jobs list query is invalidated → refetch. */
export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) => api.post<Job>("/api/jobs", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

/** Start an encode run for a job (POST /api/runs → { runId }). */
export function useStartRun() {
  return useMutation({
    mutationFn: (jobId: string) => api.post<{ runId: string }>("/api/runs", { jobId }),
  });
}

/** Fetch a single run's current state (GET /api/runs/:id). Disabled until runId is known. */
export function useRun(runId: string | null) {
  return useQuery({
    queryKey: runKeys.detail(runId ?? ""),
    queryFn: ({ signal }) => api.get<EncodeRun>(`/api/runs/${runId}`, signal),
    enabled: !!runId,
  });
}

/** Imperative one-shot fetch of a run's current state. */
export function fetchRun(runId: string) {
  return api.get<EncodeRun>(`/api/runs/${runId}`);
}