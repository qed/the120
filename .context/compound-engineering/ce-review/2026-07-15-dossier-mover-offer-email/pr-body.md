## What this does

Closes the offer -> deposit loop in the CRM dossier pane, per plan `docs/plans/2026-07-15-001-feat-dossier-mover-offer-email-plan.md` (origin brainstorm: `docs/brainstorms/2026-07-14-dossier-status-mover-and-offer-email-requirements.md`).

1. **Header status mover** - the read-only status pill is now a five-stage menu (ARIA menu pattern: roving tabindex, aria-checked, Escape/click-outside). The bottom "Move candidate" card is gone. Member keeps its confirm; a new guardrail confirms before demoting a child whose offer email is out and unpaid.
2. **Group Assignment** - compacted to exactly two lines.
3. **Send offer email** - replaces the Print button (Ctrl+P still prints; the pill and offer-sent badge deliberately print). Gated by the exported `canReserveSeat` (offered-or-later + unpaid) on client AND server; confirm dialog previews the exact rendered template; transactional email (identification-only CASL footer - no unsubscribe promise it would not honor); atomic claim-then-send on `child_reviews.offer_email_sent_at` with compare-and-swap resends and a CAS-guarded unclaim; audit action `offer-email`; discriminated result contract drives per-cause client behavior.

**Migration `20260715090000_offer_email_stamp.sql` is already applied to production** (pre-deploy phase, Management API playbook, recorded in schema_migrations, count-verified 2026-07-15) - this deploy is additive on top of it.

## Key decisions

- Stamp lives on staff-only `child_reviews` (no coerce trigger needed, per the claim-then-send doc's own carve-out)
- One template function renders preview AND send (single injection surface; both header + HTML defenses per the documented incident)
- `sendCrmEmail` gained a required footer variant + the 8s AbortSignal timeout the pattern depends on; library sends byte-identical (parity-tested)
- Effective send address resolved by one shared `effectiveEmail` helper in queue + action

## Testing

- 426 unit tests green (33 new: template/injection/gate/CAS/claim-miss/unclaim/footer-parity); tsc + eslint clean; production build compiles
- 12-persona ce:review (autofix): 16 findings applied in `1870769` (CAS-token overlay fix, parent-owned optimistic stamp for the demote warning, keyboard-safe disabled guards, error-checked reads, stuck-Sending fix); run artifact in `.context/compound-engineering/ce-review/2026-07-15-dossier-mover-offer-email/`
- **R10 manual E2E on Cedric Kuperman's dossier runs post-deploy** (move to Offered via the menu -> send -> inbox + BCC + audit -> dashboard shows Reserve seat); can double as Stripe S10's charge+refund round-trip once live keys land

## Post-Deploy Monitoring & Validation

- **Validation window / owner:** first 24h after merge; Peter + agent (R10 checklist is plan Unit 7)
- **Logs:** Vercel function logs for `[offer-email] audit insert failed` (must stay absent) and `[checkout]` errors; Resend dashboard for the offer send + bounce state
- **Healthy signals:** offer send returns `sent`, BCC copy in admissions@, `crm_audit_log` row with action `offer-email`, button flips to "Offer sent" and survives reload/second browser, demote warning fires with stamp set
- **Failure signals -> action:** send returns `send_failed` with unclaim warning (verify BCC before retrying); button shows "Offer sent" with no BCC copy (claim stranded - use Resend as recovery); any audit CHECK violation (would mean prod constraint drift - re-verify migration)
- **Rollback:** revert the merge commit (UI-only); the migration is additive and stays (column + widened CHECK are harmless to old code)
- **Release checkpoint (plan R11):** real-family sends wait until roadmap S10 (Stripe live keys) is marked done - process gate, staff-internal testing on Cedric is explicitly allowed before that

🤖 Generated with [Claude Code](https://claude.com/claude-code)
