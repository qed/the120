---
module: fp-cover
tags: [storage, serving-path, data-loss, feature-flags, fpv04]
problem_type: silent-data-loss
---

# Writing the durable artifact while clearing the served one is a silent subtraction

**Context (fpv04 U7c, 2026-08-14).** A child picks a comic cover at signup. It
is rendered once and stored inline as `children.fp_cover_data_url`, and the
three sign-in doors serve that column — they hold no storage reader, and a
public per-child cover route would leak a kid's first name to anyone who
guessed an id.

Then a new feature generated a cover from a photograph and committed it the
"proper" way: write the object to a private bucket, point the row at it with
`fp_cover_blob_key`, and null the inline copy so a previous cover's art could
not keep serving beside a new key.

Every line of that is defensible. The result is that generating a cover
**removed** the child's cover. The row said `final`, the doors answered
status-only, and the app fell back to a procedural sprite. The signup artifact
lived in that column and nowhere else — the draft it came from is consumed at
provisioning and reaped, and there is deliberately no backfill — so it was gone
for good.

**The rule.** When you introduce a second storage form for something, the
question is not "which is the durable artifact?" It is **"who serves it?"** A
write that updates the durable form and clears the served form is a deletion
wearing the clothes of an upgrade.

The fix names both roles instead of picking one:

```ts
// The blob is the DURABLE artifact and the erasure handle.
// The column is the SERVING copy, because the doors read it and nothing else.
// Both in ONE statement, so they cannot disagree.
.update({
  fp_cover_blob_key: commit.coverBlobKey,
  fp_cover_status:   commit.status,
  ...(commit.dataUrl === null ? {} : { fp_cover_data_url: commit.dataUrl }),
})
```

**The second bug is the interesting one: a size-conditional fix is not a fix.**

The inline copy is capped (the client refuses a cover over 256KB, so the server
will not store one that big). The first version of the repair wrote
`fp_cover_data_url: commit.dataUrl` unconditionally — and `dataUrl` is *null*
above the cap. So the repair worked for small images and reproduced the exact
subtraction for large ones.

That branch looked rare. It was not: the feature shipped with a hand-drawn
placeholder of ~65KB, while a real 1024² model PNG is routinely 1–2MB. The
"rare" branch was going to become the **only** branch the day the real
generator was wired, and the only evidence would have been a nulled column.

Two reviewers found this independently, which is the tell: when a fix is
conditional on a size, an environment, or a flag, ask what the condition's
value will be **after the next change**, not what it is today.

**The third: a form the whole stack must agree on.**

The generated cover is a PNG. Both whitelists — the server's
`asStoredCoverDataUrl` and the client's `asCoverUrl` — admitted `svg+xml` only.
A PNG would have passed every server check, been stored, been returned in the
sign-in response, and then been dropped silently by the client gate. Widening
one side alone converts a visible failure into an invisible one.

They are twins in two repos with independent deploys, so each side's test now
asserts the **literal list** rather than iterating its own constant — iterating
passes in both repos while they disagree.

**Prevention.**

1. For any two-form storage change, grep for every READER before writing the
   producer. The reader set is the spec.
2. Never let a repair depend on a size, a flag, or an env value without
   asserting what happens on the other branch — and test that branch through
   the real route, not by calling the pure helper the route uses.
3. When a value crosses a repo boundary, pin the contract with a literal on
   both sides.
4. Prefer "leave the old thing alone" to "null it" whenever the new thing is
   unavailable. Stale beats missing: a child keeping the cover they chose is
   better than a child with none.

**Related.**
[an-update-that-matches-no-rows-is-not-an-error-…](../../../first-profit/docs/solutions/security-issues/)
and the U7b copy learning are the same family — a write whose real-world effect
was assumed rather than checked.
