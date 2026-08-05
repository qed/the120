---
module: fp-image-lab
date: "2026-08-05"
problem_type: security_issue
component: storage
severity: high
symptoms:
  - "An application mime allowlist exists, is unit-tested, and has zero callers that can bind the stored object"
  - "A comment claims the content type is 'pinned server-side at registration'; the upload leg it names lets the browser set it"
  - "An image/svg+xml object can land in a private bucket and be served executable from the storage origin by signed URL"
root_cause: wrong_enforcement_point
resolution_type: migration
tags:
  - supabase-storage
  - direct-upload
  - signed-slot
  - content-type
  - svg
  - allowed-mime-types
  - defence-in-depth
---

# On a direct-to-storage upload, only the BUCKET can govern content-type — the app allowlist governs the ROW

## Problem

The Image Lab accepts staff-uploaded reference images (character sheets, style
samples). A pure module declared the allowlist and a guard over it:

```ts
export const IMAGE_LAB_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export function isAcceptedMimeType(value: string): value is ImageLabMimeType { … }
```

with a comment asserting: *"The content type is PINNED server-side at
registration from this list — a vendor- or client-declared type is never trusted
onto an object."* The bucket was created with `allowed_mime_types` left NULL on
the reasoning that a bucket-level allowlist "would surface as an opaque storage
error" while the application check could refuse with a friendly message.

Both halves of that reasoning were wrong in the same place.

## Symptoms

Three layers, zero enforcement over the stored object:

1. **Bucket** — `allowed_mime_types` NULL: Storage accepts any declared type.
2. **Database** — `content_type text not null` on both tables, no CHECK.
3. **Application** — `isAcceptedMimeType` had **zero callers** repo-wide; only
   its own test imported it. It was a promise made to a later unit.

## Why This Happens

This repo's upload pattern (`app/fp/lib/upload-client.ts`, mirroring
`app/fp/lib/actions/upload-slot.ts`) deliberately keeps bytes off our origin:
the server mints a **signed slot** and returns metadata, and the browser PUTs
the bytes **direct to Supabase Storage**. The existing code says so plainly —
*"the client sets the object's content-type at upload time from its own File;
the server cannot bind it at mint."*

So the split is:

| Layer | Governs | Set by |
|---|---|---|
| App allowlist at registration | the **DB row's** `content_type` | our server |
| `storage.buckets.allowed_mime_types` | the **object's** content-type | Storage, at PUT |

An application check that runs at *registration* — i.e. after the bytes have
already landed — can only ever describe what we recorded, never what we stored.

The exploit that follows: upload a file declaring `image/svg+xml` while
registering the row as `image/png`. The bucket accepts it, every reader believes
it is a PNG, and the object is later served by signed URL **from the storage
origin** with its stored content-type. An SVG is an executable document; served
that way it runs on the storage origin, with access to whatever that origin can
reach. (The test suite even flagged `image/svg+xml` as "the pointed one" — while
testing a predicate nothing called.)

## Solution

Enforce at the layer that actually governs the object, and keep the friendly
refusal as UX rather than as security:

```sql
-- the bucket: the only layer that governs the OBJECT
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fp-image-lab', 'fp-image-lab', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- the row: so a mislabeled record cannot be written even if an object slips
constraint fp_image_lab_references_mime_closed
  check (content_type in ('image/png', 'image/jpeg', 'image/webp'))
```

and normalize rather than exact-match in the app layer, because RFC 2045 makes
type/subtype case-insensitive and parameters legal:

```ts
export function normalizeMimeType(value: string | null | undefined): ImageLabMimeType | null {
  if (typeof value !== "string") return null;
  const base = value.split(";")[0]!.trim().toLowerCase();   // "image/PNG; charset=utf-8" → "image/png"
  return (IMAGE_LAB_ACCEPTED_MIME_TYPES as readonly string[]).includes(base)
    ? (base as ImageLabMimeType) : null;
}
```

Refusing `image/PNG` or `image/png; charset=utf-8` is not strictness — it is a
false negative that rejects a valid upload (or, on the generation path, discards
a *paid* result whose bytes were fine).

## Why This Works

The UX objection that kept `allowed_mime_types` NULL was real but mis-priced: it
traded away the **only structurally enforceable layer** to avoid an opaque error
on a wrong file type. With both in place, the app predicate refuses early and
legibly, and the bucket refuses late and unbypassably. A client can still upload
SVG *bytes* — but only under a declared `image/png`, and a browser served
`image/png` will not execute them.

## Prevention

- **Locate the enforcement point by asking who sets the value on the wire**, not
  where the constant is declared. In a signed-slot/direct-upload design the
  browser sets content-type; in a proxied upload the server does. The correct
  layer differs, and the code comment is not evidence.
- **A predicate with zero callers is not a control.** Grep for callers before
  citing an allowlist as a mitigation — that gap is invisible to a green test
  suite, because the predicate's own unit tests pass perfectly.
- **Never leave `image/svg+xml` inside an `image/*` allowlist** for objects
  served to a browser session; it is an executable document, not an image.
- Pin the enforcement in the parity test so it cannot be quietly reverted:

```ts
const closed = [...sql.matchAll(/content_type\s+in\s*\(([^)]*)\)/gi)];
expect(closed, "a content_type IN (...) check on references AND images").toHaveLength(2);
```

## The tension with "enforce at the lowest shared writer" — resolved, not ignored

`docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
says enforcement belongs at the one shared writer rather than scattered across
the endpoints. That thesis is correct and this case does not contradict it — it
extends it, in the direction people miss:

> **The lowest shared writer may not be in your codebase.**

For a direct-to-storage upload there is no shared *application* writer to push
the rule down to; the writer is the storage service itself, and the way to
enforce a rule there is **configuration** (`allowed_mime_types`), not code. If
you only search your own modules for the lowest writer, you conclude — as this
migration first did — that the application predicate *is* the bottom, and you
leave the real bottom unconfigured.

Corollary for review: when the enforcement point is a piece of infrastructure
config rather than a function, it has no call site to grep, no type to check,
and no test that naturally covers it. It needs a parity assertion against the
migration (below) precisely because nothing else will notice its absence.

## Related

- `docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
  — the thesis this case extends; see the section above.
- `docs/solutions/integration-issues/already-exists-idempotency-signal-differs-per-upload-leg-tus-detailederror-body-unparsed-2026-07-22.md`
  — the other place the two upload legs (plain PUT vs TUS) behave differently
  and a single-leg assumption produces a wrong conclusion. Note its code sample
  passes a client-supplied `contentType` into `uploadToSignedUrl`: that value is
  attacker-controlled, which is exactly the hazard documented here.
- `supabase/migrations/20260722140000_path_storage.sql` — the `path-evidence`
  precedent, which leaves `allowed_mime_types` NULL *on purpose* because its
  evidence set is broad (image/pdf/audio/video) and validation is deferred to a
  content-kind rule. That reasoning does not transfer to a bucket whose objects
  are served straight into a staff browser.
