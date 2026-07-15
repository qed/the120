---
date: 2026-07-14
topic: dossier-status-mover-and-offer-email
---

# Dossier Header Status Mover, Compact Group Assignment, and Send-Offer Email

## Problem Frame

Staff reviewing a candidate dossier (e.g., Clay Kliman, who just submitted) see the status pill in the top right of `app/crm/components/dossiers/DossierDetail.tsx`, but changing that status requires scrolling to a "Move candidate" card near the bottom. The action lives far from the information it changes.

Separately, when staff move a candidate to **Offered**, nothing tells the parent. The parent dashboard already unlocks "Reserve seat · $250" (Stripe Checkout, deposit recorded via webhook) the moment the child reaches Offered — but the parent (e.g., Kevin Kliman) only discovers it if they happen to log in. The missing piece is the notification, not the payment flow.

Two smaller polish items ride along: the Group Assignment card takes three stacked lines where two suffice, and the Print button in the header is being replaced by the new offer-email action.

## Requirements

**Status mover in the header**

- R1. The status pill in the dossier header becomes the mover: clicking it opens a small menu listing the five stages; selecting one moves the candidate. Menu items reuse the existing status-label constants — the same labels the pill and the old Move-candidate chips already render — never a new shortened set. The pill visually indicates it is clickable (e.g., a ▾ affordance) while keeping the current clean pill look.
- R2. The bottom "Move candidate" card is removed entirely.
- R3. Existing move behavior is preserved: the current stage is indicated in the menu, selecting the current stage is a no-op, moving to Member keeps its confirm dialog, and success/failure surface via the existing toasts.

**Compact group assignment**

- R4. The Group Assignment card renders as two lines instead of three: the "Parent picked: The Makers" note merges onto the kicker line (e.g., `GROUP ASSIGNMENT · Parent picked: The Makers`), with the chip row as the second line. When there is no parent pick, the card is still two lines — the kicker stands alone on the first.

**Send offer email**

- R5. The Print button in the dossier header is removed and replaced by a **Send offer email** button in the same spot. (Browser-native print via Ctrl+P still works; the existing print CSS conventions stay untouched.)
- R6. The button is enabled exactly when the parent's reserve CTA is live: status **Offered or later** with **no paid deposit** — by literally calling the exported `canReserveSeat` predicate (in both the button state and R8's server re-verification), never a restated copy of the rule, so the email can never promise a call to action that isn't there and a child moved straight to Member before paying stays reachable. Otherwise it is visibly disabled with a state-aware reason, resolved in this precedence: the gate state first ("not offered yet" for pre-Offered stages, "deposit already paid" once paid), then — only when the candidate is otherwise send-eligible — "no parent contact info" (covering both a missing linked family record and a missing email address). The disabled reason must be perceivable by keyboard and screen-reader users, not only a hover tooltip on a natively disabled control (mechanism chosen in planning).
- R7. Sending emails the parent from the staff admissions identity: congratulations on the offered seat, and the next step — sign in to the dashboard to reserve the seat with the $250 deposit (refundable until September 30, 2026) — with a link to the dashboard. Copy follows the de-branded The 120 voice. The send targets the effective parent email per the existing send-address authority rule (the linked parent account's email wins over the family snapshot address), and the refund deadline in the copy is read from the shared site-facts constant (single source of truth), never a hardcoded string.
- R8. The offer email is **transactional, not marketing**: it responds directly to the family's own submitted application, so it sends regardless of marketing-consent state (this CASL rationale is recorded here deliberately; nurture and Library sends stay consent-gated). Its footer is **identification-only** — sender identity and contact, without the shared footer's "Reply STOP …" unsubscribe promise, which this send deliberately would not honor and therefore must not make. Server-side, the action re-fetches truth before sending — the candidate is still send-eligible per R6 (same `canReserveSeat` call) and an email is on file — and fails closed with a staff-visible error when the child has no linked live family record or no address. An audit trail entry is written on success; a failed send logs nothing and staff can retry.
- R9. The first click opens a confirm showing the recipient ("Send offer email to Kevin Kliman (kevin@…)?") plus a read-only rendered preview of the actual subject and body — staff catch a broken name interpolation or stale deadline before the parent ever could — before anything sends. While the send is in flight the button shows a disabled "Sending…" state (matching the existing composer pattern); on failure it returns unchanged to its sendable state alongside the error toast. After a successful send the sent record ("Offer sent · Jul 14") lives on the button itself and follows R6's gate: while the gate is open the button stays interactive and a click starts the explicit, separately confirmed **resend**; once the gate closes (deposit paid, or moved pre-Offered) the same record renders as a read-only badge — it is never lost to a later status change (it survives the move to Member). A deposit refund reopens the gate by design (matching the dashboard's refund-then-repay behavior), re-arming the button with its sent history visible. The no-double-send guarantee is enforced server-side with the documented atomic claim-then-send pattern **and covers resends**: a resend claims via compare-and-swap on the last-sent timestamp the confirming staff member saw, so two concurrent resends cannot both fire (a constraint on the storage home chosen in planning). The confirm dialogs are UX, not the guard. Recovery side channel: every genuine send leaves a BCC copy in the admissions@ inbox, so a sent-stamp with no matching BCC copy means the send died after the claim — the explicit resend action is the recovery path, and a failed unclaim after a failed send must surface a staff-visible warning rather than silently stranding the stamp.

**Verification & release**

- R10. The full flow is exercised end-to-end on Cedric Kuperman's actual dossier (family-internal, so R11's checkpoint does not constrain the test): move to Offered via the new header pill menu, send the offer email, confirm receipt of the email, and confirm the dashboard shows "Reserve seat · $250" for Cedric. If Stripe is live by then, paying and refunding the $250 during this test doubles as S10's required charge+refund round-trip verification (confirm statement descriptor "THE120", receipt email, refund copy, and the webhook flipping the deposit to refunded). End state is intentional and recorded: Cedric stays at Offered (or Member if the deposit test ran); after a refund the reserve CTA and the send button re-arm by design (with sent history visible) — expected behavior, not residue; the test's audit/send rows are kept as real history — no purge needed.
- R11. Release checkpoint (the checkable form of the no-code-guard decision): the button's availability to staff in production — i.e., R10 sign-off and any announcement to admissions — requires roadmap **S10 marked done**. This is a process gate recorded here deliberately; there is no code guard.

## Success Criteria

- Staff can read and change a candidate's status in one place — the top right of the dossier header. (Accepted trade-off: on a long dossier, staff scroll back to the header to move the candidate; a sticky header was considered and deferred.)
- The dossier detail pane is visibly shorter (one card removed, one card one line shorter).
- A parent whose child is moved to Offered receives an email that tells them exactly what to do next, and the path it points to (dashboard → reserve seat → $250 deposit) already works.
- The offer email leaves the same paper trail as other CRM sends (BCC + audit), and a family can't be double-emailed by accident.

## Scope Boundaries

- No automatic email on moving to Offered — sending is an explicit staff action via the button (the move-to-Offered moment could prompt it later; not now).
- No changes to the parent dashboard or the deposit/Stripe flow — it already gates correctly on Offered.
- No offer-email template management in the Library — this is a single purpose-built transactional email, not a Library item.
- No reminder/nurture sequence for unpaid deposits after the offer email (roadmap GTM-1 territory).
- Print styling/CSS conventions stay in place; only the button goes away.

## Key Decisions

- **Status pill → dropdown menu** (over an always-visible chip row or a separate "Move ▾" button): one element shows status and changes it; keeps the header clean. User-selected.
- **Button gate = offered-or-later while unpaid** (over strictly-Offered): mirrors `canReserveSeat`, so the button is live exactly when the parent's reserve CTA is, and a straight-to-Member unpaid family can still be notified. User-selected, superseding the earlier Offered-only choice after review finding.
- **Offer email is transactional under CASL** (over hard consent gate): it answers the family's own application; a parent who unsubscribed from nurture emails can still receive their child's offer. Marketing sends remain gated. User-selected.
- **Confirm with rendered preview before first send** (over true one-click or recipient-only): recipient plus the read-only rendered subject/body shown before a money-related message goes out; matches the composer's always-preview pattern. User-selected (upgraded from recipient-only after review finding).
- **No mechanical pre-S10 guard**: instead, Stripe go-live (S10) completes first — real-family sends are blocked on that dependency, not on an env flag. User-selected 2026-07-14; S10 progress and remaining steps tracked in `artifacts/roadmap.md`.
- **Double-send prevention is server-side atomic claim-then-send** (per the documented pattern in `docs/solutions/best-practices/`): the confirm dialogs are UX only. Review-resolved — a client dialog alone cannot deliver the "never double-emailed" guarantee.
- **Replace Print with Send offer email**: the header slot is more valuable for the action that drives revenue; native browser print remains available.

## Dependencies / Assumptions

- Resend + staff-identity email infra (`app/crm/lib/crm-email.ts`: admissions@ from-address, BCC paper trail) exists and is verified — reuse it, with two amendments: a hard send timeout (`sendCrmEmail` currently has no `AbortSignal.timeout`, unlike `app/lib/email.ts` — without one, a hung provider call can strand a claim stamped-but-unsent when the serverless request is killed before the unclaim runs), and a footer variant per R8 (identification-only, no unsubscribe promise).
- Parent-side offer gate already live: `canReserveSeat` in `app/dashboard/data.ts` unlocks the $250 reserve flow at Offered-or-later while unpaid — R6 adopts the same rule.
- **A DB migration is required** for the offer-sent state and its audit entry: `library_sends.item_id` is NOT NULL → a Library item, and `crm_audit_log.action` is a fixed CHECK allowlist on the live DB with no offer-send action. Planning picks the exact home (extend the allowlist, a `child_reviews` column, or a dedicated send log — reuse over new abstraction is the default, but note R9's resend compare-and-swap and per-child queryability constrain the choice); whichever home is chosen must carry the same staff-only access control as its neighbors (RLS, no client-writable or parent-facing path). Apply via the Supabase Management API playbook (`docs/solutions/integration-issues/`).
- **S10 Stripe go-live is a blocking dependency for real-family sends** (user decision 2026-07-14). Status: statement descriptor "THE120" verified live; live product/price/webhook creation attempted 2026-07-14 but the machine's Stripe CLI key is a read-only restricted key — remaining steps (Peter) are tracked in `artifacts/roadmap.md` S10. Cedric is a family-internal dossier, so R10 is safe regardless.
- The refund deadline belongs in `app/lib/site.ts` (the documented single source of truth for public facts); it is currently hardcoded in five places (welcome route, nurture copy, dashboard ×2, co-pilot engine) plus one seeded DB row — the offer email must read the new shared constant, and retrofitting the existing spots is optional adjacent cleanup.
- Assumes Cedric Kuperman's dossier exists in the live DB with a parent email Peter controls, and carries no already-paid deposit that would hide the reserve CTA (unverified — check before R10).

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Technical] Exact home for the offer-sent state (see the migration dependency above) — prefer reusing an existing pattern over a new abstraction; it must be queryable per child, survive reloads, and be visible to all staff.
- [Affects R7][Technical] Exact email copy and subject line, with both defenses the cited incident doc distinguishes: (1) HTML-escape interpolated parent/child names in the body per `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md`, and (2) separately strip newlines/CRLF from any name interpolated into the subject line (an SMTP header — the defense already applied in the notify-submission route). Applying only one reproduces the documented incident class.
- [Affects R1][Technical] Dropdown interaction details (keyboard navigation, click-outside close, focus return) consistent with the CRM's existing patterns — real accessibility work, not cosmetic.
- [Affects R9][Technical] Whether a resend should additionally warn when the deposit was already paid between sends (edge of the R6 gate; likely moot since the button disables once paid).
- [Affects R7][Technical] Whether every family the send can reach is guaranteed a sign-in-capable dashboard account on the snapshot-address branch of the authority rule — the email's only CTA is "sign in", and a family that cannot authenticate dead-ends at the login screen.
- [Affects R7][Technical] Whether an offer sent near/after September 30, 2026 should suppress or reword the "refundable until" line rather than promise a window that has closed (the deadline constant makes this checkable).

## Next Steps

-> `/ce:plan` for structured implementation planning
