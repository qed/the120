# ce:review run — refactor/remove-network-branding (2026-07-14, mode:autofix)

**Scope:** merge-base cfe72c2 → branch tip; 25 files, +228/−533 (excl. pre-existing artifacts/*.pptx working-tree change).
**Plan:** docs/plans/2026-07-14-003-refactor-remove-network-branding-plan.md (plan_source: explicit).
**Team:** correctness, testing, maintainability, project-standards, agent-native, learnings-researcher (always-on) + adversarial (>50 lines) + kieran-typescript.

## Verdict: Ready with fixes (fixes applied; residuals are out-of-branch)

## Findings

| # | Sev | File | Finding | Reviewer | Conf | Route | Outcome |
|---|-----|------|---------|----------|------|-------|---------|
| 1 | P1 | supabase/migrations/20260713170000_crm_library.sql:91,110–115,135 | CRM copy-library seed rows (staff outbound email snippets) still say "TimeBack" / "Alpha Anywhere or GT Anywhere" and describe the old /parents copy — diverges from the rebranded site; brand names can reach families via staff emails | agent-native | high | manual → downstream-resolver | **Residual** — new migration or library update via CRM; outside this branch (origin scoped migrations untouched, but these rows are outbound copy, not records) |
| 2 | P2 | app/dashboard/data.ts | 48 duplicated "Advisor to be announced" literals vs repo constant idiom | maintainability | 0.72 | safe_auto → review-fixer | **Fixed** — `ADVISOR_TBA` constant extracted (commit 1bf11a1); tsc + 393 tests green |
| 3 | P2 (pre-existing) | app/scholars/page.tsx:41 | `quality={95}` silently coerced to 75 by Next 16's `images.qualities` default `[75]` (carried over from old /gt hero; no config override) | project-standards | 0.65 | gated_auto → downstream-resolver | **Residual** — choose: `quality={75}` or add `images: { qualities: [75, 95] }` to next.config.ts; verify hero visual quality after |
| 4 | P2 (pre-existing) | app/scholars/page.tsx + app/groups/[slug]/page.tsx | Top-bar/footer-row chrome hand-duplicated between the two files | maintainability | 0.65 | manual → human | Report-only — candidate `GroupTopBar`/`GroupFooterRow` extraction, not this branch |
| 5 | P3 (pre-existing) | app/components/Wordmark.tsx:7 | `sublabel` prop is dead configuration now that no caller varies it | maintainability | 0.62 | advisory → human | Report-only |

## Requirements Completeness (plan_source: explicit)

R1–R14: **all met** (verified by reviewers against the diff; six units present as commits). Partial: the Unit 6 off-repo checks — booking URL verified brand-clean locally (mailto fallback); Stripe product/price display names, Supabase auth email templates, and the production `NEXT_PUBLIC_BOOKING_URL` value remain a manual dashboard checklist (in PR body).

## Reviewer verification highlights

- correctness: tsc clean, production build clean, all 47 workshop ids byte-identical pre/post sed, redirect ordering verified, anchor ids collision-free — 0 findings.
- testing: full suite run (393 pass), all deleted/renamed exports grepped against every test file — 0 findings.
- kieran-typescript: tsc clean; the 3 eslint errors in touched files verified byte-identical pre-existing — 0 findings.
- adversarial: `next start` + curl verified jointhe120.vercel.app/gt resolves in two 308 hops to the120.school/scholars — 0 findings. Flagged the redirect array ordering as load-bearing (comment-documented in next.config.ts).
- learnings-researcher: lockstep-mirrors doc honored (mirrors key off ids only), consent-flow doc honored (copy-only, 4 lines), stale-tab doc n/a.

## Residual risks / testing gaps (report-only)

- No automated coverage for redirects() config or page composition — matches repo convention (rule/data tests only).
- Old Vercel deployments keep branded content at immutable URLs (accepted, voluntary rebrand).
- Search engines serve stale "GT Toronto" titles until recrawl.
- CRM dossier labels read "… — Advisor to be announced" (accepted per plan Unit 5).
- Coverage: 0 findings suppressed below confidence gate; 0 reviewers failed; untracked files (artifacts/*, docs/*) excluded from scope.
