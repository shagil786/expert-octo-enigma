"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createJobSchema, type CreateJobInput } from "@/lib/schemas";
import { useCreateJob, useJobs } from "@/lib/client/hooks";
import { ApiError } from "@/lib/client/api";
import { StatusBadge } from "@/components/status-badge";

export default function JobsPage() {
  const jobs = useJobs();
  const createJob = useCreateJob();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: { sourceUrl: "", title: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createJob.mutateAsync(values);
      reset();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        // Map server-side field errors back onto the right form fields.
        for (const [field, messages] of Object.entries(e.fieldErrors)) {
          const key = field as keyof CreateJobInput;
          setError(key, { message: messages?.[0] ?? "Invalid value" });
        }
      } else {
        setFormError(e instanceof Error ? e.message : "Could not create job");
      }
    }
  });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">New encode job</h1>
        <form
          onSubmit={onSubmit}
          className="rounded-md border border-neutral-200 bg-white p-4 space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="sourceUrl" className="mb-1 block text-sm font-medium">
              Source URL
            </label>
            <input
              id="sourceUrl"
              {...register("sourceUrl")}
              type="text"
              placeholder="https://cdn.example.com/videos/input.mp4"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              autoComplete="off"
            />
            {errors.sourceUrl && (
              <p className="mt-1 text-xs text-red-600">{errors.sourceUrl.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              Title <span className="text-neutral-400">(optional)</span>
            </label>
            <input
              id="title"
              {...register("title")}
              type="text"
              placeholder="My encode"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              autoComplete="off"
            />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Creating…" : "Create job"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Jobs</h2>
        {jobs.isLoading && <p className="text-sm text-neutral-500">Loading jobs…</p>}
        {jobs.isError && (
          <div className="text-sm text-red-600">
            Couldn’t load jobs.{" "}
            <button onClick={() => jobs.refetch()} className="underline">
              Retry
            </button>
          </div>
        )}
        {jobs.data?.length === 0 && (
          <p className="text-sm text-neutral-500">No jobs yet.</p>
        )}
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {jobs.data?.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.title}</p>
                  <p className="truncate text-xs text-neutral-500">{job.sourceUrl}</p>
                </div>
                <StatusBadge value={job.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}