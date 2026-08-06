"use server";

/**
 * Image Lab — the verdict writes: the THIN WIRE
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6; origin R9).
 *
 * Each action is gate → parse → delegate, and nothing else. The decisions live in
 * `./history-rules` (pure), the sequencing in `./history-core` (deps-injected),
 * the I/O in `./history-loader` (service role).
 *
 * ── EVERY ACTION GATES ITSELF, UNCONDITIONALLY, FIRST ──────────────────────
 * `await requireStaff()` is the first statement of every export below — not a
 * shared helper, not a branch, not "the page already did it". SERVER ACTIONS DO
 * NOT RENDER THROUGH A LAYOUT AT ALL, and `proxy.ts`'s own docblock says it does
 * not reliably cover Server Function calls. These are network-reachable POST
 * endpoints: without the line, anyone who can guess a uuid can rewrite the
 * bench's evidence.
 *
 * `__tests__/gate-enforcement.test.ts` discovers every `"use server"` module
 * under the Lab, INVOKES each exported function, and fails unless the mocked
 * `requireStaff` was called — and runs its four source fences over these files
 * too, because the behavioural invoke runs under `NODE_ENV=test`, which is
 * exactly the condition a `process.env.NODE_ENV !== "production"` bypass leaves
 * true.
 *
 * ── WHY THERE ARE THREE ACTIONS AND NOT ONE ────────────────────────────────
 * A verdict, a note, and a run's drill tags are three independent edits, and one
 * combined "save everything" action would make them dependent: judging an image
 * would rewrite whatever note text a second tab had in its box, and tagging a run
 * would carry a stale verdict along with it. Three writes, three columns, no
 * shared blob.
 *
 * ⚠ THE VERDICT WRITE NEVER TOUCHES A RUN FIELD. Two tabs judging two images of
 * the same run cannot clobber each other — which a run-blob write would guarantee.
 * Only {@link setImageLabRunDrillTags} writes a run column, and it writes exactly
 * one. Within a single image, LAST WRITE WINS: single reviewer, stated on the
 * surface and in `history-core`'s header, and there is no `verdict_by` column to
 * arbitrate with.
 *
 * ── THROW POSTURE ──────────────────────────────────────────────────────────
 * These bodies never throw from their own logic. `requireStaff()` may redirect (a
 * Next control-flow throw) or raise `IdentityUnavailableError`; everything else
 * resolves to a typed result the surface renders and, on refusal, ROLLS BACK its
 * optimistic state against — an uncaught error would reach the browser as an
 * opaque digest and the optimistic click would stand.
 */

import { z } from "zod";
import { requireStaff } from "@/app/crm/lib/auth";
import { imageLabDb } from "./image-lab-db";
import { IMAGE_LAB_DRILL_TAGS, IMAGE_LAB_VERDICTS } from "./image-lab-rules";
import {
  recordRunTags,
  recordVerdict,
  recordVerdictNote,
  type NoteResult,
  type TagResult,
  type VerdictResult,
} from "./history-core";
import { historyDeps } from "./history-loader";
import { IMAGE_LAB_VERDICT_NOTE_MAX_CHARS } from "./history-rules";

/**
 * ⚠ BOUNDS THAT EXIST IN EXACTLY ONE PLACE.
 *
 * The note cap MIRRORS the migration's `fp_image_lab_images_verdict_note_bounded`
 * by IMPORTING the constant, never by restating 2000. Unit 4's review found a
 * label bounded at 4× its pure rule's cap, which produced both failures you would
 * predict: the wrong refusal message, and two legs disagreeing about one string.
 *
 * `z.enum(IMAGE_LAB_VERDICTS)` likewise: the closed set is Unit 1's, and a
 * hand-written `["keep","reject"]` here would be a second answer to what a
 * verdict is.
 */
const verdictSchema = z.object({
  imageId: z.uuid(),
  /** `null` is a real value — "un-judge this" — not a missing field. */
  verdict: z.enum(IMAGE_LAB_VERDICTS).nullable(),
});

const noteSchema = z.object({
  imageId: z.uuid(),
  note: z.string().max(IMAGE_LAB_VERDICT_NOTE_MAX_CHARS),
});

const tagsSchema = z.object({
  runId: z.uuid(),
  tags: z.array(z.enum(IMAGE_LAB_DRILL_TAGS)).max(IMAGE_LAB_DRILL_TAGS.length),
});

/**
 * Judge one image: `keep`, `reject`, or `null` to un-judge it.
 *
 * IDEMPOTENT — a repeated `keep` is a legal write that changes only the stamp, and
 * keep → reject → keep ends `keep`. The core refuses a verdict on a non-`done`
 * row BEFORE the database does, so a staff member who clicks Keep on a cell that
 * failed while they were looking at it gets a sentence rather than a 23514 naming
 * `fp_image_lab_images_verdict_needs_done`.
 */
export async function setImageLabVerdict(input?: unknown): Promise<VerdictResult> {
  await requireStaff();

  const parsed = verdictSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_verdict" };

  return recordVerdict(historyDeps(imageLabDb()), {
    imageId: parsed.data.imageId,
    verdict: parsed.data.verdict,
  });
}

/**
 * Write one image's note.
 *
 * Independent of the verdict in both directions: a note may be written on an
 * unjudged image, and changing a verdict never rewrites the note.
 */
export async function setImageLabVerdictNote(input?: unknown): Promise<NoteResult> {
  await requireStaff();

  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "note_too_long" };

  return recordVerdictNote(historyDeps(imageLabDb()), {
    imageId: parsed.data.imageId,
    note: parsed.data.note,
  });
}

/**
 * Set a RUN's drill tags — the one run-level column this unit writes, and the
 * only column it writes on that row.
 *
 * Closed to `IMAGE_LAB_DRILL_TAGS` here, in the core, and again by the SQL CHECK
 * (`drill_tags <@ array[…]`). Three layers because the failure is SILENT: a run
 * tagged `kid_appeal` instead of `kid-appeal` drops out of every drill filter with
 * no error anywhere, and the drill it belonged to is quietly under-reported.
 */
export async function setImageLabRunDrillTags(input?: unknown): Promise<TagResult> {
  await requireStaff();

  const parsed = tagsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_tag" };

  return recordRunTags(historyDeps(imageLabDb()), {
    runId: parsed.data.runId,
    tags: parsed.data.tags,
  });
}
