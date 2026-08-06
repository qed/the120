"use server";

/**
 * Image Lab — the run flow's Server Actions: the THIN WIRE
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * Each action is gate → parse → delegate, and nothing else. The decisions live in
 * `./run-rules` (pure), the sequencing in `./run-core` and
 * `./content-picker-core` (deps-injected), the I/O in `./run-loader` and
 * `./content-picker-loader` (service role).
 *
 * ── EVERY ACTION GATES ITSELF, UNCONDITIONALLY, FIRST ──────────────────────
 * `await requireStaff()` is the first statement of every export below — not a
 * shared helper, not a branch, not "the page already did it". SERVER ACTIONS DO
 * NOT RENDER THROUGH A LAYOUT AT ALL, and `proxy.ts`'s own docblock says it does
 * not reliably cover Server Function calls. These are network-reachable POST
 * endpoints: without the line, `fillImageLabSlots` hands any caller a real
 * child's authored business text.
 *
 * `__tests__/gate-enforcement.test.ts` discovers every `"use server"` module
 * under the Lab, INVOKES each exported function, and fails unless the mocked
 * `requireStaff` was called — and runs its four source fences over these files
 * too, because the behavioural invoke runs under `NODE_ENV=test`, which is
 * exactly the condition a `process.env.NODE_ENV !== "production"` bypass leaves
 * true.
 *
 * ── WHY GENERATION IS NOT AN ACTION ────────────────────────────────────────
 * The paid call lives in `../api/generate-cell/route.ts` instead, and the reason
 * is `maxDuration`: a route segment can declare its own function budget and a
 * Server Action cannot. gpt-image-2 needs up to 240s of adapter budget, which the
 * default action budget would kill mid-flight — billing for an image, storing
 * nothing, and leaving the row latched for the full staleness window. The route
 * also asserts that budget at MODULE SCOPE, so a too-low value fails the BUILD.
 *
 * ── THROW POSTURE ──────────────────────────────────────────────────────────
 * These bodies never throw from their own logic. `requireStaff()` may redirect (a
 * Next control-flow throw) or raise `IdentityUnavailableError`; everything else
 * resolves to a typed result the composer renders, because an uncaught error
 * reaches the browser as an opaque digest.
 */

import { z } from "zod";
import { requireStaff } from "@/app/crm/lib/auth";
import { checkAndRecordRateLimit } from "@/app/fp/lib/rate-limit-store";
import { imageLabDb } from "./image-lab-db";
import { IMAGE_LAB_SLOTS } from "./image-lab-rules";
import {
  createRun,
  retryCell,
  type CreateRunResult,
  type RetryResult,
} from "./run-core";
import { runDeps, loadRunCellViews, type RunCellView } from "./run-loader";
import {
  listPickerChildren,
  listPickerIdeas,
  pickSlotValues,
  type PickerChildOption,
  type PickerContent,
  type PickerIdeasResult,
  type PickerRefusal,
} from "./content-picker-core";
import { contentPickerDeps } from "./content-picker-loader";
import {
  composeRateLimitKey,
  IMAGE_LAB_COMPOSE_RATE_LIMIT,
  IMAGE_LAB_MAX_IMAGE_COUNT,
  IMAGE_LAB_MAX_REFERENCES_PER_RUN,
  IMAGE_LAB_NOTE_MAX_CHARS,
  IMAGE_LAB_SOURCE_ID_PATTERN,
  IMAGE_LAB_TEMPLATE_MAX_CHARS,
  type RunCompositionRefusal,
  type SlotValues,
} from "./run-rules";
import { IMAGE_LAB_DRILL_TAGS } from "./image-lab-rules";

/**
 * ⚠ BOUNDS THAT EXIST IN EXACTLY ONE PLACE.
 *
 * Every `.max()` here mirrors a rules constant or a migration CHECK by IMPORTING
 * it, never by restating the number. Unit 4's review found a label bounded here at
 * 4× the pure rule's cap, which produced both failures you would predict: the
 * wrong refusal message, and two legs disagreeing about one string.
 */
const slotValuesSchema = z.record(z.string().max(64), z.string().max(4000));

/**
 * Keep only the four slots the vocabulary defines.
 *
 * A key the vocabulary does not know is DROPPED rather than refused: the template
 * decides which `{{tokens}}` exist, an unknown value can never be substituted
 * anyway, and refusing would turn a stale client into a dead composer. Dropping
 * also means `slot_values` on the row can never accumulate keys nobody audited —
 * that column is one of the three the migration header calls child-PII-bearing.
 */
function keepKnownSlots(raw: Record<string, string> | undefined): SlotValues {
  const out: SlotValues = {};
  for (const slot of IMAGE_LAB_SLOTS) {
    const value = raw?.[slot];
    if (typeof value === "string") out[slot] = value;
  }
  return out;
}

const createRunSchema = z.object({
  /** ⚠ CLIENT-MINTED, ONCE PER COMPOSE — the double-submit defence. */
  idempotencyKey: z.string().min(8).max(200),
  template: z.string().max(IMAGE_LAB_TEMPLATE_MAX_CHARS),
  slotValues: slotValuesSchema.optional(),
  modelIds: z.array(z.string().max(120)).max(16),
  imageCount: z.number().int(),
  referenceIds: z.array(z.uuid()).max(IMAGE_LAB_MAX_REFERENCES_PER_RUN).optional(),
  drillTags: z.array(z.enum(IMAGE_LAB_DRILL_TAGS)).max(3).optional(),
  note: z.string().max(IMAGE_LAB_NOTE_MAX_CHARS).optional(),
  iteratedOnModel: z.string().max(120).nullable().optional(),
  iteratedFromRunId: z.uuid().nullable().optional(),
  source: z
    .object({
      childId: z.uuid().nullable(),
      // ⚠ A CLOSED CHARACTER CLASS, not a length cap. These land on columns the
      // migration header documents as "internal ids ONLY — never a name", and
      // 200 free characters is room for a sentence. `run-core` re-checks with
      // the same exported pattern, because this schema is not the only caller.
      ideaId: z.string().regex(IMAGE_LAB_SOURCE_ID_PATTERN).nullable(),
      taskId: z.string().regex(IMAGE_LAB_SOURCE_ID_PATTERN).nullable(),
    })
    .nullable()
    .optional(),
});

/**
 * Map a zod failure onto the refusal it actually is.
 *
 * ⚠ EVERY PARSE FAILURE USED TO BECOME `empty_template`, which the composer
 * renders as "Write a prompt template first" — and every server refusal was
 * rendered as "Pick at least one model". So an over-long slot value or a bad
 * drill tag told the staff member to select models they had already selected,
 * about a template they had already written. A refusal that names the wrong
 * field is worse than no refusal: it sends someone to fix something that is not
 * broken.
 */
function refusalForIssues(error: z.ZodError): RunCompositionRefusal {
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    switch (field) {
      case "template":
        return { ok: false, reason: "template_too_long", max: IMAGE_LAB_TEMPLATE_MAX_CHARS };
      case "slotValues":
        return { ok: false, reason: "prompt_too_long", max: IMAGE_LAB_TEMPLATE_MAX_CHARS };
      case "modelIds":
        return { ok: false, reason: "no_models" };
      case "imageCount":
        return { ok: false, reason: "bad_image_count", max: IMAGE_LAB_MAX_IMAGE_COUNT };
      case "referenceIds":
        return {
          ok: false,
          reason: "too_many_references",
          max: IMAGE_LAB_MAX_REFERENCES_PER_RUN,
        };
      case "source":
        return { ok: false, reason: "bad_source_id" };
      default:
        continue;
    }
  }
  // Nothing above matched: the body is not a compose at all (a stale client, or
  // a hand-rolled POST). "Write a template first" is the honest floor.
  return { ok: false, reason: "empty_template" };
}

/**
 * Persist a compose: the run row plus one `requested` image row per cell, BEFORE
 * anything is sent to a vendor.
 *
 * `staff_id` comes from the GATE's session, never from the input — the caller
 * does not get to say who they are, and the idempotency uniqueness is scoped per
 * staff member so two people composing concurrently can never collide.
 */
export async function createImageLabRun(input?: unknown): Promise<CreateRunResult> {
  const { staffId } = await requireStaff();

  // ⚠ THE SUPPLY SIDE NEEDS A WALL TOO. Only redemption (`generate-cell`) was
  // throttled, so a loop could mint unlimited generatable `requested` rows for
  // free and spend them at whatever rate the other bucket allowed.
  const cooldown = checkAndRecordRateLimit(
    composeRateLimitKey(staffId),
    IMAGE_LAB_COMPOSE_RATE_LIMIT
  );
  if (!cooldown.allowed) return { ok: false, reason: "cooldown" };

  const parsed = createRunSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, refusal: refusalForIssues(parsed.error) };
  }
  if (
    !Number.isInteger(parsed.data.imageCount) ||
    parsed.data.imageCount < 1 ||
    parsed.data.imageCount > IMAGE_LAB_MAX_IMAGE_COUNT
  ) {
    return {
      ok: false,
      refusal: { ok: false, reason: "bad_image_count", max: IMAGE_LAB_MAX_IMAGE_COUNT },
    };
  }

  return createRun(runDeps(imageLabDb()), {
    staffId,
    idempotencyKey: parsed.data.idempotencyKey,
    template: parsed.data.template,
    slotValues: keepKnownSlots(parsed.data.slotValues),
    modelIds: parsed.data.modelIds,
    imageCount: parsed.data.imageCount,
    referenceIds: parsed.data.referenceIds,
    drillTags: parsed.data.drillTags,
    note: parsed.data.note,
    iteratedOnModel: parsed.data.iteratedOnModel ?? null,
    iteratedFromRunId: parsed.data.iteratedFromRunId ?? null,
    source: parsed.data.source ?? null,
  });
}

const idSchema = z.object({ imageId: z.uuid() });

/**
 * Append a NEW attempt at one grid position.
 *
 * Retry never re-runs an existing row — the row is latched by its own
 * `attempted_at` and its cost history is evidence. The refusal-until-staleness
 * rule lives in the core, where the server's clock is the one that judges it.
 */
export async function retryImageLabCell(input?: unknown): Promise<RetryResult> {
  const { staffId } = await requireStaff();

  // Retry mints a generatable row, so it is on the SUPPLY side of the spend and
  // takes the same wall as compose.
  const cooldown = checkAndRecordRateLimit(
    composeRateLimitKey(staffId),
    IMAGE_LAB_COMPOSE_RATE_LIMIT
  );
  if (!cooldown.allowed) {
    return {
      ok: false,
      outcome: { kind: "cooldown", retryAfterMs: cooldown.retryAfterMs },
    };
  }

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, outcome: { kind: "invalid_input" } };

  return retryCell(runDeps(imageLabDb()), { imageId: parsed.data.imageId, staffId });
}

const runIdSchema = z.object({ runId: z.uuid() });

export type RunCellsResult =
  | {
      ok: true;
      cells: RunCellView[];
      serverNowMs: number;
      /** The prompt THIS run sent. The composer shows it beside the grid, so the
       *  live preview can never be mistaken for what Retry would re-send. */
      resolvedPrompt: string;
      modelIds: string[];
    }
  | { ok: false; reason: "invalid_input" | "unavailable" | "not_found" };

/** The grid's data after a reload: every attempt, with a fresh signed URL and no
 *  storage key. */
export async function loadImageLabRunCells(input?: unknown): Promise<RunCellsResult> {
  const { staffId } = await requireStaff();

  const parsed = runIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  try {
    const view = await loadRunCellViews(imageLabDb(), parsed.data.runId);
    // ⚠ SCOPED TO THE CALLER'S OWN RUN. Without this, any staff session could
    // mint fresh signed URLs for a colleague's generated images by id.
    if (!view.run || view.run.staffId !== staffId) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      cells: view.cells,
      serverNowMs: view.serverNowMs,
      resolvedPrompt: view.run.resolvedPrompt,
      modelIds: [...new Set(view.cells.map((cell) => cell.modelId))],
    };
  } catch (e) {
    console.error("[image-lab/run] cell view load failed:", e);
    return { ok: false, reason: "unavailable" };
  }
}

// ── The content picker (gated a SECOND time, by its own flag) ────────────────

/**
 * ⚠ THE PICKER HAS TWO GATES AND THEY AUTHORIZE DIFFERENT THINGS.
 * `requireStaff()` says WHO may call; `IMAGE_LAB_REAL_CONTENT_LIVE` (checked in
 * `content-picker-core`) says whether a real child's authored text may be loaded
 * at all. With the flag unset every entry point below returns `disabled` and the
 * composer renders the picker absent — while manual prompts generate normally.
 */
export async function listImageLabPickerChildren(): Promise<
  { ok: true; children: PickerChildOption[] } | PickerRefusal
> {
  await requireStaff();

  return listPickerChildren(contentPickerDeps(imageLabDb()));
}

const childIdSchema = z.object({ childId: z.uuid() });

export async function listImageLabPickerIdeas(
  input?: unknown
): Promise<PickerIdeasResult | PickerRefusal> {
  await requireStaff();

  const parsed = childIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "unknown_child" };

  return listPickerIdeas(contentPickerDeps(imageLabDb()), parsed.data.childId);
}

const fillSchema = z.object({
  childId: z.uuid(),
  // The same closed class the run row records — a value this action accepts and
  // `createRun` then refuses would be a dead end the composer cannot explain.
  ideaId: z.string().regex(IMAGE_LAB_SOURCE_ID_PATTERN).nullable().optional(),
  taskId: z.string().regex(IMAGE_LAB_SOURCE_ID_PATTERN).nullable().optional(),
});

/**
 * Fill the four slots from one child's saved work.
 *
 * The child's first name and username are scrubbed out of every value before it
 * is returned (`content-picker-core`), and the buyer's name is never read at all.
 */
export async function fillImageLabSlots(
  input?: unknown
): Promise<PickerContent | PickerRefusal> {
  await requireStaff();

  const parsed = fillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "unknown_child" };

  return pickSlotValues(contentPickerDeps(imageLabDb()), {
    childId: parsed.data.childId,
    ideaId: parsed.data.ideaId ?? null,
    taskId: parsed.data.taskId ?? null,
  });
}
