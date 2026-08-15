import { error, json, withAuth } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withAuth(req, (userId) => {
    const job = getJob(id, userId);
    if (!job) return error(404, "Job not found");
    return json(job);
  });
}
