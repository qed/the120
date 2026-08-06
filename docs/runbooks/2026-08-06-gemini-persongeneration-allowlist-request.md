---
title: "Gemini personGeneration allow_all — why we need it, how to request it, and the submission draft"
type: runbook
status: ready-to-submit (human action required)
date: 2026-08-06
project: Google Cloud / Gemini API project backing the120's AI Gateway calls
related: docs/runbooks/2026-08-05-image-lab-operations.md (§3)
---

# Gemini `personGeneration` allow_all — request pack

**This cannot be automated.** It is a grant tied to a Google account and a
specific Cloud project, submitted through Google's developer support channel. An
operator with access to that project has to send it. Everything below is ready to
paste.

---

## 1. Why we need it

**The short version:** two of our three candidate image models refuse to draw a
person or a character until the project is allowlisted, and the entire product is
a comic starring a child character.

The detail:

- Gemini 3.x image models gate person/character output behind a per-project
  allowlist. Without the grant, a prompt that would produce a person comes back
  `finishReason: PROHIBITED_CONTENT`.
- That affects **`gemini-3-pro-image` and `gemini-3.1-flash-lite-image`** — two of
  the three models in the head-to-head. It does **not** affect `gpt-image-2`.
- The question the Image Lab exists to answer is **hero consistency**: can a model
  hold one character steady across ~125 panels? A model that will not draw a
  character cannot answer it. So until the grant lands, two thirds of the
  comparison is unavailable on the question that matters most.
- The downstream product is the graphic-novel panel engine: every completed task
  draws the next panel of that child's own story, with the child's avatar as the
  hero. Person generation is not incidental to the feature — it *is* the feature.

**Which tier we need, and why it is the stricter one.** There are two grants,
`allow_adult` and `allow_all`. We need **`allow_all`**, because the hero is a
**child** character. `allow_adult` would leave us exactly where we started.

**What we are NOT asking to do, and this matters for the reviewer:**

- We do **not** generate images *of real children*. The hero is a **fictional
  avatar the child designs** — never their photograph, never their likeness. That
  was a deliberate product decision recorded at the outset of this work.
- We do **not** send a child's photo to these models. (A separate, consented flow
  sends a photo to a different service for a comic *cover*; it is not this
  pipeline and not this project's models.)
- We do **not** send children's authored text to these models in the current
  configuration. Child-content is behind a flag that is currently **off**, and the
  work in flight replaces a child's own words with a closed-vocabulary category
  term before any prompt is dispatched.
- Output is **staff-only**. Generated panels are reviewed by staff behind an
  authenticated gate before any child sees anything; nothing is auto-published.

**How we handle the refusals in the meantime** (worth stating — it shows the
request is not a workaround for sloppiness): our History view breaks
`safety_blocked` out as its own labelled count and **excludes it from the
keep-rate denominator**, precisely so that a pending allowlist does not silently
read as "the Google models are worse than OpenAI's."

---

## 2. How to submit it

1. **Confirm the project.** The grant is per Google Cloud / Gemini API project.
   Identify the project ID that backs the120's Gemini calls (these route through
   Vercel AI Gateway, so confirm which upstream project the gateway credential
   belongs to — do not assume it is a personal project).
2. **Post the request** on the Google AI developer forum
   (`discuss.ai.google.dev`), in the Gemini API category, using the draft in §3.
   This is the channel Google directs `personGeneration` allowlist requests to;
   requests are reviewed per project and answered on the thread.
   - If the project sits under a Google Cloud account with a support plan, also
     open a support case referencing the same text and the forum thread.
3. **Include the project ID in the post.** A request without it cannot be actioned.
4. **Expect follow-up questions** about the minors angle — that is the point of
   the stricter tier. Answer from §1; do not soften the fact that the characters
   are children, because that is exactly what `allow_all` covers and an inaccurate
   description would invalidate the grant.
5. **When it is granted**, update `docs/runbooks/2026-08-05-image-lab-operations.md`
   §3 and the `verified` block for both Google entries in
   `app/staff/image-lab/lib/model-registry.ts` (the bench renders unverified items
   under each model chip, so the badge clears itself once the registry says so).
6. **If it is refused**, that is a real product input, not a dead end: record it in
   §3, and the head-to-head proceeds with `gpt-image-2` as the only model able to
   run the hero drill. Say so out loud in the model decision rather than letting
   two models quietly score zero.

---

## 3. The draft (paste this)

> **Subject: Request for `personGeneration: allow_all` — educational comic
> generator for a children's entrepreneurship program**
>
> Hello,
>
> I'm requesting `personGeneration` allowlist access (`allow_all`) for Google
> Cloud project **`<PROJECT_ID>`**, using `gemini-3-pro-image` and
> `gemini-3.1-flash-lite-image` through the Gemini API.
>
> **What we're building.** First Profit is a game-like business simulator used by
> children in a home-study entrepreneurship program. As learners complete tasks,
> the product draws the next panel of a personalized graphic novel in which the
> learner's character is the hero — roughly 125 panels across a full journey.
>
> **Why we need `allow_all` specifically.** The hero of each story is a *child*
> character, so `allow_adult` would not cover our use. The character is a
> **fictional avatar the learner designs** — we do not generate images of real
> children, we do not send photographs of children to these models, and we do not
> ask the models to reproduce any real person's likeness.
>
> **Safeguards in place.**
> - Generated panels are reviewed by staff behind an authenticated, non-public
>   surface before any learner sees them. Nothing is auto-published.
> - Prompts are assembled server-side from a fixed template. Learner-authored
>   free text is currently disabled in this pipeline, and the work in progress
>   replaces it with a closed vocabulary of business-category terms, so learner
>   writing is not sent to the API.
> - We are on the paid tier, and we rely on the Gemini API Additional Terms
>   (effective 2026-03-23) confirming that paid-tier prompts and responses are not
>   used to improve Google products.
> - Parental consent is obtained at signup, and our program complies with COPPA
>   for under-13 participants.
>
> **Scale.** Currently a small beta — 10 families, 17 learners — with staff-side
> evaluation happening first.
>
> I'm happy to provide any further detail about the pipeline, the review process,
> or the consent flow. Thank you for considering the request.
>
> `<NAME>`, `<ROLE>` — First Profit / The 120

---

## 4. Before you send it — check these are still true

The draft makes four factual claims. If any has changed, fix the draft rather
than the truth:

- [ ] The hero is a designed avatar, never a photo or likeness of a real child.
- [ ] Staff review precedes any learner-visible panel; nothing auto-publishes.
- [ ] Learner-authored text is not sent to these models (today: the flag is off;
      after the in-flight change: category terms only).
- [ ] The Gemini key bills against a **paid** project — this also closes the
      provider-terms item in the operations runbook.
