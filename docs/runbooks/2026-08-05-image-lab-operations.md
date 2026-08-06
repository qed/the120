---
title: "Image Lab — operations note (migration, go-live flags, unverified capabilities, purge order, accepted gaps)"
type: runbook
status: ready-to-run (human/gated)
date: 2026-08-05
plan: first-profit docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md (Unit 7)
---

# Image Lab — operations

The short operator reference for the staff-only prompt→image bench at
`/staff/image-lab` (bench · history · kit).
Origin: first-profit `docs/brainstorms/2026-08-05-image-lab-requirements.md`.

This note is the **operational** state an operator has to know before touching the
Lab. It is drawn from the migration header and the code, and it deliberately
POINTS AT those rather than restating them — a forked runbook is worse than no
runbook. Everything below is a fact about the shipped code as of Unit 7 plus its
security pass, not an aspiration.

---

## 1. The migration is AUTHORED, NOT APPLIED

`supabase/migrations/20260917120000_fp_image_lab.sql` has never run against any
database. **Nothing in the Lab works until it does**, and the Lab's own pages say
so honestly rather than rendering an empty history (`/staff/image-lab/history`
and `/kit` render a distinct "could not read" panel, not "nothing here yet").

**Before applying, run the ledger query. Not the file listing.**

```sql
select version, name from supabase_migrations.schema_migrations
 order by version desc limit 5;
```

The `20260917120000` slot assumes the live top is `20260916120000`. **Three
lanes are live right now** — `feat/new-user-flow-v3`, `feat/watchtower`, and
`feat/image-lab` — so an applied-but-unmerged migration from either other lane is
**invisible in this worktree's file listing** and only the ledger query catches
it. If the top is not `20260916120000`, **rename the file** to the real next-free
`12:00:00` slot before applying. The parity test resolves the file by GLOB, so
the rename does not break it. See `supabase/MIGRATION-LOCK.md` (third recorded
collision).

Apply via the Management API playbook
(`docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`).
**Do not write `schema_migrations` by hand.** The apply is not complete until the
six post-apply verification queries in the migration header pass — in particular
check 6, which requires READING every `storage.objects` policy rather than
counting the ones that mention this bucket.

Then `NOTIFY pgrst, 'reload schema'` before anything writes these tables.

---

## 2. The two go-live flags

Both are **server-side only** and read per request. Neither is `NEXT_PUBLIC_`,
deliberately: a build-time public copy could disagree with the server on a warm
deploy.

| Flag | Gates | Unset behaviour |
|---|---|---|
| `IMAGE_LAB_LIVE` | **Generation.** Whether any model may be called at all. | The bench renders in full; the adapter returns `unconfigured` and attempts no network call; the page shows an explicit "generation off" notice and the `/staff` hub card carries a matching badge. |
| `IMAGE_LAB_REAL_CONTENT_LIVE` | **All child content, on every leg.** Whether a real child's authored text may be loaded into the slot panel, AND whether `createImageLabRun` will accept, scrub or record a compose claiming child provenance. | The picker is absent; a provenance-bearing compose is refused outright (`content_picker_off`) rather than silently recorded; manual prompts still compose and generate normally. |

### ⚠ STATUS 2026-08-06 (FINAL) — `IMAGE_LAB_LIVE` ON, `IMAGE_LAB_REAL_CONTENT_LIVE` **OFF**. BOTH CHECKS WERE RUN AND **BOTH FAILED**.

`IMAGE_LAB_REAL_CONTENT_LIVE` was briefly set on as an accepted risk, then the two
checks were actually performed and **neither closes**. The flag was removed the
same day. Nothing was ever exposed: the PR was unmerged throughout, so no code
ran with it on.

**CHECK 2 — CONSENT: FAILS.** Policy `2026-08-05.1` (verified against the backend
source of truth, `app/api/fp/signup/consent-rules.ts`, not just the client
snapshot) grants exactly ONE third-party AI disclosure and it is bound to the
photo:

> "I consent to First Profit collecting **a photo of my child** … and to **that
> photo** being sent to a third-party artificial intelligence image service that
> draws a personalized comic book cover starring my child"

Every other clause is First Profit *collecting and storing*, not disclosing — and
the notes clause is scope-limited ("used only to improve First Profit"). The Lab
with this flag on sends the child's **authored business text** (product name,
one-liner, pitch, sale details) to OpenAI and Google. The photo clause does not
stretch to cover written work. **To close: a consent version bump** adding a
clause for child-authored content going to a third-party AI service — text,
version and sha256 bumped in the SAME change on both sides (a drift test guards
it). It binds only parents who attest AFTER it ships; the 17 already-enrolled
children's consent cannot be retroactively widened.

**CHECK 1 — PROVIDER TERMS: FAILS on OpenAI, closeable on Google.**

*Google — closeable today.* Gemini API Additional Terms (effective 2026-03-23):
paid tier, Google "doesn't use your prompts … or responses to improve our
products"; logging is limited-period for policy enforcement only. Unpaid tier IS
used for training and human review. EEA/CH/UK get paid-tier protection even on
free quota. **The whole dependency is: confirm the production key bills against a
PAID project, and that no fallback (dev key, AI Studio, quota overflow) can route
child text through unpaid quota.**

*OpenAI — NOT closeable today, and the blocker is their own rule.* Training is
fine by default (no training on API data since 2023-03-01; 30-day abuse-monitoring
retention). But OpenAI's under-18 API guidance
(`developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance`)
states:

> "You should not use OpenAI services to process any personal data of children
> under 13 or the applicable age of digital consent without first implementing
> zero data retention in our API."

The beta cohort includes under-13s (band `g3_5`). ZDR **is** supported for the
`gpt-image-*` models but is **approval-gated through OpenAI sales — not
self-serve** — and even under ZDR, image endpoints retain suspected-CSAM matches
for manual review (non-waivable). Three paths:
  (a) start the ZDR request with OpenAI sales;
  (b) route under-13 accounts to Gemini paid tier only, leaving gpt-image-2 for
      synthetic prompts; or
  (c) **send gpt-image-2 a sanitized prompt derived from the business CATEGORY
      rather than the child's own words** — likely the cheapest defensible path,
      since the prompt only needs to convey what to draw. Note this is a real code
      change in the Lab, not a config flip.

⚠ Three openai.com pages (usage-policies, enterprise-privacy, trust portal)
returned **403 to automated fetch again on 2026-08-06** and remain UNREAD. A human
must open them for the usage-policies effective date and minors clause, the
enterprise-privacy retention table, and trust-portal artifacts. Do not close this
item on the strength of pages nobody has read.

---

### Historical note — the accepted-risk window (superseded by the above)

`IMAGE_LAB_LIVE=1` and `IMAGE_LAB_REAL_CONTENT_LIVE=1` were set on the `the120`
Vercel project (production) on 2026-08-06. **`IMAGE_LAB_REAL_CONTENT_LIVE` was
switched on as an accepted risk, with neither prerequisite below completed** —
an explicit owner decision, recorded here so it is traceable rather than
folklore, and so whoever closes the items can find what was outstanding.

**Still open, and both should be closed promptly:**

1. **OpenAI's no-training posture is UNCONFIRMED.** Their enterprise-privacy page
   returned 403 during research on 2026-08-05 and was never re-verified. Gemini's
   paid-tier no-training posture WAS confirmed. Until OpenAI is re-verified, every
   `gpt-image-2` call carrying picker-filled slots is sending child-authored text
   to a provider whose current retention terms we have not read.
2. **The consent snapshot (2026-08-05.1) has not been checked** against
   "child-authored text is sent to a third-party model API".

Live blast radius while these are open: the beta cohort is **10 families / 17
kids in production**. The mitigations that ARE in force are the name scrub
(server-enforced at `createRun`, four leak classes closed — see the redaction
solution doc), buyer-name exclusion from the `sale` slot, internal-ids-only
provenance, and the fact that no prompt body or slot value reaches a log line.
Those reduce the exposure; they do not close the two items above.

**To reverse:** `vercel env rm IMAGE_LAB_REAL_CONTENT_LIVE production` — the
picker disappears and a provenance-bearing compose is refused outright rather
than silently recorded. Existing rows are unaffected; use the §5 purge for those.

---

**`IMAGE_LAB_REAL_CONTENT_LIVE` must not be set until both checks are done:**

1. **Provider terms.** Re-verify that BOTH providers' no-training posture still
   holds for the tiers we call. The Gemini paid tier does not train on prompts;
   OpenAI's API default is no-training, but the enterprise-privacy page **403'd
   during research on 2026-08-05 and was never confirmed**. The registry's
   `dataUseNote` on `gpt-image-2` says so out loud.
2. **Consent policy.** A one-time check of the current first-profit consent
   snapshot (2026-08-05.1) against "child-authored text is sent to a third-party
   model API".

The flag is the technical enforcement of that checklist. A checklist item is not
a gate; this flag is the gate.

**It gates the WRITE path too, since the Unit 7 security pass.** It used to be read
only by the picker's three entry points and by the page render — so with
generation on and consent off, a stale tab or a replayed action still drove the
service-role `children`/`families` lookup, stamped `source_child_id`, and logged
`dbContent=true` on a deployment whose operator believed the switch was off.

**Provenance is now server-signed, not client-asserted.** `fillImageLabSlots`
returns a short HMAC token over the child/idea/task ids; `createImageLabRun`
verifies it and DERIVES the ids from it. A token that fails to verify is a refusal,
never a downgrade. Operationally this means two things: a `source_child_id` on a
row is a fact the server minted (so the consent-revocation purge in §5 is
complete), and the token is keyed off `SUPABASE_SERVICE_ROLE_KEY` — **rotating that
key invalidates every outstanding token**, which surfaces as `bad_source_token` on
a compose whose slots were filled before the rotation. Re-filling the slots is the
fix; nothing is lost.

**With the picker live, slot values must carry that token.** A compose presenting
non-empty slot values with no token is refused (`unverified_slot_source`) — the
bench cannot tell hand-typed text from a replay of a child's. Staff who want a
hand-written value on a live deployment put it in the template instead. With the
picker off the same compose is unambiguous and is allowed.

Gateway auth is **not** a third flag — it reuses whatever the funnel's existing
gateway calls use (an existing key, or Vercel OIDC, which needs no key). Do not
add an env-key sniff; verify presence, don't assume a new var.

---

## 3. `personGeneration` — STILL UNVERIFIED, and it biases the head-to-head

The Gemini 3.x image models gate person/character output behind an **allowlist
grant**. Without it, a prompt asking for a person or a character returns
`finishReason: PROHIBITED_CONTENT`, which the adapter normalizes to
`safety_blocked`.

**Status: unverified. The request is an operational task, not a code change —
it is verified by a grant, not by a deploy.**

Consequences an operator must hold in mind while reading the bench:

- It applies to **`gemini-3-pro-image` and `gemini-3.1-flash-lite-image`, i.e.
  two of the three launch models** — and the hero-consistency drill is *the*
  question the Lab exists to answer.
- It does **not** apply to `gpt-image-2` (no allowlist gates person output on the
  OpenAI Images API; ordinary moderation still applies and also normalizes to
  `safety_blocked`).
- So until the grant lands, **the head-to-head is biased** — and it is biased
  visibly rather than silently: History breaks `safety_blocked` out as its own
  labelled count and **excludes it from the keep-rate denominator**, precisely so
  the pending allowlist does not read as "the Google models are worse".

---

## 4. The other UNVERIFIED registry items

Read them from the registry itself — `app/staff/image-lab/lib/model-registry.ts`,
where every capability carries a `{ status, note }` and `unverifiedItems(entry)`
enumerates the open ones. **Since the Unit 7 pass these are also rendered on the
bench**, under each model chip ("Unverified: personGeneration, referenceImageInput
— results on this model may reflect our own open questions rather than the
model"), so a staff member choosing a model sees them without opening this file.
Summarized:

- **Reference-image carriage to `gpt-image-2` through the gateway.** The SDK's
  `GenerateImagePrompt` accepts `{ images, text, mask }`, so the CALL shape
  exists; whether the **gateway** carries image inputs through to OpenAI is
  unconfirmed. If it cannot, that is a **scope decision** — gpt-image-2 documented
  as text-to-image-only in the head-to-head, or the GPT-5.x `image_generation`
  tool path — **escalate it, do not paper over it with a silent fallback.** Note
  the conjunction: if this fails AND the allowlist is still pending, **zero of
  three models can run the hero drill**.
- **Image-modality cost reporting.** The gateway exposes
  `providerMetadata.gateway.generationId` and `GET /v1/generation` returns cost
  for it — documented for TEXT. Whether an image generation produces a priced
  generationId at all is unconfirmed. **A null `cost_reported` is EXPECTED, not a
  bug.** The estimated column carries the decision evidence; History shows the two
  figures side by side and never adds them.
- **Gateway routability** for all three ids is `confirmed` only at the level of
  the installed `@ai-sdk/gateway` v7 catalog union. A catalog entry is not a
  successful request; the first real call is the first real evidence.

---

## 5. Consent-revocation purge

**Runbook: the header of `supabase/migrations/20260917120000_fp_image_lab.sql`.**
Do not duplicate it here and do not fork it. It covers, in order: draining the
in-flight window (a `requested` cell with a non-null `attempted_at` has bytes on
the way and is invisible to a key collection), collecting keys **including
copy-forward descendants** via a recursive walk of `iterated_from_run_id`,
deleting objects **through the Storage API and never via SQL**, verifying the
bucket before deleting rows, and only then deleting rows.

Two things from it that belong in an operator's head without opening the file:

- **Purge the Image Lab BEFORE deleting the profile/child.** `source_child_id` is
  `ON DELETE SET NULL`, so once the child row is gone the provenance is gone and
  these rows are **unfindable**. This step goes ahead of the repo's existing
  `sites → ledger → saves → profile → child` ordering.
- **References are out of scope and cannot be purged in v1.** See §6.

The R20 accepted-exposure record (first-profit `docs/solutions/security-issues/
r20-fp-child-session-reach-across-the-shared-supabase-project-accepted-exposure-2026-08-01.md`)
carries the Lab's confirmation note, including this ordering.

---

## 6. What the keep rate means (read this before quoting a number)

- **Latest attempt per cell.** A cell retried three times contributes **one** row
  to the score — the newest attempt eligible for the denominator — not three. The
  per-model panel shows `attempts per cell` beside it so the retry pressure is
  visible rather than folded into the rate.
- **Denominator = JUDGED.** `keeps / (keeps + rejects)`. A completed image nobody
  has looked at yet is **not** in the denominator; it is reported separately as
  `not judged`, because that number measures our review pace, not the model.
- **The COST line is relabelled under a filter, not suppressed.** `aggregateCost`
  runs over the filtered rows, so under `?verdict=keep` the block reads "Cost of
  the filtered rows" and says so — a fraction of real spend must never be readable
  as a total.
- **A truncated page drops the OLDEST run WHOLE.** The image read is ordered by
  recency and capped; the run the cap cuts is pruned entirely rather than shown
  with half its attempts (which would compute its keep rate, attempts-per-cell and
  cost over a fragment). Before Unit 7 the read was ordered by `run_id` — a v4
  uuid, random with respect to time — so the runs that lost their images were
  arbitrary and the banner's "newest N attempts" was the newest of nothing.
- **`requested`, `stale` and `failed` rows are out of the denominator entirely.**
  Stale is a derived render label over a non-finalized row, never a persisted
  state, so a tab someone closed can never dilute a model's score.
- **`timeout` and `safety_blocked` are broken out as their own labelled counts
  and excluded.** Both are OUR artifacts — the adapter budget penalizes
  gpt-image-2, the pending allowlist penalizes the Google models — and folding
  them in would bias the very decision the Lab exists to make.
- **The rate is SUPPRESSED under a verdict filter.** `?verdict=keep` would
  otherwise render "100% keep rate" over a filtered page, indistinguishable from
  an unfiltered one. Under any verdict filter the rate is hidden and the page
  says why; the population line above the stats always names what is being
  counted.
- **The stats describe the page AS LOADED.** Judging does not re-run the query
  (deliberately — it would re-mint every signed URL and re-download every
  thumbnail). Reload to re-score.

---

## 7. Known accepted gaps

These are decisions, not bugs. Each is stated in the code that owns it.

- **No spend ceiling beyond the per-instance cooldown.** The generate-cell route
  is rate-limited per staff member at **30 cells / 5 minutes** — sized so one
  full 12-cell compare fan always fits and a runaway loop does not. But
  `app/fp/lib/rate-limit-store.ts` is **per-instance, in-memory and best-effort**:
  a cold start begins with an empty window and bucket eviction **fails open**. It
  is a guardrail on one tab, **not a global spend bound**. There is no budget, no
  daily cap and no alert. Since Unit 7 a trip at least leaves a log line
  (`[image-lab/generate] cooldown refused staff=… retryAfterMs=…`), logged ONCE per
  key per window rather than once per refused request — a line per refusal would
  bury the trip in thousands of copies of itself on exactly the runaway-tab
  scenario it exists to surface. Before Unit 7 it was invisible after the fact. The arithmetic ceiling for a single run is
  **$0.8824** (4×$0.053 + 4×$0.134 + 4×$0.0336), derived in a test from
  `decideRunComposition` over the registry rather than asserted in prose.
- **Orphan objects from a killed invocation have no sweeper.** `maxDuration` is
  300s and the slowest model aborts at 240s, but a platform kill bypasses the
  `finally` entirely: the vendor may bill, the storage put may have landed, and
  no finalize and **no audit breadcrumb** are written. The row latches
  `requested` until the 10-minute staleness window makes Retry available. Storage
  keys are deterministic (`runs/{run_id}/{image_id}`), so an orphan always names
  itself and a sweeper *could* be written — **none exists.** Consequence for the
  cost display: killed-mid-flight billed generations are an **undercount**, and
  the cost block footnotes it.
- **References cannot be deleted in v1.** Append-only, no delete path, no
  content-hash dedupe (re-uploading the same bytes mints a second independent
  row, tolerated by design). This is safe **only** while references are
  staff-authored character sheets and style samples. A reference derived from a
  child's drawing, product photo, or likeness is an **unrecoverable mistake** —
  the upload UI states this at the point of upload, and the purge runbook cannot
  reach it.
- **Last-write-wins, CROSS-STAFF verdicts.** Single reviewer assumed. Two tabs
  judging the same image do not merge; the later write stands. Verdict, note and
  tag writes are **deliberately not scoped to the caller** — unlike generate and
  retry — because the model decision needs one body of evidence and the reviewer
  is frequently not the person who composed the run. The cost, stated: a mistaken
  verdict is untraceable, because there is no `verdict_by` column. Verdict writes
  target one image row and never touch run-level fields, so they cannot clobber
  each other's images. The carry-forward if single-reviewer stops holding is a
  `verdict_by` column, at which point scoping becomes possible.
- **History and Kit are cross-staff.** Every active staff member sees every run,
  image, note and reference label from every other. That is intended — the model
  decision needs the whole body of evidence. Spend is the one thing that is
  single-owner: generate and retry refuse a run whose `staff_id` is not the
  caller's, and BOTH log the refusal (retry distinguishes "no run" from "owner
  mismatch"; before Unit 7's pass only generate logged at all, while retry is the
  path that mints a new billable row).
- **A `failed → done` flip is real.** A function we killed can have its vendor
  call complete afterwards and finalize over the failure. Retry is disabled until
  staleness for exactly this reason, and the retry copy says a late success may
  land beside the retry with **both billed**. Since Unit 7's pass the hold is on
  the CLASS rather than the detail: **any `failed` row that is `billed` with
  `failure_reason = timeout`** waits out the window. It used to key on
  `caller_aborted`, which the taxonomy classifies as NOT billed — so the billed,
  provably-still-running `adapter_timeout` case (gpt-image-2 at 240s) was
  instantly retryable and the free one was held for ten minutes.
- **A run naming a DELETED reference object is permanently wedged, and there is
  no repair.** Every attempt returns `reference_unavailable` before the CAS, the
  cell stays `requested` forever, the reference row cannot be deleted
  (append-only) and `reference_ids` is snapshotted with no edit path. Since Unit
  7 the grid at least stops polling it (a bounded idle counter) instead of
  re-reading the run every five seconds indefinitely across reloads. Compose a
  fresh run; the wedged one is evidence of the fault, not a thing to fix.

---

## 8. Convergence follow-up (owned, not free)

After `feat/new-user-flow-v3` merges: converge the Lab's OpenAI path with the
cover pipeline's adapter and revisit the storage split (Blob covers vs the
Supabase Lab bucket). This is real work — error unions, timeout policies, a
storage migration — not a rename. Bucket usage should be checked at the same
time (compare runs are up to 12 images each, on Free-tier storage, with a 25 MiB
per-object ceiling).
