import { error, json, validationError, withAuth } from "@/lib/server/http";
import { createJobSchema } from "@/lib/schemas";
import { createJob, listJobs } from "@/lib/server/store";

export function GET(req: Request) {
  return withAuth(req, (userId) => json(listJobs(userId)));
}

export async function POST(req: Request) {
  return withAuth(req, async (userId) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error(400, "Invalid JSON body");
    }

    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors);
    }

    const job = createJob(parsed.data, userId);
    return json(job, 201);
  });
}
