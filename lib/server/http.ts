import { getUserIdFromRequest } from "@/lib/server/auth";

export function json(data: unknown, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers: { "content-type": "application/json", ...(responseInit.headers ?? {}) },
  });
}

export function error(status: number, detail: string): Response {
  return json({ detail }, status);
}

/** 422 with field-level errors, shaped so the client can map them back onto form fields. */
export function validationError(fieldErrors: Record<string, string[] | undefined>): Response {
  const cleaned: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0) cleaned[key] = value;
  }
  return json({ detail: "Validation failed", fieldErrors: cleaned }, 422);
}

/** Returns the authenticated userId, or throws a Response (401) to be caught by the handler. */
export function requireUser(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (!userId) throw error(401, "Not authenticated");
  return userId;
}

/** Wraps a handler so a thrown Response (e.g. from requireUser) becomes the actual response. */
export async function withAuth(
  req: Request,
  handler: (userId: string) => Promise<Response> | Response,
): Promise<Response> {
  try {
    const userId = requireUser(req);
    return await handler(userId);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}