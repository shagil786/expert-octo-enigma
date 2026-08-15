import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, AUTH_LOGOUT_EVENT } from "@/lib/client/api";
import { setTokens, clearTokens, getAccessToken } from "@/lib/client/token-store";

// Mock global fetch. jsdom provides localStorage for the token store.
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  setTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
});

afterEach(() => {
  clearTokens();
  vi.unstubAllGlobals();
});

describe("api wrapper", () => {
  it("attaches the bearer token and parses JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "j_1" }]));
    const result = await api.get<{ id: string }[]>("/api/jobs");
    expect(result).toEqual([{ id: "j_1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs");
    expect(init.headers.authorization).toBe("Bearer access-1");
  });

  it("throws ApiError with status on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Not authenticated" }, 401));
    // First call 401s; refresh fails (no token path returns false) → auth cleared.
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired refresh token" }, 401));
    await expect(api.get("/api/jobs")).rejects.toMatchObject({ status: 401 });
  });

  it("surfaces fieldErrors from a 422", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Validation failed", fieldErrors: { sourceUrl: ["bad url"] } }, 422),
    );
    await expect(api.post("/api/jobs", { sourceUrl: "x" })).rejects.toMatchObject({
      status: 422,
      fieldErrors: { sourceUrl: ["bad url"] },
    });
  });
});

describe("401 → silent refresh → retry", () => {
  it("refreshes once and retries the original request", async () => {
    // Call 1: original request → 401. Call 2: refresh → new access token.
    // Call 3: retried request → 200.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Not authenticated" }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access-2" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "j_2" }]));

    const result = await api.get<{ id: string }[]>("/api/jobs");
    expect(result).toEqual([{ id: "j_2" }]);
    expect(getAccessToken()).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The retried request carried the new token.
    const retryInit = fetchMock.mock.calls[2][1];
    expect(retryInit.headers.authorization).toBe("Bearer access-2");
  });

  it("does not retry auth endpoints (no refresh loop on bad login)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid email or password" }, 401));
    await expect(
      api.post<{ accessToken: string }>("/api/auth/login", {
        email: "demo@encodr.dev",
        password: "wrong",
      }),
    ).rejects.toMatchObject({ status: 401 });
    // Only ONE fetch — no refresh attempt, no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches AUTH_LOGOUT_EVENT when refresh fails", async () => {
    const dispatched = vi.fn();
    window.addEventListener(AUTH_LOGOUT_EVENT, dispatched);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Not authenticated" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired refresh token" }, 401));

    await expect(api.get("/api/jobs")).rejects.toMatchObject({ status: 401 });
    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();

    window.removeEventListener(AUTH_LOGOUT_EVENT, dispatched);
  });
});

describe("single-flight refresh", () => {
  it("shares ONE refresh across concurrent 401s", async () => {
    // N requests 401 at once. The refresh endpoint must be hit exactly once.
    fetchMock
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/refresh") {
          return jsonResponse({ accessToken: "access-2" });
        }
        const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
        // Any request without a valid new access token → 401.
        if (auth === "Bearer access-1") return jsonResponse({ detail: "Not authenticated" }, 401);
        return jsonResponse([{ id: "j_x" }]);
      });

    const results = await Promise.all([
      api.get<{ id: string }[]>("/api/jobs"),
      api.get<{ id: string }[]>("/api/jobs"),
      api.get<{ id: string }[]>("/api/jobs"),
    ]);

    expect(results).toHaveLength(3);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/auth/refresh");
    expect(refreshCalls).toHaveLength(1); // single-flight: exactly one refresh
  });
});