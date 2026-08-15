import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/client/token-store";

export class ApiError extends Error {
  status: number;
  /** Field-level errors from a 422, keyed by form field name. */
  fieldErrors?: Record<string, string[]>;
  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Fired when auth is unrecoverable. The auth provider listens for this and logs the user out. */
export const AUTH_LOGOUT_EVENT = "encodr:logout";

async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed";
  let fieldErrors: Record<string, string[]> | undefined;
  try {
    const body = await res.json();
    if (body?.detail) detail = body.detail;
    if (body?.fieldErrors) {
      fieldErrors = body.fieldErrors;
      detail = "Validation failed";
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, detail, fieldErrors);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

// --- silent refresh (single-flight) ---

/**
 * A single in-flight refresh promise shared by every request that 401s at the same time.
 * Prevents a "refresh stampede" — when N requests hit 401 together, they all await the SAME
 * refresh call instead of firing N of them. Reset to null once it settles.
 */
let inflightRefresh: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) return false;
    setTokens({ accessToken: body.accessToken });
    return true;
  } catch {
    return false;
  }
}

function singleFlightRefresh(): Promise<boolean> {
  if (!inflightRefresh) {
    inflightRefresh = doRefresh().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

// --- request wrapper ---

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const access = getAccessToken();
  if (access) headers["authorization"] = `Bearer ${access}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const doFetch = (h: Record<string, string>) =>
    fetch(path, {
      method: options.method ?? "GET",
      headers: h,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

  let res = await doFetch(headers);

  // One 401 → one silent refresh → one retry. Skip this for auth routes (login/refresh): a 401 there
  // is a legitimate "bad credentials / bad refresh token", not a stale access token.
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await singleFlightRefresh();
    if (refreshed) {
      const retryHeaders: Record<string, string> = { ...headers };
      const newAccess = getAccessToken();
      if (newAccess) retryHeaders["authorization"] = `Bearer ${newAccess}`;
      res = await doFetch(retryHeaders);
    } else {
      // Refresh failed — auth is unrecoverable, send everyone back to sign-in.
      clearTokens();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
      }
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
};