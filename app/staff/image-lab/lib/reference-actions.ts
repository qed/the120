"use server";

/**
 * Image Lab — the reference library's Server Actions: the THIN WIRE
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4).
 *
 * Each action is gate → parse → delegate, and nothing else. The decisions live
 * in `./reference-rules` (pure), the sequencing in `./reference-core`
 * (deps-injected), the I/O in `./reference-loader` (service role).
 *
 * ── EVERY ACTION GATES ITSELF, UNCONDITIONALLY, FIRST ──────────────────────
 * `await requireStaff()` is the first statement of every export below — not a
 * shared helper, not a branch, not "the layout already did it". SERVER ACTIONS
 * DO NOT RENDER THROUGH A LAYOUT AT ALL, and `proxy.ts`'s own docblock says it
 * does not reliably cover Server Function calls, so the layout gate provably
 * cannot reach here. These are network-reachable POST endpoints: without the
 * line, `mintReferenceUploadSlot` hands any caller a signed write token into a
 * private bucket.
 *
 * `__tests__/gate-enforcement.test.ts` discovers every `"use server"` module
 * under the Lab, INVOKES each exported function, and fails unless a mocked
 * `requireStaff` was called — AND runs the four source fences over these files
 * as well as over the routable ones. That second half is not decoration: the
 * behavioural invoke runs under `NODE_ENV=test`, which is exactly the condition
 * a `if (process.env.NODE_ENV !== "production")` bypass leaves true, so an
 * action wearing one would have passed the spy while shipping a wide-open POST.
 *
 * ── THROW POSTURE ──────────────────────────────────────────────────────────
 * These bodies never throw from their own logic. `requireStaff()` may redirect
 * (a Next control-flow throw) or raise `IdentityUnavailableError`; everything
 * else resolves to a typed result the picker renders, because an uncaught
 * storage error reaches the browser as an opaque digest and the whole point of
 * the structured refusals is that a staff member is told the cap.
 *
 * A thrown gate failure is NOT invisible to the client either: the picker folds
 * it into the same `{ ok: false, reason: "unavailable" }` shape these actions
 * return, so `loadFailed` is reachable for the one failure this contract admits.
 */

import { z } from "zod";
import { requireStaff } from "@/app/crm/lib/auth";
import {
  listReferenceViews,
  mintReferenceSlot,
  registerReference,
  type ReferenceListing,
  type ReferenceRegistration,
  type ReferenceSlot,
} from "./reference-core";
import { referenceDeps } from "./reference-loader";
import { imageLabDb } from "./image-lab-db";

/**
 * ⚠ NO `.max()` ON THE LABEL, DELIBERATELY.
 *
 * The label used to be bounded here at 4× the stored cap AND again by the pure
 * rule at 120 — two independent validations of one field against two different
 * numbers. It produced both failures you would predict: a 481-character label
 * came back `invalid_input` ("That request was not understood") instead of the
 * refusal that NAMES the cap, and the mint leg and the register leg could
 * disagree about the same string. The pure rule owns this refusal now, in one
 * place, and states the number.
 */
const labelSchema = z.string().optional();

const slotSchema = z.object({
  /** `File.type` as the browser reported it — ADVISORY only. The type that
   *  reaches the row is pinned server-side at registration from the object
   *  Storage actually holds, so this value can never win. */
  contentType: z.string().max(255).nullable().optional(),
  sizeBytes: z.number().int(),
  label: labelSchema,
});

const registerSchema = z.object({
  storageKey: z.string().max(200),
  label: labelSchema,
});

/**
 * Mint a signed, metadata-only upload slot. Bytes go DIRECT from the browser to
 * Storage — a Vercel function body caps around 4.5 MB, far below a character
 * sheet, so routing the file through this action is not an option that exists.
 */
export async function mintReferenceUploadSlot(input?: unknown): Promise<ReferenceSlot> {
  await requireStaff();

  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  return mintReferenceSlot(referenceDeps(imageLabDb()), {
    declaredContentType: parsed.data.contentType ?? null,
    sizeBytes: parsed.data.sizeBytes,
    label: parsed.data.label,
  });
}

/**
 * Record an uploaded object as a reference.
 *
 * `created_by` comes from the GATE's session, never from the input — the
 * caller does not get to say who they are. A retried registration of the same
 * slot resolves to the existing reference (`duplicate: true`).
 */
export async function registerReferenceUpload(
  input?: unknown
): Promise<ReferenceRegistration> {
  const { staffId } = await requireStaff();

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  return registerReference(referenceDeps(imageLabDb()), {
    storageKey: parsed.data.storageKey,
    label: parsed.data.label,
    staffId,
  });
}

/**
 * The picker's data — newest first, each with a short-lived signed URL and no
 * storage key. Called again by the client when the URLs approach expiry
 * (`decideReferenceRefresh`), since an append-only row cannot cache one.
 */
export async function listReferenceLibrary(): Promise<ReferenceListing> {
  await requireStaff();

  return listReferenceViews(referenceDeps(imageLabDb()));
}
