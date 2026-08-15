# Encodr — Fullstack Take-Home

Thanks for taking the time! This is a small **media transcoding dashboard**. You'll build a flow where
a signed-in user creates an encode **job** from a media URL, starts a **transcode run**, watches its
**progress stream in live**, and sees the **output renditions** when it finishes.

The full brief — requirements, the API contract, and what we look for — is in **`BRIEF.md`** in this
repo. Read it first; this README only covers running the scaffold.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run test:run   # tests
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

Requires **Node 20+**. **Demo login:** `demo@encodr.dev` / `password123`.

**Magic failure URL:** `https://cdn.example.com/videos/corrupt.mp4` — the run state machine fails this
one partway through (at ~14s) so you can see the error/retry path. Use any other `https://` media URL
for a successful run.

## What's implemented

All `TODO(candidate)` markers are filled in. See `SOLUTION-NOTES.md` for a running log of every fix,
design decision, and trade-off — keep it updated as you extend the code.

- **Auth** (`lib/server/auth.ts`) — JWT-style HMAC-SHA256 tokens via `node:crypto` (no new deps).
  Short-lived access token (60s) + 7-day refresh token, type-enforced (`access` vs `refresh`),
  constant-time signature verification.
- **API routes** (`app/api/**`) — login, refresh, jobs (list/create/detail), runs (start/get), and an
  authenticated **SSE** progress stream. Shared Zod validation; failures return `422` with
  `fieldErrors` the client maps back onto form fields.
- **Run state machine** (`lib/server/store.ts`) — `computeRun(record, now)` is a **pure function of
  elapsed time**: QUEUED → DOWNLOADING → PROBING → TRANSCODING → PACKAGING → COMPLETED over ~26.5s,
  with monotonic cumulative progress. Job `status` is derived from the latest run.
- **Client** (`lib/client/*`) — 401 → single silent refresh → one retry (single-flight, no refresh
  loop on bad login, logout event on refresh failure), SSE subscription hook with cleanup,
  create/start mutations, and the job list + detail screens.
- **Tests** — 44 committed unit/integration tests (`__tests__/`). Additionally, 9 Playwright browser
  checks were run from a separate scratch Playwright project covering the whole flow (login → create
  → run → results, failure/retry, mobile viewport, keyboard nav); that scratch project is not part of
  this repository.

## Key design decisions

- **SSE authentication** — the stream requires a `Bearer` token in the `Authorization` header
  (verified via `getUserIdFromRequest`). Native `EventSource` can't send headers, so the client uses
  `@microsoft/fetch-event-source`. The endpoint polls `computeRun()` every 600ms, diffs frames to
  avoid flooding, and closes cleanly on a terminal stage.
- **Refresh/retry** — the request wrapper (`lib/client/api.ts`) refreshes once on a `401` and retries
  the original request. All concurrent 401s share a single in-flight refresh promise. Auth routes are
  excluded so a failed login never triggers a refresh loop.
- **State machine as pure function** — `computeRun` derives everything from elapsed time, so there's
  no mutation/race and it's trivially testable. Progress is cumulative across the full timeline and
  is regression-tested at stage boundaries. The SSE stream just polls it.
- **In-memory state** — a module-level `Map`; restarting the dev server wipes data (allowed by the
  brief).
- **Ownership** — jobs and runs are associated with the authenticated user ID, and job/run/SSE
  lookups enforce that ownership. The demo still has one login, but the API boundary is ready for
  additional users.
- **Token secret** — `ENCODR_TOKEN_SECRET` env var with a dev-only fallback constant (mock auth, no
  real data).

## What I'd do next (with more time)

- Optimistic UI on create with rollback on failure.
- SSE reconnect/resume after a transient disconnect (currently one-shot).
- Persist job/run data to a real store instead of the in-memory `Map`.
- Key rotation / logout-all-devices for refresh tokens.
- Rate limiting on the auth endpoints.
