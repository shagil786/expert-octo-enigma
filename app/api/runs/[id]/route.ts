import { error, json, withAuth } from "@/lib/server/http";
import { getRunForUser } from "@/lib/server/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withAuth(req, (userId) => {
    const run = getRunForUser(id, userId);
    if (!run) return error(404, "Run not found");
    return json(run);
  });
}
