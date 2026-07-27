---
title: "a persisted key that gates a destructive repeat-on-mount action must not assume its own write landed — back an unwritable key with document-scoped memory"
date: 2026-07-27
module: fw cache-owner reconcile (app/fp/lib/fw-sync-client.ts ports)
category: logic-errors
problem_type: logic_error
symptoms:
  - "A destructive maintenance action (cache clear, purge, reconcile) re-runs on every mount for the rest of the session on one specific device"
  - "The device is in Safari private mode, or its localStorage quota is saturated"
  - "Every run reports success; nothing anywhere records that the completion marker never persisted"
root_cause: "The action's completion marker is a localStorage write whose boolean result was discarded; where the write silently fails, the next mount reads the stale marker and repeats the destructive action, indefinitely"
resolution_type: code_fix
tags: [localstorage, private-mode, idempotency, destructive-action, safari, quota, fail-silent]
---

# A persisted key that gates a destructive repeat-on-mount action must not assume its own write landed

## Problem

The handover reconcile runs when `fw.cacheOwner` (localStorage) names a different
account than the one signed in: it drains what it can, then DESTRUCTIVELY clears the
roster cache and the SW shell cache, then advances the key so the next mount sees
"already this actor's" and does nothing. `writeOwner` correctly returned `false` when
`setItem` threw (private mode; saturated quota) — and both call sites discarded the
boolean.

On a device where the write can never land, the key can never advance, so **every
subsequent mount of the bar re-ran the whole destructive sequence**: re-draining,
re-clearing the CURRENT guide's own freshly re-seeded roster cache and the shell
cache, on every navigation, for the rest of the shift — precisely on the flaky-wifi
device whose offline cache the feature exists to protect. Found by an adversarial
review (0.82) tracing what happens when the anticipated failure the code even
commented on ("private mode — nothing to persist") actually occurs.

## What Didn't Work

- **Returning the boolean and documenting the failure mode** — which is what the code
  did. A failure signal nobody consumes is a comment wearing a type.
- Folding a failed write into `clear_failed` would misreport: the clears *succeeded*;
  it is only the marker that did not. And since the marker will never persist on this
  device, "retry until it does" is the loop, not the fix.

## Solution

A module-level in-memory copy of the last owner THIS DOCUMENT wrote, consulted when
the persisted read is stale or throws:

```ts
/** The last owner THIS DOCUMENT wrote — localStorage can refuse the write
 *  (private mode) while the reconcile it describes genuinely ran. */
let memoryCacheOwner: string | null = null;

readOwner: () => {
  try {
    const persisted = window.localStorage.getItem(FW_CACHE_OWNER_KEY);
    return persisted ?? memoryCacheOwner;
  } catch {
    return memoryCacheOwner ?? undefined; // undefined = the read itself threw
  }
},
writeOwner: (owner) => {
  memoryCacheOwner = owner;
  try {
    window.localStorage.setItem(FW_CACHE_OWNER_KEY, owner);
    return true;
  } catch {
    return false; // memory copy above still stops THIS document repeating the clear
  }
},
```

## Why This Works

Memory scope is exactly the right size for this failure. It survives remounts within
the page's lifetime — which is where the loop lived, because the bar remounts on
route-group crossings — and evaporates on a genuinely fresh page load, where running
the reconcile once more is CORRECT: private mode persisted nothing, so nothing is
known about the device. The repetition is bounded to one per page load instead of one
per navigation, without pretending the device can remember what it cannot.

## Prevention

The general shape: **completion marker persisted ⟶ destructive action gated on it ⟶
write can fail silently**. Whenever all three hold, ask what the Nth run costs. If
the answer is "it re-destroys something," the marker needs a fallback tier whose
lifetime matches the loop you are breaking — usually module memory. Grep candidates:
any `setItem` whose return/throw is swallowed within reach of a `clear`, `purge`,
`delete`, or `reconcile`.

## Related

- `docs/solutions/best-practices/checking-a-lazily-created-client-resource-creates-it-gate-on-a-separately-persisted-usage-signal-2026-07-27.md`
  — the same key's READ side: localStorage and IndexedDB evict independently, so
  absence of the key is not absence of residue. This doc is the WRITE side.
- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md`
  — the sequence this key concludes.
