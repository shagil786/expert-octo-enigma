import { error, json, validationError, withAuth } from "@/lib/server/http";
import { startRunSchema } from "@/lib/schemas";
import { startRun } from "@/lib/server/store";

export async function POST(req: Request) {
  return withAuth(req, async (userId) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error(400, "Invalid JSON body");
    }

    const parsed = startRunSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors);
    }

    const record = startRun(parsed.data.jobId, userId);
    if (!record) return error(404, "Job not found");

    return json({ runId: record.id }, 201);
  });
}
