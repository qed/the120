---
title: "feat: Dossier header status mover + send-offer-email"
type: feat
status: active
date: 2026-07-15
origin: docs/brainstorms/2026-07-14-dossier-status-mover-and-offer-email-requirements.md
---

# feat: Dossier header status mover + send-offer-email

## Overview

Three changes to the CRM dossier detail pane, plus the notification that closes the offer → deposit loop: (1) the header status pill becomes a five-stage dropdown mover, replacing the bottom "Move candidate" card; (2) the Group Assignment card compacts to two lines; (3) the Print button becomes a **Send offer email** button that emails the parent — "your child is offered a seat; sign in and reserve it with the $250 deposit" — with an atomic, per-child no-double-send guarantee. Requires one pre-deploy DB migration (offer-sent stamp + audit-action allowlist extension).

## Problem Frame

Staff change a candidate's status far from where they read it, and when a child is moved to **Offered** nothing tells the parent — the dashboard's "Reserve seat · $250" flow (already live, gated by `canReserveSeat`) sits unlocked and unannounced. Full product definition, decisions, and CASL rationale: see origin doc (review-hardened over two passes on 2026-07-14/15).

## Requirements Trace

From the origin doc (IDs preserved):

- R1. Status pill → dropdown mover; existing `REVIEW_STATUS_LABELS`; ▾ affordance.
- R2. Bottom "Move candidate" card removed entirely.
- R3. Move behavior preserved: current-stage no-op, Member confirm, existing toasts.
- R4. Group Assignment card renders as exactly two lines (kicker + optional parent-pick merged on line one; chips on line two).
- R5. Print button removed; Send offer email button in its place; print CSS conventions untouched.
- R6. Button enabled exactly when the exported `canReserveSeat(status, deposits)` is true; disabled reasons with precedence (gate state first, then "no parent contact info"); accessible to keyboard/screen-reader users.
- R7. Email: staff admissions identity, congratulations + sign-in-and-reserve CTA, refund deadline from a shared `site.ts` constant, effective-parent-email authority rule.
- R8. Transactional under CASL (sends regardless of marketing-consent state; **identification-only footer**, no unsubscribe promise); server re-fetches truth (same `canReserveSeat`); fails closed on no-family/no-email; audit on success; nothing logged on failure.
- R9. Confirm-with-rendered-preview before first send; "Sending…" in-flight state; sent record on the button (interactive resend while gate open, read-only badge when closed); atomic claim-then-send covering resends via compare-and-swap; BCC recovery side channel; failed-unclaim warning.
- R10. E2E verification on Cedric Kuperman's dossier (family-internal); can double as S10's charge+refund round-trip.
- R11. Release checkpoint: staff availability requires roadmap S10 marked done (process gate, deliberately no code guard).

Added during planning (flow analysis, consistent with origin intent):

- F1. Per-child emails are intended (two offered children ⇒ two emails to the same parent, one per seat/deposit); **the child's first name is a hard requirement in both subject and body** so two emails never read as an accidental double-send.
- F2. The pill menu warns (lightweight confirm, same pattern as the Member move) before moving a child **pre-Offered** when an offer-sent stamp exists and no deposit is paid — otherwise the parent holds an email pointing at a CTA the move just killed (protects R6's "never promise a CTA that isn't there").

## Scope Boundaries

(Per origin doc.) No automatic email on move-to-Offered; no parent-dashboard or Stripe-flow changes; no Library template management; no nurture/reminder sequence; print CSS conventions stay. Additionally out of scope here: retrofitting the five existing hardcoded refund-deadline spots (optional adjacent cleanup, listed in Unit 2); fixing the known open injection residual in `app/api/welcome/route.ts` (pre-existing, tracked in the security solution doc); the checkout-session/demote race noted in System-Wide Impact (pre-existing).

## Context & Research

### Relevant Code and Patterns

- `app/crm/lib/actions/reviews.ts` — server-action canon (`requireStaff` → Zod `safeParse` → `supabaseAdmin` → audit → `{ success, error? }`); `moveCandidate` delegates to the SECURITY-DEFINER `move_candidate` RPC (atomic status sync + audit); module-private `familyIdForChild` — the offer action lives in this file to reuse it.
- `app/api/notify-submission/route.ts` + `docs/solutions/best-practices/atomic-claim-then-send-…-2026-07-14.md` — the claim-then-send template: atomic claim UPDATE with `.select()`, never-throw send, best-effort unclaim inside its own try/catch.
- `app/crm/components/library/SendComposer.tsx` — confirm-with-preview canon: `role="dialog"` overlay, `useFocusTrap`, TO/SUBJECT card + `whitespace-pre-wrap` body preview, `sending ? "Sending…" : …`, inline error keeps the form.
- `app/crm/components/pipeline/DrawerHeader.tsx` (··· overflow menu) — the only existing dropdown precedent (`aria-expanded`, absolute-positioned panel); has no Escape/click-outside handling — the new menu must add both (`useFocusTrap` in `app/crm/components/useFocusTrap.ts` is the closest helper).
- `app/dashboard/data.ts` — exported `canReserveSeat` (already consumed by the dashboard CTA and `app/api/checkout/route.ts`; unknown statuses fail closed; tests in `app/dashboard/__tests__/reserve-gate.test.ts`).
- `app/crm/lib/queries.ts` — `DossierItem` (has `reviewStatus`, `deposits`, `parentEmail` from the parents row only, `familyId`); `fetchDossierQueue`'s `child_reviews` select is where the stamp column gets added.
- `app/crm/lib/library-rules.ts` — `escapeHtml` (tested), `bodyToHtml`; `app/crm/lib/actions/library.ts` `loadSendFamily` — the send-address authority rule (parents-row email wins, family-snapshot fallback).
- `app/crm/lib/crm-email.ts` vs `app/lib/email.ts` — the CRM sender has BCC + footer but **no `AbortSignal.timeout`**; the base sender has the timeout but no BCC/footer.
- Pure-rules testing canon: no Supabase mocking; decision logic lives in rules modules (`reviews-rules.ts`, `library-rules.ts`) tested under `app/crm/__tests__/`.

### Institutional Learnings

- **Atomic claim-then-send** (best-practices, 2026-07-14): claim before send; unclaim best-effort; send never throws; bounded timeout is load-bearing. The stamp here lives on staff-only `child_reviews`, so the doc's coerce-trigger is unnecessary per its own "When to Apply" (unlike the `children` precedent) — reasoning recorded here deliberately.
- **Email HTML injection** (security-issues, 2026-07-14): `escapeHtml` every interpolation in the HTML part; newline-strip + truncate names in the subject (header defense ≠ HTML defense); the **preview dialog is a second injection surface** — render preview and send from one template function.
- **Upsert INSERT arm poisons EXCLUDED / coerce-not-raise guards** (database-issues, 2026-07-14): status transitions via targeted service-role writes (the `move_candidate` RPC — already reused), never upserts; the new stamp column is written only by the offer action's targeted UPDATE.
- **Management API migration playbook** (integration-issues, 2026-07-13): no DB password; apply SQL via Management API with the Credential Manager token, record in `schema_migrations`, verify with count SELECTs; keep em-dash-bearing copy in TS template literals, not seeded DB rows.
- **Split-phase migrations** (workflow-issues, 2026-07-14): this migration is **pre-deploy** (additive: new column + widened CHECK) with an imperative phase header.
- **Shared predicate = single source of truth** (logic-errors, 2026-07-14): both the button and the server guard call the exported `canReserveSeat` — never a restated copy.
- **Production email testing**: use Resend black-hole addresses (`delivered+x@resend.dev`) when a clickable inbox isn't needed.

### External References

- None — deliberately skipped; every layer reuses recently-shipped in-repo patterns.

## Key Technical Decisions

- **Stamp home = `child_reviews.offer_email_sent_at timestamptz`**: staff-only RLS table, cascades with the child, per-child queryable, supports both claim-on-null and CAS resends — and needs no server-owned coerce trigger (unlike the `children` stamp precedent). Chosen over a dedicated send-log table (new abstraction; audit rows already give send history) and over extending `children` (parent-adjacent, would need a guard trigger).
- **Audit action `offer-email`** added to both `AUDIT_ACTIONS` in `app/crm/lib/constants.ts` and the `crm_audit_log` CHECK (enum canon: both together). First CHECK-alter in the repo — use the **single-statement form**, atomic by construction regardless of channel: `alter table public.crm_audit_log drop constraint crm_audit_log_action_check, add constraint crm_audit_log_action_check check (action in (…, 'offer-email'));`.
- **Discriminated action result** — `sent | already_sent | gate_closed | not_found | send_failed` (plus `sentAt` on success, `warning` on logged-but-degraded outcomes): the client must behave differently per cause — gate-derived outcomes trigger `router.refresh()` with a specific message; only `send_failed` returns the button to its sendable state.
- **`effectiveParentEmail` + `offerSentAt` shipped on `DossierItem`**: the queue query resolves the send address with the same authority rule the action uses (parents-row email, family-snapshot fallback), so the disabled reason, the confirm recipient, and the server verdict can never disagree; the stamp round-trips after each send (action returns it AND the client refreshes).
- **One template function renders both preview and send** (injection surface unification): pure function in a rules module → `{ subject, text, html }`; the dialog shows exactly what the send will use; the send re-renders from server truth at send time (the preview is advisory).
- **Footer variant**: `sendCrmEmail` gains an options parameter (footer: standard CASL vs identification-only — make it **required**, no default, so no future transactional call site silently inherits the wrong CASL footer) and the `AbortSignal.timeout(8000)` it currently lacks; existing library-send callers keep the standard footer.
- **Resend CAS with a pinned string round-trip**: first send claims `WHERE offer_email_sent_at IS NULL`; resend claims `WHERE offer_email_sent_at = <the stamp the confirming staff member saw>`. Three invariants make the equality trivially exact: (a) the stamp is always minted in JS (`new Date().toISOString()`, millisecond precision — never a SQL `now()` default); (b) the client passes `item.offerSentAt` back **verbatim as an opaque string** — never re-parsed through `Date` (the "Offer sent · {date}" label formats a separate parse); (c) the Zod field accepts offset-bearing ISO strings (PostgREST serializes `+00:00`; Zod v4's strict datetime default would reject every legitimate resend).
- **Unclaim is CAS-guarded too**: on send failure, the restore is `UPDATE … SET offer_email_sent_at = <prior value> WHERE child_id = … AND offer_email_sent_at = <the stamp THIS invocation wrote>` with `.select()`. Zero rows restored ⇒ a concurrent claim superseded this one — treat as CAS loss (do NOT restore, do NOT warn as unclaim-failure; the newer stamp is truth). The notify-submission template's unconditional unclaim **must not be copied verbatim** — it is safe there only because that flow has no resends; here it could clobber a concurrent successful resend's stamp and re-arm an accidental double-send. CAS loss surfaces as info ("already resent — refreshed"), not error.
- **Interactive pill wraps `ReviewPill`, never edits it**: the pill span is shared with `QueueList` rows and deliberately prints; the menu button, ▾, open panel, and Send button are `no-print`; the sent badge prints (it's dossier history).
- **Accessibility mechanisms (settled here, per R6)**: the disabled offer button is `aria-disabled` + visually dimmed, **not natively disabled**, so it stays keyboard-focusable, with `aria-describedby` resolving to a visible reason string; the status menu marks the current stage with `aria-checked` semantics (not a bare visual dot) and uses roving tabindex + arrow keys per the ARIA menu pattern — `useFocusTrap`'s Tab-trap is for modal dialogs (the confirm dialog uses it), not menus. The Print button being replaced uses exactly the forbidden pattern (`title` on a plain button) — do not copy local convention here.
- **Email links**: `https://the120.school/dashboard` via a new `SITE_URL` constant in `app/lib/site.ts`, beside the new `DEPOSIT_REFUND_DEADLINE_LABEL` constant.

## Open Questions

### Resolved During Planning

- Storage home for the offer-sent state: `child_reviews` column (above) — reuse over new abstraction, satisfies CAS + per-child queryability + staff-only access control.
- Coerce trigger for the stamp: not needed — `child_reviews` is staff/service-role-only; reasoning per the pattern doc's own applicability note.
- Client behavior per failure cause, effective-email plumbing, stamp round-trip + CAS-loss copy: per Key Technical Decisions (from flow analysis).
- Two offered children ⇒ two per-child emails, child name mandatory in subject + body (flow analysis → F1).
- Demote-after-send guardrail: lightweight confirm in the pill menu (flow analysis → F2).
- Print surface, email link target, and accessibility mechanisms: per Key Technical Decisions.

### Deferred to Implementation

- Exact subject/body copy (bounded by: child first name in both; name escaping in HTML; CRLF-strip + truncate in subject; deadline from the constant; de-branded voice).
- Post-deadline copy handling (origin deferred question): the constant makes it checkable; simplest v1 is unconditional copy — decide at implementation with real dates in view.
- Fine dropdown DOM details (exact positioning vs the Send button below it in the narrow header column; narrow-viewport wrapping) — the interaction/a11y model itself is settled in Key Technical Decisions.
- Whether `assignGroup`'s upsert needs `revalidatePath("/crm/pipeline")` parity — noticed in research; unrelated to this feature, note-only.

## Implementation Units

- [x] **Unit 1: Pre-deploy migration + enum constants**

**Goal:** The DB can store the offer-sent stamp and accept the new audit action.

**Requirements:** R8, R9 (persistence halves)

**Dependencies:** None. **Applied before any code deploys** (split-phase canon).

**Files:**
- Create: `supabase/migrations/20260715090000_offer_email_stamp.sql`
- Modify: `app/crm/lib/constants.ts` (`AUDIT_ACTIONS` + `AuditAction`)

**Approach:**
- `alter table child_reviews add column if not exists offer_email_sent_at timestamptz;`
- Recreate the `crm_audit_log` action CHECK with `'offer-email'` appended — **one `ALTER TABLE` statement carrying both the DROP CONSTRAINT and ADD CONSTRAINT clauses** (atomic by construction; no reliance on the Management API's transaction wrapping): the audit table is immutable, so a row inserted in a constraint-free window could never be corrected. The inline constraint auto-names as `crm_audit_log_action_check` — verify against the live DB first. The ADD revalidates existing rows under ACCESS EXCLUSIVE (fine at this table's size; count-check after). The table's immutability triggers are row-level BEFORE UPDATE/DELETE only — they don't interfere with the ALTER or a rolled-back INSERT probe.
- Imperative phase header: "Applied PRE-DEPLOY — the offer-send action depends on the stamp column and the extended allowlist."
- Apply via the Management API playbook; insert the version into `supabase_migrations.schema_migrations`; verify with count SELECTs (column exists; an `offer-email` insert probe inside a rolled-back transaction passes the CHECK).

**Test scenarios:**
- Test expectation: none — SQL migration + `as const` tuple edit; the TS side is compile-checked, and Unit 3's action tests exercise the action string.

**Verification:**
- Live DB shows the column and the widened CHECK; `schema_migrations` records the version; existing audit inserts still pass.

- [x] **Unit 2: Shared constants + offer rules module (template, gate, states)**

**Goal:** All decision logic and the email template exist as pure, tested functions.

**Requirements:** R6, R7, R8 (copy/gate logic), F1

**Dependencies:** None (parallel with Unit 1).

**Files:**
- Modify: `app/lib/site.ts` (`SITE_URL`, `DEPOSIT_REFUND_DEADLINE_LABEL`)
- Create: `app/crm/lib/offer-rules.ts`
- Test: `app/crm/__tests__/offer-rules.test.ts`

**Approach:**
- `offerEmailTemplate({ childFirstName, parentName })` → `{ subject, text, html }`: child's first name in subject and body (F1); `escapeHtml` every HTML interpolation; CRLF-strip + truncate names in the subject; CTA link `SITE_URL + "/dashboard"`; deadline from the constant; de-branded voice.
- `offerButtonState({ reviewStatus, deposits, effectiveParentEmail, offerSentAt })` → discriminated UI state (`sendable | resendable | not_offered | deposit_paid | no_contact`) implementing R6's precedence, calling the exported `canReserveSeat` — never a restated rule. The enum drives **interactivity** only (only `sendable`/`resendable` are clickable); whether the sent-date badge renders is driven by `offerSentAt` being non-null, **independent** of which state the enum returns — R9's badge must survive every gate-closed state.
- `demoteWarning({ targetStatus, offerSentAt, deposits })` → boolean for F2 (target pre-Offered ∧ stamp set ∧ no paid deposit).
- Optional cleanup note (not required): the five existing hardcoded deadline strings (`app/api/welcome/route.ts`, `app/lib/nurture/copy.ts`, `app/dashboard/DashboardApp.tsx` ×2, `app/crm/lib/engine.ts`) can adopt the constant.

**Execution note:** Implement the rules module test-first (pure functions, established `__tests__` canon).

**Test scenarios:**
- Happy path: template output contains child first name in subject AND body; dashboard link uses `SITE_URL`; deadline label present in text and html.
- Error path (injection): name `<img src=x onerror=…>` → escaped in html, raw in text; name with `\r\nBcc: evil@x` → subject has no CR/LF and is truncated to the length cap.
- Happy path (gate): offered+unpaid → `sendable`; offered+unpaid+stamp → `resendable`.
- Edge cases (precedence): submitted+no-email → `not_offered` (gate state wins); offered+paid+no-email → `deposit_paid`; offered+unpaid+no-email → `no_contact`; member+unpaid → `sendable` (straight-to-Member reachable); refunded-then-unpaid → `sendable`/`resendable` (re-arm).
- Edge cases (badge survival, R9): offered+paid+stamp → `deposit_paid` AND the sent date still renders as a read-only badge; submitted (demoted)+stamp → `not_offered` AND the badge still renders — the most common real sequence (send → parent pays) must never drop the badge.
- Edge case: unknown status string → fails closed (`not_offered`), inherited from `canReserveSeat`.
- Happy path (CAS round-trip): a stamp string as PostgREST serializes it (`+00:00` offset form) passes the Zod schema and equals the CAS comparison value untransformed.
- Happy path (F2): in_review target + stamp + unpaid → warn; member target + stamp → no warn; in_review target + stamp + paid → no warn.

**Verification:**
- `npm test` green; template snapshot reviewed by eye for voice.

- [x] **Unit 3: `sendOfferEmail` server action + data plumbing + email infra amendments**

**Goal:** The server can send the offer email exactly once per confirmation, with truth re-checks, and the queue ships the fields the UI needs.

**Requirements:** R7, R8, R9 (server half)

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `app/crm/lib/actions/reviews.ts` (new `sendOfferEmail`; reuse module-private `familyIdForChild`)
- Modify: `app/crm/lib/crm-email.ts` (`AbortSignal.timeout(8000)`; footer option `standard | identification`)
- Modify: `app/crm/lib/queries.ts` (`child_reviews` select + `DossierItem.offerSentAt`; `effectiveParentEmail` resolved with the authority rule — parents-row email, family-snapshot fallback; widen `fetchDossierQueue`'s families select from `id, parent_id` to `id, parent_id, email` so the fallback has data. Note: the fallback is near-dead code for dossier children — parents-row email normally exists — it serves the same edge the composer's rule does)
- Modify: `app/crm/lib/reviews-rules.ts` (Zod schema: `childId`, optional `resendOf` timestamp)
- Test: `app/crm/__tests__/offer-rules.test.ts` (schema + any extracted result-mapping helpers)

**Approach:**
- Canon order: `requireStaff` → `safeParse` → fetch child + review + deposits + family (fail closed `not_found` when the child or live family is missing; `gate_closed` reason `no_contact` when no effective email) → `canReserveSeat` re-check → atomic claim (`IS NULL` for first send; `= resendOf` CAS for resend; stamp minted in JS per the pinned round-trip invariants) — zero rows claimed → probe `child_reviews.offer_email_sent_at` for the child (NOT the children row): stamp set → `already_sent` returning the fresh stamp so the client can re-CAS; row missing or stamp null → `not_found`/`gate_closed` as appropriate → render template (server truth) → send → on failure: **CAS-guarded** unclaim per Key Technical Decisions (zero rows restored = superseded by a concurrent claim — no restore, no unclaim-failure warning), its own try/catch, `send_failed` (+ `warning` only when a genuinely-held claim failed to restore) → on success: `crm_audit_log` insert (`offer-email`, family + child ids, to-address, resend flag in metadata) → `revalidatePath("/crm/dossiers")` → `{ status: "sent", sentAt }`.
- Decision-10 contract: a failed send writes nothing (no stamp survives, no audit, no last-touch).
- The library-send callers of `sendCrmEmail` keep today's behavior (standard footer; timeout addition is strictly safer).

**Execution note:** Extract anything decision-shaped (result mapping, claim-outcome interpretation) into `offer-rules.ts` so tests need no Supabase mock.

**Test scenarios:**
- Happy path (schema): valid uuid → parse ok; `resendOf` absent vs ISO timestamp both accepted, **including the `+00:00` offset form PostgREST returns**.
- Error path (schema): bad uuid / malformed timestamp → parse error message.
- Claim-outcome mapping (pure): zero-rows + stamp-set-on-probe → `already_sent` (with fresh stamp); zero-rows + review-row-missing-or-stamp-null → `not_found`/`gate_closed`; claimed + send-ok → `sent`; claimed + send-fail + restore-took → `send_failed` no warning; claimed + send-fail + restore-zero-rows (superseded) → CAS-loss outcome, no warning; claimed + send-fail + restore-errored → `send_failed` with warning.
- Integration (manual, Unit 7): timeout path — a hung provider resolves `send_failed` in ~8s, stamp restored.

**Verification:**
- Two rapid concurrent invocations for the same child (manual or scripted) produce exactly one email + one audit row; the loser reports `already_sent`.

- [x] **Unit 4: Header status-pill dropdown (replaces the Move card)**

**Goal:** Status is readable and changeable in one place, top right.

**Requirements:** R1, R2, R3, F2

**Dependencies:** Unit 2 (`demoteWarning`); Unit 3 for `DossierItem.offerSentAt` (the F2 demote-warning wiring). The menu shell, move behavior, and card removal are independent of Units 1/3 and may land first with `offerSentAt` treated as absent (warning inert until Unit 3 lands). Units 4 → 5 → 6 all modify `DossierDetail.tsx` — land them sequentially in that order, not in parallel sessions.

**Files:**
- Create: `app/crm/components/dossiers/StatusMenu.tsx`
- Modify: `app/crm/components/dossiers/DossierDetail.tsx` (header swap; delete the Move card and `MOVE_STAGES`)
- Test: covered by Unit 2's `demoteWarning` scenarios (menu itself is wiring)

**Approach:**
- `StatusMenu` wraps the untouched `ReviewPill` in a button (`aria-haspopup="menu"`, `aria-expanded`, ▾ affordance) — single-purpose, not a generalized menu primitive (scope-guardian note).
- Panel: absolutely positioned like the DrawerHeader precedent, plus what that precedent lacks — Escape-to-close, click-outside, focus return to the trigger (per `useFocusTrap` conventions), `role="menu"`/`menuitem`, current stage marked (`aria-checked` or visual dot).
- Selecting the current stage is a no-op; Member keeps `window.confirm`; F2's demote warning uses the same `window.confirm` pattern — draft copy (adjust voice at implementation): `An offer email went to {parentName} on {date} and no deposit is paid. Moving {childName} back to {stage} kills the "Reserve seat" button their email points at. Move anyway?`; then the existing `move()` handler unchanged (toast + `router.refresh()`).
- Interactive parts `no-print`; the pill span still prints. Once Unit 6 lands: the Send button is disabled while `moving`, and the status menu is disabled while a send is in flight (`sending`) — the two header actions never race each other.

**Test scenarios:**
- Test expectation: interaction wiring — no unit tests beyond Unit 2's predicates; behavior verified in Unit 7 (menu open/close/Escape, move fires, no-op on current, both confirms, focus return).

**Verification:**
- Bottom card gone; every stage reachable from the header; queue pill + needs-review badge update after a move; print preview shows the pill without ▾ or menu.

- [x] **Unit 5: Group Assignment two-line compaction**

**Goal:** R4 — the card is exactly two lines.

**Requirements:** R4

**Dependencies:** None.

**Files:**
- Modify: `app/crm/components/dossiers/DossierDetail.tsx` (merge the parent-pick note into the kicker line: `GROUP ASSIGNMENT · PARENT PICKED: THE MAKERS`; kicker alone when no pick; `GroupChips` row unchanged)

**Test scenarios:**
- Test expectation: none — pure presentation; `parentPickLabel`'s garbage-slug handling already exists and is unchanged.

**Verification:**
- With and without a parent pick, the card renders two lines at desktop widths.

- [x] **Unit 6: Send-offer button, confirm-with-preview dialog, sent-state UI**

**Goal:** The full staff-facing send experience per R5/R6/R9 and the discriminated post-result client contract.

**Requirements:** R5, R6, R9 (client half)

**Dependencies:** Units 2, 3.

**Files:**
- Create: `app/crm/components/dossiers/OfferEmailButton.tsx` (button + dialog)
- Modify: `app/crm/components/dossiers/DossierDetail.tsx` (replace the Print button)
- Test: covered by Unit 2's `offerButtonState` scenarios (component is wiring)

**Approach:**
- Button renders from `offerButtonState`: `sendable` ("Send offer email"), `resendable` ("Offer sent · {date}" — interactive), disabled states per the settled a11y mechanism (`aria-disabled` + focusable, `aria-describedby` → visible reason); the sent-date badge renders whenever `offerSentAt` is non-null, in every disabled state (R9 badge survival).
- **State derivation rule**: derive from `item.offerSentAt` on every render — never `useState(item.offerSentAt)` (the `notes` useState in `DossierDetail.tsx` is the local anti-pattern: it goes stale across `router.refresh()` because the component keeps its identity, `key` unchanged). PLUS a local `lastResult.sentAt` optimistic overlay after a successful action, so the button never flashes back to sendable during the refresh window (the double-click-prone moment); the overlay is superseded when fresh props deliver a stamp.
- Dialog per the SendComposer confirm step: recipient name + `effectiveParentEmail`, rendered subject + body from the SAME `offerEmailTemplate` (escaped output; `whitespace-pre-wrap` text preview — no `dangerouslySetInnerHTML`), Cancel + "Send now"/"Resend now", `sending` disables everything, resend passes `resendOf: offerSentAt` verbatim (opaque string — never through `Date`).
- Post-result contract: `sent` → success toast + `router.refresh()`; `already_sent` → info toast ("Offer already sent — refreshed") + refresh; `gate_closed` → error toast ("No longer sendable — status or deposit changed; refreshed") + refresh; `not_found` → error toast ("Candidate not found — refreshed") + refresh; `send_failed` → inline error in the dialog, button returns to sendable; any `warning` → additional warning toast (failed-restore case).
- `no-print` on button + dialog; the sent badge prints.

**Test scenarios:**
- Test expectation: none beyond Unit 2's state-resolver tests — the discriminated post-result behaviors are exercised in Unit 7's E2E (send, resend, race, refund re-arm).

**Verification:**
- Preview shows exactly what arrives in the inbox (spot-check against the BCC copy); a `send_failed` leaves no stamp, no audit row, and a sendable button.

- [ ] **Unit 7: End-to-end verification on Cedric's dossier (R10) + release checkpoint**

**Goal:** The whole loop demonstrably works against production truth; release gating honored.

**Requirements:** R10, R11, F1, F2

**Dependencies:** Units 1–6 deployed; migration applied pre-deploy.

**Files:**
- Modify: `artifacts/roadmap.md` (S10/S11 notes as outcomes dictate)

**Approach / checklist:**
- Pre-check the origin doc's unverified assumption: Cedric's dossier exists, parent email is Peter-controlled, **no already-paid deposit** (else the CTA and button are correctly hidden and the test needs a refund first).
- Staff flow: move Cedric to Offered via the pill menu (confirm queue/badge refresh) → button enabled → confirm dialog preview reads correctly (child name in subject/body, deadline, no escaping artifacts) → send → email received (or `delivered+offertest@resend.dev` black-hole variant for repeat runs) → BCC copy in admissions@ → audit row with `offer-email` → "Offer sent" state survives reload and a second browser.
- Race + resend: a fresh-props **successful resend** first — verify a second email actually arrives and the stamp advances (a silently-broken CAS maps every resend to the loss path; this line is the canary) — then attempt a resend from a second tab with the stale stamp → info "already resent — refreshed" (CAS loss); demote warning fires when moving Cedric pre-Offered with the stamp set. (Note: the two-tab test proves sequential claim-dedupe, which is the DB-level serialization point — a true sub-second simultaneous race isn't manually reproducible and isn't required.)
- Parent flow: sign in as Cedric's parent → "Reserve seat · $250" visible → if S10 is live, pay + refund $250 (this IS S10 step 4: descriptor "THE120", receipt, refund copy, webhook flips the deposit, CTA + button re-arm with sent history).
- R11: real-family use waits for roadmap S10 marked done — process gate; record final state in the roadmap.

**Test scenarios:**
- Test expectation: none — this is the manual E2E unit; scripted checks live in Units 2–3.

**Verification:**
- Every checklist line above observed and the end state recorded: Cedric intentionally left at Offered (or Member), test rows kept as real history.

## System-Wide Impact

- **Interaction graph:** `move_candidate` RPC (unchanged, reused); `children_status_guard` (service-role path already correct); `revalidatePath` on `/crm/dossiers` (queue, badge); Stripe `charge.refunded` webhook now also re-arms the staff button (by design, R9/R10).
- **Error propagation:** the discriminated action result is the contract — gate-derived causes refresh the client; only transport failure re-arms; `sendCrmEmail` stays never-throw with the new timeout bounding the serverless request.
- **State lifecycle risks:** claimed-but-unsent stamp (mitigated: timeout + unclaim + BCC reconciliation + resend as recovery + warning on failed unclaim); stale client stamp for CAS (mitigated: action returns stamp AND client refreshes).
- **API surface parity:** `sendCrmEmail`'s new options must not change library-send behavior (standard footer preserved); `ReviewPill` untouched for `QueueList` parity; `DossierItem` gains fields — additive only.
- **Integration coverage:** concurrent-send race, refund re-arm, and demote warning are E2E-verified in Unit 7 (mocks can't prove them).
- **Unchanged invariants:** parent dashboard, checkout gate, webhook, `canReserveSeat` semantics, print CSS conventions, library send flow, Member-move confirm. Pre-existing (not addressed here): checkout gates at session creation, so a demote during an open Checkout session can still record a paid deposit; `app/api/welcome/route.ts` injection residual.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| First-ever CHECK-constraint alter on the live audit table | Verify constraint name from live DB first; drop+add in one batch; probe-insert in a rolled-back transaction; playbook channel with count verification |
| Hung provider strands the claim | `AbortSignal.timeout(8000)` added to `sendCrmEmail` (Unit 3) — the pattern doc's load-bearing prerequisite |
| Migration/copy mojibake via PowerShell channel | Keep template in TS (Unit 2), not seeded rows; verify DB-side strings by hex if ever needed |
| Staff send to a real family pre-S10 | R11 process gate (explicit user decision — no code guard); S10 remaining steps tracked in `artifacts/roadmap.md`, currently blocked on Peter (live keys + product/webhook creation) |
| Cedric test-day assumption fails (no dossier / paid deposit) | Unit 7 pre-check step before anything else |
| Two staff racing sends/resends | claim-on-null + CAS, verified in Unit 7 |

## Documentation / Operational Notes

- Roadmap S10/S11 updated as outcomes land (Unit 7); consider a `docs/solutions/` compound pass after shipping (first CHECK-alter migration + the footer-variant decision are both first-of-kind here).
- Post-deploy, the S11 purge re-run (due on/after 2026-07-16) is unrelated but shares the Management API channel — batch them if convenient.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-14-dossier-status-mover-and-offer-email-requirements.md](../brainstorms/2026-07-14-dossier-status-mover-and-offer-email-requirements.md)
- Related code: `app/crm/components/dossiers/DossierDetail.tsx`, `app/crm/lib/actions/reviews.ts`, `app/api/notify-submission/route.ts`, `app/crm/lib/queries.ts`, `app/dashboard/data.ts`
- Related PRs: #5 (approval gate — established `canReserveSeat` gating), #6 (status-guard hardening — targeted-UPDATE canon)
- Solutions: `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md`, `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md`, `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`, `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md`
