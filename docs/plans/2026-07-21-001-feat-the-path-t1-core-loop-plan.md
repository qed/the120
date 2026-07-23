---
title: "feat: The Path T1 — the core loop at /path"
type: feat
status: completed
completed: 2026-07-23
date: 2026-07-21
deepened: 2026-07-21
origin: docs/brainstorms/2026-07-21-the-path-app-requirements.md
tier: T1
next: docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md
---

# feat: The Path T1 — the core loop at `/path`

**Plan 1 of 3.** T1 → [T2](2026-07-21-002-feat-the-path-t2-the-year-plan.md) → [T3](2026-07-21-003-feat-the-path-t3-completeness-plan.md).

## Overview

Build the core loop of The Path, an authenticated multi-role application at `/path`. A student captures evidence of real-world curriculum work, submits it, a parent verifies it against a published *Done when* line, and the student is told. Everything else in the product amplifies that loop.

T1 is the boundary at which **a family can work criterion 1.1 end to end in the app** — five tasks captured, submitted, verified, celebrated at Tier 1, with the criterion entering review. Nothing is faked.

**One honest narrowing against the origin document.** The origin's success criterion for 1.1 ends with "the crest awarded, the Criterion Recap generated". The crest reveal is T2 Unit 5 and the Recap is T2 Unit 8. T1 therefore satisfies a **reduced form** of that criterion — the loop runs and the criterion enters review, but the ceremony that closes it lands in T2. This is a deliberate scope decision, recorded here rather than discovered when someone asks whether T1 is done.

Three capabilities here have **zero precedent in this repo**: student identity, media storage, and offline-capable capture. They carry the most risk and drove the most research.

## Problem Frame

The curriculum exists as prose (`artifacts/The Path/the-path-home-study-curriculum-brief.md`) and as a marketing section (`app/2026-27/sections/ThePath.tsx`). A family running it has nowhere to file evidence, no verification trail, and no way to see where their child is. See origin: `docs/brainstorms/2026-07-21-the-path-app-requirements.md`.

Per **D22** this build deliberately does not target the 19 Sept 2026 cohort start; families run Phase 01 on paper this autumn and a paper-to-app migration is a separate deliverable.

## Requirements Trace

- **R1–R6, R29, R31, R32** — parent-provisioned student accounts, independent simultaneous sessions, evidence visibility, the no-self-verification guarantee, rate limiting, linkage to `public.children`, parent-driven reset.
- **R7–R9, R12, R27, R30** — app at `/path`, per-role notification transport, in-app surface, three-timestamp instrumentation. **R8 in full: the phone and desktop app shells are separately authored layouts, not one responsive tree** — the prototype uses a single container query and switches between hand-built phone (390×812) and desktop (236px sidebar + sticky top bar) scenes. Shipping both is close to double the student and parent UI surface and is budgeted as such in Units 12 and 13. **T1 ships the desktop shell as the verified target (R9); the phone layout follows in the same units and is not held to the same polish bar.**
- **R13–R15, R17, R28** — all evidence types including log tables, native video, append-only on verify, offline capture, private storage with signed URLs.
- **R18–R20** — both skins on placeholder art.
- **R22–R24** — versioned content package with a per-`ProgramVersion` manifest, both copy registers, criteria reconciled with `app/2026-27/data.ts`.

Inherited behaviour in T1: task state machine and concurrency (brief §9.1, §9.2, §9.5), Criterion Review (§9.3), data model (§10), Tier 1 celebration and the Not Yet moment (§5), roles (§14), privacy non-negotiables (§11).

Decisions carried in: **D15–D27** (origin document; D27 — per-student program-version pinning — was added during the deepening pass).

## Scope Boundaries

- No phase review or countersign — T2.
- No celebrations above Tier 1, no AI layer, no wisdom, no export, no PWA install or web push, no skin *toggle* (both skins render; switching is T2).
- No Guide surfaces, Field Guides, or math gate — T3. The engine exposes a `gateStatus` hook so the gate is additive.
- No native mobile app, no app-store work, no iOS-PWA-specific engineering beyond what offline durability requires (R11).
- **No `cacheComponents`.** It is off in `next.config.ts` and enabling it is an app-wide switch.
- Standing non-goals: no payments, no leaderboards, no social layer, no AI that verifies or gates.

## Context & Research

### Relevant code and patterns

| Purpose | Reference |
|---|---|
| Guard to mirror — pure verdict module + thin wrapper | `app/crm/lib/access.ts` (`resolveStaffAccess`), `app/crm/lib/auth.ts` (`requireStaff`) |
| The R6 clamp, already written | `app/crm/lib/reviews-rules.ts` (`effectiveReviewStatus`) |
| Atomic transition RPC with audit write | `public.move_candidate()` in `supabase/migrations/20260713110000_crm_core.sql` |
| CAS claim-then-send and CAS-guarded unclaim | `app/lib/welcome/send.ts`, `app/lib/welcome/welcome-rules.ts` |
| Dedupe-key-after-effect (the offline-sync model) | `app/lib/calcom/events.ts` + `public.processed_webhook_events` |
| Server action canon: gate → zod → service-role → audit → revalidate → `{success,error?}` | `app/crm/lib/actions/welcome.ts`, `app/crm/lib/actions/families.ts` |
| Never-throw email wrapper, 8s abort | `app/lib/email.ts` |
| Cron auth shape | `app/api/cron/nurture/route.ts` |
| Proxy gate (matcher is currently the single string `"/crm/:path*"`) | `proxy.ts` |
| Content to reconcile against | `app/2026-27/data.ts`, `app/2026-27/path-criteria.ts` |
| Design prototype (Vite + Tailwind v3 — port, do not copy) | `artifacts/The Path/v1 Path Design/src/components/**` |
| Visual contract, verbatim copy, tokens | `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/` |
| Next 16 PWA guide (bundled locally) | `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` |

### Institutional learnings that change this plan

- **`supabase db push` is permanently dead here** — no DB password exists. All DDL goes through the Supabase Management API with the CLI token from Windows Credential Manager: `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`. Decode with `Marshal.Copy` → `Encoding.UTF8.GetString` (never `PtrToStringUni`); send UTF-8 **bytes** with `charset=utf-8`; type the param `[string]`; record the version in `supabase_migrations.schema_migrations` **only after** the DDL succeeds.
- **A committed migration is not an applied migration.** `docs/solutions/integration-issues/dormant-migration-not-applied-prerequisite-table-missing-2026-07-17.md`. `select to_regclass('public.x')` before applying dependents; make every migration idempotent.
- **One migration file per rollout phase.** `docs/solutions/workflow-issues/split-phase-migrations-...-2026-07-14.md`. Postgres aborts the whole file on one error; there is no "apply half a file".
- **`"use server"` vs `import "server-only"` are different boundaries.** Every export of a `"use server"` file is a client-callable Server Action; `server-only` throws under `tsx`. `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-...-2026-07-17.md`, `.../server-only-import-breaks-tsx-scripts-plain-core-re-export-2026-07-21.md`. **This decides Unit 3's shape and is the cheapest decision now, the most expensive later.**
- **`vitest.config.ts` `include` is an explicit allowlist** — a new test directory silently never runs while `npm run test` stays green. `docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md`.
- **No jsdom, no `@testing-library/react`, no component tests, no CI.** 44 test files, all `.test.ts`, `environment: "node"`. Only pure logic is defensible.
- **Full-row upserts poison guard triggers.** `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md` and `.../stale-status-echo-...-2026-07-14.md`. A `BEFORE INSERT` trigger's coercion propagates into `EXCLUDED`. Guards coerce, never raise — so `{error: null}` does not mean the row is what you asked for. Echo interpretation is **three-way**: matches → success; behind intent → retryable; **ahead of intent → adopt the DB value**.
- **Seed prose drifts.** `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md` — em-dashes flattened on application; a later UPDATE keyed on that text matched 0 rows silently. See Decision 7.
- **Env-less `next build` must pass.** `docs/solutions/build-issues/env-less-build-hangs-render-time-supabase-clients-...-2026-07-17.md`. Never construct a Supabase client in a render path (including `useState`/`useRef` initializers); never interpolate a possibly-undefined env var into a fetch URL — the patched fetch hangs 60s per page rather than throwing.
- **Client-side awaited server actions need `try/catch/finally`.** `docs/solutions/ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md`. The guard can `redirect()` (throws) before the action's own try.
- **Escape user-supplied values in email HTML**, `html` part only. `docs/solutions/security-issues/admissions-notification-email-html-injection-...-2026-07-14.md`.
- **Never mutate on GET from an email link** — scanners prefetch. `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-...-2026-07-16.md`.
- **`on_parent_created` auto-creates a `families` row on every `parents` insert.** `docs/solutions/best-practices/bulk-import-crm-leads-families-derived-stage-parent-id-consent-2026-07-15.md`.

### Next.js 16 constraints (from `node_modules/next/dist/docs/`, per AGENTS.md)

- **`proxy.ts` is the renamed middleware.** Runtime is `nodejs` and **cannot be configured** — setting `runtime` throws. `config.matcher` must be statically analyzable.
- **Server Action body limit is 1 MB.** Separately `experimental.proxyClientMaxBodySize` defaults to 10 MB and **silently truncates** an oversized buffered body with only a warning. And **Vercel Functions cap request and response bodies at 4.5 MB** (`413 FUNCTION_PAYLOAD_TOO_LARGE`). Three independent reasons bytes must not traverse our origin — Decision 4.
- **Server Actions dispatch sequentially per client**; `Promise.all` over actions does not parallelize.
- **A proxy matcher that excludes a path also skips Server Function calls on that path.** Next's own docs: verify auth inside every Server Function.
- **Sync `cookies()`/`headers()`/`params`/`searchParams` are fully removed** — all must be awaited.
- **`revalidateTag(tag)` single-arg is a TypeScript error.** Use `revalidatePath` or `refresh()` for read-your-writes.
- **Multiple root layouts require deleting `app/layout.tsx`** and force a **full page reload** on cross-root navigation — see Decision 3.
- **Parallel routes now require an explicit `default.tsx`** or the build fails.
- **Once streaming starts the status code is committed** — do auth checks before any `await`, or reject in the proxy.
- **Layouts do not re-render on navigation** — never put the auth check only in a layout.

### Supabase constraints

- **`@supabase/ssr` 0.12.0 → 0.12.3 available**; cookie-correctness fixes. The `setAll` callback gained a `headers` argument in 0.10 — **this repo omits it**, and `proxy.ts` returns `redirect`/`rewrite` **without copying refreshed auth cookies**. Both desync sessions. Unit 1.
- **TUS resumable above 6 MB**, `chunkSize` exactly `6 * 1024 * 1024` (docs say do not change it), against `https://{ref}.storage.supabase.co/storage/v1/upload/resumable` — the direct storage hostname, not the project URL. **The upload URL is valid 24 hours**; persist it *and* its creation time, and treat >24h as restart-from-zero. Concurrent clients on one URL get **409**.
- TUS auth accepts either the user's JWT (RLS applies) or a server-minted token in the **`x-signature` header**. Prefer `x-signature`: authorize server-side at mint time so the child's client never needs a long-lived session for the upload leg.
- **`createSignedUploadUrl` expiry is fixed at 2 hours**, not configurable.
- **Signed download URLs are signed with a per-project key separate from the Auth JWT key.** Rotating auth keys does not invalidate them and **there is no self-serve revocation** — a leak requires contacting Supabase support. Keep expiries short.
- **Signed URLs defeat the CDN.** Each unique token is a separate cache key, so every freshly-minted URL is a cache miss billed at $0.09/GB uncached vs $0.03/GB cached. **Mint one URL per object, store it in Postgres, reuse until near expiry.** Never mint per render.
- **Deleting `storage.objects` rows via SQL orphans the underlying file permanently.** Deletion must go through the Storage API — this matters enormously once a retention obligation exists.
- **`storage.allow_any_operation()`** distinguishes listing a bucket from reading an object; without it users can enumerate filenames across families.
- **RLS performance:** wrap function calls as `(select fn())` so Postgres builds an initPlan and evaluates once per statement, not per row (a security-definer function measured 178,000 ms → 12 ms). Specify `TO authenticated`. Index policy columns.
- **`app_metadata` changes are not reflected in `auth.jwt()` until token refresh.** Never optimize the DB lookup away into a pure claim check.
- **Never module-scope a Supabase client** — Vercel Fluid Compute reuses warm instances and would leak sessions between users.
- ⚠️ **`supabase/config.toml` is misleading and its `enable_confirmations = false` does NOT describe the hosted project.** The Unit 2 spike (run 2026-07-21 against production) settled this: an account created **without** `email_confirm: true` gets `email_confirmed_at: NULL` and its sign-in fails with **"Email not confirmed"**. `artifacts/roadmap.md` was right — confirmations were turned ON in production on 2026-07-13. Treat `config.toml` as local declarative config only; it is not a source of truth for the hosted project's auth settings.
- **Spike result (Unit 2, 2026-07-21):** `admin.createUser({ email, password, email_confirm: true })` on a system-generated **non-deliverable** address works, and the account signs in with `signInWithPassword` returning a session. No MX or deliverability validation occurs — even a non-routable `.invalid` domain is accepted. **R1/R2/R31/R32 are viable as designed**, provided `email_confirm: true` is always passed.
- **`ca-central-1` is available**; region is chosen at project creation and migration later is painful. Relevant to the launch gate below.

### Offline and media research

- **Background Sync is Chromium-only.** Not in Firefox, not in Safari desktop, **not in iOS Safari, in any version**. ~76% global. For an app whose capture device is a child's phone, it is an *enhancement*, never the mechanism. The mechanism is an **IndexedDB queue drained on foreground signals** (`load`, `online`, `visibilitychange → visible`, post-auth-refresh).
- **iOS wipes all script-writable storage — IndexedDB, Cache API, and the service worker registration — after 7 days of browser use without interaction with the origin.** **Installed home-screen web apps are exempt.** This makes install a **data-durability requirement**, not a nicety: a child who captures a 400 MB video in a Safari tab and returns in eight days has lost it. Mitigations: call `navigator.storage.persist()` and expect `false` on Safari; warn loudly whenever queued bytes exist and the app is not installed.
- **iOS kills the service worker aggressively when backgrounded** — an upload in flight from SW context dies. Run uploads from the **page context**, and rely on TUS resume.
- **Serwist confirmed unusable here.** `@serwist/next` 9.5.11 is a **webpack** plugin and Next 16 defaults to Turbopack; `@serwist/turbopack` has been in preview since Sept 2025. `next-pwa` last published 2022. **Hand-roll the service worker** per Next's own guide.
- **iOS Safari no longer transcodes camera-roll video on upload** (since 13.6.1) — you receive the original, commonly **HEVC in a `.mov`**, which **desktop Firefox and GPU-less Chrome cannot play**. A child uploads on iPhone, a parent opens review on a Windows laptop, and sees a black rectangle. **`MediaRecorder` on iOS writes H.264/AAC MP4** — universally playable, free, no vendor. Record in-app; treat the file picker as the fallback path needing normalization (Mediabunny v1.50.9, pure-TS, WebCodecs-backed, tree-shakes to ~5 kB — the 2026 replacement for `ffmpeg.wasm`).
- **Always generate a poster frame on-device at capture time.** Cheap, universal, and the review list still renders when a video is unplayable.
- **Canvas re-encode strips EXIF orientation**, producing rotated photos — a classic bug. EXIF GPS/timestamp also has genuine evidentiary value here. Preserve server-side, strip on export; the policy belongs with the launch gate.
- **Range-request support for `<video>` seeking over Supabase signed URLs is undocumented.** Verify with `curl -I -H 'Range: bytes=0-1024'` against a real signed URL before designing the player; a 200 instead of 206 means seeking is broken.
- **Do not build a serverless ffmpeg pipeline** — 300s/800s function limits and bundle size make it a trap. If client-side normalization proves painful, **Cloudflare Stream** is the paved escape hatch at roughly $10/month at this scale, encoding and ingress free.
- Storage cost on Supabase at 100 families: **~$33/mo year 1**, ~$54/mo year 2. Egress stays inside the 250 GB allowance. There is **no cold tier** — a permanent record accumulates at full rate.

## Key Technical Decisions

1. **Authorization boundary: service-role behind a `requirePathUser()` gate, not RLS-as-primary.** R5's graph — student reads self, either parent of a family, siblings see position but not evidence, a cohort Guide reads across ~24 families — cannot be expressed in this repo's single-column-ownership RLS idiom, and the repo's precedent for anything non-trivial is service-role reads inside a guarded server context. All Path tables get **RLS enabled with zero policies**, matching `gauntlet_tournament_events`. *Trade-off:* no direct-from-browser PostgREST path and no RLS backstop if a guard is missed — mitigated by an exhaustively tested pure verdict module and by the guard running inside every Server Function, which Next 16 requires anyway. **Storage objects are the exception**: they get real RLS policies — but for a reason worth stating precisely, because the obvious one is backwards. The server-minted `x-signature` upload token and the server-minted signed download URL are both authorized at mint time and are **not** evaluated under the caller's Postgres identity, so RLS covers neither leg. RLS on `storage.objects` exists because **Unit 6 mints genuine Supabase Auth sessions for students and parents**, and an authenticated JWT can hit the storage REST API directly. That is the threat the policy defends. Unit 9 must therefore name the policy's subject: a `TO authenticated` SELECT policy keyed on the **family relationship**, not on `student_id` alone — a policy on `(storage.foldername(name))[1]` against a `{student_id}/…` path would grant the student and deny the parent, who must read their child's evidence.

2. **Role grants, not a role enum.** `User.role: student|parent|guide` cannot represent a parent who is also a Guide, which D24 requires forbidding for a specific review. Model `path_role_grants (user_id, role, scope_type, scope_id)`. One-line change now, multi-table migration after 120 families are linked.

3. **Fonts: extend the existing root layout; do not split into route groups.** Multiple root layouts require deleting `app/layout.tsx`, moving every page on disk, putting `/` inside a group, and **forcing a full page reload on every marketing → `/path` navigation**. Instead add Fraunces, Inter, and Spline Sans Mono to `app/layout.tsx` with **`preload: false`**, so marketing pages declare but never fetch them. *Trade-off:* three extra `@font-face` declarations site-wide.

4. **Evidence never uploads through our origin.** Client requests a signed upload slot from a Server Action (metadata only), then uploads **directly to Supabase Storage** — plain `upload()` under 6 MB, TUS above. This sidesteps three independent limits: the 1 MB Server Action cap, the 10 MB proxy **silent truncation**, and Vercel's hard 4.5 MB function body cap.

5. **Every state transition goes through one atomic security-definer RPC**, modelled on `public.move_candidate()`: validate → transition → cascade → audit, in one transaction. This is simultaneously the answer to concurrent verification (first write wins via a CAS predicate), review attempts, and R6's audit requirement — "no path advances without an adult verification record" becomes enforceable by inspecting one function.

6. **`reviewOpenedAt` timestamp, not a seventh enum state.** Gives R30's three timestamps, §9.1's withdraw legality, and the handoff's two distinct chips, without widening the enum or risking the documented TS-enum/DB-CHECK drift.

7. **Curriculum prose never enters SQL.** A `tsx` script parses the markdown into a committed typed TS module; the DB stores only stable slug IDs, sequence, and version. Sidesteps the recorded em-dash seed drift entirely, keeps content diffable in git, removes a DB round-trip from every render.

8. **Notification durability is T1.** A parent who never learns a submission exists is a core-loop failure by the tiering test itself. Build `path_notification_sends` with a unique-constraint claim, a `CRON_SECRET`-gated retry cron, and Resend's `Idempotency-Key`.

9. **Skins are two token namespaces swapped by class, not runtime CSS-variable overrides.** Tailwind v4.3.2's `@theme` **cannot be scoped** — verified against the compiled implementation, which merges all blocks into one `:root, :host` rule with no scoping modifier. And `@theme inline` compiles utilities to *literal* values, so overriding `--color-*` under a `.trail` class does nothing. Ship `--color-hq-*` and `--color-trail-*` in the single global block, swap class names at the subtree root. **Must be settled before any component is written.**

10. **Sync is a rebase, not a replay.** Evidence always attaches — it is a fact about the world and `capturedAt` is honest. Queued *submits* validate against current server state. Evidence landing on an already-verified task is flagged `addedAfterVerification` and surfaced quietly to the reviewer: not a re-verification, but never invisible, because the alternative silently violates R6.

11. **Record video in-app; do not accept camera-roll files as the primary path.** `MediaRecorder` on iOS yields H.264/AAC MP4 that plays everywhere, for free, with no third party holding children's video. The file picker remains available and routes through client-side normalization.

## Open Questions

### Resolved During Planning

- **Crest on a returned criterion?** Never taken back; renders provisional (D23).
- **Self-countersign?** Forbidden; routes to a co-Guide (D24) — forces Decision 2.
- **Guide read scope?** Evidence for their cohort at any time (D25).
- **Single-parent families?** Staff-mediated recovery (D26); needs an audit trail and a written policy.
- **Enforcement boundary, fonts, upload path, transition mechanism, content storage, skin architecture, video capture** — Decisions 1, 3, 4, 5, 7, 9, 11.
- **Withdraw legality** — legal until `reviewOpenedAt` is set (Decision 6).
- **Two parents verify simultaneously** — first write wins via CAS; the loser is told who won and when, not shown an error.
- **Band drift** — snapshot band onto `TaskProgress` at first `available`, so a staff grade correction cannot move a child's bar mid-review.
- **Append-only is a one-way latch** — set at first verification, never lifts, through revocation, Not Yet, criterion return, and phase return.
- **Math gate boundary** — gates at **submit**, never at open (gate itself is T3).

### Deferred to Implementation

- Exact RPC and helper names, and the audit payload shape.
- Whether the token split needs a third shared namespace for genuinely common values — discoverable only once components exist.
- Video compression parameters — depends on measured file sizes from real devices.
- Precise index set on `path_task_progress` — write the queries, then index against real `explain analyze`.
- Practical per-blob IndexedDB ceilings on current iOS. **Spike a real 400 MB write on a real iPhone before committing to the 500 MB cap** — historical Safari IDB blob bugs are well documented and 2026 behaviour is unverified.
- Whether `navigator.storage.persist()` is honoured meaningfully by Safari in installed PWAs (unconfirmed; treat `false` as expected).

## 🚩 Launch Gate — not a unit, and not resolvable by engineering

**The children's-data compliance research failed and produced nothing.** It is unresolved and must not be guessed at.

**Deferred 2026-07-21 (Peter) → roadmap `TP-1`, gated on/after 2026-10-21.** The decision: test users only until a public launch roughly three months out, so the exposure during this build is a handful of consenting families rather than the public. That is a reasonable risk posture and it unblocks building and testing everything below. **This gate no longer blocks T1.**

**Consequence for T1's exit check.** T1 is verified with **test families** — real devices, the full loop, a small number of families who know they are testing. Verification at public scale waits on TP-1.

**✅ Data residency — cleared 2026-07-21.** Counsel confirmed the current Supabase region is acceptable, so R31's linkage to `public.children` and Decision 1's single service-role boundary both stand as planned. This was the last pre-build blocker. **T1 has no remaining gate.** Re-check only if the project is recreated or a second project is introduced.

Before any real family uses this, a dedicated task must answer — and a Canadian privacy lawyer must review the consent flow and privacy policy:

- Whether PIPEDA is still the operative law in 2026 (Bill C-27 / CPPA status after the January 2025 prorogation), plus any Ontario private-sector statute and Quebec Law 25 exposure.
- The consent standard for minors, and whether "verifiable parental consent" in the COPPA sense applies here or something lighter.
- **Third parties incidentally captured** — the door-to-door prospect, the lemonade-stand customer named in a sales ledger. These people never consented and have standing.
- Retention versus the product's permanence promise (PIPEDA Principle 4.5), and what happens when the child turns 18.
- Data residency and cross-border transfer disclosure — `ca-central-1` is available but **region is fixed at project creation**, so this must be decided before Unit 5 if it matters.
- **Whether any AI vendor trains on or retains API-submitted images of children** — this is a compliance question wearing an engineering hat and belongs in the same task. It gates T2's AI units.

Engineering readiness that *does* land in T1: the `redacted_at` / `redacted_by` / `redaction_reason` columns (Unit 10), and the rule that object deletion goes through the Storage API, never SQL.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
stateDiagram-v2
    [*] --> locked
    locked --> available: predecessor verified
    available --> in_progress: opened / evidence added
    in_progress --> submitted: submit (band snapshotted at first available)
    submitted --> in_progress: withdraw (legal only while reviewOpenedAt is null)
    submitted --> verified: verify (CAS; first write wins)
    submitted --> not_yet: Not Yet + required note
    not_yet --> in_progress: student resumes, evidence intact
    verified --> not_yet: revoke by original verifier, before criterion review clears
    verified --> not_yet: criterion review returns this task
    note right of verified
      Append-only latches here and never lifts.
      On a return, later-sequence verified tasks are
      NOT relocked — they become display-blocked and
      un-submittable until the returned task clears.
    end note
```

**Why bytes leave our origin immediately:**

```
browser                    Server Action            Supabase Storage
   |  request upload slot      |                          |
   |-------------------------->|  metadata only, <1MB     |
   |                           |  guard + quota + mint    |
   |  slot: strategy + token   |                          |
   |<--------------------------|                          |
   |                                                      |
   |  PUT bytes (plain <6MB / TUS >6MB, x-signature)      |
   |----------------------------------------------------->|
   |  confirm(clientId, storageRef)                        |
   |-------------------------->|  insert EvidenceItem     |
                               |  unique(taskProgressId, clientId)
```

## Implementation Units

**Sixteen units. Unit numbers are stable IDs, not the execution sequence.** *(Sequencing corrected in the 2026-07-21 deepening pass: the old strictly-serial order hid two parallel tracks and misstated Unit 13's constraint.)*

**Execution structure — two parallel tracks after the prerequisites, converging at Unit 7:**

```
1 → 2 ─┬─ 13 (design foundation) ─────┐
       ├─ 4-DDL → 5 → 6 ──────────────┤
       └─ 3 → 4-seed ─────────────────┴→ 7 → 8 → 9 → 10 → 14 → 15 → 11 → 12 → 16
```

*The diagram is a sketch of the three parallel branches; the edges list below is authoritative.*

**Hard edges, stated precisely so a re-sequencer cannot break them:**
- `2 → 13`, and `13 → {6, 9, 10, 11, 14, 15, 16}` — Unit 13 must precede **Unit 6's sign-in page**, the first rendered surface, not merely "any component". Unit 13 has **no** edge into 3, 4, 5, 7, or 8 — it runs as its own parallel branch, not ahead of the identity track. Its early start is chosen for marketing-file soak time (it is the only other unit touching `app/globals.css` / `app/layout.tsx`, and landing it early maximizes time for a regression to surface — the same logic that puts Unit 1 first).
- **Unit 4 splits.** Its **DDL half** (four tables) depends only on Unit 2. Its **seed half** (`scripts/seed-path-content.ts`) depends on Unit 3 **and on the 4-DDL migration having been applied** — a committed migration is not an applied migration, and the seed inserts into tables that only exist once the DDL has actually run. This split is what unlocks the parallel tracks: the identity work — the plan's highest-risk greenfield — no longer waits on the content parser.
- `4-DDL → 5` is a **real** edge (Unit 5's `program_version_id` FK references `path_program_versions`).
- Unit 7 converges the tracks (Dependencies: Units 3, 5 — unchanged).

| Track | Units | Why |
|---|---|---|
| Prerequisites | 1 → 2 | Session fixes; test harness — including the `admin.createUser` spike that falsifies the identity layer's load-bearing assumption on day one |
| Design foundation | 13 | Before Unit 6's sign-in surface; soak time on shared marketing files |
| Identity track | 4-DDL → 5 → 6 | The highest-risk greenfield, now unblocked from content |
| Content track | 3 → 4-seed | Nothing renders without tasks |
| Convergence | 7 → 8 | The engine needs both content and identity |
| Pipeline | 9 → 10 | Storage, evidence |
| Surfaces | 14 → 15 | Student, then parent |
| Close the loop | 11 → 12 → 16 | Offline sync onto a working surface; notification; celebration |

- [x] **Unit 1: Fix Supabase session handling and bump `@supabase/ssr`**

**Goal:** Correct two pre-existing session-desync bugs before a second gated area depends on the same code.

**Requirements:** Prerequisite to R1, R3, R7.

**Dependencies:** None.

**Files:** Modify `proxy.ts`, `app/lib/supabase/server.ts`, `package.json`. Create `app/lib/supabase/proxy-rules.ts` (pure). Test: `app/crm/__tests__/auth-guard.test.ts`, `app/crm/__tests__/proxy-rules.test.ts`.

**Approach:**
- Add the `headers` argument in `proxy.ts` and write it onto the response via `response.headers.set`. It landed in `@supabase/ssr` 0.10; omitting it compiles fine while silently dropping CDN protection. In `app/lib/supabase/server.ts`, accept the argument but note **no response object is in scope there** — the `cookies()` store cannot set arbitrary response headers, so the CDN-protection headers are the proxy's responsibility. `app/lib/supabase/client.ts` calls `createBrowserClient` with no cookie methods and needs **no change**; it is not in the Files list for that reason.
- **Extract the testable part.** This file gates both `/crm` and `/path` and is the highest-blast-radius change in the plan, but the repo has no way to test a `NextRequest`. Put `mergeAuthCookies(sourceCookies, targetResponse)` and a pure `resolveProxyOutcome({ pathname, session })` returning `pass | login | staff-only | path-login` in `proxy-rules.ts`, and have `proxy.ts` call them. Otherwise the regression test silently reduces to the unchanged-verdict check.
- On the `redirect` and `rewrite` branches in `proxy.ts`, copy `supabaseResponse.cookies.getAll()` onto the new response. Today those branches drop refreshed auth cookies, which can terminate a session prematurely.
- Bump `@supabase/ssr` to 0.12.3. Pin `engines.node` ≥22 (storage-js dropped Node 20 at 2.110.0) and confirm the Vercel project setting matches.
- Keep `getUser()` in `requireStaff()` — it is revocation-sensitive. `getClaims()` is appropriate in the proxy only, since it validates the JWT locally and does not detect server-side logout.
- Do not introduce a module-scoped client anywhere.

**Test scenarios:**
- Happy path: `resolveStaffAccess` verdicts unchanged after the bump.
- Edge case: a proxy redirect response carries the same auth cookie names the pass-through response would have carried.
- Edge case: `"Admin"`, `"ADMIN"`, `"admin "`, `"administrator"` all still resolve to forbidden.

**Verification:** `npm run test` green; a manual `/crm` sign-in survives navigation and a token refresh.

---

- [x] **Unit 2: Test harness and `/path` module skeleton**

**Goal:** Make Path tests capable of running at all, and fix the module layout before any logic exists.

**Requirements:** Prerequisite to every unit below.

**Dependencies:** None.

**Files:** Modify `vitest.config.ts`. Create `app/path/lib/`, `app/path/lib/__tests__/smoke.test.ts`.

**Approach:**
- Add `app/path/**/__tests__/**/*.test.ts` to the `include` allowlist **in this unit**. A directory outside the allowlist silently never runs and the suite stays green.
- Establish the convention: pure `*-rules.ts` modules with no Next, Supabase, or React imports, colocated `__tests__/`. Nothing here can test a React component, so anything that must be defended has to be pure.
- **Run the `admin.createUser` spike here, not in Unit 6.** *(Promoted in the deepening pass.)* The identity layer's single load-bearing assumption — that Supabase Auth accepts a parent-provisioned account on a system-generated non-deliverable address with confirmations disabled — needs nothing but the project and one call, and the origin marks it "not yet tested, and load-bearing for the entire identity layer". Falsify it on day one, not at execution position seven. Create one throwaway account, confirm sign-in works, delete it. If it fails, escalate before any schema work begins. Copy the env-loading pattern from `scripts/seed-staff.ts` (`.env.local` on this machine carries the service-role key); note the spike is machine-bound — env-less machines and worktree agents cannot run it, the same portability class as the untracked-artifacts prerequisite. The spike should also settle whether `admin.createUser` needs `email_confirm: true` despite `enable_confirmations = false` — mailer autoconfirm governs `signUp`, not the admin API.

**Test scenarios:**
- Happy path: a deliberately failing assertion **fails** under `npm run test`, proving the glob took effect — then invert it. Do not verify with `npx vitest run <path>`; that bypasses the config and gives false confidence.

**Verification:** `npm run test` discovers and runs the new file; the `admin.createUser` spike has succeeded (throwaway account created, signed in, deleted) or its failure has been escalated.

---

- [x] **Unit 3: Curriculum content package — parser and manifest**

**Goal:** Turn the curriculum markdown into a typed, versioned, validated module the app and scripts both consume.

**Requirements:** R22, R23, R24.

**Dependencies:** Unit 2.

**Files:** Create `app/path/content/parse-curriculum.ts` (plain core — **no `server-only`, no `"use server"`**), `app/path/content/manifest.ts`, `app/path/content/types.ts`, `scripts/build-path-content.ts`, `app/path/content/generated/program-2026-27.ts` (generated, committed). **Hand-authored sidecars** *(added in the deepening pass — every one manifest-validated, none parser work)*: `app/path/content/log-templates.ts`, `app/path/content/safety-flags.ts`, `app/path/content/evidence-spec.ts`. Test: `app/path/content/__tests__/parse-curriculum.test.ts`, `.../manifest.test.ts`, `.../sidecars.test.ts`.

**Approach:**
- **The `server-only` decision is this unit's most consequential.** The parser must be reusable by a `tsx` script, and `import "server-only"` throws under `tsx`, transitively. Author it plain from the start; retrofitting means touching every importer.
- Parse task IDs `N.N.N`, title, body, the `*Done when:*` line, band variants. **Band variants exist on only ~half the tasks** (63 / 57 / 59 for grades 3–5 / 6–8 / 9–12); the curriculum states a missing band line means identical across bands. Treat absence as inheritance, never as a parse failure.
- **Tasks per criterion is variable:** 2.3 has six, 3.4 has four, all others five. The manifest declares totals per `ProgramVersion`; ingestion asserts parsed content matches the manifest it shipped with, plus an explicit check that 2026-27 declares 25/26/24/25/25 = 125. A revision then ships a new manifest, not a code change.
- **Reconciliation against `app/2026-27/data.ts` is structural, not textual.** The two sources deliberately differ: the curriculum's own "Home-Study Adaptations of Cohort Moments" table strips cohort references (3.4 drops "on a Saturday", 4.5 drops "to the cohort", 5.5 drops "at an intensive"), and nine further criteria are independently reworded. **Zero of the 25 match exactly today** — eight differ only by a trailing period, seventeen substantively, and the encoding drift runs both ways (1.3 has straight quotes in the markdown and curly in `data.ts`; 2.5 has an en dash in one and a hyphen in the other). A string-equality assertion would fail the build on first run for every criterion. Assert instead that the 25 `N.N` IDs exist, that phase and criterion counts and ordering align with `pathSteps`, and that each curriculum criterion links to its `data.ts` index. **State explicitly that curriculum wording and marketing wording are permitted to differ.** If drift detection is still wanted, commit a snapshot of the 25 `data.ts` strings and assert against the snapshot, so a marketing edit fails the build while the intentional home-study rewording does not.
- **Handle the `As written.` sentinel.** 15 of the 57 `6–8` band lines read literally `- **6–8:** As written.`, meaning "inherit the base text" — not a variant. A parser handling only the *absent* case stores `"As written."` as the variant, and a Grade 7 child opening task 1.1.3 sees those words where their instruction should be. Resolve the sentinel (case-insensitive, with or without the period) exactly as an absent line.
- **The kid register does not exist.** The curriculum has no kid-voice task copy — its own open items still ask whether one should be produced. R23 requires it for all 125 tasks and no parser can produce strings nobody wrote. See the content track note below; the parser must **fall back to the standard register, never render blank**, and the manifest must treat a missing kid string as tolerated inheritance rather than a hard failure, or the build cannot go green until an authoring project finishes.
- **Four §10 fields the parser must NOT try to parse** *(deepening pass, verified against the markdown)*. The brief's `UnitTask` carries fields whose information is either absent from the curriculum or present only as irregular prose — every one closes as a **hand-authored sidecar or constant**, never a parser extension:
  - **Log-table templates** — Unit 10 promises them ("the 25-attempt tracker, No Log, sales ledger, and P&L ship as per-task templates") and, before this pass, nothing produced them. The column definitions exist explicitly in prose ("a tracker numbered 1–25 with columns: date, channel, who, response, note", with band overrides like the 9–12 follow-up column) but under varying grammar — hand-author ~8–12 templates in `log-templates.ts`, keyed by task ID, band overrides included. **Column names must be stable**: T2's `headlineStatSpec` will reference them, and free-form grids now mean a migration later.
  - **`safetyFlags`** — a tiny enum (`parent_present`, `approval_gate`, `publishing_rules`) hand-mapped in `safety-flags.ts`. Safety content exists in three inconsistent prose forms and cannot be keyed on. **Highest real-world weight of the four**: Phase 01 *is* the door-to-door phase, and the handoff's task card has a Safety slot that would otherwise render nothing on exactly the tasks (1.2.4, 1.5.x) where test families knock on strangers' doors. Phase 01 coverage is the floor.
  - **`evidenceSpec`** — absent as structure; some tasks (1.2.3's witnessed rehearsal) legitimately have *no* filed artifact. Optional field in `types.ts` plus a Phase-01 sidecar in `evidence-spec.ts`. Where absent, **Unit 14 renders the Done-when line as the evidence standard** — a coherent fallback, since §9.1 never gates submit on spec fulfillment and the parent verifies against Done-when prose anyway.
  - **`isStageMoment`** — derivable: a fixed list of four criterion IDs (`2.5, 3.4, 4.5, 5.5`) as one constant in `manifest.ts`. Unit 14's port of the handoff's 4.5.4 card needs it for the "Live moment" badge.
  - `wisdomContextTags` and `headlineStatSpec` stay out of T1 entirely — reserve optional type fields so T2 doesn't touch every consumer, and author nothing now.
- **The generated module is keyed by version, and consumers never import it directly** *(deepening pass)*. `manifest.ts` exports a `getProgram(versionId)` registry; nothing does `import { program } from "./generated/program-2026-27"`. When a revision ships, the new module lands **beside** the old one — a pinned student still reads theirs, so old modules are permanent fixtures, never deleted or regenerated in place. This is near-zero cost now and a touch-every-consumer refactor after Units 12–16 exist — the same class of decision as the `server-only` split. Honest correction to R22's phrasing: a revision ships a new module *plus* a new manifest, not "a manifest, not a code change".
- UTF-8 safety throughout — the source uses em dashes (—), en dashes (–) and STRAIGHT apostrophes; it contains no curly quotes at all. (`data.ts` does, which is one more reason reconciliation is structural.)

**Carried out of Unit 3's review, for later units:**
- **[T2/T3] Wire generated-module imports before any `getProgram` caller ships.** `registerProgram` runs as an import side effect, so a server component calling `getProgram(versionId)` for a pinned student throws "not registered" unless that version's generated module is in the same module graph. A central barrel that imports every generated module, imported by the engine, closes it. The throw is correct (no silent fallback); the risk is only that the import actually happens on every path.
- **[T2] Criterion-level home-study notes are not yet captured.** Criteria 3.4, 4.5, 5.1, 5.5 open with an italic framing paragraph (3.4's is the "hands-off by design" statement). The parser drops these — they sit between a criterion header and its first task, where `draft` is undefined. `Criterion` has no field for them. Add an optional `note?` and capture it, or a small sidecar, when these surfaces are built.
- **[build] `scripts/build-path-content.ts` is not wired into `package.json`.** A stale or hand-edited generated module can currently drift from the parser without a gate. Add a `pretest`/`prebuild` hook, or a test that diffs a fresh `parseCurriculum()` against the committed module, before real families are on it.

**Prerequisite:** `artifacts/The Path/` is **untracked in git today** (`?? "artifacts/The Path/"`), and the previously tracked copy at `artifacts/the-path-home-study-curriculum-brief.md` is staged for deletion. The single source of 125 tasks, 125 Done-when lines and 179 band variants exists on one machine. **Commit it before this unit starts** — the parser's input must be a tracked file or no other developer, agent, or verification pass can run these tests.
- `app/2026-27/__tests__/data.test.ts` hard-asserts `toHaveLength(5)` on criteria arrays. Still correct for the 25 criteria; do not let that invariant leak into task-level code.

**Execution note:** Implement test-first. The contract is fully knowable from the source, and the failure mode — silent under-parse — is invisible at runtime.

**Test scenarios:**
- Happy path: parsing yields exactly 125 tasks, 25 criteria, 5 phases.
- Happy path: task `1.2.4` parses with title, Done-when line, and three band variants.
- Edge case: criterion `2.3` yields six tasks; `3.4` yields four. Both are required fixtures — a hard-coded five passes every other case.
- Edge case: a task with no band lines resolves each band to the base text, not empty or undefined.
- Edge case: a band line reading `As written.` resolves to the base text, not the literal string. The fixture must be one of the 15 real occurrences.
- Edge case: a task with no kid-register string falls back to the standard register rather than rendering blank.
- Edge case: em-dashes and curly quotes survive byte-identical.
- Error path: a manifest declaring 124 against a 125 parse fails loudly, naming the mismatch.
- Error path: a malformed task ID fails rather than being skipped silently.
- Integration: all 25 `N.N` IDs resolve to a `data.ts` index and the phase/criterion ordering aligns; a reordering of `pathSteps` fails the assertion, a rewording does not.
- Edge case: every sidecar entry's task ID exists in the parsed package — an entry for a nonexistent task fails manifest validation loudly.
- Edge case: the 1.5.2 log template carries the 9–12 follow-up column as a band override; the 3–5 P&L template is three whole-dollar lines.
- Edge case: a task with no evidence-spec entry resolves to the Done-when-as-standard fallback, not to an empty checklist.
- Happy path: `getProgram('2026-27')` returns the module; an unknown version ID fails loudly, never falls back to "latest".

**Verification:** env-less `npm run build` succeeds; the generated module is committed and diffable; every Phase 01 task has its safety flags authored (the door-to-door floor).

---

- [x] **Unit 4: Program version schema and content seed**

**Goal:** Referential integrity for tasks and criteria, without curriculum prose in SQL.

**Requirements:** R22.

**Dependencies:** **Split** *(deepening pass)*: the **DDL half** depends on Unit 2 only — the four tables' shapes are fully decided by this plan and need no parsed content. The **seed half** (`scripts/seed-path-content.ts`) depends on Unit 3. This split is what lets the identity track (4-DDL → 5 → 6) run parallel to the content track (3 → 4-seed).

**Files:** Create `supabase/migrations/<ts>_path_program_content.sql`, `scripts/seed-path-content.ts`. Test: `app/path/content/__tests__/seed-rows.test.ts`.

**Approach:**
- Tables hold **IDs, slugs, sequence, version only** — `path_program_versions`, `path_phases`, `path_criteria`, `path_unit_tasks`. Prose lives in the generated TS module (Decision 7), structurally avoiding the recorded em-dash flattening incident.
- **`path_program_versions` designates the active version** (an `is_current` flag or equivalent) — provisioning (Units 6/15) needs to know which version to pin a new student to, and before this pass nothing supplied that.
- **Content rows are immutable per version** *(deepening pass)*: a revision inserts new rows under a new version ID; it never updates or deletes rows a pinned student references. This is the DB-side companion to Unit 3's keep-old-modules rule, and the seed's "re-run is a no-op" property only covers the same-version case — the revision case is a new-version insert.
- **The seed script prechecks its own tables**: `select to_regclass('public.path_unit_tasks')` first, aborting with a named error if null — the dormant-migration learning applied to this unit's own split halves.
- Idempotent DDL (`create table if not exists`); header states the rollout phase imperatively.
- Apply via the Management API playbook. `to_regclass` **before** applying dependents; record the version only after the DDL succeeds. Check for a timestamp collision before naming the file.

**Test scenarios:**
- Happy path: the row builder emits 125 task rows with stable slugs and correct FK targets.
- Edge case: re-running against existing rows is a no-op, not a duplicate insert.
- Edge case: seeding a second version inserts new rows and leaves every first-version row byte-identical.
- Error path: a task whose criterion slug is absent raises rather than inserting an orphan.

**Verification:** `select count(*) from path_unit_tasks` = 125; a **negative-space** query (`count(*) where criterion_id is null`) = 0. Verify by counting the bad condition, not by absence of error.

---

- [x] **Unit 5: Identity schema — role grants, families, students, cohorts**

**Goal:** The account model, linked to the existing CRM roster.

**Requirements:** R1, R2, R4, R31, D24.

**Dependencies:** Unit 4's **DDL half** only (the `program_version_id` FK below references `path_program_versions`). *(Deepening pass: the old whole-Unit-4 edge was spurious — nothing here needs the seed or the parser — and the old residency-blocked clause was stale; counsel cleared residency 2026-07-21.)*

**Files:** Create `supabase/migrations/<ts>_path_identity.sql`, `app/path/lib/access-rules.ts` (pure), `app/path/lib/auth.ts` (thin `server-only` wrapper). Test: `app/path/lib/__tests__/access-rules.test.ts`.

**Approach:**
- `path_student_profiles` links to `public.children` (R31), which stays authoritative for name and grade; band is **derived**, not stored twice.
- **`path_student_profiles.program_version_id` — NOT NULL FK to `path_program_versions`, set at provisioning, immutable thereafter** *(deepening pass; origin flow-analysis conclusion I9, now recorded as D27)*. Same class as the band snapshot: without it, a content revision silently rewrites an active student's remaining tasks. A sibling provisioned after a revision pins the newer version.
- **FK posture: ON DELETE RESTRICT, stated explicitly** *(deepening pass)*. The repo's house idiom is CASCADE end-to-end (`auth.users → parents → children`), so an implementer following house style would let a CRM account deletion cascade into Path and destroy a decade of evidence. `path_student_profiles → public.children` is RESTRICT — a CRM delete must fail loudly, never silently take a Founder File with it. RESTRICT holds throughout the Path graph (Units 8, 10, 12).
- `path_role_grants (user_id, role, scope_type, scope_id)` per Decision 2 — a human can hold `parent` scoped to a family and `guide` scoped to a cohort simultaneously.
- Path tables: **RLS enabled, zero policies** (Decision 1). Where a policy is ever added, use `TO authenticated` and `(select fn())`-wrapped calls.
- Student provisioning must not trip the `on_parent_created` trigger.
- Mirror `app/crm/lib/access.ts` exactly: a pure `resolvePathAccess({ session, grants, target })` returning a verdict union, with a thin `requirePathUser()` wrapper. That purity is the only way any of this gets tested.

**Execution note:** Implement `access-rules.ts` test-first — it is the enforcement of R5 and R6 and nothing else in the stack can defend it.

**Test scenarios:**
- Happy path: a student resolves `ok` for their own profile and evidence.
- Happy path: either parent of a family resolves `ok` for any student in it.
- Happy path: a Guide resolves `ok` for cohort-student evidence with no review pending (D25).
- Edge case: a Guide resolves `forbidden` for a student in a different cohort.
- Edge case: a sibling resolves `ok` for position and awards, `forbidden` for evidence.
- Edge case: a human holding both a parent and a guide grant resolves per scope, and is **not** treated as having either role globally.
- Error path: no session resolves `login`, never `forbidden` — the distinction drives redirect vs rewrite.
- Error path: a grant referencing a deleted cohort resolves `forbidden`, not a throw.

**Verification:** every branch of the verdict union has a test.

---

- [x] **Unit 6: Student sign-in, provisioning, reset, and the `/path` gate**

**Goal:** An eight-year-old signs in with a name and a password; a parent provisions and resets it; the route is gated.

**Requirements:** R1, R2, R3, R6, R29, R32, D26.

**Dependencies:** Unit 5.

**Files:** Modify `proxy.ts`. Create `app/path/(auth)/sign-in/page.tsx`, `app/path/lib/actions/provision.ts` (`"use server"`), `app/path/lib/provision-rules.ts` (pure), `app/path/lib/rate-limit-rules.ts` (pure). Test: `__tests__/provision-rules.test.ts`, `__tests__/rate-limit-rules.test.ts`.

**Approach:**
- The non-deliverable-address assumption was **verified by Unit 2's spike on 2026-07-21** — confirmed viable, with one mandatory correction below.
- ⚠️ **`email_confirm: true` is REQUIRED on every student `createUser` call.** The hosted project has email confirmations ON (despite `config.toml` saying otherwise). Omit the flag and the account is created but **cannot sign in** — `signInWithPassword` fails with "Email not confirmed", and since the address is non-deliverable by design there is no confirmation email to rescue it. Every child provisioned without this flag is permanently locked out of an account that looks fine in the dashboard. Cover it with a test that asserts the provisioning call includes the flag, and mirror `scripts/seed-staff.ts`, which already does this for staff.
- Provision via the service-role admin API with a parent-set password — **not** `signUp()`, which returns no session and strands the profile write. **Provisioning pins the student to the currently-designated program version** (Unit 4's `is_current`) — the pin is set here and never touched by content deploys.
- Sign-in shows **name + password**; the system address is derived server-side and never displayed.
- Rate limiting and a strength floor (R29) are entirely greenfield — no throttle exists anywhere in this repo, and a first name is far more guessable than an email address within a cohort.
- `config.matcher` becomes a literal array `["/crm/:path*", "/path/:path*"]` with a pathname branch. `/path/sign-in` gets its own unguarded allowlist — the guard must not lock the door to the door.
- Auth checks run **before any `await` that could start streaming**. And since a proxy matcher does not reliably cover Server Functions, `requirePathUser()` runs inside every action regardless.
- Staff recovery (D26) reuses `requireStaff()` and writes to `crm_audit_log`. A new audit action value must be added to the DB CHECK **and** `app/crm/lib/constants.ts` in the same change, or reuse an existing value with a `metadata.kind` discriminator — these have drifted before.

**Test scenarios:**
- Happy path: a valid name + password resolves to the right student profile.
- Happy path: a parent-initiated reset sets a new password with no email round-trip.
- Edge case: two students in different families share a first name and resolve to different accounts.
- Edge case: a password below the strength floor is rejected at provisioning with a specific message.
- Error path: 5 failed attempts in the window locks out; the 6th is rejected even with the correct password.
- Error path: a student session hitting `/crm` is rewritten to staff-only, not redirected to the Path sign-in.
- Error path: a parent resetting a child outside their family is refused.
- Integration: a student and a parent hold simultaneous independent sessions in separate browsers, neither invalidating the other (R3 — the requirement a profile-picker design would have failed).

**Verification:** manual two-browser test of R3; env-less `npm run build` passes.

**Prerequisite findings / applied state (2026-07-22):** the D26 audit-action migration is applied + verified + recorded in production (version `20260722180000`): `crm_audit_log_action_check` now accepts `'path-recovery'` (verified via `pg_get_constraintdef`), matched in `constants.ts` + pinned by `app/crm/__tests__/audit-actions-parity.test.ts` (parses migration files, catches drift both ways). A test family was provisioned in prod via `npm run seed:path-family` (parent + Maya g4 + Dev g7). Sign-in is a Server Action (system email derived server-side, never displayed); two students may share a first name → candidate set resolved by normalized name, password disambiguates. Rate limiting is **greenfield + in-memory** (Unit 6 forbade new tables): pure `rate-limit-rules.ts` + a per-instance `rate-limit-store.ts` (`server-only`), reused by Unit 9's upload-slot mint. Provisioning/reset run through the plain `provision-core.ts` (tsx-script-reusable); D26 recovery reuses `requireStaff()`. Verified live: bad password rejected, good sign-in reaches a profile, R3 two-browser simultaneous sessions, the 5→6 lockout, parent reset (old dies / new works). Env-less build passes, `/path/sign-in` static, `/path` dynamic; 1287 tests green, tsc clean, eslint clean on changed files.

**Carried out of Unit 6's review, for later units** *(14-agent `/ce:review`, security-heavy; findings applied — the compound learning is docs/solutions/best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md; run artifact `.context/compound-engineering/ce-review/2026-07-22-unit6/`):*
- **[Unit 15 — HARD GATE, security P1]** `provisionStudentAction` authorizes on the client-supplied `familyId` (`isParentOfFamily`) but nothing DB-side proves the supplied `childId` belongs to that family — a signed-in parent could pair their `familyId` with **any** roster child and squat it (the unique `child_id` makes it un-reprovisionable by the real family). Bounded today only because parent accounts exist solely via the seed script (no self-serve signup). **Unit 15 MUST add the CRM-side childId↔family ownership check before opening parent self-serve entry** (this is the R31 backfill's job; the comment in `provision.ts` is marked accordingly).
- **[Unit 14/15]** Unit 6 actions use the CRM `{success, error}` result shape; the rest of `/path` (evidence/upload/transition) uses `{ok, reason}`. When Unit 15 builds the first consumer, reconcile with a shared unwrap helper (or migrate the two actions to `{ok, reason}`) so a family surface calling both families of action has one branch.
- **[Unit 14 — scale, before TP-1]** `signInStudent` does a full `path_student_profiles⋈children` scan per attempt (deliberate at T1 ≤ few-hundred profiles) with `.order("created_at")` for deterministic same-name truncation. Beyond PostgREST's ~1000-row cap this silently truncates, and >`MAX_SIGN_IN_CANDIDATES` (5) same-name collisions can't sign in. A **normalized-name column + index** removes both the scan and the cap — needed before TP-1 provisions real cohorts.
- **[before TP-1]** The rate-limit store is **per-instance, best-effort** (a durable table/KV is the carry-forward before public launch lifts the test-families-only posture). Also: the sign-in timing side-channel (unknown-name = 0 probes vs known-name = 1–5 bcrypt probes) is mitigated by the generic message + per-IP cap but not eliminated — a constant-time path is a later hardening.
- **[later]** `notFound()` propagation from a Server Action (the zero-grants-mid-session path in `requirePathUser`) is used by the provision/reset actions but its behavior in a `"use server"` body is documented-as-unverified in `auth.ts` — verify explicitly in a later unit. Reset actions carry no rate limit (authenticated; session-churn only) — advisory.

---

- [x] **Unit 7: The progress engine — pure state machine**

**Goal:** Every transition, precondition, and cascade as a pure module with exhaustive tests. The heart of the product, and the only part this repo's testing setup can genuinely defend.

**Requirements:** R6, R30, brief §9.1, §9.2, §9.5, D23.

**Dependencies:** Units 3, 5.

**Files:** Create `app/path/lib/path-rules.ts`, `app/path/lib/transition-table.ts`. Test: `app/path/lib/__tests__/path-rules.test.ts`.

**Approach:**
- Write the **transition table before any schema** — every transition including `withdraw`, `revoke`, `criterion_return`, `phase_return`, each with actor, precondition, effect on successors, effect on awards, effect on notifications.
- Mirror `effectiveReviewStatus`: R6 is enforced by a **pure clamp function**, not a UI affordance check. A forged student-supplied `verified` must coerce back.
- Concurrency: tasks sequential within a criterion; criteria parallel within a phase; phases strictly sequential.
- Withdraw legal iff `reviewOpenedAt` is null.
- Criterion return: returned tasks → `not_yet`; later-sequence verified tasks **stay verified** but become display-blocked and un-submittable; the criterion sits in `returned` until every task is verified again.
- Awards immutable (D23) — a returned criterion renders its crest provisional, never withdrawn.
- Band snapshotted at first `available`.
- **Every task, criterion, and manifest lookup resolves through the student's pinned `program_version_id`** *(deepening pass, D27)* — never a "current" or "latest" global. The engine takes the version from the student context and calls `getProgram(versionId)`; publishing a newer version is invisible to an active student, exactly as a staff grade correction is invisible to an in-review task.
- Expose a `gateStatus` hook now, gating at **submit**, so T3's math gate is additive rather than structural.

**Execution note:** Strictly test-first. The transition table is the specification.

**Technical design:** *(directional)* the table is a data structure, not a switch — `{ from, to, actor, precondition(ctx), cascade(ctx) }` — so adding a transition is a data change and tests can enumerate the table rather than hand-listing cases.

**Test scenarios:**
- Happy path: verifying a criterion's last task moves the criterion to `review_underway`.
- Edge case: criterion 2.3's **sixth** task, not its fifth, triggers the review.
- Edge case: a student holds `in_progress` tasks in three criteria of one phase simultaneously.
- Edge case: publishing a newer program version does not alter a pinned student's task set; a sibling provisioned afterwards resolves tasks from the newer version. *(Mirrors the band-snapshot scenario; D27.)*
- Edge case: withdraw with `reviewOpenedAt` null succeeds; with it set, refused.
- Edge case: revoke by the original verifier succeeds; by the other parent, refused (§9.5 is actor-scoped).
- Edge case: a criterion return leaves later verified tasks verified but un-submittable.
- Edge case: changing `StudentProfile.band` does not alter an already-`available` task's variant.
- Error path: **enumerate the table** — a student actor attempting any verifying transition is clamped, for every row. Do not hand-list; this is R6.
- Error path: verifying a task whose predecessor is unverified is refused.
- Integration: a full criterion 1.1 walkthrough ends in `review_underway` with exactly five verification records.

**Verification:** every table row has a passing and a refused test; no transition is reachable that the table does not name.

**Carried out of Unit 7's review, for Unit 8** *(the transition RPC + applier; these are caller obligations the pure engine documents but cannot enforce)*:
- **Re-derive `criterionTo` from ALL siblings inside the CAS/transaction — never blind-write `cascade.criterionTo`.** It is computed from a point-in-time snapshot; two concurrent verifies of *different* tasks in one criterion each compute a stale aggregate, so a blind write can wedge the criterion at `active` even after every task is verified. The `move_candidate()` CAS shape must cover the aggregate, not just the task row.
- **Stamp `verifiedBy` with the real authenticated `actorId`.** §9.5's revoke identity check trusts it; the cascade never sets it.
- **The snapshot loader must fail-closed-narrow every DB state string** into the engine's unions before it reaches `evaluateTransition` (the `parseRoleGrant` pattern), and **emit `null` — never `""` — for an unset `reviewOpenedAt`** (withdraw's D6 guard treats both as unset, but the type contract wants `null`).
- **Re-authorize on an `already_in_target_state` verdict.** That verdict is returned *without* running the row's precondition (identity/note/membership), so per-target authorization is the caller's job on that path.
- **Confirm the action imports `evaluateTransition`/`clampStudentTaskState`** rather than re-deriving the logic inline (extract-the-branch-the-production-path-calls).
- **[T2] `phase_return` validates `returnedCriterionIds` against `PhaseSnapshot.criterionIds`** — T2's phase-review unit must populate that list from the phase's real criteria (as the criterion loader populates `criterion.tasks`), and the §9.5 post-clear revoke guard lands when `CriterionState` gains `cleared`.

---

- [x] **Unit 8: Transition RPC and progress schema**

**Goal:** Make the state machine atomic, audited, and safe under concurrency.

**Requirements:** R6, R30, R15.

**Dependencies:** Unit 7.

**Files:** Create `supabase/migrations/<ts>_path_progress.sql`, `app/path/lib/actions/transition.ts` (`"use server"`), `app/path/lib/progress-core.ts` (plain; `server-only` wrapper separate). Test: `app/path/lib/__tests__/progress-core.test.ts`.

**Approach:**
- One security-definer RPC per Decision 5: `set search_path = public`, revoke from `public`/`anon`/`authenticated`, grant to `service_role` only.
- **Optimistic concurrency in the WHERE clause** — first write wins; the loser is told "Mum verified this at 7:42pm", not shown an error.
- **Never a full-row upsert.** Content via status-free write, state flip via targeted UPDATE with the transition value **hardcoded** so a stale caller cannot smuggle local state in. This exact shape broke "Submit for review" in production before: a `BEFORE INSERT` trigger's coercion propagates into `EXCLUDED` and poisons the DO UPDATE arm.
- Guards **coerce, never raise** — so `{error: null}` does not mean the row is what you asked for. Echo-verify critical transitions with `.select()` and interpret **three ways**: matches → success; behind intent → retryable; **ahead of intent → adopt the DB value**. Treating the third as failure reverts authoritative state to a stale belief and loops forever.
- `path_task_progress` carries `submitted_at`, `review_opened_at`, `decided_at` (R30) and the snapshotted band. **And `unique (student_id, unit_task_id)`** *(deepening pass — the most corrupting single omission found)*: without it, nothing prevents two progress rows for one student-task pair, and the CAS transition, band snapshot, evidence FKs, and review attempts all fork across duplicates into a split permanent record no later constraint can merge. The transition RPC keys on this uniqueness.
- **All FKs in the progress graph are ON DELETE RESTRICT** (see Unit 5's posture note) — no cascade anywhere in Path.
- An errored response is **not** proof the write failed — the write can commit while the response is lost. Re-read once before reporting failure.
- `path_reviews` gets an `attempt` int; uniqueness `(scope, scope_id, student_id, attempt)`. A second review must not overwrite the first, or the audit trail R6 exists to keep is destroyed.
- Test policy and trigger behaviour by replaying the app's **real statement shape under the real role** inside a `DO $$ ... RAISE EXCEPTION 'RESULT %' $$` rollback block with `set_config('request.jwt.claims', ...)`. A prior suite of targeted UPDATEs passed while the bug shipped.

**Test scenarios:**
- Happy path: a verify writes actor, role, timestamp and returns the new state.
- Edge case: two concurrent verifies — exactly one wins, the other reports the winner's identity and time.
- Edge case: a second criterion review creates `attempt = 2`, leaving attempt 1 intact and readable.
- Error path: a failed precondition changes nothing and returns a typed refusal, not a throw.
- Error path: a stale client cannot change the transition target (value hardcoded server-side).
- Integration: echo verification detects the ahead-of-intent case and adopts the DB value.

**Verification:** the concurrency test run 50× yields exactly one winner every time; migration verified via `to_regprocedure`.

**Carried out of Unit 8's review, for later units** *(all applied server-side by the RPC/action; these are consumer obligations):*
- **[Unit 11]** The two submit timestamps are reserved and split: `submit_received_at` (server `now()`, what R30 instruments off) and `submitted_at` (client, skew-clamped — the RPC already accepts `p_submitted_at`). The offline queue supplies the client value; no column rename is needed later.
- **[Unit 12]** A `revoke` already reconciles an open `path_reviews` row to `returned` and clears `verified_by` on the reopened task, so re-completion opens a fresh attempt. Unit 12 owns the review *ceremony* (`criterion_return`/`phase_return`, which apply the engine's cascade) and must confirm `path_reviews`' `maybeSingle()` open-review read can never see two `review_underway` rows once its return/reopen path exists. `interpretEcho` is task-scope-only; the review RPC is attempt-based, not a simple CAS.
- **[Units 14–16]** Consume `applyTransition`'s `TransitionResult` (`byCaller`/`winner`/closed-union `reason`): render distinct copy for `superseded` (target reached by someone else — never say "you did it") vs `diverged` (task went elsewhere); wrap every call in `try/catch/finally` (the auth guard can `redirect()`); apply a retry ceiling to `reason: "retry"`; and **escape `note`** (free text) in any history view.
- **[audit]** Record a session/device signal in `path_task_events` for the accepted parent-acts-as-child boundary (a cheap column a later unit adds).
- **[Unit 15]** Provisioning must refuse an unlock with an unknown grade (`band` = null), or record a documented default — `effectiveBand`'s live fallback would otherwise silently mask a null band.

---

- [x] **Unit 9: Storage, signed uploads, and quota**

**Goal:** Private media storage with direct-to-storage uploads. Entirely greenfield.

**Requirements:** R13, R14, R28, D21.

**Dependencies:** Unit 5.

**Prerequisites, all cheap and all blocking:** confirm the **Supabase plan tier and its per-file ceiling** (Free 50 MB / Pro 500 GB) — if it is 50 MB, D21's 500 MB cap moves by an order of magnitude, most video becomes a link, and the ~$33/mo cost model is invalid; confirm **`storage.allow_any_operation()` exists** in the current storage schema, since an unresolvable function aborts the entire migration file; and confirm **range-request support** with `curl -I -H 'Range: bytes=0-1024'` against a real signed URL.

**Files:** Create `supabase/migrations/<ts>_path_storage.sql`, `app/path/lib/actions/upload-slot.ts` (`"use server"`), `app/path/lib/upload-rules.ts` (pure), `app/path/components/EvidenceUploader.tsx`. Test: `app/path/lib/__tests__/upload-rules.test.ts`.

**Approach:**
- **Private bucket, always.** Media served only through signed download URLs. Include `storage.allow_any_operation()` in read policies — without it users enumerate filenames across families. Path pattern `{student_id}/{evidence_id}/{sha256}.{ext}` with a policy on `(storage.foldername(name))[1]`.
- **Mint one signed download URL per object and store it in Postgres**, reusing until near expiry. Minting per render defeats the CDN entirely — every unique token is a fresh cache key billed at 3× the cached rate.
- Keep expiry short anyway: signed URLs use a per-project key separate from the Auth JWT key, rotating auth keys does not invalidate them, and **there is no self-serve revocation**.
- Upload per Decision 4: the action returns a slot; the client uploads direct. Plain `upload()` under 6 MB; **TUS above, `chunkSize` exactly `6 * 1024 * 1024`**, against `https://{ref}.storage.supabase.co/storage/v1/upload/resumable`. Authorize with a server-minted **`x-signature`** token so the child's client never needs a long-lived session for the upload leg.
- **Persist the TUS URL and its creation time**; it expires after **24 hours** and an older unfinished upload must restart from zero. One client per URL — a second gets 409.
- Enforce D21's caps (3 min / 500 MB) **client-side at capture**; quota server-side at slot issue. A six-minute video rejected at sync time is rejected long after the moment is gone.
- **Verified objects must be physically unoverwritable** *(deepening pass)*. Both upload legs are mint-time-authorized and RLS-exempt, TUS was specified with `x-upsert: true` ("last completer wins"), the path's sha256 is **client-declared and never verified**, and a TUS URL stays live 24 hours — so a replayed URL or re-minted slot could replace a *verified* object's bytes while the DB row still swears append-only. Close it structurally: (a) **all upload legs run with upsert disabled** — an existing object is never replaceable, first completed upload wins; (b) **slot minting refuses any path whose evidence row's append-only latch is set.** Note in the module header that the content hash is client-declared, so nobody later assumes it is integrity-verified. **One retry mapping falls out of (a) and must be stated:** an already-exists response on either upload leg means the object completed on a prior attempt — treat it as upload success and proceed directly to confirm; without this rule, the upload-then-die retry wedges against its own earlier success until the orphan reaper deletes it. Resume of an *incomplete* transfer (same TUS URL) is unaffected by upsert — upsert only matters at completion. Confirm the exact already-exists status code during this unit's prerequisite curl checks.
- **Orphan reaping** *(deepening pass)*: an object written whose `confirm` never arrives (upload-then-die) is invisible, unbilled-against-quota, and permanent. Objects whose path has no confirmed evidence row after 48h (comfortably past the 24h TUS window) are deleted via the Storage API by the existing cron; quota accounting reconciles against confirmed rows.
- **Object deletion goes through the Storage API, never SQL** — deleting `storage.objects` rows orphans the file permanently, which matters enormously once a retention obligation exists.
- Every client-side awaited action needs `try/catch/finally`; the guard can `redirect()` (throws) before the action's own try, and a frozen upload modal is the worst instance of that class here.
- Never construct a Supabase client in a render path, including `useState`/`useRef` initializers.
- **Verify range-request support** with `curl -I -H 'Range: bytes=0-1024'` against a real signed URL before designing the player; a 200 instead of 206 means seeking is broken.

**Test scenarios:**
- Happy path: a 2 MB photo returns the plain-upload strategy.
- Edge case: a 40 MB video returns TUS with the correct chunk size and resumable endpoint.
- Edge case: a request at exactly 6 MB resolves deterministically — name which strategy and test both sides of the boundary.
- Edge case: a TUS URL older than 24h is treated as expired and a fresh one minted.
- Error path: video over 500 MB or 3 minutes refused at slot issue with a specific reason.
- Error path: a student at the 10 GB annual quota is refused with the link-overflow path offered.
- Error path: a slot request for an inaccessible task is refused (delegates to `resolvePathAccess`).

**Verification:** a real 40 MB upload resumes after a mid-transfer network interruption; the object is not readable by URL without a signature.

**Prerequisite findings (run 2026-07-22 against prod, two changed the design):**
- **Per-file ceiling is 50 MB** (`fileSizeLimit = 52428800`; Free tier, org "Helix"). D21's 500 MB per-item cap is **not storable today** — `MAX_STORABLE_BYTES` is 50 MB and larger items are link-overflow; the bucket `file_size_limit` enforces it server-side. A Pro upgrade (roadmap TP-3) restores 500 MB by flipping that one constant + the bucket limit together (the migration-parity test pins them equal).
- **`storage.allow_any_operation` exists but its signature is `(expected_operations text[])`**, not the plan's zero-arg reference — the read policy gates to `array['object.get_authenticated','object.get_authenticated_info']` so `object.list` (enumeration) is never authorized.
- **Range requests over signed URLs return 206** (`Content-Range` honored) — `<video>` seeking works, no player workaround (Units 10/14).
- Applied + verified + recorded in prod (version `20260722140000`): private `path-evidence` bucket, the family-read `path_can_read_evidence(text)` (proved against a rolled-back fixture: parent→child true, sibling→evidence false), the `path_student_storage_bytes(uuid,text)` quota RPC, and the `storage.objects` SELECT policy (`TO authenticated`, RLS-on, no write policies, anon revoked).

**Carried out of Unit 9's review, for later units** *(15-agent /ce:review; 0 P0, security clean; findings applied where in-scope, the rest carried here):*
- **[Unit 6]** Rate-limit `requestUploadSlot`. In-flight (never-finalized) resumable objects have no size metadata, so the quota byte-sum is blind to them and Unit 9 ships no reaper — an authenticated caller can start-but-never-finish uploads for unbounded, unattributed storage. The rate limit bounds this until Unit 10's reaper lands.
- **[Unit 10]** Own the **orphan reaper** (48h, via the Storage API — never SQL). **Wire `appendOnlyLatched`** to the real evidence-row latch (Unit 9 passes `false`; physical unoverwritability is currently upsert-disabled only). Implement **content-type / evidence-kind validation** (the migration's `allowed_mime_types` is NULL and the pure rules do size/duration/quota only — comment corrected to say kind-validation is deferred here). **On an already-exists outcome the client-reported size/sha are UNVERIFIED** (sha256 is client-declared): confirm must reconcile the reported metadata against the real `storage.objects` size/etag, not trust `onUploaded`. Optionally add **task-existence gating** (mirror `applyTransition`'s `not_found`) if slot mint should refuse a well-formed but nonexistent `taskId` (currently validated-but-reserved).
- **[Unit 11]** Persist `tusMintedAt` + endpoint across sessions and wire **`isTusUrlExpired`** (built + tested, unused in Unit 9's in-session upload) to re-mint before resuming — the signed-upload **token is valid 2h**, the resumable **upload URL 24h**, and a static `x-signature` header goes stale on a >2h pause. `submit`/offline-queue replay reuses the same `evidenceId`, which is what the quota-exclusion-by-path fix relies on to avoid double-charging a retry.
- **[Unit 14]** When capture is wired into a route: the **guide-exclusion is already enforced** in `decideUploadSlot` (student/parent only — a guide's D25 read grant does not mint a write slot), so re-confirm no surface re-introduces guide capture. **Differentiate retryable (`unavailable`) vs terminal (`forbidden`/`quota_exceeded`/`link_overflow`) refusals** in the UI (the typed reason reaches `onRefused`). **Smoke-test `path_student_storage_bytes` against a real object** before the first real upload: it fails **OPEN** (returns 0) if its SECURITY DEFINER privilege assumption ever breaks, silently disabling the quota — unlike `path_can_read_evidence`, which fails closed.
- **[Unit 10 / duration]** D21's **3-minute cap has no server-side backstop** (unlike the 50 MB size cap, which the bucket enforces): `durationSeconds` is client-declared and best-effort (`probeVideoDuration` resolves `undefined` on undecodable metadata). A client omitting/lying about it bypasses the duration cap. Accepted for T1; revisit only if server-side length measurement is wanted.

---

- [x] **Unit 10: Evidence model, capture, video, and log tables**

**Goal:** All evidence types captured and playable everywhere, immutable after verification, schema ready for redaction.

**Requirements:** R13, R14, R15, Decision 11.

**Dependencies:** Units 8, 9.

**Files:** Create `supabase/migrations/<ts>_path_evidence.sql`, `app/path/lib/evidence-rules.ts` (pure), `app/path/components/VideoCapture.tsx`, `app/path/components/LogTable.tsx`, `app/path/components/EvidenceList.tsx`. Test: `app/path/lib/__tests__/evidence-rules.test.ts`.

**Approach:**
- **Client-generated UUID as the evidence identity**, `unique (task_progress_id, client_id)`. This is what makes the offline queue safe: an upload that times out *after* the server committed, then retries, must not create a second permanent row. Append-only plus at-least-once sync would otherwise make duplicates undeletable garbage in a keepsake. Add a content hash for the re-picked-same-file case.
- **Record video in-app via `MediaRecorder`** (Decision 11). iOS writes H.264/AAC MP4 that plays everywhere; the camera-roll path yields HEVC `.mov` that desktop Firefox and GPU-less Chrome cannot play at all. Cap recording at 60–90s, which also caps the storage bill. File-picker fallback routes through client-side normalization (Mediabunny, WebCodecs-backed).
- **Generate a poster frame on-device at capture** and use it as the review thumbnail, so the list renders even when a video is unplayable.
- Preserve EXIF server-side in a private column; **do not canvas-re-encode to strip it**, which also destroys orientation and rotates photos. Stripping on export is a launch-gate policy question.
- **Log table is a first-class structured type** — the 25-attempt tracker, No Log, sales ledger, and P&L ship as per-task templates, **loaded from Unit 3's `app/path/content/log-templates.ts` sidecar** (hand-authored, band overrides included, stable column names for T2's `headlineStatSpec`). `LogTable.tsx` renders a template; it never defines one.
- **Append-only latches at first verification and never lifts** — through revocation, Not Yet, criterion return, and phase return. State this in the module header: it is currently derivable but unstated, and a reasonable implementer would conclude the latch lifts when a task returns to `in_progress`, which would let a student delete the evidence that made a reviewer uncomfortable. Carve-out: duplicate reconciliation *before* verification is not a deletion.
- Ship `redacted_at`, `redacted_by`, `redaction_reason` from day one. The policy is deferred; the columns must not be.
- **Redaction's blast radius is defined now, or redaction doesn't redact** *(deepening pass)*: on redaction, delete or quarantine the storage object **and its poster frame** via the Storage API, null the Postgres-cached signed URL row (signed URLs are irrevocable by design, so a surviving cached URL keeps the "redacted" media readable), and clear the private EXIF column — which can hold the GPS coordinates of a child's home. The DB row itself remains, append-only, as the tombstone.
- **Any content-hash uniqueness is a partial index scoped `where redacted_at is null`** *(deepening pass)* — otherwise a redacted row holds the hash forever and a later legitimate re-submission of similar content is refused with no recourse. Alternatively make hash dedupe advisory (a prompt) rather than a constraint; either way, decide and test it.
- **FKs: ON DELETE RESTRICT** per Unit 5's posture note.

**Test scenarios:**
- Happy path: five evidence items of different types attach to one task and read back in capture order.
- Edge case: the same `clientId` submitted twice yields one row.
- Edge case: two different files with the same content hash on one task — decide keep-both or dedupe, and test the decision.
- Edge case: a log table with zero rows is distinguishable from no log table at all.
- Error path: editing a verified item is refused.
- Error path: deleting a verified item is refused.
- Error path: deleting an *unverified* duplicate succeeds (the carve-out).
- Integration: redaction leaves the task verified and the verification record intact.

**Verification:** append-only holds across all four return paths, each covered; a video recorded on iOS plays in desktop Firefox.

**Prerequisite findings / applied state (2026-07-22):** the `path_evidence_items` migration is applied + verified + recorded in production (version `20260722160000`): client-UUID PK identity, the `(task_progress_id, student_id)` composite FK pinning the denormalized owner, the `kind` + `kind_shape` CHECKs, redaction tombstone columns, `ON DELETE RESTRICT` throughout, RLS enabled / zero policies. Verified behaviourally via a rolled-back `DO`-block (valid insert, log-zero-row, link, dup-PK-rejected, valid-but-wrong-student-rejected, shape-CHECK-rejected, RESTRICT-delete-blocked) plus an `authenticated`-role RLS probe (0 rows). Range requests / bucket already settled in Unit 9. **Decisions taken here:** content-hash dedupe is **advisory keep-both** (no unique constraint → no redaction-tombstone-holds-the-hash trap); the append-only latch is **derived from a `verified` event in `path_task_events`** (never lifts, no RPC change); the orphan reaper ships as pure logic + a Storage-API executor + a CRON_SECRET-gated route but is **NOT scheduled in `vercel.json`** (Hobby's 2-cron cap; scheduling lands with Unit 12's tier decision).

**Carried out of Unit 10's review, for later units** *(14-agent `/ce:review` + a bounded adversarial re-review; a P0 log-hijack, three P1s, and a self-introduced redaction regression were all caught and fixed — see docs/solutions/best-practices/id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner-2026-07-22.md):*
- **[Unit 11]** `added_after_verification` is now set on the ONLINE confirm/link path (task currently `verified`), but the flag is snapshotted before the confirm's later I/O — a verify landing in that window yields a stale `false`. The offline-sync rebase is the authoritative path and must set/repair it against real server state. The confirm/log/link/delete/redact actions are built-to-contract (no client caller yet); wire them behind the offline queue with the `try/catch/finally` + mounted-ref posture Unit 9's uploader documents.
- **[Unit 12]** Own the reaper's **cron schedule** (the route + logic ship now, unscheduled). Before scheduling: (a) the reaper's `listAllObjects` is serial per-folder and `loadConfirmedObjectPaths` reads the whole table — parallelize / paginate before it runs unattended against real volume; (b) confirm the 48h orphan window can never reap a fully-uploaded object whose confirm is legitimately deferred (the online flow couples upload+confirm, so this is latent, but re-confirm when scheduling).
- **[Unit 14]** When the surfaces mount: wire `shouldRemintSignedUrl` into the read loader (built + tested, no caller yet — reuse the stored URL, never mint per render); the **video poster** needs its own signed URL (only the main object's is stored today) and its own null-out on redaction; re-run `resolvePathAccess(kind:'evidence')` per item on the READ path (this unit gates writes); differentiate retryable (`unavailable`) vs terminal refusals in the UI; and add a caption-edit action (the `edit` mutation is modeled + tested but only `saveLogEvidence` exercises it — photo/video/etc. can currently only be deleted, not caption-fixed). Wire the real **mediabunny** types (`typeof import(...)`) once the file-picker conversion is device-tested.
- **[T2 / later]** `confirmUploadedEvidence` trusts the client-declared content-type; `readObjectMeta` already fetches the real object metadata, so a mimetype reconciliation (mirroring the size reconciliation) could close the last client-declared-kind gap. The five actions share a gate/authorize/resolve prologue — extract a `loadAuthorizedStudent` helper if a sixth evidence action lands. A concurrent verify-vs-delete TOCTOU exists (the latch read isn't serialized against `move_path_task`); a shared advisory lock is heavier than T1 warrants but revisit if it bites.

---

- [x] **Unit 11: Offline capture queue and sync**

**Goal:** Evidence made without signal survives and lands honestly. The highest-risk unit in the plan — no local precedent, and both failure modes cause *permanent* damage.

**Requirements:** R17, R30.

**Dependencies:** Units 9, 10.

**Files:** Create `app/manifest.ts`, `public/sw.js`, `app/path/lib/offline-queue.ts`, `app/path/lib/sync-rules.ts` (pure), `app/path/components/SyncStatus.tsx`, `app/path/components/InstallPrompt.tsx`. Modify `next.config.ts` (headers). Test: `app/path/lib/__tests__/sync-rules.test.ts`.

**Approach:**
- **IndexedDB queue drained on foreground signals** — `load`, `online`, `visibilitychange → visible`, post-auth-refresh. **Background Sync is Chromium-only and absent from iOS Safari entirely**; register it if `'sync' in registration` as a free win on Android, but never branch product behaviour on it.
- Store the `File`/`Blob` directly (structured clone handles it; far cheaper than base64) alongside `{id, kind, taskId, mime, bytes, sha256, capturedAt, attempts, tusUrl, tusMintedAt, uploadedBytes}`.
- **Run uploads from the page context, not the service worker** — iOS kills a backgrounded SW and an in-flight upload dies with it. Rely on TUS resume.
- **Hand-roll the service worker.** Serwist's Next plugin is webpack-only and Next 16 defaults to Turbopack; the Turbopack variant has been in preview since Sept 2025. Next's own guide covers manifest plus a hand-written `public/sw.js`.
- `/sw.js` needs `Cache-Control: no-cache, no-store, must-revalidate` in `next.config.ts` headers plus `updateViaCache: 'none'` at registration. A CDN-cached service worker is a multi-hour outage of your update path.
- **Do not cache navigations or RSC payloads.** Next serves flight payloads via `?_rsc=` with an `RSC: 1` header; caching them under confusable keys produces stale-data and hydration bugs. Precache only content-hashed `/_next/static/**` and a single `/offline` route served on navigation failure.
- **Do not `skipWaiting` blindly** — v1 HTML requesting v2 chunks yields `ChunkLoadError`. Detect the waiting worker, show an update toast, reload on user action. Guard registration with a hostname check so a preview-deployment SW does not poison later previews on the same origin.
- **Install is a data-durability requirement, not a nicety.** iOS wipes IndexedDB, the Cache API, *and* the SW registration after 7 days without interaction — installed home-screen apps are exempt. Call `navigator.storage.persist()` (expect `false` on Safari). **T1 must ship the minimum viable install path, not just a warning:** `apple-touch-icon` at 180×180, standalone detection, and the iOS coached Share → Add to Home Screen sheet. A warning a user cannot act on is not a mitigation — there is no `beforeinstallprompt` on iOS, so without the coached sheet there is no discoverable install path at all, and a minimal manifest produces no usable home-screen icon because iOS ignores manifest icons entirely. The richer install UX (maskable icons, urgency tiering, Android prompt capture) is T2 Unit 2. **If the coached sheet slips, forbid offline capture on non-installed iOS** — refusing capture is a far better failure than queueing a 400 MB video that gets wiped on day eight.
- **Sync is a rebase, not a replay** (Decision 10). Four server-state-moved cases, each explicit: task returned to `not_yet` (attach; re-apply submit); criterion returned (attach; submit no-ops with a note); phase locked (attach; submit refused with an explanation); **task already verified** (attach, flagged `addedAfterVerification`, surfaced quietly to the reviewer). That fourth case silently violates R6 if left to default behaviour, and it is the one nobody will test.
- At-least-once, possibly-reordered replay is the webhook problem — model on `app/lib/calcom/events.ts`, recording the dedupe key **after** the idempotent effect.
- Submit **is** offline-capable: record `submitted_at` (client, skew-clamped) and `submit_received_at` (server). R30 instruments off the **server** timestamp, or the metric measures the child's connectivity rather than the parent's responsiveness.
- Verification events landing while offline queue unseen and fire on next open — the one case where Tier 1 celebration is deliberately replayed rather than missed.
- The service worker holds a stale bundle far longer than a tab. Any later migration touching a column the queue writes needs split-phase treatment and a re-run 24–48h post-deploy.
- Nothing about the SW itself is testable here, so `sync-rules.ts` must hold **all** decision logic as pure functions; the SW is a thin driver.

**Test scenarios:**
- Happy path: three queued items sync in order and clear the queue.
- Edge case: an item queued against a since-returned task attaches and its submit re-applies.
- Edge case: an item queued against a since-verified task attaches with `addedAfterVerification` set.
- Edge case: an item queued against a since-locked phase attaches but its submit is refused with a student-readable reason.
- Edge case: the same queued item replayed twice yields one row.
- Edge case: a retry after a completed-but-unconfirmed upload maps already-exists to success and clears the queue via confirm — no re-upload, no drop, no 48h wedge.
- Edge case: a submit whose response was lost but which committed is detected on re-read, not double-applied.
- Edge case: a `capturedAt` in the future is clamped, and the clamping is recorded.
- Edge case: a TUS URL past 24h restarts rather than resuming into a 404.
- Error path: a queued item whose task no longer exists is dropped with a surfaced note, never silently.
- Integration: `submitted_at` and `submit_received_at` diverge by the offline duration; R30 uses the server value.

**Verification:** airplane-mode test — capture three items and a submit offline, reconnect, all four land correctly. A mid-upload disconnect on a 40 MB video resumes. **Spike a 400 MB IndexedDB write on a real iPhone before trusting the 500 MB cap.**

**Prerequisite findings / applied state (2026-07-22):** **The SW/manifest scope decision resolved /path-SCOPED** (System-Wide Impact): `public/sw.js` served from the ORIGIN ROOT (outside the proxy matcher — an expired session can never break an update fetch) and registered `{scope:'/path', updateViaCache:'none'}` — narrowing needs NO Service-Worker-Allowed header (the plan's parenthetical had it inverted); **NO root `app/manifest.ts`** (it would make every marketing page installable under Path branding) — `public/path.webmanifest` is linked only from the new pass-through `app/path/layout.tsx`, and the nested file-convention `app/path/apple-icon.png` replaces the root "120" badge for /path pages (its URL delimiter-allowlisted in proxy-rules, tested). The Files-list deviation is deliberate and PINNED by `sw-discipline.test.ts` (text-parses sw.js/manifest/next.config — the migration-parity idiom; asserts no root manifest exists). SW discipline: precache = /offline + its hashed assets (separate untrimmed cache); runtime cache-first ONLY /_next/static/** (80-entry cap); navigations never cached; skipWaiting only via the update toast. **Queue architecture:** every capture enqueues into IndexedDB BEFORE network I/O (upload-then-die + mid-upload death survive a killed tab); the online interactive path IS the first drain; drains on load/online/visible/SW-nudge from PAGE context; all queue WRITES serialized through one promise chain (IDB gives no cross-connection commit-order guarantee); an entry is deleted only AFTER its idempotent effect (dedupe-key-after-effect; confirm idempotent by the entry's never-regenerated evidenceId). Rebase per D10: all four cases pure + tested (`planSubmitTransitions`/`interpretSubmitRefusal`/`routeStateReadFailure`); evidence attaches via the same actions the UI calls; `added_after_verification` REPAIRED post-insert against real state (false→true only) in confirm/link. **R30 proven in prod DB:** `submitted_at 2026-07-22T23:59:28.162Z` (offline enqueue clock, byte-identical to the queue entry) vs `submit_received_at 23:59:40.291Z`. TUS resume across sessions (client-clock `mintedAt`; >2h re-mints the token keeping the URL; >24h restarts). Stuck escalation (`AUTO_RETRY_ATTEMPT_CEILING`, "still trying" in SyncStatus; manual Send-now always available). iOS install coach ships (gentle/urgent by queued bytes INCLUDING blocked); `storage.persist()` requested. Legacy direct-upload path retained solely for no-IndexedDB browsers (documented). Queue entries carry `schemaVersion` + a tolerant reader (unrecognized → surfaced tombstone, never raw into the drain). **14-agent `/ce:review` (13 reviewers + fixer): 6 P1s found and fixed** — attempts-write-only retry-forever, IDB write-ordering resurrection, per-chunk whole-Blob write amplification, NTP-rollback defeating the submit hold, mixed server/client clock freshness (dead token judged fresh forever), and the 0-B urgent banner on blocked media; run artifact `.context/compound-engineering/ce-review/2026-07-22-unit11/run.md`. Sign-out deliberately does NOT clear the queue (deleting un-synced evidence is the loss this unit prevents; posture documented). Compound learning: docs/solutions/best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md. Verified: 1472 runnable tests green, tsc clean, eslint clean on changed files, env-less build passes (/offline + /path/apple-icon.png static); live browser drill on a local prod build against prod (SW scope `/path` exactly, marketing uncontrolled + manifest-free, offline link capture→queue→online-event drain→attach+open choreography, offline submit→drain→submitted, update toast→user-tap→clean reload). **REAL-IPHONE half handed to Peter as a checklist** (install sheet, IDB volume spike, airplane-mode capture, 40 MB mid-upload resume, phone-shell pass — the U14 carry).

**Carried out of Unit 11's review, for later units:**
- **[Unit 12]** (pre-existing carries restated) review queue + reaper cron schedule + the DB-level parent-cap backstop ride-along; the review surface derives "arrived after the review opened" from `created_at` vs `review_opened_at`, and now also renders the `added_after_verification` flag the offline rebase repairs.
- **[Unit 16]** celebration/Not-Yet moment — including replaying verification events that landed while the student was offline (the queue side is done; the event surface is Unit 16's); richer superseded/diverged copy; twin same-name confirm UX (Unit 15 carry).
- **[T2 / before real cohorts]** split the IndexedDB entry into an immutable Blob record + a small mutable progress record (~5 full-entry puts per capture remain — fine at T1, not at cohort scale); add a queue byte/count ceiling with a student-facing "queue full" state; sign-out at-rest residue policy (drained-only purge / at-rest encryption) belongs in the TP-1 compliance scope; bump the sw.js cache version literals whenever cache-relevant SW logic changes (manual discipline, noted in the file); a parent's drain scope (`actableStudentIds`) is a mount-time snapshot — a child provisioned mid-session drains after the next full load.
- **[env — for Peter]** `artifacts/The Path/` was renamed on disk to `artifacts/Foundry/` mid-session (uncommitted): `app/path/content/__tests__/parse-curriculum.test.ts`, `__tests__/generated-drift.test.ts`, and `scripts/build-path-content.ts` read the tracked old path and ENOENT until the rename is committed with those paths updated (2 suites load-fail; zero failing assertions).

---

- [x] **Unit 12: Review queue, verification, and durable notification**

**Goal:** Close the loop. A parent is reliably told, verifies against the Done-when line, and the student learns — including an under-13 with no inbox.

**Requirements:** R12, R27, R30, R6, brief §9.3, §5.

**Dependencies:** Units 8, 10.

**Files:** Create `supabase/migrations/<ts>_path_notifications.sql`, `app/path/lib/notify/send.ts` (plain — **no `server-only`**, so cron and scripts reuse it), `.../template.ts`, `.../notify-rules.ts` (pure), `app/api/cron/path-notifications/route.ts`, `app/path/(app)/review/page.tsx`, `app/path/components/ReviewPanel.tsx`. Modify `vercel.json`. Test: `app/path/lib/notify/__tests__/notify-rules.test.ts`.

**Approach:**
- **Durable delivery** per Decision 8. Today `app/lib/email.ts` never throws, has an 8s abort, and a failed send is simply lost — documented as acceptable for a nudge. Not acceptable for the only channel that lets a parent advance the system.
- `path_notification_sends` with a unique-constraint claim (the `nurture_sends` shape). **Atomic claim-then-send, never send-then-stamp:** conditional `UPDATE ... WHERE stamp IS NULL`, row cardinality is the verdict; on failure a **CAS-guarded** unclaim that cannot clobber a concurrent real send. The stamp is a JS-minted opaque ISO string, never SQL `now()` and never re-parsed through `Date`. Zero rows claimed is ambiguous — disambiguate by re-probing.
- Retry with Resend's `Idempotency-Key` (24h window). Cron copies the existing guard shape: missing secret → 503, wrong bearer → 401, plus a per-run cap. **Note Vercel Hobby caps crons at once daily** — anything time-sensitive needs Pro.
- **Escape every user-supplied value in email HTML** — student names, captions, reviewer notes. Escape the `html` part only, never the `text` part.
- Any verification link must render a button that **POSTs**; scanners prefetch GETs and would false-confirm.
- **In-app surface (R27)** is the guaranteed channel for under-13 students. Store the event and its parameters, **never rendered copy** — a Not Yet queued in Trail voice and read after a skin toggle would otherwise render Trail copy in an HQ shell. Render the register at read time.
- **In-app event rows are insert-plus-supersede-flag only, never UPDATE-in-place** *(deepening pass)* — the repo's split-policy append-only idiom. Unit 16 renders reversals as "superseded, past tense, history intact"; if events shared the mutable claim-stamp table's posture, a reversal implemented as an UPDATE would destroy the original event a child's history depends on. Also note `path_notification_sends` carries PII (addresses, names in params) and sits inside any future deletion scope; its FKs are RESTRICT or SET NULL, never CASCADE.
- Reviewer-side stall nudge at a family-set threshold (default 72h). Nothing currently acts on a parent sitting on a queue; R30 measures that failure and nothing responds to it, and an under-13 would see "awaiting review" indefinitely with no recourse.
- Not Yet requires a note, uses amber never red, returns the task to `in_progress` with evidence intact.
- Use `refresh()` or `revalidatePath` after a verification — **not** `revalidateTag`, whose single-arg form is now a TypeScript error and which does not re-render in the action response.

**Test scenarios:**
- Happy path: a submission creates exactly one pending notification per parent.
- Happy path: a verification writes an in-app event the student sees on next open.
- Edge case: an under-13 receives an in-app event and **no** email is attempted.
- Edge case: two parents both notified; only the first verification wins and the second's view reflects the winner.
- Edge case: a claim finding zero rows is disambiguated by re-probing, not assumed failed.
- Edge case: a Not Yet without a note is refused before any send.
- Edge case: a reversed event marks the original superseded and renders in past tense — no new celebration, no deleted history.
- Error path: a transient Resend failure retries with the same idempotency key and does not double-send.
- Error path: a send failure unclaims only if the stamp is still the one this invocation set.
- Error path: cron without `CRON_SECRET` → 503; wrong bearer → 401.
- Integration: a name containing `<script>` renders escaped in HTML and raw in text.

**Verification:** a submission with the provider deliberately failing still delivers on the next cron run, exactly once — **with the worst-case latency stated as an acceptance criterion.** Determine the Vercel plan tier first: Hobby caps crons at once daily, which would make "delivers on the next cron run" satisfiable with a 24-hour silence, defeating the requirement Decision 8 exists to serve. If the project is on Hobby, either budget the Pro upgrade or add an in-request retry path.

**Prerequisite findings / applied state (2026-07-22):** **Vercel tier = PRO** (verified in the dashboard: Helix team, Pro active) — the Hobby question never bit; the notification cron runs `*/10 * * * *` and the reaper daily 13:35 UTC (both in `vercel.json`, pinned by a parity test; prod `CRON_SECRET` confirmed live via 401 probes). **Acceptance criterion stated:** inline delivery is immediate; a failed inline send delivers ≤10 min later per retry, ≈50 min worst case (5-attempt ceiling), then parks loudly in the cron response — **proven live** (broken-key submit → 2 pending rows w/ `Resend 401` → key restored → next cron delivered exactly once). **Architecture:** notifications are DERIVED from the spines the RPC already writes atomically (`path_task_events` + `path_reviews`) — inline for latency, a reconcile healer (24h window, memoized per-run, capped+logged) for durability, so a crash between RPC commit and enqueue is repaired, not lost; in-app student events (`path_notification_events`, insert-plus-supersede-flag, `occurred_at` = source moment) never email (`.invalid` addresses by design); parent emails via `path_notification_sends` claim-then-send with a **claimed_at/sent_at SPLIT** (stale-TTL retake under the stable Resend Idempotency-Key — a mid-send crash self-heals), send batches paced to Resend's 2 req/s (429s met live, absorbed). Submit send keys are TIME-BUCKETED per (student, task, 30 min) so submit/withdraw cycling cannot flood inboxes. **Ceremony:** `return_path_criterion` (attempt-based decide under the same advisory lock as `path_maybe_open_review`; `move_path_task`'s revoke branch now takes that lock too — migration `20260723130000`); the maybeSingle open-review invariant holds through the return path (U8 carry closed). **Review surface** verified live on prod data: Maya's fixture 1.1.1 REALLY verified (comment stored, cascade unlocked 1.1.2, in-app event, no email), Not Yet (note-required button gate; task → not_yet with evidence intact; student sees the amber note), full 1.1 walkthrough → review opened → RETURN ceremony via UI (attempt 1 returned, supersede flags temporally correct), stall nudge (once per cycle, family threshold honored, restored to 72), reaper ran clean paginated. **Verify TOCTOU closed:** the queue snapshots an `evidenceFingerprint`; verify recomputes and refuses `evidence_changed` on a withdraw+resubmit swap. Parent-cap DB trigger shipped (advisory-locked, duplicate-upsert exempt, lock-first; U15 ride-along closed; `children` name-uniqueness deliberately NOT added — live CRM table, adoption logic already handles same-name). Reaper: reads paginated (keyset on the confirmed-set), orphan window widened 48h→7d against U11's deferred confirms, scheduled (U10 carry closed). Agent parity: `actions/review-read.ts` `getReviewQueue()`. Migrations `20260723120000` + `20260723130000` applied+verified+recorded via the Management API. 14-agent `/ce:review`: 4 P0s (stale-supersede replay, verify TOCTOU, stuck claim, opened_at-only healing) + 6 P1s found AND fixed; security + learnings clean; run artifact `.context/compound-engineering/ce-review/2026-07-22-unit12/run.md`. Compound learning: docs/solutions/best-practices/idempotent-reconciler-replaying-one-way-flags-needs-temporal-scope-2026-07-22.md. Verified: 1538/1538 runnable assertions (2 suites still ENOENT from the user's uncommitted artifacts rename — now at `artifacts/First Profit/`, no longer "Foundry"), tsc clean, eslint clean on changed files, env-less build passes.

**Carried out of Unit 12's review, for later units:**
- **[Unit 16]** Render `path_notification_events` (kind + params + `occurred_at` ordering + `superseded_at` past-tense + `seen_at` stamping); celebration/Not-Yet moments incl. offline replay; richer superseded/diverged copy (TaskSurface + ReviewPanel both carry basic versions); twin same-name confirm UX (U15 carry); ReviewPanel card-scaffolding extraction when U16 touches the file (mountedRef/busy/notice/retry-ceiling duplicated across the two cards); a "task you were reviewing was handled elsewhere" toast for the vanishing-untouched-card case; optionally a queued-behind-another-action caption (Server Actions dispatch sequentially per client).
- **[T2 / before real cohorts]** Split `notify/send.ts` before new notification kinds land (784-line executor, well-factored but growing); `attempts` increments from a JS snapshot (bounded imprecision, documented — an RPC-side increment is the clean fix if parked-count accuracy ever matters); hoist `escapeHtml` out of `app/crm/lib/library-rules` to a neutral shared module (third cross-domain import); InviteSection mountedRef (same gap FounderCard had); Storage `.list()` ordering stability under concurrent writes is unverified (orphan-side only, fail-safe direction).
- **[TP-1]** `path_notification_sends` carries PII (emails + names in params) inside the future deletion scope; guide queue visibility is a deliberate T1 cut (guides can act via actions but have no queue surface — revisit with T3's guide surfaces); first prod cron run after this deploy re-keys in-window submit notifications under the bucketed format (one duplicate email per in-window submit — test family only at current scale).

---

- [x] **Unit 13: Design foundation — tokens, fonts, and the skin architecture**

**Goal:** Settle Decision 9 in code before a single component is written, and land the design system both skins render through.

**Requirements:** R18, R19, R20, and the enabling half of R8.

**Dependencies:** Unit 2. **Hard edges** *(corrected in the deepening pass)*: `2 → 13`, and `13 → {6, 9, 10, 11, 14, 15, 16}` — the first rendered surface is **Unit 6's sign-in page**, not Unit 9, so 13-before-6 is the binding constraint. Unit 13 has **no** edge into 3, 4, 5, 7, or 8. Its early placement is soft and chosen deliberately: this is the only other unit modifying shared marketing files (`app/globals.css`, `app/layout.tsx`), and landing it early maximizes soak time for its "marketing pages visually inert" verification — the same logic that runs Unit 1 first. A re-sequencer may float it anywhere after 2 and before 6.

**Files:** Modify `app/globals.css` (add `--color-hq-*` and `--color-trail-*` to the existing single `@theme inline` block), `app/layout.tsx` (add Fraunces, Inter, Spline Sans Mono with `preload: false`), `package.json` (add `lucide-react`). Create `app/path/components/system/{Button,StatusChip,ProgressMeter,Crest,Seal,Icon}.tsx`, `app/path/components/hq/{HQTaskCard,PhaseRow}.tsx`, `app/path/components/trail/TrailStep.tsx`, `app/path/lib/skin-tokens.ts` (pure). Test: `app/path/lib/__tests__/skin-tokens.test.ts`.

**Approach:**
- Two token namespaces in the one global block (Decision 9). `@theme` cannot be scoped and `@theme inline` compiles utilities to literal values, so a runtime CSS-variable override does nothing — this is the architecture, not a preference.
- The handoff stores tokens as **HSL channel triplets** consumed via `hsl(var(--x) / a)` under Tailwind v3. Converting to this repo's flat `--color-*` hex convention is mechanical but real work.
- Fonts on the existing root layout with `preload: false` (Decision 3) — marketing pages declare but never fetch them.
- Port the handoff's components; **do not copy the prototype**, which is Vite + Tailwind v3 + Google-Fonts-via-`@import`. Crests and seals are the parametric template (colour + numeral) behind **swappable art references** so commissioned illustration drops in later without touching logic.
- `lucide-react` is not currently a dependency and the handoff's `Icon` needs it.

**Test scenarios:**
- Happy path: `skin-tokens` resolves an HQ token name and a Trail token name to distinct class strings.
- Edge case: a token present in one namespace and absent in the other fails at build/type level, not silently at runtime.
- Test expectation: the components themselves are not unit-testable here (no jsdom) — they are covered by the manual verification below.

**Verification:** a marketing page's rendered CSS and computed fonts are unchanged; env-less `npm run build` passes; a scratch page renders the same component under both skins with visibly different tokens.

**Prerequisite findings / verified state (2026-07-22):** Decision 9 confirmed against compiled output — `bg-hq-canvas` and `bg-trail-canvas` are distinct utilities and `/opacity` composes via `color-mix` on the `hsl(var(--x))` form; the two-namespace-plus-classname-swap pattern is documented at `docs/solutions/best-practices/tailwind-v4-theme-not-scopable-inline-literals-two-namespace-classname-swap-2026-07-22.md`. Decision 3 verified live — on the marketing homepage the three Path fonts report `loaded:0` with zero preload links and the body font is unchanged (Space Grotesk). Ported 9 handoff primitives (Button/StatusChip/ProgressMeter/Crest/Seal/Icon/HQTaskCard/PhaseRow/TrailStep) reusing the domain PhaseKey/Band/TaskState types + `motion/react`; `skin-tokens.ts` is the pure, test-first resolver. Env-less build passes, tsc clean, eslint clean on changed files, 1203 tests green.

**Carried out of Unit 13's review, for later units** *(9-agent `/ce:review`; 0 P0/P1; in-scope P2s applied — reduced-motion on Seal/TrailStep, a non-distributive `SkinToken<S>` guard so a widened `Skin` can't smuggle a cross-namespace token, and `phases.ts` tests incl. a `--phase-*`↔globals.css channel guard):*
- **[Unit 14]** Wire `skin-tokens.ts` into the app shells — the resolver's real consumer (choose the skin once at the subtree root; resolve neutral bg/text/border via `skinClass`; a widened `Skin` is restricted to shared tokens, so narrow to a literal for skin-specific ones). Wire the `Icon` registry into surface/nav chrome. Add `<MotionConfig reducedMotion="user">` at the shell root as defense-in-depth (Unit 13 gates Seal + TrailStep motion per-component; HQTaskCard's `layout` is auto-suppressed by motion).
- **[Unit 14 / design]** Confirm against the handoff screenshots whether a Trail **pending Seal** and a Trail **locked Crest** should adopt `trail-mist` neutrals instead of the HQ neutrals ported verbatim from the prototype (the prototype hardcodes HQ neutrals for the unsealed/locked state in both skins — faithful port, flagged for design sign-off). Likewise whether `TrailStep` should render `not_yet` distinctly from `submitted` (the prototype conflates them into one shimmer).
- **[Unit 14 / no-CI]** Nothing automatically guards that marketing stays font-inert, or that `skin-tokens`' `CLASS_TABLE` literals still match the compiled utilities — both are verified manually today. If CI ever lands, add a `next build` CSS-output assertion.

---

- [x] **Unit 14: Student app shell, journey, and the task surface**

**Goal:** The surface the loop actually runs on. Without this, Units 7–11 are an engine no child can reach.

**Requirements:** R8, R9, R18–R20, and the student half of the core loop.

**Dependencies:** Units 10, 13. **Runs after Unit 10, before Unit 11** — the offline queue layers onto a working capture surface.

**Files:** Create `app/path/(app)/layout.tsx` (desktop sidebar shell + phone shell), `app/path/(app)/page.tsx` (territory map / phase ledger), `app/path/(app)/criterion/[criterionId]/page.tsx`, `app/path/(app)/task/[taskId]/page.tsx` (the capture and submit surface), `app/path/components/EmptyStates.tsx`. Test: `app/path/lib/__tests__/now-card-rules.test.ts`.

**Approach:**
- Both layouts per R8 — separately authored phone and desktop shells, desktop verified and polished (R9), phone honest.
- The task view mounts `EvidenceUploader`, `VideoCapture`, `LogTable`, `EvidenceList`, and `SyncStatus` from Units 9–11. Those components have no route until this unit exists.
- **The task card consumes Unit 3's sidecars** *(deepening pass)*: the evidence checklist renders from `evidence-spec.ts` where an entry exists and falls back to the Done-when line as the standard where it doesn't; the Safety note renders from `safety-flags.ts` (Phase 01 fully authored — the door-to-door tasks are the reason it exists); the "Live moment" badge renders from the `stageMoments` constant in `manifest.ts`.
- **The "Now" card selection rule is pure and testable:** criteria run in parallel within a phase, so several tasks can be open at once and both skins render one current step. Most-recently-touched, with a student pin override.
- **Design first-run explicitly.** Every one of the handoff's 18 surfaces is seeded with a mid-program persona. Day one for a Grade 4 on Trail is `0 / 125`, twenty-five locked silhouettes, an empty satchel — a screen of grey, the opposite of what the brief promises. An implementer handed only mid-program components will render them with empty props. Territory revealed rather than fully locked; the student's skin and avatar choice as their first act.
- **Withdraw needs a visible affordance and copy** — it is legal until `reviewOpenedAt` is set and currently has no UI anywhere. Likewise the evidence-locked-while-submitted state ("Evidence is locked while Dad reviews · Withdraw to add more"), which is one of three mutability regimes and the only one with no rendering.
- Client submit handlers need `try/catch/finally` — a rejected action freezes the UI permanently.

**Test scenarios:**
- Happy path: with three criteria open, the Now card resolves to the most recently touched task.
- Edge case: a student pin overrides recency until cleared.
- Edge case: a student at `0 / 125` resolves to the first-run presentation, not the mid-program one with empty props.
- Edge case: a task in `submitted` resolves to the locked-with-withdraw affordance; in `verified`, to append-only.
- Error path: a task the student cannot access resolves to not-found, not a partial render.

**Verification:** a student signs in and reaches a task, attaches evidence, and submits — the first point in the plan at which that is possible.

**Prerequisite findings / applied state (2026-07-22):** the exit check ran live on prod-provisioned accounts (Maya · Trail g3_5, Dev · HQ g6_8): sign-in → territory map/dashboard → landmark/criterion → task → photo evidence attached (auto-`open` fired) → caption edited → submitted (`locked_submitted` + the withdraw affordance rendered) → withdrawn → resubmitted; both skins, first-run (0/125 hero) distinct from mid-program; `/path/task/9.9.9` → 404. **Three gaps closed that the plan didn't know about:** (1) NOTHING materialized `path_task_progress` rows (the RPC only UPDATEs — "empty echo = provisioning gap") → `ensureStudentProgress` in provision-core (125 rows, five Phase-01 firsts `available` + band snapshot + system unlock events, idempotent), called from `provisionStudent` + seed-script backfill; prod verified `profiles=2, missing_progress=0`. (2) The generated content module was only imported by the seed script — every server `getProgram` call would have thrown → `content/registry.ts` barrel (Unit 3 carry-forward closed). (3) `export type { TransitionResult }` in the `"use server"` transition action threw `ReferenceError` at module load, taking every Path action down — found on first live mount; documented as docs/solutions/runtime-errors/use-server-type-reexport-registers-server-reference-referenceerror-2026-07-22.md. **Structure:** now-card-rules.ts is the pure heart (Now selection with display-block sibling exclusion + pin override, `journeyPresentation` incl. the `not_ready` stranded-student card, mutability regimes, journey aggregates, `resolveTaskInProgram`/`resolveCriterionNow`/`latestReviewStateByCriterion`/`decisionFromEvents`/transition choreography, refusal classification, `unwrapActionResult` (built for Unit 15, documented), pin-cookie helpers); journey-loader.ts + lib/journey-view-types.ts are the read layer; the pin is a device-local httpOnly cookie (no migration); skin is band-derived at the shell root (persisted choice + toggle are T2). Two migrations applied+verified+recorded in prod: `20260722200000` (poster signed-URL cache columns; redaction nulls them) and `20260722210000` (partial unique index on `poster_object_path`). Env-less build passes (/path/* dynamic, sign-in static); 1363 tests green; tsc + eslint clean.

**Carried out of Unit 14's review, for later units** *(14-agent `/ce:review`; security/project-standards/api-contract/learnings all clean; an adversarial P0 — forged `posterObjectPath` aliasing another row's object let the delete carve-out destroy verified media — was fixed structurally (`underEvidenceFolder` binds both paths to `{studentId}/{evidenceId}/`) plus the unique-index backstop; run artifact `.context/compound-engineering/ce-review/2026-07-22-unit14/run.md`):*
- **[Unit 11]** The offline queue layers onto this surface: `SyncStatus` mounts in the task surface's capture card (the seam is left; nothing invented). The confirm-retry affordance ("Finish saving", `pendingConfirm` in TaskSurface) is the ONLINE half of upload-then-die; Unit 11's queue owns the durable half (persist the confirm params, replay on foreground signals) — replace the in-memory `pendingConfirm` with the queue entry when it lands.
- **[Unit 12]** Evidence CAN land on a `submitted`/in-review task (Decision 10: evidence always attaches; server deliberately does not refuse below the append-only latch). The review surface must render "arrived after the review opened" **derived from `created_at` vs `review_opened_at`** — no new column needed (documented on the evidence actions' module header). Also surface `decisionFromEvents`' rule there: the latest noteless decision shows nothing (never a stale older note).
- **[Unit 15]** `unwrapActionResult` (now-card-rules) is built+tested for the parent surfaces — the first consumer of both result families ({success,error} provision/reset + {ok,reason} everything else); wire it rather than re-deriving. Consider the agent-native review's typed read-model wrapper (`getJourney()`/`getTaskDetail()` as thin `"use server"` functions over journey-loader) when the parent dashboard needs journey reads.
- **[Unit 16]** `TransitionResult.byCaller/winner` copy obligations still stand (distinct superseded-vs-diverged rendering); TaskSurface currently renders a generic "Already done — handled elsewhere" for superseded — Unit 16's celebration/notification moment owns the richer copy.
- **[T2 / advisory]** `/path/now` runs a full `loadJourney` to compute a redirect (fine at 125 tasks; a light `resolveNowTaskId` is the fix if it ever shows in latency). TaskSurface's `busy` is stringly-typed (a discriminated union is the cleanup). The phone shell is CSS-verified only (`lg:` breakpoint; both chrome sets in DOM, content rendered once) — real-device phone verification rides with Unit 11's iPhone testing. Trail pending-Seal/locked-Crest neutrals stay as the prototype's faithful HQ-neutral port (design sign-off still open, Unit 13 carry).

---

- [x] **Unit 15: Parent surfaces — onboarding, family dashboard, provisioning**

**Goal:** How a family gets into the product at all, and how a parent sees more than one child.

**Requirements:** R4, R31, R2, R8, D26.

**Dependencies:** Units 6, 13, 14.

**Files:** Create `app/path/(app)/family/page.tsx`, `app/path/(app)/onboarding/page.tsx`, `app/path/components/AddFounder.tsx`, `app/path/lib/onboarding-rules.ts` (pure). Test: `app/path/lib/__tests__/onboarding-rules.test.ts`.

**Approach:**
- **The enrolled-family path is the primary path and the handoff does not design it.** Handoff scene 2 is "Add a founder — name field plus three band cards", but R31 links to an existing `public.children` row which is authoritative for name and grade, with band **derived**. For 2026-27 families the flow is *confirm and link*, not *create*. Band is shown derived-and-confirmable, not chosen.
- **How does an existing parent get a `parent` role grant, and how do they sign in at `/path` at all?** Unit 6 describes only the student's name-and-password path. This unit owns the parent's entry.
- **Second-parent invite exists nowhere** and R4 permits more than one. Build it here — it is also the practical mitigation for a single verifier going dark.
- Multi-sibling dashboard: each child's phase and criterion position at a glance, with per-child review counts. Siblings see position and awards, never evidence.
- R31's **linkage migration for already-enrolled families** lands here — a backfill, plus the rule for who owns a grade change at a birthday.

**Test scenarios:**
- Happy path: an enrolled family's existing `children` rows appear as linkable founders with derived bands.
- Edge case: a family with no `children` rows falls through to the create path.
- Edge case: **a linked child whose `grade` is null** — `public.children.grade` is nullable and CRM rows start as drafts. Provisioning refuses with a specific message, or applies a documented default band recorded as defaulted. Decide and test; without this a real child gets no band and no variant text for all 125 tasks.
- Edge case: adding a second child mid-year does not disturb the first's progress — and if a program revision shipped in between, the second child pins the newer version while the first keeps theirs (D27).
- Error path: a parent linking a child outside their family is refused.

**Verification:** an enrolled 2026-27 family reaches a working student account without re-entering any data.

**Prerequisite findings / applied state (2026-07-22):** the **ownership HARD GATE is closed in the shared core** — `provisionStudent` refuses unless the child's CRM parent (`children.parent_id`, which IS an auth user id: `public.parents.id → auth.users`) holds a `parent`/`family` grant for the supplied family (`child_not_in_family`, before any write; pure verdict `onboarding-rules.childFamilyVerdict`; probed live against prod: refusal, zero writes). **Null grade refuses** with a specific reason (`child_grade_missing`/`child_grade_out_of_range`) — the decided UX, never a default. Parent ENTRY = a Parent tab on the (still-static) sign-in page (`signInParent`: email+password against their existing application account; rate-limited; forgot-password reuses `/reset`). Onboarding is LINK-primary (roster children with DERIVED band shown confirm-not-choose; handoff band-card copy verbatim; the handoff's skin-choice step cut — skin is band-derived in T1); create path = fallback (name + grade select; adopt-by-name via pure `resolveSiblingAdoption`, provisioned same-name siblings never adopted). Family dashboard: per-child cards from `loadJourney` (n/125, phase+criterion, five-segment bar, honest awaiting count), R32 reset-password UI (first consumer of the built-to-contract action), truthful settings strip; ParentShell = own grounded chrome (handoff surface 20); the "Open"→review-queue button + Review Queue nav land with Unit 12 (no dead links). Second-parent invite: `path_parent_invites` (token-hash, single-use, 7d; migration `20260722220000` applied+verified+recorded in prod), unguarded `/path/invite/[token]` (proxy-rules prefix, tested), acceptance is compensation-based (see the review round) with the cap enforced by post-write verify. **R31 backfill = staff-run per-family script** (`scripts/backfill-path-families.ts`, decision 2026-07-22: never a blanket migration while TP-1 holds the test-families-only posture); `ensurePathFamilyForParent` shared with the seed script (tested). Grade-at-a-birthday rule documented (roster owns grade; snapshots protect in-flight work). Agent-native reads: `journey-read.ts` + `family-read.ts` (functions-only exports). Verified live end-to-end on prod data: parent sign-in → dashboard (Maya/Dev/Kai real positions) → Kai linked+provisioned via the UI (floor refusal shown first) → Kai signs in as a student (g9_12 variant resolves) → invite created→wrong-account refused→session-less accept joins as co-parent (2/2) → student bounced from /path/family → reset-password exercised. 1427 tests green; tsc/eslint clean; env-less build passes. Review: 14-agent `/ce:review` (run artifact `.context/compound-engineering/ce-review/2026-07-22-unit15/run.md`; learnings clean 17/17); compound learning: docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md.

**Carried out of Unit 15's review, for later units:**
- **[Unit 12 or a migration ride-along] DB-level parent-cap backstop** — the 2-parent cap is compensation-enforced only (post-write verify + self-delete); a trigger or count-guarded insert on `path_role_grants` is the real serialization. Likewise a `(parent_id, normalized first_name)` uniqueness (or advisory lock) on `public.children` would close the create path's concurrent double-submit residue.
- **[Unit 16 / T2] Twin same-name UX** — the create path silently adopts an unprovisioned same-name sibling when grades agree; a "we found an existing Alex — is this them?" confirm is the product-judgment fix. Trail pending-Seal/locked-Crest neutrals design sign-off still open (Unit 13 carry).
- **[TP-1] Invite rows are PII** (emails, RESTRICT FKs, no retention/erasure path) — belongs in the launch-gate compliance scope. Per-instance rate limiting still stands (Unit 6 carry).
- **[advisory] First live invocation of `journey-read.ts`/`family-read.ts`** actions pending a real caller (neither exports types — the known use-server crash trigger; both compile and the modules load in the build). `resolveParentFamily` assumes one family per parent (first grant wins, ordered+logged); a real multi-family parent is a T2+ design question.

---

- [x] **Unit 16: Tier 1 celebration, the Not Yet moment, and the in-app notification surface**

**Goal:** The moment the loop pays off, and the only guaranteed channel an under-13 student has.

**Requirements:** R27, brief §5 Tier 1 and the Not Yet moment.

**Dependencies:** Units 12, 14.

**Files:** Create `app/path/components/TaskVerifiedMoment.tsx`, `app/path/components/NotYetPanel.tsx`, `app/path/(app)/notifications/page.tsx`, `app/path/lib/celebration-tier1-rules.ts` (pure). Test: `app/path/lib/__tests__/celebration-tier1-rules.test.ts`.

**Approach:**
- Two to four seconds, **never a modal, never interrupts flow**. Trail: the wax stamp thumps, the avatar steps, a short chime. HQ: the chip flips, the meter ticks. Honour `prefers-reduced-motion`.
- **The verifier's comment displays here** — the brief is explicit that adult words are the best reward in the system, and it is the cheapest thing in the plan to get right.
- **Not Yet lands as information, not judgement**: the reviewer's note beside the Done-when line, amber never red, no error iconography, no broken streak, task returns to `in_progress` with evidence intact.
- **R27's in-app surface renders here.** Unit 12 stores events; nothing displayed them. Store event plus parameters and **render the register at read time** — a Not Yet queued in Trail voice and read after a skin toggle would otherwise render Trail copy in an HQ shell.
- Events that arrived while the student was offline queue unseen and fire on next open — the one case where Tier 1 is deliberately replayed rather than missed.
- **A reversed event renders in past tense with the correction inline** — "Verified on Sat — Dad reopened this Sunday to take another look." No new celebration, no deleted history.

**Test scenarios:**
- Happy path: a verification with a verifier comment renders the comment; without one, renders cleanly.
- Edge case: three events queued offline all fire in order on next open.
- Edge case: an event stored in Trail context renders in HQ register after a toggle.
- Edge case: a superseded event renders past-tense and does not re-celebrate.
- Edge case: `prefers-reduced-motion` suppresses motion, not the moment.
- Error path: an event referencing a deleted task is skipped with a note, never rendered blank.

**Verification:** an under-13 student with no inbox learns of a verification and of a Not Yet, entirely in-app.

**Prerequisite findings / applied state (2026-07-22/23):** the R27 store's first reader shipped: pure `celebration-tier1-rules.ts` (ordering by coalesce(occurred_at, created_at) with deterministic tie-breaks; replay plan = unseen+live+resolvable → ordered moments, superseded/unresolvable → `stampWithoutPlaying` cursor advances with NO re-celebration; supersede pairing renders past-tense with the correction inline, matched by reversal shape + superseded_at PROXIMITY so multi-cycle returns attribute the right ceremony; unknown kind / deleted task → skipped-with-a-note, never blank; register copy resolved at read time from the caller's skin — NOTHING rendered is stored), `notifications-loader.ts` (program-pinned resolvers per D27), `TaskVerifiedMoment.tsx` (non-modal fixed-corner host, ~3.2s/moment, wax thump + user-activation-gated chime on Trail / chip-flip + meter tick on HQ, reduced-motion suppresses motion never the moment, seen stamped per moment played, keyed by studentId so a shared-device session switch discards the queue), `NotYetPanel.tsx` beside the Done-when line (copy single-sourced via `NOT_YET_COPY`), `/path/notifications` feed + `MarkSeenOnMount` (stamps via Server Action on mount, never a mutation on GET), agent-parity `actions/notifications-read.ts` + `actions/notifications.ts` (student-self-only, `seen_at IS NULL` one-way fence, ids chunked to the shared `MAX_SEEN_IDS_PER_CALL`), shell nav item + badge + phone bell. **Found live and fixed:** `decisionFromEvents` dropped `criterion_return` notes AND journey-loader's hand-listed SQL pre-filter dropped them independently — a returned task showed a bare chip; both now consume one exported `DECISION_TRANSITIONS` (`satisfies readonly TransitionName[]`). **Verified live on prod data (test family):** Maya's 9-event fixture replayed 7 moments in source-moment order (DB seen_at stamps narrate the cadence; both superseded events batch-stamped WITHOUT playing), feed renders past-tense + corrections + notes verbatim (em-dashes intact), full live loop (submit 1.2.2 → parent verify with comment → student sees the moment + meter 6/125 + badge), feed-page mount-stamp (unseen 0 in DB), replay-once-then-stamped on reload, badge 7→0 via post-drain refresh. Reduced-motion: CSS media block verified in compiled output + per-component gates mirror the Unit-13-verified Seal/TrailStep pattern (OS-level emulation not reachable from this harness — on Peter's device checklist). Carries applied: ReviewPanel scaffolding extracted (`useReviewCardScaffolding`), vanishing-card toast (per-cycle `taskCardKey`), richer superseded/diverged copy in ReviewPanel AND TaskSurface. 14-agent `/ce:review` (13 reviewers + fixer): 0 P0; 1 P1 (unchunked seen-stamp vs the zod ceiling — 3-reviewer agreement) + 9 P2 + 7 P3 all applied; security/standards/learnings clean; run artifact `.context/compound-engineering/ce-review/2026-07-22-unit16/run.md`. Compound learning: docs/solutions/best-practices/pure-decision-function-starved-by-hand-listed-sql-prefilter-export-one-allowlist-satisfies-pinned-2026-07-22.md. Verified: 1577/1577 runnable assertions (2 suites still ENOENT from the uncommitted artifacts rename, now `artifacts/First Profit/`), tsc clean, eslint clean on changed files, env-less build passes.

**Carried out of Unit 16's review — recorded in the T2 plan's context:** two-tab replay double-play (needs cross-tab coordination); display-time supersede TOCTOU (a reversal landing mid-replay still plays; correction surfaces on feed/task page — accepted T1 residual); twin same-name confirm UX (U15 carry — U16 never touched the create path); Trail pending-Seal/locked-Crest neutrals design sign-off (U13 carry, still open — Peter); FEED_ROW_CAP=400 with no truncation indicator; tone-icon map + `/path/notifications` route string each spelled twice; FeedItem tone/correction as a discriminated union; TaskVerifiedMoment hosts all tones despite its name (revisit when Tier 2–3 land); chime is user-activation-gated WebAudio (silent before first gesture — flag to Peter for the device pass).

## System-Wide Impact

- **Interaction graph:** `proxy.ts` gains a second matcher and branch — the file both gated areas share, which is why Unit 1 fixes it first. `on_parent_created` fires on any `parents` insert. `app/2026-27/data.ts` gains a build-time consumer, so a marketing copy edit can now fail the build (intentionally). `app/layout.tsx` gains three fonts for every route.
- **Error propagation:** actions return `{success, error?}` and never throw *from their own body* — but the guard can `redirect()` before that body runs, so every client call site needs `try/catch/finally`. Storage failures degrade to a retryable queue entry, never a lost capture.
- **State lifecycle risks:** the offline queue holds a stale bundle far longer than a tab; append-only plus at-least-once sync makes duplicates permanent without Unit 10's dedupe; a partial TUS transfer must resume, and expires at 24h; a review attempt must never overwrite its predecessor.
- **API surface parity:** none — `/path` adds no public API. `/crm` gains an audited recovery action (D26).
- **Integration coverage:** behaviours no unit test can prove and which need manual verification — two simultaneous independent sessions (R3), offline capture and sync end to end, a resumed large upload, iOS-recorded video playing in desktop Firefox, and delivery of a notification whose first send failed.
- **Service worker and manifest scope — decide deliberately.** `public/sw.js` registers at origin scope by default, so once registered from a Path page it intercepts fetches for **every marketing route**, turning a Path SW bug into a site-wide outage. `app/manifest.ts` is a root metadata route: Next injects `<link rel="manifest">` into every page, making the marketing site installable under Path branding. Either serve the worker from `/path/sw.js` and register with `{ scope: '/path/' }` (adding `Service-Worker-Allowed` if it stays at root), or accept origin-wide scope explicitly and add a marketing smoke check to Unit 11's verification. This is free to choose now and expensive after families have a registered worker.
- **Unchanged invariants:** `/crm` behaviour and its role check are unchanged beyond Unit 1's cookie fixes; `public.children` stays authoritative for name and grade; `cacheComponents` stays off; no existing table gains a policy. **Marketing components are untouched, but `app/globals.css` and `app/layout.tsx` are modified by Unit 13** (added token namespaces and three non-preloaded fonts) — verified by that unit as visually inert on marketing pages.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Children's-data compliance is unresearched** | Certain | Critical | The launch gate above. Dedicated task plus a Canadian privacy lawyer. Blocks real families, not this build — but blocks Unit 5 if `ca-central-1` is required, since region is fixed at project creation. |
| iOS wipes queued evidence after 7 days uninstalled | High | High | Install warning whenever queued bytes exist; `storage.persist()`; full install UX in T2. A lost 400 MB video is product-destroying. |
| Migration application is a manual Management-API ritual; ~10 new tables | High | High | One file per phase, idempotent DDL, `to_regclass` before dependents, version recorded only on success. Budget it as real work. |
| Silent body truncation corrupts large evidence | Medium | High | Structurally avoided — bytes never traverse the proxy (Decision 4). |
| Offline sync produces permanent duplicate evidence | Medium | High | Client-generated IDs with a uniqueness constraint plus the pre-verification carve-out (Unit 10). |
| Evidence lands on a verified task via sync, breaching R6 | Medium | High | `addedAfterVerification`, surfaced to the reviewer. A named required test. |
| iOS-recorded HEVC unplayable for the reviewing parent | High | Medium | Record in-app via MediaRecorder (Decision 11); poster frame always; Cloudflare Stream as the paved escape hatch (~$10/mo). |
| No CI, no component or integration tests | Certain | Medium | All decision logic in pure modules; the five listed integration behaviours get explicit manual steps. UI regressions are undetectable automatically — accept it. |
| Multi-role auth has zero precedent | High | High | Pure `resolvePathAccess` with exhaustive branch tests; service-role boundary (Decision 1); verify DB behaviour by replaying real statement shapes under the real role. |
| A leaked signed URL for a child's media cannot be revoked | Low | High | Short expiries, private bucket, `allow_any_operation`. Note the tension with the CDN-cost mitigation — resolve toward shorter expiry. |
| `@theme` cannot be scoped, discovered after components exist | Low | High | Settled up front (Decision 9). Must hold before any component work. |
| **125 kid-register strings do not exist and no unit authors them** | Certain | High | Not a discovery risk — a confirmed gap. The curriculum has no kid-voice task copy. **Trail is the default skin for Grades 3–5**, the exact persona T1's success story is built around. Needs its own track with a named owner and a milestone, plus Unit 3's fallback-to-standard-register rule so the build can go green before it finishes. |
| T1 verification needs real families before the compliance review is done | Low | Medium | Resolved 2026-07-21: test users only until public launch, and residency is cleared by counsel. T1's exit check is a small number of families who know they are testing, on real devices, running the full loop. |
| Parent knows the child's password, so a parent can submit as the child and verify as themselves | Medium | Medium | An accepted trust boundary of home study, recorded rather than discovered. R6's guarantee is against forged clients and mis-attributed actors, **not** against a parent choosing to act as their child. Record the session/device distinction in the audit payload as a cheap signal; do not pretend the invariant is stronger than it is. |
| Vercel and Supabase plan tiers unknown, and both change unit content | Certain | Medium | Establish both before Units 9 and 12. Hobby's daily cron cap defeats Decision 8; Free's 50 MB file ceiling invalidates D21 and the cost model. |

## Documentation / Operational Notes

- Every schema unit needs the Management API apply-and-verify sequence run manually; there is no automated path.
- `vercel.json` gains one cron entry (Unit 12); entries are additive. Hobby caps crons at once daily.
- **Never pipe secrets through PowerShell 5.1** — it prefixes a BOM and has corrupted a Vercel env var before. Use `--value` flags, the dashboard, or the REST API. After one failed edit, delete every row with that name and recreate with explicit per-environment scopes rather than editing again.
- Confirm the Supabase plan's storage file-size ceiling (Free 50 MB / Pro 500 GB) before setting the bucket limit.
- Env-less `npm run build` must pass — this failure class produces no stack trace.
- Storage cost projection: ~$33/mo at 100 families year 1, ~$54/mo year 2, egress inside allowance. There is no cold tier; a permanent record accrues at full rate indefinitely.

## Next Steps

**T1 COMPLETE (2026-07-23).** All sixteen units shipped, reviewed, and merged. **T1-exit check against "a family can work criterion 1.1 end to end":** verified with the TEST family on desktop browsers — provisioning/link/sign-in (R1–R3), capture/submit/verify/Not-Yet/return/celebrate at Tier 1 (§5, §9.1–9.3), offline queue + sync (R17), durable parent notification (Decision 8) and the in-app under-13 channel (R27), all live against prod. What genuinely waits on a REAL family + Peter's devices: the iPhone half (install sheet, IDB volume spike, airplane-mode capture, 40 MB mid-upload resume, phone-shell polish pass — the Unit 11 checklist), OS-level reduced-motion + the chime on real hardware, the Trail pending-Seal/locked-Crest neutrals design sign-off (U13), and the TP-1 test-families-only posture itself. Reduced form per the Overview: the crest reveal and Criterion Recap that CLOSE 1.1's ceremony are T2 Units 5/8 by design.

**The next step is:**
`/ce:work docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md` — T2, *The Year*. **Do not start T2 before Peter signs off on the real-family verification above.** Every T2 unit assumes the state machine, evidence pipeline, and notification transport are trustworthy.

The items previously listed here were resolved or deferred on 2026-07-21. Data residency is **cleared by counsel**. The remaining compliance review (`TP-1`, on/after 2026-10-21), kid-register authoring (`TP-2`, before Trail meets Grades 3–5), and the Vercel/Supabase tier checks (`TP-3`, at 30 users) all live in `artifacts/roadmap.md` and none of them gates this build.

**When every unit here is checked off and the verification steps pass, the next step is:**
`/ce:work docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md` — T2, *The Year*: phase reviews and countersign, install and web push, the skin toggle, Tier 2–3 celebrations, the AI Readiness Check and Criterion Recap, wisdom, and export.

Do not start T2 before T1's core loop is verified end to end with a real family. Every T2 unit assumes the state machine, evidence pipeline, and notification transport are trustworthy.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-07-21-the-path-app-requirements.md`
- Product behaviour and tone: `artifacts/The Path/the-path-app-design-brief.md`
- Curriculum content: `artifacts/The Path/the-path-home-study-curriculum-brief.md`
- Visual contract: `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/README.md`
- Design prototype (port, do not copy): `artifacts/The Path/v1 Path Design/src/components/`
- Next 16 docs: `node_modules/next/dist/docs/01-app/` — authoritative for this version per `AGENTS.md`
- Institutional learnings: `docs/solutions/` — specific docs cited in Context & Research
- **Next plan:** `docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md`
