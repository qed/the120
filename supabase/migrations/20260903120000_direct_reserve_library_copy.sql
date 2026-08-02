-- Direct reserve (2026-08-02, nav-deposit-shortcut U6): the answer library's
-- refund-terms entry promised "No payment until a seat is offered" — the
-- exact sequencing direct reserve inverts. Reworded to cover both paths
-- (reserve directly, or wait for an offer). Targeted by the STABLE concern
-- slug, never by body text: em-dashes at rest may be hyphen-flattened
-- (docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-
-- title-drift-crm-library-2026-07-14.md) and an exact-match WHERE would
-- silently update zero rows. Precedent: 20260714213000_debrand_library_copy.
-- Apply via the Management API playbook.

update public.library_items
set body =
  'The seat deposit is $250 and it''s fully refundable until September 30, 2026. You can pay it any time — right after creating an account to reserve a seat directly, or after a seat is offered — and it''s returned in full if The 120 can''t offer your child a place. Tuition itself applies only after your child qualifies: dossier review, then the qualifying assessment. If the 120 is full, you join the waitlist for the next assessment window. The network stays 120.'
where concern = 'refund-terms'
  and type = 'faq';
