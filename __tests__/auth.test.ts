import { describe, expect, it } from "vitest";
import {
  authenticate,
  findUser,
  getUserIdFromRequest,
  issueTokens,
  verifyRefreshToken,
} from "@/lib/server/auth";

describe("authenticate", () => {
  it("accepts the demo user", () => {
    const user = authenticate("demo@encodr.dev", "password123");
    expect(user?.email).toBe("demo@encodr.dev");
    expect(user).not.toHaveProperty("password");
  });

  it("is case-insensitive on email", () => {
    expect(authenticate("DEMO@encodr.dev", "password123")).not.toBeNull();
  });

  it("rejects wrong password", () => {
    expect(authenticate("demo@encodr.dev", "nope")).toBeNull();
  });

  it("rejects unknown email", () => {
    expect(authenticate("other@encodr.dev", "password123")).toBeNull();
  });
});

describe("tokens", () => {
  it("issues access + refresh tokens", () => {
    const { accessToken, refreshToken } = issueTokens("u_demo");
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  it("getUserIdFromRequest resolves a valid Bearer access token", () => {
    const { accessToken } = issueTokens("u_demo");
    const req = new Request("http://localhost/api/jobs", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(getUserIdFromRequest(req)).toBe("u_demo");
  });

  it("returns null without a token", () => {
    expect(getUserIdFromRequest(new Request("http://localhost/api/jobs"))).toBeNull();
  });

  it("rejects an access token used as a refresh token", () => {
    const { accessToken } = issueTokens("u_demo");
    expect(verifyRefreshToken(accessToken)).toBeNull();
  });

  it("accepts a valid refresh token", () => {
    const { refreshToken } = issueTokens("u_demo");
    expect(verifyRefreshToken(refreshToken)).toBe("u_demo");
  });

  it("rejects a tampered token", () => {
    const { accessToken } = issueTokens("u_demo");
    const tampered = accessToken.slice(0, -1) + (accessToken.endsWith("a") ? "b" : "a");
    const req = new Request("http://localhost/api/jobs", {
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(getUserIdFromRequest(req)).toBeNull();
  });
});

describe("findUser", () => {
  it("does not leak the password", () => {
    const user = findUser("u_demo");
    expect(user).not.toHaveProperty("password");
    expect(user?.name).toBe("Demo User");
  });
});