---
title: "Content-safety enforcement must live at the lowest shared writer, not the API endpoints — and a kid-safe blocklist needs space boundaries, term classes, and phrase forms"
date: 2026-08-03
category: security-issues
module: fp-public-sites
problem_type: security_issue
component: backend
symptoms:
  - "Server-side blocklist ran at claim/publish endpoints, but after first publish the ONLY writer of live-page content was the save-doc projection trigger — which had no blocklist at all; an in-game edit (or a direct save-doc write per the R20 threat model) reached the live public page unfiltered within seconds"
  - "Aggressive separator-stripping fold created Scunthorpe false positives across word joins: 'Sushi Tempura' folded to contain 'shit', 'Bass Hole Lures' to 'asshole' — silently blanking legitimate kid headlines to empty"
  - "'Scunthorpe Sweets' collided WITHIN a token ('cunt' ⊂ 'scunthorpe') — unfixable by any boundary rule, only by term-class curation"
root_cause: logic_error
resolution_type: code_and_migration
severity: high
last_updated: 2026-08-03
related_components:
  - supabase/migrations/20260907120000_fp_public_sites.sql (fp_blocked_terms, fp_blocklist_fold, fp_clamp_public_text in the shared extraction)
  - app/fp/lib/fp-public-site-rules.ts (foldForBlocklist, containsBlockedTerm, sanitizePublicText — the TS mirror)
  - app/api/fp/site/site-core.ts (claim backfill / publish resync — enforcement callers, no longer the sole gate)
tags:
  - content-safety
  - blocklist
  - scunthorpe
  - trigger
  - projection
  - enforcement-seam
  - kid-safety
  - fp
---

# Content-safety enforcement must live at the lowest shared writer

## Problem

The public-site feature enforced its content blocklist in the claim and publish
endpoints ("server-side is the enforcement, because a save-doc write can bypass the
client"). But once a page was published, ongoing edits flowed save-doc → projection
trigger → live page, never touching those endpoints. The enforcement guarded the two
moments content *became* visible and missed the path that keeps it visible.

## Solution

Move enforcement into the ONE shared extraction function all writers call (the SQL
`fp_public_site_content` → `fp_clamp_public_text`), so the trigger, the claim
backfill, and the publish resync inherit it identically. Mirror it in the TS
executable spec so CI exercises the semantics. Rules that made the matcher survive
adversarial *and* innocent input:

1. **Fold within tokens, never across spaces.** Strip symbols/punctuation/format
   chars (NFKC first) inside tokens so `f-u-c-k`, `f*ck`, zero-width interleaves are
   caught — but preserve spaces as boundaries so 'Sushi Tempura' cannot fold into a
   blocked substring across a word join. Accepted residual: spaces-spelled terms
   ('f u c k'), pinned as failing-by-design tests.
2. **Two term classes.** `substring` for terms with no innocent containments;
   boundary-aware `word` for collision-prone short terms (meth ⊂ method,
   retard ⊂ retardant, cunt ⊂ scunthorpe). Within-token collisions can ONLY be fixed
   by moving the term to the word class — no boundary rule helps.
3. **Phrase forms for multi-word terms.** A spaceless joined form can never match
   space-preserving folded text; multi-word terms need their spaced phrase seeded
   alongside ('kill yourself' + 'killyourself'), with a parity test requiring both.
4. **Silent-blank is a UX decision — pin the pass-throughs.** Blocked → stored empty
   (renderer shows defaults). That makes false positives invisible data loss, so
   regression-pin the innocent cases ('proven method', 'fire retardant', 'Sushi
   Tempura', 'Scunthorpe Sweets') as hard test assertions.

## Why This Works

Enforcement at the lowest shared writer is structural: no future caller can forget
it, and the trigger path (the highest-frequency writer) is covered by construction.
The SQL and TS copies are held together by set-equality parity tests per term class
plus fold-structure assertions, the same discipline as the repo's other
migration-parity suites.

## Prevention

- When a review says "server-side X is the enforcement", enumerate EVERY writer of
  the protected surface and check each one calls the enforcement. An API-layer gate
  over a DB-trigger-writable surface is a seam bug by default.
- Any aggressive text-normalization matcher must be tested in BOTH directions:
  adversarial bypasses AND innocent collisions (Scunthorpe cases at word joins and
  within tokens). Write the innocent-input regression tests first — silent blanking
  of a child's work is the failure mode users actually hit.
- Accepted residuals belong in failing-by-design pinned tests + module docs, not in
  reviewers' heads.
