"use client";

/**
 * Image Lab — the bench: template + slots + references + model/compare selection
 * → a persisted run → per-cell generation
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R3, R5, R7, R12, R15, R16, R17).
 *
 * ── THE ONE INVARIANT THIS COMPONENT EXISTS TO PROTECT (origin R16) ────────
 * THE TEXTAREA ALWAYS HOLDS THE `{{slot}}` TEMPLATE. The picker fills a SEPARATE
 * slot-value panel; it never writes into the textarea. A read-only, live
 * resolved-prompt preview shows the exact final text before Generate — which is
 * how "the operator sees the exact final prompt" is honoured WITHOUT letting an
 * edit destroy the template. The template is what the Kit copies and what the
 * panel engine inherits; resolving into the editor would burn it on first use.
 *
 * ── DECISIONS LIVE IN `run-rules`, NOT HERE ────────────────────────────────
 * The suite is `environment: "node"` with NO jsdom, so nothing in this file can
 * be rendered by a test. Every decision — what resolves to what, which slots are
 * unfilled, whether Generate is enabled, what a cell's state is, whether Retry is
 * offered, what a run costs, and even the ORDER OF THE SECTIONS — is a pure
 * function or constant in `./lib/run-rules`, asserted there. This file maps over
 * `IMAGE_LAB_COMPOSER_SECTIONS`, so the layout order is structurally derived from
 * a tested constant rather than from the sequence somebody pasted JSX in.
 *
 * ── THE TWO SPEND DEFENCES THE CLIENT IS RESPONSIBLE FOR ───────────────────
 *   1. THE IDEMPOTENCY KEY IS MINTED ONCE PER COMPOSE AND HELD. A resubmit after
 *      a lost response MUST carry the same key, or it mints a whole new run whose
 *      fresh cell ids all pass their own CAS and the bench pays twice. The key is
 *      cleared only when the composition genuinely changes, or after a run lands.
 *      (The reference library holds its upload slot for exactly this reason.)
 *   2. THE CLIENT'S AWAIT IS LONGER THAN THE SERVER'S BUDGET
 *      (`IMAGE_LAB_CLIENT_AWAIT_MS`). If the browser gave up first, the server
 *      would keep going, the vendor would still bill, and the staff member —
 *      looking at a cell that says "failed" — would retry.
 *
 * ── MOBILE (~390px) ────────────────────────────────────────────────────────
 * ONE COLUMN AT BOTH BREAKPOINTS, in the order above; every control at least
 * `min-h-11` (44px); no hover-only affordance anywhere — the cost line, the
 * unfilled-slot warning and the excluded-field chips are all plain visible text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { ResultGrid } from "./ResultGrid";
import {
  createImageLabRun,
  fillImageLabSlots,
  listImageLabPickerChildren,
  listImageLabPickerIdeas,
  loadImageLabRunCells,
  retryImageLabCell,
} from "./lib/run-actions";
import type { RunCellView } from "./lib/run-loader";
import type { PickerChildOption, PickerIdea } from "./lib/content-picker-core";
import { IMAGE_LAB_MODELS } from "./lib/model-registry";
import { IMAGE_LAB_SLOTS } from "./lib/image-lab-rules";
import {
  clockOffsetFor,
  decideGenerateAffordance,
  decideRunComposition,
  describeCellProgress,
  describeCompositionRefusal,
  describeGenerateOutcome,
  describeUnverified,
  estimateRunCostUsd,
  formatUsd,
  modelIdsFromCells,
  previewPromptText,
  previewRows,
  promptModeFor,
  releaseIdempotencyKey,
  resolveIdempotencyKey,
  runWithConcurrency,
  cellsFingerprint,
  serverNowFrom,
  shouldPollCells,
  IMAGE_LAB_CELL_POLL_MS,
  IMAGE_LAB_CLIENT_AWAIT_MS,
  IMAGE_LAB_CLIENT_FAN_CONCURRENCY,
  IMAGE_LAB_COMPOSER_SECTIONS,
  IMAGE_LAB_MAX_IMAGE_COUNT,
  IMAGE_LAB_RUN_COPY,
  modelSummaryLine,
  type ComposerNotice,
  type ImageLabPromptMode,
  type PromptModes,
  type GenerateCellOutcome,
  type IdempotencyStore,
  type ImageLabComposerSection,
  type SlotValues,
} from "./lib/run-rules";

const COPY = IMAGE_LAB_RUN_COPY;

/** Where the run this tab is watching is remembered across a reload. */
const RUN_ID_STORAGE_KEY = "image-lab:run-id";

/**
 * `sessionStorage`, degraded to a no-op store when it is unavailable.
 *
 * ⚠ THE IDEMPOTENCY KEY MUST OUTLIVE THE COMPONENT. It lived in React state,
 * which a reload destroys — so the two cases the key exists for (no response, so
 * the staff member reloads; no response, so they open a second tab) both minted
 * a FRESH key and therefore a whole new run whose fresh cell ids all passed
 * their own CAS. Two full 12-cell fans for one intent. Session scope is right:
 * per tab-session, cleared when the browser session ends, never synced.
 */
function browserIdempotencyStore(): IdempotencyStore {
  return {
    get(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* Private mode / quota. The key degrades to per-render, as before. */
      }
    },
    clear(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* Same tolerance as `set`. */
      }
    },
  };
}

export function RunComposer({
  live,
  pickerLive,
}: {
  /** `IMAGE_LAB_LIVE`, read SERVER-side and handed down. */
  live: boolean;
  /** `IMAGE_LAB_REAL_CONTENT_LIVE` — a SEPARATE switch. Unset means the picker is
   *  absent while manual prompts still generate. */
  pickerLive: boolean;
}) {
  const [template, setTemplate] = useState<string>(COPY.composer.template.placeholder);
  const [slotValues, setSlotValues] = useState<SlotValues>({});
  const [slotsOpen, setSlotsOpen] = useState(true);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [imageCount, setImageCount] = useState(1);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  /**
   * ⚠ PER MODEL, AND EMPTY MEANS "TAKE THE DEFAULT" rather than "authored".
   * `promptModeFor` owns the default — an OpenAI model on a provenance-bearing
   * run derives, everything else sends what was written — so a model this map
   * has never heard of still gets the lawful answer.
   */
  const [promptModes, setPromptModes] = useState<PromptModes>({});

  /**
   * ⚠ RESTORED AT FIRST RENDER, not in an effect.
   *
   * A run that only exists in component state is a run a reload LOSES — along
   * with the only surface that can retry its live cells, which is what drives
   * the staff member to compose again and pay twice. A lazy initializer rather
   * than a `setState` in an effect, so re-attaching costs no cascading render.
   */
  const [runId, setRunId] = useState<string | null>(() => {
    try {
      return typeof window === "undefined"
        ? null
        : window.sessionStorage.getItem(RUN_ID_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  /** ⚠ THE RUN'S OWN COLUMNS, held apart from the chip selection. See ResultGrid. */
  const [runModelIds, setRunModelIds] = useState<string[]>([]);
  /** What the run actually sent. Retry re-sends THIS, not the live template. */
  const [runPrompt, setRunPrompt] = useState<string | null>(null);
  const [cells, setCells] = useState<RunCellView[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);

  // The picker's own state. Nothing here exists when `pickerLive` is false.
  const [children, setChildren] = useState<PickerChildOption[]>([]);
  const [childId, setChildId] = useState("");
  const [ideas, setIdeas] = useState<PickerIdea[]>([]);
  const [ideaId, setIdeaId] = useState("");
  /**
   * ⚠ THE SERVER-SIGNED PROVENANCE TOKEN, CARRIED VERBATIM.
   *
   * This used to be a `{ childId, ideaId, taskId }` object the composer ASSERTED
   * back to `createImageLabRun`, which made the server's whole re-scrub and
   * consent-audit block opt-in on a field a caller could simply omit. The client
   * now states nothing about provenance: it holds an opaque token the fill
   * minted and hands it back, and the server derives the three ids from it.
   */
  const [sourceToken, setSourceToken] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<
    readonly { slot: string; field: string; why: string }[]
  >([]);
  /** The save doc failed the version gate — a DIFFERENT state from "no ideas". */
  const [docGated, setDocGated] = useState(false);
  /** ⚠ FALSE MEANS THE NAME SCRUB HAD NOTHING TO WORK WITH. The note claiming the
   *  name was removed must not render in that case. */
  const [scrubCovered, setScrubCovered] = useState(true);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * ⚠ THE SERVER'S CLOCK, ANCHORED TO THIS BROWSER'S AT RECEIPT.
   *
   * Staleness decides whether Retry is offered, and it is judged against the
   * clock that stamped `attempted_at`. Comparing a server timestamp with
   * `Date.now()` in a browser whose clock is minutes off — routine after a
   * suspend — offers Retry on a call that is still running (paying twice) or
   * never offers it at all.
   */
  const clockOffsetMs = useRef(0);
  const serverNow = () => Date.now() + clockOffsetMs.current;
  const [serverNowMs, setServerNowMs] = useState(() => Date.now());

  /** ⚠ "THE PICKER MINTED A TOKEN", which is what the SERVER will verify. The
   *  preview would otherwise show the wrong prompt for every provenance-bearing
   *  compose — see `decideRunComposition`'s `childProvenance`. */
  const childProvenance = sourceToken !== null;

  const decision = useMemo(
    () =>
      decideRunComposition({
        template,
        slotValues,
        modelIds,
        imageCount,
        referenceIds,
        childProvenance,
        promptModes,
      }),
    [
      template,
      slotValues,
      modelIds,
      imageCount,
      referenceIds,
      childProvenance,
      promptModes,
    ]
  );

  const cost = useMemo(
    () => (decision.ok ? estimateRunCostUsd(decision.cells) : null),
    [decision]
  );

  const affordance = decideGenerateAffordance({ decision, submitting, live });

  /**
   * ⚠ HELD IN SESSION STORAGE, NOT IN REACT STATE — and BOUND TO THE COMPOSITION
   * IT BELONGS TO.
   *
   * See {@link browserIdempotencyStore}: component state does not survive the
   * reload that IS the case this key exists for. Keyed by the composition
   * signature rather than held flat, because reusing a key for a genuinely
   * different prompt would return the OLD run and silently discard the new
   * intent — the opposite failure and just as bad.
   */
  const compositionSignature = JSON.stringify([
    template,
    slotValues,
    modelIds,
    imageCount,
    referenceIds,
    // ⚠ THE PROMPT CHOICE IS PART OF THE COMPOSITION. Without it, switching a
    // model from `authored` to `derived` and pressing Generate again would reuse
    // the held idempotency key, collide with the earlier run, and return it — so
    // the bench would answer the prompt experiment with the OTHER prompt's
    // results, which is the exact comparison this unit exists to enable.
    promptModes,
    childProvenance,
  ]);

  // ── The picker ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pickerLive) return;
    void (async () => {
      try {
        const result = await listImageLabPickerChildren();
        if (mounted.current && result.ok) setChildren(result.children);
      } catch (e) {
        console.error("[image-lab/composer] child listing threw:", e);
      }
    })();
  }, [pickerLive]);

  // Cleared by the CHANGE HANDLER, never by a setState in this effect's body:
  // clearing here would fire a cascading render on every mount.
  useEffect(() => {
    if (!pickerLive || childId === "") return;
    void (async () => {
      try {
        const result = await listImageLabPickerIdeas({ childId });
        if (!mounted.current || !result.ok) return;
        setIdeas(result.ideas);
        setDocGated(!result.docReadable);
      } catch (e) {
        console.error("[image-lab/composer] idea listing threw:", e);
      }
    })();
  }, [pickerLive, childId]);

  async function onFillSlots() {
    if (childId === "") return;
    try {
      const result = await fillImageLabSlots({ childId, ideaId: ideaId || null });
      if (!mounted.current) return;
      if (!result.ok) {
        // ⚠ A MISSING IDEA IS ITS OWN MESSAGE. The picker used to substitute
        // `idea[0]` silently and record THAT as `source_idea_id` — money on a
        // different idea than the one selected, with the consent trail pointing
        // at the wrong one.
        setNotice({
          tone: "bad",
          text:
            result.reason === "unknown_idea"
              ? COPY.picker.unknownIdea
              : COPY.picker.unavailable,
        });
        if (result.reason === "unknown_idea") setIdeaId("");
        return;
      }
      // ⚠ INTO THE SLOT PANEL, NEVER INTO THE TEMPLATE. The textarea is untouched
      // by this call, which is the whole R16 arrangement.
      setSlotValues(result.slots);
      setExcluded(result.excluded);
      setSourceToken(result.provenance);
      // Re-sync the select to the idea the run will actually record.
      setIdeaId(result.ideaId ?? "");
      setDocGated(!result.docReadable);
      setScrubCovered(result.scrubCovered);
      setSlotsOpen(true);
      const notes: string[] = [COPY.picker.filled];
      if (result.substituted) notes.push(COPY.picker.substituted);
      if (result.emptySlots.length > 0) {
        notes.push(COPY.picker.emptySlots(result.emptySlots));
      }
      setNotice({
        tone: result.emptySlots.length > 0 ? "warn" : "ok",
        text: notes.join(" "),
      });
    } catch (e) {
      console.error("[image-lab/composer] slot fill threw:", e);
      setNotice({ tone: "bad", text: COPY.picker.unavailable });
    }
  }

  // ── The run ────────────────────────────────────────────────────────────────

  const forgetRun = useCallback(() => {
    setRunId(null);
    setRunModelIds([]);
    setRunPrompt(null);
    setCells([]);
    try {
      window.sessionStorage.removeItem(RUN_ID_STORAGE_KEY);
    } catch {
      /* nothing to forget */
    }
  }, []);

  const refreshCells = useCallback(async (id: string) => {
    try {
      const result = await loadImageLabRunCells({ runId: id });
      if (!mounted.current) return;
      if (!result.ok) {
        // The run is gone, or belongs to someone else. Stop watching it rather
        // than polling a 404 forever.
        if (result.reason === "not_found") forgetRun();
        return;
      }
      // ⚠ SIGN MATTERS, and the arithmetic is a tested pure function for exactly
      // that reason: getting it backwards offers Retry on a running vendor call.
      clockOffsetMs.current = clockOffsetFor(result.serverNowMs, Date.now());
      setCells(result.cells);
      setRunModelIds(result.modelIds);
      setRunPrompt(result.resolvedPrompt);
      setServerNowMs(serverNowFrom(clockOffsetMs.current, Date.now()));
    } catch (e) {
      console.error("[image-lab/composer] cell refresh threw:", e);
    }
  }, [forgetRun]);

  /** Re-attach to the restored run's rows once, on mount. */
  const restoredRunId = useRef(runId);
  useEffect(() => {
    if (restoredRunId.current !== null) void refreshCells(restoredRunId.current);
  }, [refreshCells]);

  /**
   * ⚠ THE RECOVERY LOOP WAS UNREACHABLE WITHOUT THIS.
   *
   * `serverNowMs` was written only at createRun and at an explicit refresh, and
   * there was no poll, no manual refresh and no ticking clock — so a cell left
   * pending could NEVER reach staleness, Retry stayed disabled forever, and the
   * fan looked hung for four or five minutes. That is what drove the reload that
   * lost the run and re-minted the idempotency key.
   */
  /**
   * ⚠ AND THE LOOP IS BOUNDED. A run naming a reference whose object has gone can
   * never finalize any cell (see {@link IMAGE_LAB_MAX_IDLE_POLLS}), and this used
   * to poll it — run read, cell read, a signed-URL mint per stored image — every
   * five seconds forever, surviving reloads via the stored run id. The counter is
   * reset by any change to what the grid actually shows.
   */
  const fingerprint = useMemo(() => cellsFingerprint(cells), [cells]);
  const idlePolls = useRef(0);
  const lastFingerprint = useRef(fingerprint);
  useEffect(() => {
    if (lastFingerprint.current === fingerprint) idlePolls.current += 1;
    else {
      idlePolls.current = 0;
      lastFingerprint.current = fingerprint;
    }
  }, [fingerprint]);

  useEffect(() => {
    if (runId === null || !shouldPollCells(cells, idlePolls.current)) return;
    const timer = setInterval(() => {
      void refreshCells(runId);
    }, IMAGE_LAB_CELL_POLL_MS);
    return () => clearInterval(timer);
  }, [runId, cells, fingerprint, refreshCells]);

  /**
   * One request per cell.
   *
   * The await is `IMAGE_LAB_CLIENT_AWAIT_MS` — deliberately LONGER than the
   * route's own budget, so the browser can never be the first to give up on a
   * call the vendor is still billing for.
   */
  const generateOne = useCallback(async (imageId: string): Promise<GenerateCellOutcome> => {
    setBusyIds((prev) => new Set(prev).add(imageId));
    try {
      const response = await fetch("/staff/image-lab/api/generate-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
        // ⚠ CREATED AT DISPATCH, never up front. Twelve signals minted at t=0
        // start counting while their requests are still queued behind the
        // six-per-host cap — which inverts the client-await > route-budget
        // inequality and makes duplicate spend the designed behaviour. The fan
        // is bounded (IMAGE_LAB_CLIENT_FAN_CONCURRENCY) so this line runs when
        // the request actually goes out.
        signal: AbortSignal.timeout(IMAGE_LAB_CLIENT_AWAIT_MS),
      });
      const body = (await response.json()) as { outcome?: GenerateCellOutcome };
      return body.outcome ?? { kind: "unavailable" };
    } catch (e) {
      // ⚠ OUR OWN TIMEOUT IS RETRY-WITH-STATE-INTACT, NOT A FAILURE. The row is
      // latched server-side and the server may still finalize it; the grid will
      // show whatever actually happened on the next refresh, and Retry stays
      // disabled until the staleness window closes.
      console.error("[image-lab/composer] generate request failed:", e);
      return { kind: "unavailable" };
    } finally {
      if (mounted.current) {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
      }
    }
  }, []);

  async function onGenerate() {
    if (!affordance.enabled || !decision.ok) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const idempotencyKey = resolveIdempotencyKey(
        browserIdempotencyStore(),
        compositionSignature,
        () => crypto.randomUUID()
      );

      const created = await createImageLabRun({
        idempotencyKey,
        template,
        slotValues,
        modelIds,
        imageCount,
        referenceIds,
        sourceToken,
        promptModes,
      });
      // ⚠ THE KEY IS RELEASED THE MOMENT THE SERVER HAS ANSWERED, AND BEFORE THE
      // mounted check, so a staff member who navigated away is not left holding a
      // key that makes their next identical compose a no-op. See
      // {@link releaseIdempotencyKey}: without this, the same prompt could never
      // be run twice in a session — which IS the consistency drill.
      releaseIdempotencyKey(browserIdempotencyStore(), compositionSignature);
      if (!mounted.current) return;
      if (!created.ok) {
        // ⚠ SAY WHICH REFUSAL IT ACTUALLY WAS. Every server refusal used to
        // render as "Pick at least one model" — telling a staff member to select
        // models they had already selected, about a bound they had not hit.
        setNotice({
          tone: "bad",
          text:
            "refusal" in created
              ? describeCompositionRefusal(created.refusal)
              : created.reason === "cooldown"
                ? COPY.outcomes.cooldown(IMAGE_LAB_CELL_POLL_MS)
                : COPY.outcomes.unavailable,
        });
        return;
      }

      setRunId(created.run.id);
      // ⚠ THE RUN'S OWN COLUMNS AND ITS OWN PROMPT, captured here so neither the
      // grid nor the preview can be re-narrated by a later chip toggle.
      setRunModelIds(modelIdsFromCells(created.cells));
      setRunPrompt(created.run.resolvedPrompt);
      try {
        window.sessionStorage.setItem(RUN_ID_STORAGE_KEY, created.run.id);
      } catch {
        /* A reload will lose the run; the grid still works in this tab. */
      }
      // The freshly minted rows, as the grid sees them: no storage key ever
      // reaches the client, and nothing is stored yet.
      setCells(
        created.cells.map((cell) => ({
          id: cell.id,
          runId: cell.runId,
          modelId: cell.modelId,
          cellOrdinal: cell.cellOrdinal,
          state: cell.state,
          attemptedAtMs: cell.attemptedAtMs,
          createdAtMs: cell.createdAtMs,
          failureReason: cell.failureReason,
          failureDetail: cell.failureDetail,
          billed: cell.billed,
          costEstimatedUsd: cell.costEstimatedUsd,
          costReportedUsd: cell.costReportedUsd,
          resolvedPrompt: cell.resolvedPrompt,
          promptDerived: cell.promptDerived,
          hasObject: false,
          signedUrl: null,
        }))
      );
      setServerNowMs(serverNow());
      setNotice({
        tone: created.duplicate ? "warn" : "ok",
        text: created.duplicate ? COPY.runDuplicate : COPY.runCreated,
      });

      // ⚠ ON A DUPLICATE, FAN ONLY WHAT IS STILL `requested`. Re-fanning a run
      // whose cells are already finalized burns twelve of the thirty-per-five-
      // minutes cooldown for zero work, and overwrites the dedupe notice with
      // "That cell is already finished" as though it were an error.
      const pending = created.duplicate
        ? created.cells.filter((cell) => cell.state === "requested")
        : created.cells;

      // The fan, BOUNDED. Failures are per cell — one model's failure never
      // blanks a run.
      const outcomes = await runWithConcurrency(
        pending,
        IMAGE_LAB_CLIENT_FAN_CONCURRENCY,
        (cell) => generateOne(cell.id)
      );
      if (!mounted.current) return;
      const firstBad = outcomes.find((outcome) => outcome.kind !== "done");
      if (firstBad) {
        setNotice({ tone: "warn", text: describeGenerateOutcome(firstBad) });
      }
      await refreshCells(created.run.id);
    } catch (e) {
      console.error("[image-lab/composer] compose threw:", e);
      if (mounted.current) setNotice({ tone: "bad", text: COPY.outcomes.unavailable });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  async function onRetry(imageId: string) {
    try {
      const appended = await retryImageLabCell({ imageId });
      if (!mounted.current) return;
      if (!appended.ok) {
        setNotice({ tone: "warn", text: describeGenerateOutcome(appended.outcome) });
        return;
      }
      if (runId) await refreshCells(runId);
      const outcome = await generateOne(appended.imageId);
      if (!mounted.current) return;
      if (outcome.kind !== "done") {
        setNotice({ tone: "warn", text: describeGenerateOutcome(outcome) });
      }
      if (runId) await refreshCells(runId);
    } catch (e) {
      console.error("[image-lab/composer] retry threw:", e);
      if (mounted.current) setNotice({ tone: "bad", text: COPY.outcomes.unavailable });
    }
  }

  /** Generate the EXISTING row for a cell nothing has ever attempted. */
  async function onGenerateCell(imageId: string) {
    const outcome = await generateOne(imageId);
    if (!mounted.current) return;
    if (outcome.kind !== "done") {
      setNotice({ tone: "warn", text: describeGenerateOutcome(outcome) });
    }
    if (runId) await refreshCells(runId);
  }

  const toggleModel = (id: string) =>
    setModelIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );

  // ── Sections ───────────────────────────────────────────────────────────────

  const sections: Record<ImageLabComposerSection, React.ReactNode> = {
    template: (
      <section key="template" className="mt-6">
        <label className="flex flex-col gap-1 text-sm text-hq-ink">
          {COPY.composer.template.label}
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={5}
            className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface p-3 text-sm text-hq-ink"
          />
          <span className="text-xs text-hq-ink-soft">{COPY.composer.template.hint}</span>
        </label>
      </section>
    ),

    slots: (
      <section key="slots" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-path-display text-sm text-hq-ink">
            {COPY.composer.slots.heading}
          </h3>
          <button
            type="button"
            onClick={() => setSlotsOpen((open) => !open)}
            className="min-h-11 rounded-lg border border-hq-border px-3 text-sm text-hq-ink"
          >
            {slotsOpen ? COPY.composer.slots.hide : COPY.composer.slots.show}
          </button>
        </div>

        {slotsOpen && (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-hq-ink-soft">{COPY.composer.slots.manualHint}</p>

            {pickerLive ? (
              <div className="flex flex-col gap-2 rounded-xl border border-hq-border bg-hq-surface p-3">
                <h4 className="font-path-display text-sm text-hq-ink">
                  {COPY.picker.heading}
                </h4>
                <label className="flex flex-col gap-1 text-sm text-hq-ink">
                  {COPY.picker.childLabel}
                  <select
                    value={childId}
                    onChange={(e) => {
                      setChildId(e.target.value);
                      // A different child's ideas are a different list; leaving
                      // the old one up invites filling slots from the wrong one.
                      setIdeas([]);
                      setIdeaId("");
                    }}
                    className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface px-2 text-sm text-hq-ink"
                  >
                    <option value="">—</option>
                    {children.map((child) => (
                      <option key={child.childId} value={child.childId}>
                        {child.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-hq-ink">
                  {COPY.picker.ideaLabel}
                  <select
                    value={ideaId}
                    onChange={(e) => setIdeaId(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface px-2 text-sm text-hq-ink"
                  >
                    <option value="">—</option>
                    {ideas.map((idea) => (
                      <option key={idea.ideaId} value={idea.ideaId}>
                        {idea.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void onFillSlots()}
                  className="min-h-11 rounded-lg border border-crm-blue px-3 text-sm font-medium text-hq-ink"
                >
                  {COPY.picker.load}
                </button>
                {/* ⚠ NEVER ASSERT A PROTECTION THAT DID NOT RUN. */}
                <p className="text-pretty text-xs text-hq-ink-soft">
                  {scrubCovered ? COPY.picker.scrubNote : COPY.picker.scrubNotCovered}
                </p>
                {children.length === 0 && (
                  <p className="text-xs text-hq-ink-soft">{COPY.picker.noChildren}</p>
                )}
                {/* A doc we DECLINED to read is not a child with nothing saved —
                    and saying so is what stops a staff member retyping the
                    content by hand, which bypasses the scrub entirely. */}
                {docGated ? (
                  <p className="text-pretty text-xs text-hq-ink">
                    {COPY.picker.docGated}
                  </p>
                ) : (
                  childId !== "" &&
                  ideas.length === 0 && (
                    <p className="text-xs text-hq-ink-soft">{COPY.picker.noIdeas}</p>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-hq-border-strong bg-hq-surface p-3">
                <p className="font-path-display text-sm text-hq-ink">
                  {COPY.picker.disabled.headline}
                </p>
                <p className="mt-1 text-pretty text-sm text-hq-ink-soft">
                  {COPY.picker.disabled.body}
                </p>
              </div>
            )}

            {IMAGE_LAB_SLOTS.map((slot) => (
              <label key={slot} className="flex flex-col gap-1 text-sm text-hq-ink">
                {`{{${slot}}}`}
                <textarea
                  value={slotValues[slot] ?? ""}
                  onChange={(e) =>
                    setSlotValues((prev) => ({ ...prev, [slot]: e.target.value }))
                  }
                  rows={2}
                  className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface p-2 text-sm text-hq-ink"
                />
              </label>
            ))}

            {/* ⚠ AN EXCLUDED FIELD RENDERS AS A CHIP, NEVER AS A BLANK. A blank
                reads as a missing value, and a staff member helpfully types it
                back in — reintroducing exactly what the exclusion removed. */}
            {excluded.length > 0 && (
              <ul className="flex flex-col gap-1">
                {excluded.map((field) => (
                  <li key={field.field} className="text-pretty text-xs text-hq-ink-soft">
                    <span className="mr-2 rounded border border-hq-border-strong px-2 py-0.5 text-xs text-hq-ink">
                      {COPY.composer.slots.excludedChip}
                    </span>
                    {COPY.composer.slots.excludedNote(field.field, field.why)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    ),

    preview: (
      <section key="preview" className="mt-6">
        {/* ⚠ ONCE A RUN EXISTS, THIS STOPS DESCRIBING WHAT GETS SENT. Retry
            re-sends the RUN's stored prompt while this tracks the live template,
            and the heading above calls the preview "the last check before
            child-authored content leaves for a vendor" — so an unlabelled
            preview is the one lie this surface must not tell. Labelled as the
            NEXT run; the run's own prompt is shown with its results. */}
        <h3 className="font-path-display text-sm text-hq-ink">
          {runId === null
            ? COPY.composer.preview.heading
            : COPY.composer.preview.nextRunHeading}
        </h3>
        <p className="mt-1 text-xs text-hq-ink-soft">
          {runId === null
            ? COPY.composer.preview.hint
            : COPY.composer.preview.nextRunHint}
        </p>
        {/* ⚠ ONE BLOCK PER MODEL, AND THE TEXT COMES FROM `previewRows` — the
            SAME pure function whose output `run-rules.test.ts` pins against the
            `resolved_prompt` `createRun` writes on the image rows. A `.tsx` that
            re-derived the string inline would put this surface outside every
            test in the repo, which for "the last check before child-authored
            content leaves for a vendor" is not a trade worth making. */}
        {previewRows(decision).length === 0 ? (
          <pre className="mt-2 w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-hq-border bg-hq-surface p-3 text-sm text-hq-ink">
            {previewPromptText(decision)}
          </pre>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {previewRows(decision).map((row) => (
              <li key={row.modelId}>
                <p className="flex flex-wrap items-baseline gap-2 text-xs text-hq-ink">
                  <span className="font-path-mono">{row.modelId}</span>
                  <span className="rounded border border-hq-border-strong px-2 py-0.5">
                    {row.derived
                      ? COPY.composer.preview.derivedBadge
                      : COPY.composer.preview.authoredBadge}
                  </span>
                </p>
                {row.note !== "" && (
                  <p className="mt-1 text-pretty text-xs text-hq-ink-soft">
                    {row.note}
                  </p>
                )}
                <pre className="mt-1 w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-hq-border bg-hq-surface p-3 text-sm text-hq-ink">
                  {row.text}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),

    references: (
      <section key="references">
        {/* CONTROLLED by this composer: the picker reports its selection up, and
            takes the chosen models so its budget is the STRICTEST of them. */}
        <ReferenceLibrary
          modelIds={modelIds}
          selectedIds={referenceIds}
          onSelectionChange={setReferenceIds}
        />
      </section>
    ),

    models: (
      <section key="models" className="mt-6">
        <h3 className="font-path-display text-sm text-hq-ink">
          {COPY.composer.models.heading}
        </h3>
        <p className="mt-1 text-xs text-hq-ink-soft">{COPY.composer.models.hint}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {IMAGE_LAB_MODELS.map((entry) => {
            const picked = modelIds.includes(entry.id);
            // ⚠ THE CONTROL IS DISABLED, AND THE SERVER STILL REFUSES. Disabling
            // is courtesy — `decideChildTextGate` runs on the paid path against a
            // crafted request, which is where the rule actually lives.
            const lockedToDerived =
              childProvenance && entry.provider === "openai";
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => toggleModel(entry.id)}
                  aria-pressed={picked}
                  className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm text-hq-ink ${
                    picked ? "border-crm-blue" : "border-hq-border"
                  }`}
                >
                  <span className="block">{modelSummaryLine(entry)}</span>
                  {/* ⚠ THE UNVERIFIED BADGE, ACTUALLY MOUNTED. `unverifiedItems`
                      claimed in its own docblock to drive "an honest badge on the
                      bench" and had no caller at all — while `personGeneration`
                      (two of three models) and gpt-image-2's reference carriage
                      are both still open, and either can make a model look worse
                      than it is in the head-to-head this bench exists to run.
                      The rule is pure and tested in `run-rules.test.ts`. */}
                  {describeUnverified(entry) !== "" && (
                    <span className="mt-1 block text-pretty text-xs text-hq-ink">
                      {describeUnverified(entry)}
                    </span>
                  )}
                  {entry.restrictions?.map((restriction) => (
                    <span
                      key={restriction}
                      className="mt-1 block text-pretty text-xs text-hq-ink-soft"
                    >
                      {restriction}
                    </span>
                  ))}
                </button>

                {/* ⚠ THE PROMPT CHOICE LIVES ON THE MODEL, because the prompt is
                    a per-model experiment — that is the feature, not a
                    concession. It is shown only for a SELECTED model: an unused
                    chip's prompt choice is noise, and the run records nothing
                    about it. */}
                {picked && (
                  <label className="mt-2 flex flex-col gap-1 pl-1 text-xs text-hq-ink">
                    {COPY.composer.preview.modeLabel}
                    <select
                      value={promptModeFor(entry.id, childProvenance, promptModes)}
                      disabled={lockedToDerived}
                      onChange={(e) =>
                        setPromptModes((prev) => ({
                          ...prev,
                          [entry.id]: e.target.value as ImageLabPromptMode,
                        }))
                      }
                      className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface px-2 text-sm text-hq-ink disabled:opacity-60"
                    >
                      <option value="authored">
                        {COPY.composer.preview.modeAuthored}
                      </option>
                      <option value="derived">
                        {COPY.composer.preview.modeDerived}
                      </option>
                    </select>
                    {lockedToDerived && (
                      <span className="text-pretty text-hq-ink-soft">
                        {COPY.composer.preview.lockedNote}
                      </span>
                    )}
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-2 text-xs text-hq-ink-soft">
          {modelIds.length > 1
            ? COPY.composer.models.compareOn
            : modelIds.length === 1
              ? COPY.composer.models.compareOffSingle
              : COPY.refusals.noModels}
        </p>

        <label className="mt-3 flex flex-col gap-1 text-sm text-hq-ink">
          {COPY.composer.models.countLabel}
          <select
            value={imageCount}
            onChange={(e) => setImageCount(Number(e.target.value))}
            className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface px-2 text-sm text-hq-ink sm:w-40"
          >
            {Array.from({ length: IMAGE_LAB_MAX_IMAGE_COUNT }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {decision.ok && cost && (
          <p className="mt-2 text-sm text-hq-ink-soft">
            {COPY.composer.models.costLine(formatUsd(cost.totalUsd), decision.cells.length)}
          </p>
        )}
      </section>
    ),

    generate: (
      <section key="generate" className="mt-6">
        {affordance.warnings.map((warning) => (
          <p key={warning} className="mb-2 text-pretty text-sm text-hq-ink">
            {warning}
          </p>
        ))}
        {affordance.blocker && (
          <p className="mb-2 text-pretty text-sm text-hq-ink">{affordance.blocker}</p>
        )}
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={!affordance.enabled}
          className="min-h-11 w-full rounded-lg border border-crm-blue px-4 text-sm font-medium text-hq-ink disabled:opacity-60 sm:w-auto"
        >
          {affordance.label}
        </button>
        {notice && (
          <p role="status" className="mt-3 text-pretty text-sm text-hq-ink">
            {notice.text}
          </p>
        )}
      </section>
    ),

    results: (
      <section key="results" className="mt-6">
        <h3 className="font-path-display text-sm text-hq-ink">{COPY.grid.heading}</h3>
        {/* THE PROMPT THIS RUN ACTUALLY SENT, beside the results it produced —
            so the live preview above can never be mistaken for what Retry
            re-sends. */}
        {runPrompt !== null && (
          <>
            <p className="mt-2 font-path-display text-sm text-hq-ink">
              {COPY.grid.sentPromptHeading}
            </p>
            <p className="mt-1 text-xs text-hq-ink-soft">
              {COPY.composer.preview.sentHint}
            </p>
            <pre className="mt-2 w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-hq-border bg-hq-surface p-3 text-sm text-hq-ink">
              {runPrompt}
            </pre>
          </>
        )}
        {/* ⚠ THE LIVE REGION IS THIS SENTENCE, NOT THE GRID.
            It used to be a `<div aria-live="polite">` wrapped around
            `<ResultGrid>` itself, which made every mutation inside the grid an
            announcement: twelve cards of headings, cost lines and failure prose
            re-read on each poll tick, and again whenever a Retry button's
            `disabled` flipped. The one fact a reviewer is waiting for — a cell
            finished — was unhearable through that. `describeCellProgress` is a
            tested pure rule in `run-rules`; React only touches this text node
            when the sentence actually changes, so an unchanged poll is silent. */}
        <p aria-live="polite" className="sr-only">
          {describeCellProgress(cells, serverNowMs)}
        </p>
        <div>
          <ResultGrid
            cells={cells}
            // ⚠ THE RUN'S list, not the live chips — see ResultGrid's docblock.
            modelIds={runModelIds}
            serverNowMs={serverNowMs}
            busyIds={busyIds}
            onRetry={(imageId) => void onRetry(imageId)}
            onGenerate={(imageId) => void onGenerateCell(imageId)}
          />
        </div>
      </section>
    ),
  };

  return (
    <div className="mt-8 flex flex-col">
      <h2 className="font-path-display text-base text-hq-ink">
        {COPY.composer.heading}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-hq-ink-soft">
        {COPY.composer.intro}
      </p>
      {/* ⚠ ORDER COMES FROM THE TESTED CONSTANT, not from the paste order of the
          JSX above. One column at every breakpoint. */}
      {IMAGE_LAB_COMPOSER_SECTIONS.map((id) => sections[id])}
    </div>
  );
}
