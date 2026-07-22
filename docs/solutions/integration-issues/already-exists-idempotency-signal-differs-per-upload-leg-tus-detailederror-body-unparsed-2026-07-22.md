---
title: "One Supabase already-exists (409 Duplicate) surfaces two ways: @supabase/storage-js parses it into StorageApiError.statusCode, but tus-js-client's DetailedError only exposes the outer HTTP 400 — a duplicate check verified on the plain leg silently misclassifies the TUS leg"
date: 2026-07-22
category: integration-issues
module: path-storage
problem_type: integration_issue
component: storage
symptoms:
  - "An upsert-disabled re-upload of an already-stored object is correctly treated as success on the plain (<6MB) leg but would be misclassified as a hard failure on the TUS (resumable) leg"
  - "The same logical Supabase Storage response — body {\"statusCode\":\"409\",\"error\":\"Duplicate\"} under an outer HTTP 400 — reaches a shared classifier with the 409 present on one path and absent on the other"
  - "A production probe of the duplicate response returned 400/409-in-body and 'confirmed' the already-exists mapping, but only the plain object endpoint was exercised — the resumable endpoint was never tested"
root_cause: incorrect_assumption
resolution_type: code_fix
severity: high
related_components:
  - storage
  - offline_sync
tags:
  - supabase-storage
  - tus-js-client
  - idempotency
  - already-exists
  - error-shape
  - upsert-disabled
  - resumable-upload
  - StorageApiError
  - DetailedError
  - verify-every-path
---

# One already-exists response, two client-library shapes: the plain leg parses the 409 body, the TUS leg doesn't — verify the duplicate mapping on BOTH legs, not just the one you probed

## Problem

The Path uploads evidence direct to Supabase Storage with **upsert disabled** on both legs (plain `uploadToSignedUrl` under 6 MB, resumable TUS above), so first-write-wins and a completed-then-retried upload comes back as an *already-exists*. A pure `interpretUploadResponse` maps that already-exists to `"success"` (a prior attempt already won → proceed to confirm, never re-upload or wedge). The mapping was verified against a real duplicate response in production — but only the **plain** object endpoint was probed. The **TUS** leg produces the *same logical* response in a *different shape*, and the classifier, wired identically for both legs, would misclassify a legitimate already-won TUS retry as a hard `"failed"` — defeating the exact failure-recovery the idempotent design exists for, precisely for the large/video uploads TUS is chosen to protect.

## Symptoms

- Supabase Storage returns the same logical already-exists both ways: an outer **HTTP 400** whose **body** is `{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`.
- On the **plain** leg (`@supabase/storage-js`), the client parses that body into a `StorageApiError` whose `.statusCode === "409"` — so a classifier keyed on `statusCode === 409` detects the duplicate. ✅
- On the **TUS** leg (`tus-js-client`), the `onError` callback receives a `DetailedError` whose `originalResponse.getStatus()` returns only the **outer 400**; the body's inner `409`/`Duplicate` is embedded **as text inside `.message`** and never parsed into a field. A classifier keyed on `statusCode`/outer-status therefore falls through to a fragile `/already exists/i.test(message)` last resort. ❌
- The class is invisible to the repo's node-only test suite (no live Storage), and the one manual production probe exercised the wrong endpoint.

## What Didn't Work

- **"The already-exists mapping is confirmed against production."** It was — for the plain leg. A single manual probe (`POST /storage/v1/object/{bucket}/{path}` twice, upsert off) returned the 400/`statusCode:409` shape and validated `interpretUploadResponse`. But the resumable endpoint (`/storage/v1/upload/resumable`, TUS create/PATCH) was never hit, and it surfaces the duplicate through a *different library's* error object. Two legs feed one classifier; probing one proves nothing about the other.
- **Relying on the outer HTTP status.** `tusErrorStatus(err)` read only `originalResponse.getStatus()` → `400`, which is neither a 2xx nor a 409, so the duplicate signal was lost before `interpretUploadResponse` ever saw it.
- **Relying on a message substring.** `/already exists/i.test(message)` happens to work *today* because tus-js-client concatenates the response body text into `DetailedError.message` — but that depends on the library's error-string formatting and Supabase's exact wording, an unversioned contract to hang idempotency on.

## Solution

Give the TUS leg the **same structured detection** the plain leg gets by **parsing the response body** off the `DetailedError`, and forward the parsed `statusCode`/`error` into the shared pure classifier — rather than trusting the outer status or a message heuristic.

```ts
// EvidenceUploader.tsx — normalize a tus-js-client error into the same shape
// interpretUploadResponse already consumes from the plain (StorageApiError) leg.
import { DetailedError } from "tus-js-client";

function normalizeTusError(err: unknown): Parameters<typeof interpretUploadResponse>[0] {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DetailedError && err.originalResponse) {
    let statusCode: number | string | null = null;
    let errorName: string | null = null;
    try {
      // The 409/Duplicate lives in the BODY — tus-js-client never parses it.
      const body = JSON.parse(err.originalResponse.getBody() || "{}") as {
        statusCode?: number | string;
        error?: string;
      };
      if (body.statusCode != null) statusCode = body.statusCode;
      if (typeof body.error === "string") errorName = body.error;
    } catch {
      // body wasn't JSON — fall back to outer status + message heuristics
    }
    return { status: err.originalResponse.getStatus(), statusCode, errorName, message };
  }
  return { status: null, statusCode: null, errorName: null, message };
}
```

The pure classifier already detects the duplicate **semantically** (any of: body `statusCode === 409`, an outer `409`, `error === "Duplicate"`, or an `/already exists/i` message), so once the body is parsed both legs converge:

```ts
export function interpretUploadResponse(resp: {
  status?: number | null; statusCode?: number | string | null;
  errorName?: string | null; message?: string | null;
}): "success" | "retry" | "failed" {
  const bodyCode = toStatusNumber(resp.statusCode);
  const httpCode = toStatusNumber(resp.status);
  const isDuplicate =
    bodyCode === 409 || httpCode === 409 ||
    (resp.errorName ?? "").trim().toLowerCase() === "duplicate" ||
    /already exists/i.test(resp.message ?? "");
  if (isDuplicate) return "success"; // a prior attempt won — proceed to confirm
  // …2xx → success; 429/5xx → retry; else failed
}
```

The plain leg needs no cast — `@supabase/storage-js`'s base `StorageError` already carries `status?: number` and `statusCode?: string`:

```ts
const { error } = await supabase.storage.from(bucket)
  .uploadToSignedUrl(objectPath, token, file, { contentType, upsert: false });
if (error) {
  const outcome = interpretUploadResponse({
    status: error.status ?? null, statusCode: error.statusCode ?? null,
    errorName: error.name ?? null, message: error.message,
  });
  if (outcome === "success") return; // already exists
  // …retry / throw
}
```

## Why This Works

The root cause is **one logical signal with two physical shapes, and a verification that only exercised one shape.** Supabase Storage returns the same already-exists semantics on both upload paths, but the two *client libraries* that receive it disagree on where the `409` lands:

- `@supabase/storage-js` reads the JSON error body and lifts `body.statusCode` onto `StorageApiError.statusCode` (a first-class field).
- `tus-js-client` treats the transfer as an opaque HTTP exchange: `DetailedError` carries `originalResponse.getStatus()` (the transport status, `400`) and stringifies the body into `.message`, but never structures it.

A classifier written and *verified* against the first shape silently degrades on the second. Parsing the body off `DetailedError.originalResponse.getBody()` re-lifts the same field the plain leg gets for free, so the single semantic `isDuplicate` check is true on both legs. This is the same family as [the SECURITY DEFINER CASE being a third untested copy](../test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md): **count coverage by physical encodings, not by "the concept."** There, one value map lived in three files and the test touched two; here, one duplicate signal flows through two upload legs and the production probe touched one.

## Prevention

- **When N code paths converge on one error/idempotency classifier, verify the classifier against the real error object each path actually produces — not one representative path.** "Confirmed against production" must name *which* path; a probe of the plain object endpoint says nothing about the resumable endpoint, even for the identical logical response. (Sibling rigor: [prove which version/shape produced the error before trusting a check](../workflow-issues/stale-rereport-of-fixed-bug-prove-code-version-db-state-deploy-timeline-edge-log-fingerprint-2026-07-15.md).)
- **Do not classify on the outer HTTP status when the meaningful status is in the body.** Supabase Storage wraps a body `statusCode` inside a different outer status (409-in-body under a 400); read the body. This mirrors the plain-leg quirk already documented for [interpreting a coerced echo three ways](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md) — the value you branch on is not always the one the transport reports.
- **Detect idempotent "already done" semantically, with multiple independent signals** (body code, outer code, error name, message), so no single library-specific field is load-bearing. A message-substring alone is an unversioned contract on the library's error formatting.
- **Prefer the library's own typed error over a hand-written cast.** `err instanceof DetailedError` (tus-js-client) and the base `StorageError`'s typed `status`/`statusCode` (`@supabase/storage-js`) both model these fields; a bespoke `err as { statusCode?: … }` cast throws away the real type and can get it wrong (e.g. asserting `statusCode: number` when it is `string`).
- **Test the pure classifier against BOTH shapes**, including a duplicate-body under a non-409 outer status, so a reordering that checks retry-before-duplicate is caught DB-free:
  ```ts
  expect(interpretUploadResponse({ status: 400, statusCode: "409", errorName: "Duplicate" })).toBe("success"); // plain-leg shape
  expect(interpretUploadResponse({ status: 503, statusCode: 409 })).toBe("success");                            // duplicate wins over a 5xx outer
  ```

## Related

- [A SECURITY DEFINER SQL CASE is a third, untested copy of a TS map — parse the migration file to cover it](../test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md) — the same "count coverage by physical encodings, not the concept" principle, one language boundary over.
- [Coerce-not-raise / three-way stale-status echo](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md) — the DB-side sibling: interpret a response shape three ways (match / behind / ahead), never trust the surface value.
- [Webhook idempotency — record the dedupe key AFTER the idempotent effect](../best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md) — the at-least-once/first-write-wins model the upload legs mirror.
- [Retry transient send failures with an idempotency key + circuit-breaker sizing](../best-practices/retry-transient-send-failures-idempotency-key-circuit-breaker-sizing-2026-07-21.md) — retry vs terminal classification, the other half of interpretUploadResponse.
- [Client-side awaited server actions need try/catch/finally](../ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md) — the surrounding uploader-freeze hazard the same component guards.
- Plan: `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 9 (storage, signed uploads, quota).
