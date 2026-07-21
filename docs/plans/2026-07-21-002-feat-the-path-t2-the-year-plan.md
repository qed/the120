---
title: "feat: The Path T2 — the year"
type: feat
status: active
date: 2026-07-21
origin: docs/brainstorms/2026-07-21-the-path-app-requirements.md
tier: T2
previous: docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md
next: docs/plans/2026-07-21-003-feat-the-path-t3-completeness-plan.md
---

# feat: The Path T2 — the year

**Plan 2 of 3.** [T1](2026-07-21-001-feat-the-path-t1-core-loop-plan.md) → **T2** → [T3](2026-07-21-003-feat-the-path-t3-completeness-plan.md).

## Prerequisite

**T1 must be complete and verified end to end before starting this plan.** Every unit here assumes the state machine, the evidence pipeline, and the notification transport are trustworthy.

**Verification is with test families** — a small number of families who know they are testing, on real devices, running the full loop. Data residency was cleared by counsel on 2026-07-21 and the broader compliance review (roadmap `TP-1`) is gated to on/after 2026-10-21, before public launch. Neither blocks T1 or T2.

Carried forward from T1 and assumed present: `path-rules.ts` and the transition table, the transition RPC, `resolvePathAccess`, the content package, the evidence pipeline with offline queue, `path_notification_sends`, the design foundation and both skins (T1 Unit 13), the student app shell and task surface (T1 Unit 14), the parent surfaces (T1 Unit 15), and the Tier 1 celebration and in-app notification surface (T1 Unit 16).

**Note on decision numbering:** T1, T2, and T3 each carry their own `Decision N` list. They are plan-local. The cross-plan decisions are the origin document's `D15`–`D26`, which are referenced by that prefix throughout.

## Overview

T2 is everything a real student reaches within weeks to months of starting, but not on day one. It closes the phase-level ceremony, makes the app installable and push-capable, lets a student switch skins, delivers the celebration moments that make the product worth using, and adds the AI documents that turn a pile of verified evidence into something a family keeps.

The tiering test that put these here: *ship everything except this — can a family still complete criterion 1.1 and keep using the app?* For T2 items the answer is yes for the first criterion and no for the first phase.

## Requirements Trace

- **R10** — installable PWA, web push where supported.
- **R16** — one-click full Founder File export. Stated in the origin document as a launch requirement.
- **R21** — student-controlled skin toggle, instant, logged, zero data consequence.
- **R26** — wisdom deck, Phase 01 coverage as the floor to ship.
- Inherited: **Phase Review and countersign** (brief §9.4), **Tier 2–3 celebrations and the Not Yet moment** (§5), **Criterion Recap and Readiness Check** (§12), **the notification routing matrix** (§13).

Decisions carried in: **D23** (a crest is never taken back), **D24** (no self-countersign; role grants), **D25** (Guide sees cohort evidence). The Guide *surfaces* are T3; the countersign *engine* is here, because a phase cannot seal without it.

## Scope Boundaries

- No Guide-facing UI — the cohort board and the countersign screen are T3. T2 builds the countersign state machine and notifies the Guide by email with a signed link.
- No Tier 4, no Phase Chronicle, no Founder Portfolio — T3.
- No Field Guides, no math gate, no PathEvent scheduling — T3.
- No AI that verifies, grades, or gates. Every output here is advisory or celebratory, and no AI output may change a task or review state.
- No wisdom beyond Phase 01 coverage; Phases 02–05 land as rolling content ahead of the first student reaching them.

## Context & Research

Everything in T1's Context section still applies. Additional findings that shape this plan:

### Web Push — the state of play in 2026

- **Support:** Chrome 50+, Edge 17+, Firefox 44+, Samsung 4+, Safari macOS 16+ (full from 18.0, works in ordinary tabs). **iOS/iPadOS Safari: Home Screen web apps only**, 16.4 through 26.5. Apple has not relaxed the install requirement — checked against the Safari 27 beta and 26.4 notes.
- ⚠️ **A widely repeated claim is wrong:** Declarative Web Push did *not* remove the install requirement. Apple's own Safari 18.4 post says it is available "for web apps added to the Home Screen."
- **Declarative Web Push** (Safari 18.4; macOS 26.4) is the real evolution — send a JSON envelope (`{"web_push": 8030, "notification": {...}}`) and the notification displays **with no service worker involved**. It is backwards compatible: older browsers parse the same JSON in their SW `push` handler. **Send this envelope and one payload serves both worlds.**
- **iOS 26 lowered install friction** (not push): any site added to the Home Screen now defaults to opening as a web app even without a manifest.
- ⚠️ **The Apple VAPID `sub` trap, which the official Next.js sample gets wrong.** Apple returns **403 `BadJwtToken`** unless `sub` is a real `mailto:` or `https:` URI. Next's PWA guide literally writes `'<mailto:your-email@example.com>'` **with angle brackets** — copy it verbatim and every iOS send 403s.
- **iOS endpoints silently rotate and expire** (~1–2 weeks reported) with no event, and **`pushsubscriptionchange` is not supported on iOS Safari at all** (and only landed in Chrome 138). The actual fix is to re-read `getSubscription()` and upsert on **every app open**. Do not rely on the event.
- **Never call `unsubscribe()` on logout** — Safari then refuses resubscription without a fresh user gesture.
- **Safari revokes push permission entirely if you receive a push and do not display a notification.** Silent push is not an option.
- **Chrome web push rate limits began rolling out January 2026** — high volume relative to engagement returns **429**, with escalating 1/7/14-day penalties, reset after 42 clean days.
- **VAPID rotation is effectively one-way.** Every subscription is cryptographically bound to its `applicationServerKey`; after rotation push services return 403 with no re-key operation. Treat the keys as permanent, back them up outside Vercel, and store a `vapid_key_id` per subscription row.
- `web-push` npm is Node-`crypto`-based — the send path must use the **Node runtime, not Edge**. Latest published 3.6.7 but the repo has July 2026 commits and ~6M weekly downloads; still the default. Self-host rather than adopting a vendor: it is ~60 lines against existing Supabase, costs nothing, and there is a real privacy argument against handing children's engagement data to a third party.
- ⚠️ **Never put a child's name or progress in a push payload** — it renders on a lock screen visible to anyone holding the phone. Send an opaque ID and fetch details after auth.

### PWA install

- **No `beforeinstallprompt` on iOS or Safari at all** — Next's own docs say do not build on it. Two entirely separate UX branches: detect `navigator.standalone` plus `matchMedia('(display-mode: standalone)')`, then either coach a Share → Add to Home Screen sheet (iOS) or use a captured `beforeinstallprompt` (Chrome/Edge).
- **iOS requires `requestPermission()` inside a click handler**, never on load.
- **iOS ignores manifest icons entirely for the Home Screen icon** — `apple-touch-icon`, 180×180, opaque, no transparency. Miss it and children get a blurry screenshot as their app icon.
- Manifest needs 192 and 512 PNG at `purpose: "any"` **plus a second 512 at `purpose: "maskable"`**, or Android crops badly.
- `themeColor` lives on the **`viewport` export**, not `metadata` (moved in Next 14). Ship both `apple-mobile-web-app-capable` and the standardized `mobile-web-app-capable`. Add `viewport-fit=cover` with `env(safe-area-inset-*)` — standalone mode has no browser chrome and notched devices clip the header.
- Pin `/manifest.webmanifest` cache headers the same way as `/sw.js`; it is a cached Route Handler by default and a stale edge copy is a nasty install bug.
- **Use a Route Handler, not a Server Action, for push subscribe** — a service worker cannot invoke a Server Action, so a SW-side re-registration path would be impossible later.

### Multimodal evaluation for the Readiness Check

- **Do not send native video.** Gemini charges **5,792 tokens per second of 720p video** — a 60-second clip is ~347K input tokens *per evaluation*. Claude has no video input capability at all (images and PDFs only).
- **Frame sampling is the right architecture.** Extract 3–5 frames **on the capture device** at 0/25/50/75/95% of duration — critical, because the capture device can always decode its own codec while your server or another browser may not. Downscale to ~1024px long edge before upload: full-resolution on Claude is ~4,784 tokens per image versus ~1,600, a 3× cost swing for fidelity irrelevant to "is there a lemonade stand in this photo".
- Transcribe audio separately where a spoken pitch is part of the criterion and feed the transcript as text.
- **Run once, on submit** — never per upload. Rough cost with 3 photos + 5 frames ≈ 10K input, 1K output — about **$0.03 per submission** on Sonnet 5 before caching, versus ~347K tokens for native video. An order of magnitude.
- **Prompt caching:** reads ~0.1× input price, writes 1.25× (5-min) or 2× (1-hour); break-even at two requests. The rubric and system prompt are a perfect cache prefix. **Minimum cacheable prefix is 4,096 tokens on Opus 4.8** — a short rubric silently will not cache (`cache_creation_input_tokens: 0`, no error). Verify with `usage.cache_read_input_tokens`.
- **Prefix ordering is load-bearing.** Render order is `tools` → `system` → `messages`. Put the frozen rubric first and the student's images after the last `cache_control` breakpoint. **A `new Date()` interpolated into the system prompt invalidates everything downstream** — the most common silent cache killer.
- **Batch API is 50% off** and a parent-verified workflow tolerates "feedback in a few minutes".
- Model tiering: Haiku 4.5 ($1/$5) for a first-pass legibility check, escalating to Sonnet 5 ($3/$15; $2/$10 intro through 2026-08-31) for real evaluation.

### Export

- **There is no Supabase Storage export primitive**, and zipping 10 GB in a Vercel function is impossible against the 300s/800s duration cap and the 4.5 MB response body limit. Export must be a **manifest of signed URLs**, a streaming zip, or an out-of-band job against the S3-compatible endpoint.
- `FileHandle.readableWebStream()` streams without buffering, which is the shape a streaming zip would need.

## Key Technical Decisions

1. **The countersign engine ships in T2; the Guide's UI ships in T3.** A phase cannot seal without a countersign, so the state machine, the signature records, and the D24 conflict rule are core-loop-adjacent. The Guide is notified by email with a signed link to a minimal single-purpose sign page. The full cohort board is T3.

2. **Evidence freezes for the duration of a phase review — and this is narrower than it sounds.** The freeze applies to *appends* across the phase's scope; it does not alter R15's append-only latch, which is set per item at its own first verification and never lifts. The two rules compose: append-only says an item can never be edited or deleted once verified; the freeze says no *new* items may be added to the phase while its review is underway. A phase review that returns lifts the freeze; it does not unlatch anything. Between the parent's signature and the Guide's countersign — a deliberately multi-day window in the brief's own worked example — R15 would otherwise permit the student to append, so the two signatures would attest to different bodies of work. Freeze appends across the phase's scope from review open until seal or return, and store an evidence manifest count and hash on the review so the countersign screen can say "attesting to the same 47 items Mum attested to." The parent may withdraw their signature until the countersign lands, which cancels the request and notifies the Guide.

3. **Declarative Web Push envelope for every send.** One JSON payload serves Safari 18.4+ with no service worker and every older browser through its SW handler. Avoids maintaining two send paths.

4. **Push subscriptions are re-upserted on every app open**, not maintained by `pushsubscriptionchange` — that event does not exist on iOS Safari and iOS endpoints rotate silently within weeks. Anything else produces a slowly-dying push channel that looks fine in testing.

5. **Readiness Check uses device-side frame sampling, never native video**, and is structured as observe-then-judge with no score field anywhere in the schema. If the field does not exist, it cannot leak into the UI.

6. **Readiness Check output is never shown to the parent before they form their own view.** Showing an AI opinion first anchors the human verifier, which defeats the entire purpose of parental verification. Store it in a separate table from the verified record with a `prompt_version` column so a 2029 re-read of a 2026 evaluation is reproducible.

7. **Export is a background job producing a manifest plus a streamed archive**, not a synchronous download. The 4.5 MB function response cap makes any other shape impossible.

8. **Skin toggle swaps a class at the subtree root** and persists to the profile — following T1's Decision 9. It cannot be a CSS-variable override because `@theme inline` compiles utilities to literal values.

## Open Questions

### Resolved During Planning

- **Can the Guide refuse to countersign?** Yes — "Return to parent with a note". A second signature that cannot be refused is not a signature, and the brief gives the Guide's counterparty as the parent.
- **Can the parent un-sign before the countersign lands?** Yes, until it lands; cancels the request and notifies the Guide.
- **What happens to a phase review when a criterion is returned from within it?** Returning a criterion **is** the phase review's `returned` outcome. A phase review may never be underway while any of its criteria is not `cleared`; it reopens as attempt N+1 when all five clear again.
- **Which parallel criterion is "Now"?** Most-recently-touched, with a student pin override.
- **Does a reversed event delete its celebration?** No — mark superseded, render in past tense with the correction inline. No new celebration, no deleted history.

### Deferred to Implementation

- Frame-sampling count and JPEG quality — tune against real evidence once T1 has produced some.
- Whether the Readiness Check warrants Haiku pre-screening or goes straight to Sonnet; depends on observed rejection rates.
- Archive format and chunking strategy for export; depends on measured per-student volume after a term of real use.
- Whether the wisdom contextual trigger needs per-task or per-criterion granularity.

### Blocked

- ✅ **Units 7 and 8 are unblocked (2026-07-21).** The vendor's retention and training terms were read and cleared, so sending children's photo and video evidence to the model API is permitted. ⚠️ **The clearance is vendor-specific.** If the Readiness Check or the recap generator later moves to a different provider — or a second provider is added for a capability the first lacks — the terms must be re-read before any child's image is sent. Record the vendor and the date alongside `prompt_version` in the AI evaluations table so a future reader knows which terms applied.

## Implementation Units

Ten units. Units 1–4 are independent of each other; 5–6 depend on 1; 7–8 are blocked as noted; 9–10 are independent.

- [ ] **Unit 1: Phase review and countersign engine**

**Goal:** A phase can seal, with two signatures where the context requires it.

**Requirements:** Brief §9.4, D23, D24.

**Dependencies:** T1 Units 7, 8.

**Files:** Create `supabase/migrations/<ts>_path_phase_reviews.sql`, `app/path/lib/phase-review-rules.ts` (pure), `app/path/lib/actions/phase-review.ts` (`"use server"`), `app/path/(app)/review/phase/[id]/page.tsx`. Modify `app/path/lib/transition-table.ts`. Test: `app/path/lib/__tests__/phase-review-rules.test.ts`.

**Approach:**
- Extend the transition table rather than branching around it — a phase review is a scope, not a special case.
- Home-study seals on the parent's signature alone. Cohort requires both; the phase does not seal until the second lands.
- **D24 conflict rule:** the same `userId` may not hold both the parent signature and the Guide countersign on one review. Route to a co-Guide, or seal as home-study with the reason recorded on the review.
- Evidence freeze per Decision 2, with the manifest count and hash stored at parent-signature time.
- Guide may **return to parent with a note**, which is a third outcome alongside seal and return-to-student.
- A returned criterion cancels any underway phase review — that *is* the returned outcome.
- Crests stay provisional, never withdrawn (D23).

**Execution note:** Test-first, extending the existing transition-table tests.

**Test scenarios:**
- Happy path: home-study phase seals on one signature.
- Happy path: cohort phase seals only after both signatures.
- Edge case: parent withdraws their signature before countersign — request cancelled, Guide notified, phase not sealed.
- Edge case: evidence append attempted during the freeze window is refused with a clear reason.
- Edge case: the manifest hash at countersign time matches the one at parent-signature time; a mismatch blocks the countersign.
- Edge case: a criterion returned from within a phase review cancels the review and reopens it as attempt N+1 once all five clear.
- Error path: the same user attempting both signatures is refused, naming the conflict.
- Error path: a Guide countersigning a phase for a student outside their cohort is refused.
- Integration: a sealed phase unlocks the next phase's criteria and leaves all five crests intact.

**Verification:** a full phase-05-of-01 walkthrough seals in both contexts; the conflict rule is proven by test, not by UI absence.

---

- [ ] **Unit 2: PWA manifest, icons, and the install flow**

**Goal:** The app installs properly on every platform — which on iOS is a data-durability requirement, not a nicety.

**Requirements:** R10, and T1 Unit 11's install warning becomes a real flow.

**Dependencies:** T1 Unit 11 (manifest stub and service worker exist).

**Files:** Modify `app/manifest.ts`, `app/layout.tsx` (viewport export), `next.config.ts`. Create `app/path/components/InstallFlow.tsx`, `app/path/lib/install-rules.ts` (pure), `public/icons/*`. Test: `app/path/lib/__tests__/install-rules.test.ts`.

**Approach:**
- Icons: 192 and 512 PNG at `purpose: "any"`, **plus a second 512 at `purpose: "maskable"`** or Android crops badly. Plus `apple-touch-icon` at 180×180, **opaque, no transparency** — iOS ignores manifest icons entirely for the Home Screen and a miss gives children a blurry screenshot as their app icon.
- `themeColor` on the **`viewport` export**, not `metadata`. Ship both `apple-mobile-web-app-capable` and `mobile-web-app-capable`. Add `viewport-fit=cover` and `env(safe-area-inset-*)`.
- **Two separate UX branches.** There is no `beforeinstallprompt` on iOS or Safari at all: detect standalone via `navigator.standalone` and `matchMedia('(display-mode: standalone)')`, then coach a Share → Add to Home Screen sheet on iOS, or use the captured event on Chrome/Edge.
- Frame the prompt honestly for the case that motivates it: queued offline evidence is at risk of being wiped after 7 days unless the app is installed.
- Pin `/manifest.webmanifest` cache headers alongside `/sw.js`.

**Test scenarios:**
- Happy path: `install-rules` returns the iOS coached-sheet branch for a non-standalone iOS user agent.
- Happy path: returns the prompt-event branch where `beforeinstallprompt` is available.
- Edge case: an already-installed context returns "no prompt needed" on both platforms.
- Edge case: queued-bytes-present raises the prompt's urgency tier; zero queued bytes does not.
- Error path: an unrecognised platform degrades to the coached sheet rather than showing nothing.

**Verification:** installed on a real iPhone and a real Android device; the icon is correct on both home screens.

---

- [ ] **Unit 3: Web push subscription and delivery**

**Goal:** Push as a genuine enhancement over email, without a slowly-dying subscription table.

**Requirements:** R10, R12 (push column of the transport table).

**Dependencies:** Unit 2.

**Files:** Create `supabase/migrations/<ts>_path_push_subscriptions.sql`, `app/api/path/push/subscribe/route.ts` (Node runtime), `app/path/lib/notify/push.ts` (plain), `app/path/lib/notify/push-rules.ts` (pure). Modify `public/sw.js`, `app/path/lib/notify/send.ts`. Test: `app/path/lib/notify/__tests__/push-rules.test.ts`.

**Approach:**
- **Route Handler, not Server Action** — a service worker cannot invoke a Server Action, so a SW-side re-registration path would be impossible later. Node runtime; `web-push` is Node-`crypto`-based.
- Table keyed on a **unique `endpoint`** (that is the dedupe key), plus `p256dh`, `auth`, `vapid_key_id`, `last_seen_at`, `failure_count`. Service-role writes only.
- **Re-read `getSubscription()` and upsert on every app open** (Decision 4). `pushsubscriptionchange` does not exist on iOS Safari and endpoints rotate silently within weeks.
- **Never call `unsubscribe()` on logout** — Safari then refuses resubscription without a fresh user gesture.
- **Always display a notification on receiving a push.** Safari revokes permission entirely for silent pushes.
- ⚠️ **VAPID `sub` must be a real `mailto:` or `https:` URI with no angle brackets.** Next's own sample writes `'<mailto:...>'` and every iOS send 403s with `BadJwtToken`.
- Send the **Declarative Web Push envelope** (Decision 3) so one payload serves Safari 18.4+ and older browsers alike.
- ⚠️ **No child name or progress in the payload** — it renders on a lock screen. Send an opaque ID; fetch details after auth.
- Failure taxonomy: **404/410 → hard-delete the row.** 403 → do *not* delete, it is a VAPID config bug; alert. 429 → back off (Chrome began rate-limiting in January 2026). 413 → payload over 4 KB, truncate. 5xx → retry with backoff.
- Store `vapid_key_id` per row; rotation is effectively one-way and there is no re-key operation. Back the keys up outside Vercel, and set them with `--value` flags or the REST API — **never a PowerShell 5.1 pipe**, which prefixes a BOM and has corrupted a Vercel env var here before. A BOM-prefixed VAPID private key fails signing in a way that is very hard to diagnose.
- Send from the existing cron/outbox, never a request path.

**Test scenarios:**
- Happy path: a new subscription upserts; the same endpoint re-submitted updates rather than duplicating.
- Edge case: a rotated endpoint creates a new row and the stale one ages out via `last_seen_at`.
- Edge case: the Declarative envelope parses correctly in both the declarative and SW-handler shapes.
- Error path: 410 hard-deletes; 403 retains the row and flags a config alert.
- Error path: 429 backs off rather than retrying immediately.
- Error path: a payload exceeding 4 KB is truncated before send.
- Error path: a VAPID `sub` with angle brackets is rejected at config validation, before any send is attempted.
- Integration: a push and its email counterpart do not both fire for the same event where the user has push active.

**Verification:** a real push received on an installed iOS home-screen app and on Android Chrome.

---

- [ ] **Unit 4: Skin toggle**

**Goal:** A student switches between Trail and HQ instantly, losing nothing.

**Requirements:** R21, D4.

**Dependencies:** T1 Units 5, and both skins rendering.

**Files:** Create `app/path/lib/actions/set-skin.ts` (`"use server"`), `app/path/components/SkinToggle.tsx`, `app/path/lib/skin-rules.ts` (pure). Modify `app/path/(app)/layout.tsx`. Test: `app/path/lib/__tests__/skin-rules.test.ts`.

**Approach:**
- Swap a class at the subtree root (T1 Decision 9). Not a CSS-variable override — `@theme inline` compiles to literal values.
- Persist to the profile and log the change, so design can learn what ages actually choose.
- **A band change must not override an explicitly chosen skin.** A 13th birthday must not silently flip a student who deliberately chose Trail. Needs a `skin_explicitly_set` flag.
- The toggle affects only the student's view; parents and Guides always see the grounded interface.

**Test scenarios:**
- Happy path: toggling persists and the next server render uses the new skin.
- Edge case: a band change with `skin_explicitly_set` false updates the default; with it true, leaves the choice alone.
- Edge case: a parent viewing a student's progress sees the grounded interface regardless of the student's skin.
- Error path: a student setting another student's skin is refused.

**Verification:** toggling mid-phase preserves progress, awards, and evidence exactly.

---

- [ ] **Unit 5: Tier 2 celebration — criterion cleared**

**Goal:** The crest reveal, twenty-five times, in proportion to what actually happened.

**Requirements:** Brief §5.1 Tier 2.

**Dependencies:** T1 Unit 7, Unit 4.

**Files:** Create `app/path/components/CriterionCelebration.tsx`, `app/path/components/Crest.tsx`, `app/path/lib/celebration-rules.ts` (pure), `app/path/lib/headline-stat.ts` (pure). Test: `app/path/lib/__tests__/celebration-rules.test.ts`, `.../headline-stat.test.ts`.

**Approach:**
- Fifteen to thirty seconds, skippable, full-screen crest reveal, plus the criterion's headline stat **in real numbers drawn from the student's own evidence** ("25 outreach attempts. 9 conversations. 2 yeses.").
- `headlineStatSpec` per criterion tells the generator which numbers to surface — the log-table types from T1 Unit 10 are where they come from.
- Crests are the parametric template (phase colour plus numeral) per R20. **Specify what varies beyond colour and numeral**, or 25 different real achievements produce 25 visually interchangeable reveals, which contradicts the rule that intensity is proportional to achievement. Distinct reveal copy per criterion is the cheapest lever; criterion-specific pictograms the next.
- Provisional rendering for a crest whose criterion is under re-review (D23) — a third state the trophy wall does not currently have.
- Family share card generated as an image; nothing is public.
- Honour `prefers-reduced-motion`.

**Test scenarios:**
- Happy path: clearing criterion 1.5 surfaces the three funnel numbers from real evidence.
- Edge case: a criterion with no numeric evidence falls back to a non-numeric reveal rather than showing zeros.
- Edge case: a provisional crest renders distinctly from both earned and locked.
- Edge case: `prefers-reduced-motion` suppresses the animation but not the reveal.
- Error path: a headline stat spec referencing an absent log-table column degrades to the fallback, never throws mid-celebration.

**Verification:** all 25 crests render distinctly enough that a student can tell them apart.

---

- [ ] **Unit 6: Tier 3 celebration — phase sealed**

**Goal:** The emotional benchmark of the entire product. The brief says design this first and scale everything else down from it.

**Requirements:** Brief §5.1 Tier 3.

**Dependencies:** Unit 1, Unit 5.

**Files:** Create `app/path/components/PhaseSealCelebration.tsx`, `app/path/components/Seal.tsx`, `app/path/lib/montage-rules.ts` (pure). Test: `app/path/lib/__tests__/montage-rules.test.ts`.

**Approach:**
- Five-part sequence both skins share in structure: the review clearing (seal pressed / countersignature landing) → **a montage of the phase's own evidence**, actual photos and clips the app has been quietly collecting → the numbers that phase produced → the Chronicle placeholder (the document itself is T3) → the gate to the next phase opening.
- The montage selection is pure logic and testable: prefer verified photo evidence, spread across criteria, exclude redacted items, fall back gracefully when a phase produced little media.
- Then the real-world prompt — the app suggests the family celebrate offline.
- Neither skin may underplay this. Trail plays it cinematic; HQ plays it like the closing of a funding round.
- Poster frames from T1 Unit 10 make the montage render even where a video will not play.

**Test scenarios:**
- Happy path: a phase with media across five criteria yields a montage drawing from all five.
- Edge case: a phase whose evidence is entirely log tables and documents produces a typographic sequence rather than an empty montage.
- Edge case: redacted items never appear in a montage.
- Edge case: an unplayable video contributes its poster frame.
- Error path: a montage with zero eligible items still completes the sequence.

**Verification:** the sequence plays end to end in both skins with real Phase 01 evidence.

---

- [ ] **Unit 7: AI Readiness Check**

**Goal:** A student can ask, before submitting, whether anything looks missing — advisory only, never a verdict.

**Requirements:** Brief §12 capability 1, and its hard rule that AI never verifies, grades, or gates.

**Dependencies:** T1 Unit 10. Vendor terms cleared 2026-07-21 — see Open Questions for the vendor-change caveat.

**Files:** Create `supabase/migrations/<ts>_path_ai_evaluations.sql`, `app/path/lib/ai/readiness.ts` (plain), `app/path/lib/ai/readiness-rules.ts` (pure), `app/path/lib/ai/frame-sample.ts` (client), `app/path/components/ReadinessPanel.tsx`. Test: `app/path/lib/ai/__tests__/readiness-rules.test.ts`.

**Approach:**
- **Frame sampling on the capture device**, 3–5 frames at 0/25/50/75/95% of duration, downscaled to ~1024px long edge. The capture device can always decode its own codec; your server may not. Never send native video — 5,792 tokens per second of 720p makes a 60-second clip ~347K input tokens.
- Run **once, on submit**. Never per upload.
- **Two-pass in one call: observe, then judge.** Force the model to enumerate what it literally sees *before* comparing to the criterion. This is the highest-leverage anti-hallucination move — asked directly whether the criterion is met, a model confabulates supporting detail; asked to list what is visible first, it must commit to observations that can then be checked.
- **Structured output via zod 4** (already a dependency): `observations[]`, `criterion_elements[]` with `status: visible | not_visible | cannot_tell` and a `grounded_in` index array, and `suggestions_for_student[]`. **No `score`, `pass`, or `overall` field anywhere** — if the field does not exist it cannot leak into the UI. Reject server-side any `visible` status with an empty `grounded_in`.
- An explicit `cannot_tell` escape hatch so a bad photo produces "insufficient evidence" rather than a confident guess.
- **Prompt caching:** frozen rubric first, student images after the last `cache_control` breakpoint. **Never interpolate a timestamp into the system prompt** — it invalidates everything downstream. Minimum cacheable prefix is 4,096 tokens on Opus 4.8; a short rubric silently will not cache, so verify `usage.cache_read_input_tokens`.
- Consider the Batch API (50% off) — a parent-verified workflow tolerates a few minutes.
- Store in a **separate table** from the verified record with `prompt_version`, so a 2029 re-read of a 2026 evaluation is reproducible.
- **Never blocks submission**, and per Decision 6 is **never shown to the parent before they form their own view**.

**Test scenarios:**
- Happy path: a response with grounded observations maps to a student-readable list of what looks missing.
- Edge case: `cannot_tell` on every element renders as "we couldn't tell from these photos", not as a failure.
- Edge case: frame sampling on a 20-second video yields 5 frames at the specified offsets.
- Error path: a response with a `visible` status and empty `grounded_in` is rejected server-side and the check degrades to unavailable.
- Error path: a model timeout leaves submission entirely unaffected.
- Error path: any response containing a score-like field is rejected by schema validation.
- Integration: cache hit rate is observable via `cache_read_input_tokens` across two consecutive checks on the same criterion.

**Verification:** submission succeeds with the AI provider entirely unreachable.

---

- [ ] **Unit 8: AI Criterion Recap**

**Goal:** When a criterion clears, the student gets a document that says *look what you did*.

**Requirements:** Brief §12 capability 2.

**Dependencies:** Unit 5, Unit 7.

**Files:** Create `app/path/lib/ai/recap.ts` (plain), `app/path/lib/ai/recap-rules.ts` (pure), `app/path/components/GeneratedDoc.tsx`. Test: `app/path/lib/ai/__tests__/recap-rules.test.ts`.

**Approach:**
- One to two pages in the student's register: what the criterion asked, what the student actually did (names, numbers, dates from the evidence), the headline stat, a quoted moment from the evidence itself.
- **Generated from verified evidence only.** Clearly marked as an AI-written summary *of* the student's work, never presented as the student's own writing.
- Parents can regenerate once per document if a generation misfires — `regeneratedBy` already exists in the data model.
- Delivered in the Tier 2 celebration and filed to the Founder File.
- The Almanac quote-back (Unit 10) hooks in here once wisdom exists.

**Test scenarios:**
- Happy path: a recap for criterion 1.2 cites the real sale amount, date, and customer descriptor from the log table.
- Edge case: a criterion cleared with minimal evidence produces a short recap rather than padding.
- Edge case: regeneration replaces the document and records who triggered it; a second regeneration is refused.
- Error path: unverified evidence is never cited.
- Error path: a generation failure leaves the criterion cleared and the celebration intact, with the recap marked pending.

**Verification:** a recap reads truthfully against the underlying evidence for three different criteria.

---

- [ ] **Unit 9: Founder File export**

**Goal:** The family owns this record and can take it with them. Stated in the origin document as a launch requirement.

**Requirements:** R16.

**Dependencies:** T1 Units 9, 10.

**Files:** Create `supabase/migrations/<ts>_path_export_jobs.sql`, `app/api/cron/path-exports/route.ts`, `app/path/lib/export/manifest.ts` (plain), `app/path/lib/export/manifest-rules.ts` (pure), `app/path/components/ExportButton.tsx`. Modify `vercel.json`. Test: `app/path/lib/export/__tests__/manifest-rules.test.ts`.

**Approach:**
- **Background job, not a synchronous download** (Decision 7). Vercel caps function response bodies at 4.5 MB and duration at 300s/800s; a multi-gigabyte archive cannot be assembled in a request.
- Produce a **versioned JSON manifest plus a human-readable `index.html` sibling** — the manifest schema is what determines whether the record is legible when the app disappears, which is the entire point of R16.
- Include **everything, with honest state labels** — unverified and not-yet tasks appear as what they are. Include reviewer Not Yet notes; the brief already frames setbacks as part of the story.
- **Mid-program export must work**, not just end-of-program.
- Extend export permission to 13–17 students, not parents only.
- **Object access goes through the Storage API.** And note the tension resolved in T1: signed URLs in a long-lived manifest are exactly the leak that cannot be revoked, so the manifest should carry storage paths plus a short-lived fetch, not baked-in long-expiry URLs.
- Record link-rot state (`lastCheckedAt`, `lastOkAt`, `status`) so a Founder File opened in five years shows when a dead link was last reachable — and snapshot the thumbnail and title on first successful check, so the export has something when the link dies.

**Test scenarios:**
- Happy path: a manifest for a mid-program student lists verified, not-yet, and unstarted tasks with correct labels.
- Edge case: a student with zero evidence produces a valid, honest manifest rather than an error.
- Edge case: redacted items appear with their redaction notice, not omitted silently.
- Edge case: a dead link appears with its last-reachable date and snapshotted title.
- Error path: an export requested by a parent outside the family is refused.
- Error path: a job that fails mid-assembly is retryable and does not leave a partial archive presented as complete.
- Integration: the manifest plus `index.html` are legible with the app entirely offline.

**Verification:** a real export opened on a machine with no access to the app renders a complete, readable record.

---

- [ ] **Unit 10: Wisdom system and the Almanac**

**Goal:** Contextual wisdom that collects into something the student keeps.

**Requirements:** R26, brief §6.

**Dependencies:** T1 Unit 7 (for contextual triggers), Unit 4.

**Files:** Create `supabase/migrations/<ts>_path_wisdom.sql`, `app/path/content/wisdom/` (authored entries), `app/path/lib/wisdom-rules.ts` (pure), `app/path/components/WisdomCard.tsx`, `app/path/components/MarginNote.tsx`, `app/path/(app)/almanac/page.tsx`. Test: `app/path/lib/__tests__/wisdom-rules.test.ts`.

**Approach:**
- **Phase 01 coverage is the floor to ship** (R26); Phases 02–05 land as rolling content ahead of the first student reaching them. **This is a content authoring track, not engineering** — size it separately and do not let it silently become the critical path.
- Contextual delivery keyed to position: rejection wisdom during the No Log (1.3), pricing wisdom entering the pricing experiment (3.2). At most one contextual card per task; **arrives after a meaningful moment, never as a gate before work**; never interrupts evidence capture or review.
- Both registers per entry — Trail renders a collectible card, HQ a margin note, same content.
- Entries file automatically into the Almanac; students can favourite and add a one-line note.
- Real quotes carry real attribution and need a vetting bar for accuracy — a content decision still open in the origin document.
- **If Phase 02 wisdom is not authored before a student reaches Phase 02**, contextual wisdom must degrade to silence, not to an error or an empty card.

**Test scenarios:**
- Happy path: verifying task 1.3.2 surfaces a rejection-themed entry.
- Edge case: a task with no matching entry surfaces nothing, silently.
- Edge case: at most one contextual card fires per task even when several entries match.
- Edge case: an entry already encountered does not re-fire as new.
- Error path: a phase with no authored entries degrades to silence, not an empty-state error.

**Verification:** a full Phase 01 walkthrough surfaces wisdom at the intended moments and the Almanac accumulates correctly.

## System-Wide Impact

- **Interaction graph:** the transition table gains phase-scope transitions; the notification send path gains a push channel; the celebration layer reads from the evidence pipeline; export reads everything.
- **Error propagation:** every AI call must fail open — a model outage may never block a submission, a verification, or a celebration. Push failures may never block email.
- **State lifecycle risks:** the evidence freeze window is a new mutability regime and must be visible in the UI; a rotated push endpoint that is not re-upserted produces silent delivery failure; an export job holding stale signed URLs is a revocation problem.
- **API surface parity:** one new Route Handler (`/api/path/push/subscribe`) — the first Path endpoint reachable by a service worker.
- **Integration coverage:** manual verification needed for a real iOS installed-app push, a real phase seal with countersign, and an export opened offline.
- **Unchanged invariants:** T1's state machine semantics, the append-only latch, the service-role authorization boundary, and the no-AI-verification rule all hold unchanged.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI vendor terms cleared, but the clearance is vendor-specific | Low | High | A provider change — or adding a second provider — re-triggers the terms check before any child's image is sent. Record vendor + date alongside `prompt_version`. |
| iOS push reach is low — install, open, tap, grant is a four-step funnel on a child's device | High | Medium | Push is an enhancement; email to the parent remains the reliable channel per R12. Do not degrade email once push exists. |
| VAPID key rotation is one-way with no re-key path | Low | High | Store `vapid_key_id` per subscription; back keys up outside Vercel; set via `--value`/REST, never a PS 5.1 pipe. |
| The Apple `sub` angle-bracket trap silently 403s every iOS send | Medium | Medium | Config-time validation test (Unit 3) that rejects angle brackets before any send. |
| 25 crests from one parametric template read as interchangeable | High | Medium | Unit 5 must specify what varies beyond colour and numeral. Otherwise Tier 2 becomes a counter increment. |
| Wisdom authoring becomes the critical path | High | Medium | Phase 01 floor only; degrade to silence beyond it; size the content track separately. |
| Export volume outgrows any synchronous shape | Certain | Medium | Background job from the start (Decision 7). |
| Chrome push rate limits (429, escalating penalties) | Low | Medium | Volume is inherently low — one push per real event. Back off on 429 and never batch-blast. |

## Documentation / Operational Notes

- New env vars: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Set with `--value` flags or the dashboard; a BOM-prefixed private key fails signing in a way that is very hard to diagnose.
- `vercel.json` gains an export-job cron. Hobby caps crons at once daily; push and export both want faster than that.
- AI spend is roughly $0.03 per Readiness Check on Sonnet 5 before caching; Batch halves it. Monitor `cache_read_input_tokens` to confirm caching is actually working.
- Test push and install on **Vercel preview deployments**, not `next dev --experimental-https` — and guard SW registration with a hostname check so a preview worker does not poison later previews on the same origin.

## Next Steps

Implement this plan with `/ce:work docs/plans/2026-07-21-002-feat-the-path-t2-the-year-plan.md`.

**When every unit here is checked off — excluding Units 7 and 8 if the AI-vendor gate is still open — the next step is:**
`/ce:work docs/plans/2026-07-21-003-feat-the-path-t3-completeness-plan.md` — T3, *Completeness*: Guide surfaces, the Phase Chronicle and Founder Portfolio, Tier 4, Field Guides, the math gate, and event scheduling.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-07-21-the-path-app-requirements.md`
- **Previous plan:** `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md`
- **Next plan:** `docs/plans/2026-07-21-003-feat-the-path-t3-completeness-plan.md`
- Product behaviour: `artifacts/The Path/the-path-app-design-brief.md` §5, §6, §9.4, §12, §13
- Visual contract: `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/README.md`
- Next 16 PWA guide: `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` — note the `sub` angle-bracket error in its sample
