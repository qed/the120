---
title: "An id-keyed Supabase upsert trusts the CLIENT-SUPPLIED id as proof of ownership: DO UPDATE reparents a reused/forged id across owners, DO NOTHING (`ignoreDuplicates`) silently drops the write as a false success — verify the EXISTING row's owner, not just the caller's scope"
date: 2026-07-22
category: best-practices
module: path-evidence
problem_type: best_practice
component: database
severity: high
applies_when:
  - "An id-keyed `.upsert(row, { onConflict: \"id\" })` write uses a CLIENT-SUPPLIED or client-echoed id (not a fresh server-generated one) on a table whose rows carry owner/tenant/scope columns (family_id, task_progress_id, submission_id, …)"
  - "Choosing between DO UPDATE (the Supabase/PostgREST upsert default) and DO NOTHING (`ignoreDuplicates: true`) for a write whose conflict key (the id) can collide across two different owners or scopes"
  - "An idempotency / already-done early-return branches on a DB \"completed\" marker (a `redacted_at` timestamp, a status column, a boolean flag) rather than on the confirmed outcome of the actual external side-effect (a storage object deletion, a webhook call, an email send) the marker is supposed to represent"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - authentication
  - storage
tags:
  - supabase
  - upsert
  - on-conflict
  - ignore-duplicates
  - ownership-verification
  - cross-tenant
  - tenant-isolation
  - idempotency
  - fail-closed
  - re-read-before-write
---

# An id-keyed upsert trusts the client-supplied id as ownership — verify the existing row's owner

## Context

The Path's evidence model (T1 Unit 10) lets a client generate its own `evidenceId` (a UUID) up front, so an offline-safe retry can re-submit the same id and land on the *same* row instead of forking a duplicate. Two Supabase upsert shapes implement that idempotency against `path_evidence_items`, keyed on the row's primary key `id` — which comes **straight from client input**:

- `upsertLogEvidence` → `.upsert(row, { onConflict: "id" })` — a **DO UPDATE** (edit a log in place across saves).
- `insertEvidenceItem` → `.upsert(row, { onConflict: "id", ignoreDuplicates: true })` — a **DO NOTHING** (a retried confirm never creates a second permanent row).

The authorization the actions ran was entirely about the **caller's** standing: `canCaptureEvidence(grants, { studentId, familyId })` — "may this caller author evidence for this student at all." Nothing checked what the **existing row at that id** actually belonged to. The composite FK `(task_progress_id, student_id)` doesn't help: the caller's own request supplies a self-consistent, valid pair, so the FK is satisfied *even when the id collides with another owner's row*. `/ce:review` surfaced both failure modes (a P0 and a P1), plus a related idempotency bug in the redaction path.

## Guidance

**An id-keyed upsert is only as safe as the ownership check that runs around it.** A client-supplied conflict key splits authorization into two different questions — "may I write to my own data?" and "may I write to *this row*?" — and the second is the one an upsert answers implicitly and wrongly.

1. **For DO UPDATE** (`onConflict` without `ignoreDuplicates`): resolve the existing row by id and compare its owner/scope columns to the caller's resolved identity **before** the upsert runs, and refuse a mismatch. The write is destructive-in-place — there is no useful read *after* a DO UPDATE, because the original row is already overwritten. The ownership check must be a precondition.

2. **For DO NOTHING** (`ignoreDuplicates: true`): **re-read by id after** the upsert and verify the persisted row's owner matches what you intended to write. DO NOTHING silently skips a colliding id and reports **no error**, so success cannot be inferred from the absence of an error. Returning the caller's own input as confirmation lets a stale/foreign row masquerade as a fresh success.

3. **Authorization over "my scope" is not authorization over "the row this id points at."** They are separate checks with separate failure semantics (`forbidden` vs. a not-written `id_conflict`), and both are required — neither substitutes for the other. A UUID PK feels un-forgeable, but the threat isn't a cryptographic collision; it's an ordinary client bug (a stale id cache after switching between two children on one device, an offline-queue replay) reusing a live id.

4. **Idempotency on the EFFECT, not on a MARKER.** When an operation is a DB marker/tombstone step **plus** a real external side-effect (a storage delete, a webhook, an email), never gate the retry of the side-effect on whether the marker is already set. A partial failure — marker committed, effect failed — is *exactly* the case where the marker is present and the effect still needs to run. Gate the marker write on the marker (do it once, preserving original attribution); leave the side-effect **ungated**, relying on it being naturally idempotent (deleting an already-gone object is a no-op).

## Why This Matters

- **DO UPDATE → cross-tenant reparent.** Without the pre-check, a reused `evidenceId` that collides with a *different* student's log row makes the DO UPDATE overwrite that row's `task_progress_id`, `student_id`, and `log_data` — reparenting another family's evidence to the caller's task and destroying the original. `canCaptureEvidence` passes cleanly because it never looked at the row being overwritten.
- **DO NOTHING → silent false success.** Without the re-read, a colliding id DO-NOTHINGs at the database (the foreign row survives untouched) while the code returns `ok: true` from the caller's own input. The caller believes their evidence attached; it silently did not. The object they just uploaded to storage becomes an unattributed orphan, and the task's evidence trail is missing an item the UI reported as saved.
- **Marker-gated idempotency → a redaction that doesn't redact.** `redactEvidence` tombstones the row (sets `redacted_at`, nulls the signed URL/EXIF) and then deletes the storage object. Gating the whole function on `if (redacted_at != null) return` means a first call that committed the tombstone but failed the storage delete leaves the media **live in the bucket forever** — every retry sees the marker and returns early, and the orphan reaper skips it too (a tombstoned path still counts as "confirmed"). The row reads "redacted" everywhere; the child's photo/video (with GPS EXIF) stays retrievable. A privacy regression in the one code path whose entire job is making media unreadable.

## When to Apply

- Any table whose primary/conflict key is **client-generated** (not server-minted) and used for upsert-based idempotency.
- Any upsert scoped to "the caller's own resources" via foreign keys the caller's own valid input always satisfies — composite FKs do **not** protect against key reuse across owners.
- Anywhere authorization is expressed only as "does the caller have standing over resource scope X" rather than "over the specific row this key resolves to."
- Any action with a DB marker/tombstone step followed by an external, potentially-failing side-effect (storage delete, webhook, email) that can be retried after a partial failure.

## Examples

**DO UPDATE — resolve the existing owner BEFORE writing** (`saveLogEvidence`):

```ts
// Ownership guard: upsertLogEvidence is ON CONFLICT (id) DO UPDATE, so a reused
// evidenceId that already belongs to a DIFFERENT student/task could reparent that
// row. Refuse unless any existing row for this id is already this student's log on
// this task (deleteEvidence/redact guard the same way via resolveEvidenceOwner).
const existingOwner = await resolveEvidenceOwner(db, p.evidenceId); // null for a brand-new id
if (existingOwner && (existingOwner.studentId !== student.studentId || existingOwner.taskId !== p.taskId)) {
  return { ok: false, reason: "forbidden" };
}
await upsertLogEvidence(db, { id: p.evidenceId, taskProgressId, studentId: student.studentId, rows: p.rows, caption });
```

**DO NOTHING — re-read AFTER and verify the persisted owner** (`insertEvidenceItem`):

```ts
const { error } = await db.from("path_evidence_items")
  .upsert({ id: row.id, task_progress_id: row.taskProgressId, student_id: row.studentId, /* … */ },
    { onConflict: "id", ignoreDuplicates: true });
if (error) throw new Error(`insertEvidenceItem(${row.id}) failed: ${error.message}`);

// DO NOTHING silently skips a colliding id → verify the row that now holds this id is OURS.
const { data, error: readError } = await db.from("path_evidence_items")
  .select("task_progress_id, student_id").eq("id", row.id).maybeSingle();
if (readError) throw new Error(`… verify read failed: ${readError.message}`);
if (!data) throw new Error(`… row missing immediately after upsert`);
if (data.task_progress_id !== row.taskProgressId || data.student_id !== row.studentId) {
  return { ok: false, reason: "id_conflict" }; // caller maps to invalid_input, never a false ok
}
return { ok: true };
```

**Idempotency on the effect, not the marker** (`redactEvidence`): tombstone **once**, then delete **always**.

```ts
// Marker write is gated on the marker (preserve the ORIGINAL redactor/time on a retry)…
if (data.redacted_at == null) {
  await db.from("path_evidence_items").update({ redacted_at: now, redacted_by, redaction_reason, signed_url: null, exif: null, updated_at: now }).eq("id", id);
}
// …but the real side-effect is gated on NOTHING — every call (first or retry) reaches it.
// storage.remove is idempotent for already-gone paths, so a retry converges on media-actually-deleted.
if (plan.deleteObjectPaths.length > 0) {
  const { error: rmError } = await db.storage.from(EVIDENCE_BUCKET).remove(plan.deleteObjectPaths);
  if (rmError) throw new Error(`… storage remove failed: ${rmError.message}`);
}
```

## Related

- [Blind upsert on a public endpoint — expression-index inference + consent hijack](../database-issues/blind-upsert-on-conflict-public-endpoint-expression-index-inference-and-consent-hijack-2026-07-16.md) — the sibling in the "an ON CONFLICT is an authorization decision" family, but a **distinct threat model**: that one is a *public/unauthenticated* endpoint keyed on a *guessable natural column*, fixed by proving the *caller's* identity. This one is *authenticated/service-role*, id-keyed, and fixed by re-reading the *existing row's owner* even when the caller is otherwise legitimate — plus the DO-NOTHING silent-drop mode that doc never covers.
- [Record the dedupe key AFTER the idempotent effect](webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md) — the closest existing statement of the secondary rule: a completion marker is not proof the side-effect happened; order/verify around the real effect.
- [Stale status echo — coerce, don't raise; interpret the echo three ways](../database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md) and [Upsert INSERT arm poisons EXCLUDED](../database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md) — the repo's standing lineage that **state/identity belongs in a targeted UPDATE or an RPC, never a full-row upsert**; `{ error: null }` is not proof the row is what you asked for.
- [Fail-closed type-guard for untyped service-role rows](fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md) and [optional-field default sentinel fails open](optional-field-default-sentinel-not-legal-state-guard-fails-open-2026-07-21.md) — same fail-closed family: don't let an unverified input silently become a trusted signal.
- [One already-exists response, two client-library shapes](../integration-issues/already-exists-idempotency-signal-differs-per-upload-leg-tus-detailederror-body-unparsed-2026-07-22.md) — a **contrast**, not an overlap: that is a signal-*detection*-shape divergence; this is a marker-vs-reality divergence.
- Plan: `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 10 (evidence model, capture, video, log tables).
```
