import { error, json } from "@/lib/server/http";
import { issueAccessToken, verifyRefreshToken } from "@/lib/server/auth";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, "Invalid JSON body");
  }

  const refreshToken = (body as { refreshToken?: unknown } | null)?.refreshToken;
  if (typeof refreshToken !== "string" || !refreshToken) {
    return error(400, "refreshToken is required");
  }

  const userId = verifyRefreshToken(refreshToken);
  if (!userId) return error(401, "Invalid or expired refresh token");

  return json({ accessToken: issueAccessToken(userId) });
}