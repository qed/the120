---
module: fp-child-photo
tags: [feature-flags, placeholders, fallback, ai-generation, fpv04]
problem_type: silent-wrong-mode
---

# A placeholder chosen by fallback fires everywhere and looks exactly like a working pipeline

**Context (fpv04 U7a-bis, 2026-08-14).** The founder asked for the photo → cover
pipeline to ship with a **placeholder image** (a kitten) standing in for the
model call, so the UX could be judged before the provider was wired.

The obvious implementation is a fallback: try the real generator, and if it
fails, return the placeholder. It reads as defensive, it needs no flag, and it
degrades gracefully.

It would have been silently wrong in every environment. The configured model id
(`FP_COVER_MODEL_ID`) does not resolve in the provider registry today, so **the
real generator fails on every request** — dev, preview, and production alike. A
fallback would therefore have fired every single time, and the result would have
been indistinguishable from a working pipeline: 200s, covers committed, source
photos deleted, tests green. The first person to discover that no model had ever
been called would have been a parent looking at a cartoon cat.

**The rule.** A stand-in must be selected by an **explicit mode read at the top
of the run**, from configuration alone — never chosen in a `catch`.

```ts
// Step 1b, BEFORE the photo is even read: from the flag, and nothing else.
const usePlaceholder = isCoverPlaceholderMode(env);
...
// And placeholder mode with no placeholder available REFUSES:
if (usePlaceholder && !deps.generatePlaceholder) return refuse("placeholder_unavailable");
```

Three properties follow, and each is worth a test:

1. **No error path reaches the placeholder.** Test it against every failure the
   real generator can produce — `unconfigured`, `safety_blocked`, `timeout`,
   `rate_limited`, `provider_error`, and a thrown adapter. Each must fail, not
   substitute.
2. **Placeholder mode without a placeholder refuses** rather than quietly
   falling through to the real model — the inverse mistake.
3. **The mode is identity-gated too**, not only flag-gated. A flag is one
   fat-fingered env var away from production; a real family must not be served a
   stand-in even when the mode is armed.

**The self-identifying image.** The stand-in should say what it is, in the
image. Two notes from doing it: an SVG `<text>` caption depends on fontconfig
resolving a generic family and can render as *nothing* on a bare container, so
the caption was drawn as stroked vector letterforms instead — a caption that can
silently vanish is worse than none, since it is the only thing making the image
self-identifying. And a test crops the caption band and asserts pixel variance,
so it cannot regress to blank.

**The generalisation.** "Fall back to X on failure" and "use X in this mode" look
interchangeable until you ask *how often does the failure fire?* If the answer is
"in this environment, always", the fallback is not a safety net — it is the
primary path, wearing a disguise. Before writing any fallback, check whether the
thing it guards currently works at all.

**Prevention.**

1. Grep for placeholders/stubs selected inside a `catch` or after a failed
   provider call. Convert to a mode read before the work starts.
2. When shipping a stand-in, write the test that proves the REAL path's failures
   do not produce it.
3. Gate any "not the real thing" mode on identity as well as configuration when
   the output reaches a customer.
4. Keep the consent/disclosure copy honest for the mode you are actually in: in
   placeholder mode nothing leaves our infrastructure, so no new disclosure is
   owed — and the moment the real model is wired, one is.
