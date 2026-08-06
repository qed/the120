---
module: fp-image-lab
date: "2026-08-05"
problem_type: security_issue
component: api
severity: high
root_cause: scope_issue
symptoms:
  - "A feature flag is described as 'the technical enforcement' of a consent check, and the endpoint that acts on the data never reads it"
  - "A .js route handler and a .js server action are both network-reachable and both invisible to a guard whose glob is {ts,tsx}"
  - "A function-scope \"use server\" directive is a live endpoint that every exported-function check skips"
  - "Turning a flag off changes what the page renders and changes nothing about what a POST can still do"
---

# A flag that gates the page does not gate its Server Actions — they are separately addressable endpoints

## The problem

`IMAGE_LAB_REAL_CONTENT_LIVE` is the Image Lab's consent switch. Its own docblock,
the operator runbook, and the copy rendered on the bench all describe it the same
way: *the technical enforcement of the consent and provider-terms check.* A
checklist item is not a gate; this flag is the gate.

It was read in exactly three places — the content picker's three entry points —
plus the page render that decides whether to show the picker at all. It was **not**
read by `createImageLabRun`, the action that takes a child's content, writes it to
a row, and sends it to a third-party model.

So on a deployment with generation ON and consent OFF:

- a stale tab, a replayed action, or a hand-rolled POST past `requireStaff()`
  could still submit a compose carrying `source.childId`;
- the server performed a service-role lookup against `children` and `families`;
- the run was written with `source_child_id` stamped;
- the audit breadcrumb recorded `dbContent=true`;

…on a deployment whose operator believed the switch was off. The flag governed
what the UI *offered*. It governed nothing about what the endpoint *accepted*.

This is one instance of a wider shape, and the wider shape is the lesson: **a
Server Action is not part of the page that renders its button.** It has its own
action id, it is reachable by POST without ever loading that page, and it does not
render through a layout. Anything the page decided — a flag read, a gate, a
feature toggle, a role check — decided nothing for the action.

## The three ways the same boundary was crossed

All three shipped past a guard suite that was green, and all three were found by
writing a probe file rather than by reading code.

**1. The flag (above).** The page read it; the action did not.

**2. The extension.** The gate guard globbed
`app/staff/image-lab/**/{page,layout,template,default,route}.{ts,tsx}` for routable
files, and `app/staff/image-lab/**/*.{ts,tsx}` for `"use server"` modules. Verified
against a green suite:

- `app/staff/image-lab/api/probe/route.js` — an ungated POST — passed the gate
  suite 20/20;
- `app/staff/image-lab/lib/probe-actions.js` — `"use server"`, one ungated exported
  action — passed it too, because the action scan globbed `{ts,tsx}` as well.

`next.config.ts` sets no `pageExtensions`, so Next routes `.js` in full. The
*sibling* guard in the same feature (`service-role-only.test.ts`) had already
learned this lesson in an earlier unit and enumerated eight extensions; the fix was
never carried across. **A lesson learned by one guard and not the other is a lesson
not learned.**

**3. The scope of the directive.** A function-scope `"use server"` — inside a page
body or a form handler — is a network-reachable endpoint with its own action id.
Every check in the gate suite (four source fences and one behavioural invoke)
iterates *exported* functions. An inline action is exported by nothing, so all five
skipped it silently while Next served it.

## The fix

**Read the flag where the effect happens, not where the button renders.**
`createRun` now consults the consent flag itself and refuses a provenance-bearing
compose when it is off — with a named refusal, before any roster lookup. The flag
reader moved out of the picker's `*-core` module and into the plain rules module
beside its sibling `isImageLabLive`, because it now has readers on two different
layers.

**Make provenance a fact the server minted, not a field the caller asserts.** The
deeper problem behind the flag gap was that `source` was a client-supplied,
`.nullable().optional()` object — so the whole protection block was defeated by
*deleting* a field rather than by forging one, which is strictly easier. The picker
now returns a short server-signed token (HMAC over the three ids and a timestamp,
keyed off an existing server secret); `createRun` verifies it and *derives* the
child id from it. A token that does not verify is a refusal, never a silent
downgrade to the unprovenanced path — falling through would restore the exact
bypass the token replaces, reachable by flipping one character.

**Share the extension list between the guards.** One exported constant, imported by
both, so they cannot drift again. Both globs now cover
`{ts,tsx,js,jsx,mjs,cjs,mts,cts}`.

**Ban the inline directive rather than half-covering it.** Covering function-scope
actions properly means slicing arbitrary nested closures out of a page component,
which is exactly the kind of extractor whose history shows it always has one more
shape it does not know. A parser-based check now fails loudly on any `"use server"`
that is not the first statement of a module, and the author moves it into a
`"use server"` module where all five checks reach it.

**Anchor by import, not only by directory.** Every gate check was scoped to
`app/staff/image-lab/`, so a Lab endpoint written under `app/api/…` — where every
other API route in the repo lives, and therefore where an author would naturally
put it — would inherit none of the feature's guarantees. A
repo-wide scan now asserts that nothing outside the feature directory imports its
cores, so a relocated endpoint reddens the moment it wires itself up.

## What to take from it

- **Every flag, gate and toggle belongs at the point of effect.** If turning it off
  changes what renders but not what a POST accepts, it is a UI preference wearing
  a security control's name — and the docblock claiming otherwise is the most
  dangerous part, because it stops the next reader looking.
- **An optional field is an opt-in protection.** If the guard reads
  `if (input.x) { …protect… }` and `x` is optional, the protection is defeated by
  omission. Derive the value server-side, or refuse the request that lacks it.
- **A negative fixture per hole, or the hole is not closed.** Every item above was
  found by writing the offending file and watching a green suite stay green. Each
  now has a fixture that goes red.
- **When two guards in one feature enforce related boundaries, share their inputs.**
  The extension list drifted for exactly one reason: it was written twice.

## Related

- `docs/solutions/security-issues/a-source-scan-cannot-prove-a-guard-was-reached-shadowed-conditional-and-route-handlers-all-pass-it-2026-08-05.md`
  — the same boundary from the other side: why a source scan cannot answer "was the
  gate reached", and why the glob had to include actions at all.
- `docs/solutions/security-issues/a-keyword-grep-is-not-an-import-boundary-seven-ways-past-a-forbidden-client-guard-2026-08-05.md`
  — the sibling guard, and where the eight-extension list came from.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the parent lesson both extend.
