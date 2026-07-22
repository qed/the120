# ce:review run — The Path T1 Unit 6

- **Mode:** autofix
- **Scope:** `feat/path-t1-unit-6` vs `main` (base `64f0017`), 21 files, +2086/-1
- **Plan:** `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` (Unit 6, explicit)
- **Team (14):** correctness, testing, maintainability, project-standards, agent-native, learnings-researcher (always-on) + security, adversarial, reliability, api-contract, data-migrations, performance, kieran-typescript, deployment-verification.
- **Verdict:** Ready with fixes → all applied. Migration already applied to prod (constraint verified). Requirements R1/R2/R3/R6/R29/R32/D26 met.

## Applied fixes (in-skill)

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| F1 | P1 | Rate-limit check-then-act race (sign-in + upload-slot) — concurrent bursts bypass R29 | `checkAndRecordRateLimit` (atomic, no await between check+record) + `releaseRateLimitEvent` on outage; sign-in clears name bucket on success |
| F2 | P1 | Fail-open bucket eviction — attacker flushes a victim's lockout by flooding 5000 keys | Eviction now takes the FEWEST-event bucket (protects active lockouts), not oldest-inserted |
| F15 | P1 | Name-only rate-limit key → global collateral lockout / cheap DoS of every common name | Key scoped by client IP (`${ip}:${name}`) + per-IP aggregate backstop (`SIGN_IN_IP_RATE_LIMIT`, 40/15min) |
| F4 | P1/P2 | Blank-name provisioning mints an unreachable account (`{success:true}`) | `provisionStudent` refuses empty/whitespace `first_name` → `child_name_missing` |
| F13 | P2 | Password floor checks JS `.length` not UTF-8 bytes → bcrypt silently truncates multi-byte | `new TextEncoder().encode(password).length > 72` |
| F16 | P2 | Concurrent co-parent provisioning clobbers first parent's password | repair path re-probes for a profile before resetting → `already_provisioned`, no clobber |
| F6 | P2 | `path-recovery` writes untyped audit literal → silent D26 gap on typo | `"path-recovery" satisfies AuditAction` |
| F7 | P2 | D26 audit write no retry → silent compliance gap on a blip | one bounded retry of the append-only insert, then loud log |
| F9 | P2 | Candidate query no `ORDER BY` → nondeterministic same-name truncation | `.order("created_at")` |
| F5 | P2 | Dropped candidate rows not logged (fail-closed learning rule 4) | `console.error` per dropped row, mirroring `auth.ts` |
| F10 | P2 | Repair adopts user without role check | guard `app_metadata.role === "student"` before reset |
| F17 | P2 | Unguarded `inserted.data.id as string` | `typeof … === "string"` guard, else fail loudly |
| F14 | P3 | Name-in-password check normalizes name (NFKC) but not password | normalize the password NFKC symmetrically |
| F11 | P3 | Reset-result→message mapping duplicated | shared `resetFailureMessage` in provision-core |
| F12 | P3 | `findUserByEmail` triplicated | exported `findAuthUserByEmail`; script reuses it |
| — | P1(test) | `provision-core` repair/adopt branches untested | new `provision-core.test.ts` fake-db harness (13 cases) |

## Carried forward (residual / plan)

- **F3 (security P2 → upgraded P1 Unit 15 blocker):** provisioning trusts client `childId` with no CRM child↔family ownership check — a parent could squat any roster child. Bounded today (no self-serve parent signup); **Unit 15 MUST add the ownership check before opening parent entry.** Comment strengthened in `provision.ts`; recorded in the plan's Unit 15 carry-forwards.
- Timing side-channel (unknown-name vs wrong-password latency) — mitigated by generic message + per-IP limit; a constant-time path is a later hardening.
- >5 same-name candidates / PostgREST ~1000-row scan cap — needs a normalized-name column + index (T2), out of T1's no-new-columns scope.
- In-memory rate-limit store is per-instance/best-effort — durable/shared store before TP-1 (already documented).
- `notFound()` propagation from a Server Action unverified — verify in a later unit.
- Reset actions carry no rate limit (session-churn only, authenticated) — advisory.
- Unit-6 actions use `{success,error}` vs Path's `{ok,reason}` — Unit 15 to reconcile with a shared unwrap helper.

## Clean

- **project-standards: 0 findings** — every documented learning verified honored.
- **data-migrations: 0 findings** — chain/atomicity/idempotence + parity-regex verified (4/4).

## Verification (post-fix)

`npm run test` 1287 passed · `npx tsc --noEmit` clean · `npx eslint <changed>` clean · env-less `npm run build` passes (`/path/sign-in` static, `/path` dynamic) · live re-verify: R3 concurrent sessions, parent reset (weak refused / strong works / old dies / new works), browser sign-in redirects to `/path`.
