import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { User } from "@/lib/types";

// Mock auth for the exercise — no real identity provider, no database.
//
// Tokens are signed JWT-style blobs (header.payload.signature) using HMAC-SHA256 from node:crypto —
// no external dependency. Access tokens live ~60s so the client's silent-refresh path is observable;
// refresh tokens live 7 days.
//
// The SSE stream authenticates with an Authorization: Bearer header. Native EventSource can't send
// headers, so the client uses @microsoft/fetch-event-source (see lib/client/use-run-stream.ts).

// In production this comes from an env var / secrets manager. A dev fallback is fine here because
// there is no real identity provider and no production data.
const SECRET = process.env.ENCODR_TOKEN_SECRET ?? "encodr-dev-secret-do-not-use-in-prod";
const ACCESS_TTL_SEC = 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
const ALGORITHM = "sha256";
const JWT_ALG = "HS256";

// The one hard-coded user. Documented in the README.
const USERS: (User & { password: string })[] = [
  { id: "u_demo", email: "demo@encodr.dev", name: "Demo User", password: "password123" },
];

export function authenticate(email: string, password: string): User | null {
  const user = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

export function findUser(id: string): User | null {
  const user = USERS.find((u) => u.id === id);
  if (!user) return null;
  const { password: _pw, ...safe } = user;
  return safe;
}

// --- token helpers ---

interface TokenPayload {
  sub: string; // userId
  typ: "access" | "refresh";
  iat: number; // issued at (epoch seconds)
  exp: number; // expiry (epoch seconds)
  jti: string; // unique token id
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(unsigned: string): string {
  return createHmac(ALGORITHM, SECRET).update(unsigned).digest("base64url");
}

function mintToken(userId: string, typ: TokenPayload["typ"]): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = typ === "access" ? ACCESS_TTL_SEC : REFRESH_TTL_SEC;
  const payload: TokenPayload = {
    sub: userId,
    typ,
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
  };
  const header = b64url(JSON.stringify({ alg: JWT_ALG, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign(unsigned)}`;
}

function verifyToken(token: string, expectedTyp: TokenPayload["typ"]): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, signature] = parts;
  const unsigned = `${headerB64}.${bodyB64}`;

  // Constant-time comparison to avoid leaking the signature.
  const expected = sign(unsigned);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.typ !== expectedTyp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!findUser(payload.sub)) return null; // user no longer exists
  return payload;
}

export function issueTokens(userId: string): { accessToken: string; refreshToken: string } {
  return {
    accessToken: mintToken(userId, "access"),
    refreshToken: mintToken(userId, "refresh"),
  };
}

export function issueAccessToken(userId: string): string {
  return mintToken(userId, "access");
}

/** Return the authenticated userId from the request, or null. Reads a Bearer token. */
export function getUserIdFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  const payload = verifyToken(token, "access");
  return payload?.sub ?? null;
}

/** Verify a refresh token and return its subject (userId), or null. */
export function verifyRefreshToken(token: string): string | null {
  const payload = verifyToken(token, "refresh");
  return payload?.sub ?? null;
}