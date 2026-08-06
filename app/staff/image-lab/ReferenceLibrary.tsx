"use client";

/**
 * Image Lab — the reference picker
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4; origin R6 and R13).
 *
 * Upload a character sheet or style sample ONCE, then attach it to any run —
 * which is what makes the consistency drill ("one hero sheet, N prompts, per
 * model") a thing you can actually run rather than a file you re-attach and
 * hope is the same one.
 *
 * ── WHY THIS IS A CLIENT COMPONENT ─────────────────────────────────────────
 * Because the bytes must never traverse our origin. A Vercel function request
 * body caps around 4.5 MB, far below a character sheet, so the browser uploads
 * DIRECT to Storage on a server-minted signed slot. That is a browser-side
 * transfer with progress and retries, and it needs the file handle.
 *
 * ⚠ THE UPLOAD LEGS ARE NOT REIMPLEMENTED HERE. `uploadWithSlot`
 * (app/fp/lib/upload-client.ts) is the shipped, reviewed implementation of the
 * plain-PUT-under-6MiB / TUS-at-or-above split AND of the already-exists→success
 * mapping, which is genuinely different per leg: storage-js parses a duplicate
 * into `StorageApiError.statusCode`, while tus-js-client's `DetailedError`
 * exposes only the outer HTTP 400 with the 409 buried in a body it never parses.
 * A Lab-local copy of that would be a second implementation of a mapping this
 * repo has already paid to discover twice.
 *
 * ── THE THREE THINGS THAT MAKE A RETRY SAFE ────────────────────────────────
 * The table is append-only, so a duplicate row is permanent and a lost upload is
 * 25 MB nobody can name. All three of these are load-bearing:
 *
 *   1. THE SLOT IS HELD IN STATE AND REUSED. Minting a fresh key on every
 *      submit meant every retry left a SECOND full-size object in the bucket
 *      with one row and no sweeper — and made the server's 23505 duplicate
 *      re-read unreachable from this UI, because two attempts never shared a
 *      key. It is cleared only when the chosen file changes or the upload lands.
 *   2. A FAILED TRANSFER STILL ATTEMPTS REGISTRATION. `uploadWithSlot` reports
 *      `retry` for any thrown transport error, including one thrown after the
 *      bytes landed and the final ack was lost. `statObject` is the arbiter of
 *      whether an object exists, not the browser.
 *   3. NOTHING AFTER A SUCCESSFUL REGISTER MAY CLAIM NOTHING WAS SAVED. The
 *      grid refresh happens OUTSIDE the upload's try block: it re-enters the
 *      gate, which can throw on a slow session read (a 25 MB upload is exactly
 *      that long a window), and overwriting "Reference added." with "Nothing was
 *      saved — try again" over a cleared form is how a second permanent row gets
 *      created by a staff member doing what they were told.
 *
 * ── MOBILE (~390px) ────────────────────────────────────────────────────────
 * The grid is `grid-cols-1` at base and widens at `sm`/`lg`, so thumbnails
 * stack in one column on a phone and nothing scrolls sideways. Every control —
 * the file field, the label field, the submit button, and each reference card —
 * is at least `min-h-11` (44px). THE SELECTION COUNT IS RENDERED AS TEXT beside
 * the heading, never as a `title` attribute or a hover badge, because there is
 * no hover on a phone and the count is the one thing that explains why the next
 * tap did nothing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { uploadWithSlot } from "@/app/lib/fp/upload-client";
import {
  listReferenceLibrary,
  mintReferenceUploadSlot,
  registerReferenceUpload,
} from "./lib/reference-actions";
import type {
  ReferenceListing,
  ReferenceSlot,
  ReferenceView,
} from "./lib/reference-core";
import {
  clampReferenceSelection,
  decideReferenceRefresh,
  decideReferenceUpload,
  formatMegabytes,
  IMAGE_LAB_ACCEPTED_MIME_TYPES_ATTR,
  IMAGE_LAB_REFERENCE_COPY,
  IMAGE_LAB_REFERENCE_LIST_LIMIT,
  refImageLimitFor,
  reduceUploadStep,
  toggleReferenceSelection,
  uploadButtonLabel,
  type UploadEvent,
  type UploadStepState,
} from "./lib/reference-rules";

/** How often the picker asks whether a re-listing is due. The row is
 *  append-only, so a URL cannot be cached on it and the reader owns freshness —
 *  see `decideReferenceRefresh`, which also decides when NOT to ask. */
const FRESHNESS_POLL_MS = 60_000;

/** A listed reference plus the deadline THIS BROWSER computed for it. The
 *  server sends a lifetime; the clock that judges it has to be the one that
 *  will later read it. */
type Card = ReferenceView & { expiresAtMs: number | null };

/** The minted slot, held for the life of the form, with the file it belongs
 *  to. Reusing a slot for a DIFFERENT file would upload the new bytes under the
 *  old key — which upsert-disabled storage refuses — so the identity is checked. */
type HeldSlot = {
  slot: Extract<ReferenceSlot, { ok: true }>;
  fileKey: string;
};

const fileKeyOf = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const IDLE: UploadStepState = { phase: "idle", notice: null };

/**
 * Every awaited action call goes through here.
 *
 * `requireStaff()` does not only return a typed refusal — it can THROW
 * (`IdentityUnavailableError` on a slow or expired session read, and Next's own
 * redirect control-flow throw). Awaiting the listing action bare left `loading`
 * true and `loadError` null forever: the empty state and the error block are
 * both suppressed by that pair, so the picker rendered a blank grid with no
 * message, and the sixty-second poll emitted an unhandled rejection every minute
 * for the life of the tab. Folding the throw into the action's own refusal shape
 * is what makes `loadFailed` reachable for the one failure the contract admits.
 */
async function listSafely(): Promise<ReferenceListing> {
  try {
    return await listReferenceLibrary();
  } catch (e) {
    console.error("[image-lab/reference] listing threw:", e);
    return { ok: false, reason: "unavailable" };
  }
}

export function ReferenceLibrary({
  modelIds = [],
  selectedIds,
  onSelectionChange,
}: {
  /** The models chosen for this run. The budget is the STRICTEST of them; with
   *  none chosen (the state the bench opens in) it is the strictest in the
   *  registry, so a selection made now stays legal whatever is picked later. */
  modelIds?: readonly string[];
  /** Controlled selection (Unit 5's composer owns it); omit to self-manage. */
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  const limit = refImageLimitFor(modelIds);

  const [references, setReferences] = useState<Card[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failedMintRounds, setFailedMintRounds] = useState(0);
  const [lastListedAtMs, setLastListedAtMs] = useState<number | null>(null);

  const [ownSelection, setOwnSelection] = useState<string[]>([]);
  const rawSelection = selectedIds ?? ownSelection;
  const selection = useMemo(
    () => clampReferenceSelection(rawSelection, limit),
    [rawSelection, limit]
  );

  const [label, setLabel] = useState("");
  const [{ phase, notice }, setStep] = useState<UploadStepState>(IDLE);
  const [held, setHeld] = useState<HeldSlot | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const transfer = useRef<Upload | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // An abandoned TUS transfer otherwise leaves an incomplete multipart no
      // bucket-vs-row reconciliation can see.
      transfer.current?.abort().catch(() => {});
      transfer.current = null;
    };
  }, []);

  /**
   * REQUEST SEQUENCING. The poll and a post-registration refresh can be in
   * flight together, and the poll started first can land last — erasing the card
   * that was just added while "Reference added." is still on screen. A listing
   * older than the newest one already applied is dropped.
   */
  const nextSeq = useRef(0);
  const appliedSeq = useRef(-1);

  const applyListing = useCallback((result: ReferenceListing, seq: number) => {
    if (seq < appliedSeq.current) return;
    appliedSeq.current = seq;
    const receivedAtMs = Date.now();
    setLastListedAtMs(receivedAtMs);
    if (!result.ok) {
      setLoadError(IMAGE_LAB_REFERENCE_COPY.loadFailed);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setReferences(
      result.references.map((reference) => ({
        ...reference,
        // The lifetime the server measured, anchored to THIS clock at receipt.
        expiresAtMs:
          reference.signedUrlExpiresInMs === null
            ? null
            : receivedAtMs + reference.signedUrlExpiresInMs,
      }))
    );
    setTotalCount(result.totalCount);
    // A round with any missing URL is a failed-mint round; a clean one resets
    // the backoff so a transient storage blip does not spend the retry budget.
    setFailedMintRounds((rounds) =>
      result.references.some((r) => r.signedUrl === null) ? rounds + 1 : 0
    );
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const seq = nextSeq.current++;
    const result = await listSafely();
    if (mounted.current) applyListing(result, seq);
  }, [applyListing]);

  // The first load. The picker has nothing to show until it reaches an external
  // system (the gated listing action), which is exactly what an effect is for —
  // and every state write lands AFTER the await, so this body sets nothing
  // synchronously and triggers no cascading render.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Signed URLs expire; an unsigned request to this private bucket 403s, so a
  // stale thumbnail is a broken image rather than a slow one. The DECISION —
  // near-expiry versus a failed mint that must be backed off and capped rather
  // than retried sixty times a minute forever — is `decideReferenceRefresh`.
  useEffect(() => {
    const timer = setInterval(() => {
      const decision = decideReferenceRefresh({
        references,
        nowMs: Date.now(),
        failedMintRounds,
        lastListedAtMs,
      });
      if (decision.refresh) void refresh();
    }, FRESHNESS_POLL_MS);
    return () => clearInterval(timer);
  }, [references, failedMintRounds, lastListedAtMs, refresh]);

  const commitSelection = useCallback(
    (ids: string[]) => {
      if (!selectedIds) setOwnSelection(ids);
      onSelectionChange?.(ids);
    },
    [selectedIds, onSelectionChange]
  );

  /**
   * ⚠ THE CLAMP IS REPORTED, NOT JUST RENDERED.
   *
   * Switching from the Gemini pair (limit 11) to gpt-image-2 (limit 4) with
   * eleven references picked used to render "4 of 4 selected" while the owner of
   * the selection still held eleven — and Generate would send eleven refs to a
   * model that accepts four, the exact silent truncation `refImageLimitFor`
   * exists to prevent, concealed by the counter that was supposed to reveal it.
   *
   * Loop-guarded by the reported signature rather than by length alone, so a
   * controlled parent that declines the repair is told once, not every render.
   */
  const reportedClamp = useRef<string | null>(null);
  const clampSignature = selection.join(",");
  useEffect(() => {
    if (selection.length === rawSelection.length) {
      reportedClamp.current = null;
      return;
    }
    if (reportedClamp.current === clampSignature) return;
    reportedClamp.current = clampSignature;
    commitSelection(selection);
  }, [selection, rawSelection.length, clampSignature, commitSelection]);

  const step = (event: UploadEvent) => setStep(reduceUploadStep(event));

  const onToggle = (id: string) => {
    const result = toggleReferenceSelection({ selectedIds: selection, id, limit });
    if (!result.ok) {
      setStep({
        phase: "idle",
        notice: {
          tone: "bad",
          text: IMAGE_LAB_REFERENCE_COPY.picker.limitReached(result.limit),
        },
      });
      return;
    }
    setStep(IDLE);
    commitSelection(result.selectedIds);
  };

  /** A new file invalidates the held slot: its key is bound to the old bytes. */
  const onFileChange = () => {
    setHeld(null);
    setStep(IDLE);
  };

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;

    const file = fileInput.current?.files?.[0];
    if (!file) {
      // Previously a silent no-op: no notice, no phase change, nothing to react
      // to on a phone where the file chooser may not have committed.
      step({ type: "submitted_without_file" });
      return;
    }

    // Refuse locally FIRST, from the same pure rule the server applies, so an
    // over-cap sheet is named-and-refused before 25 MB leave a laptop.
    const decision = decideReferenceUpload({
      declaredContentType: file.type,
      sizeBytes: file.size,
      label,
    });
    if (!decision.ok) {
      step({ type: "refused_locally", refusal: decision });
      return;
    }

    setStep({ phase: "preparing", notice: null });
    try {
      // ⚠ REUSED, NOT REMINTED. A retry has to land on the SAME key or it is a
      // second upload of the same sheet.
      const fileKey = fileKeyOf(file);
      let slot = held && held.fileKey === fileKey ? held.slot : null;
      if (!slot) {
        const minted = await mintReferenceUploadSlot({
          contentType: file.type,
          sizeBytes: file.size,
          label,
        });
        if (!minted.ok) {
          step({ type: "slot_refused", refusal: minted });
          return;
        }
        slot = minted;
        setHeld({ slot: minted, fileKey });
      }

      step({ type: "slot_minted" });
      const transferred = await uploadWithSlot({
        slot:
          slot.strategy === "plain"
            ? {
                strategy: "plain",
                bucket: slot.bucket,
                objectPath: slot.storageKey,
                token: slot.token,
              }
            : {
                strategy: "tus",
                bucket: slot.bucket,
                objectPath: slot.storageKey,
                token: slot.token,
                endpoint: slot.endpoint,
                chunkSize: slot.chunkSize,
              },
        file,
        // The type the RULES accepted, canonicalized — not the raw `File.type`.
        // It sets the object's type, which the bucket allowlist then vets and
        // which registration reads back as the row's pinned type.
        contentType: slot.contentType,
        isMounted: () => mounted.current,
        // A 25 MB phone upload with no progress reads as a hung page.
        onProgress: (percent) => {
          if (mounted.current) step({ type: "transfer_progressed", percent });
        },
        registerUpload: (upload) => {
          transfer.current = upload;
        },
      });
      if (transferred.outcome !== "success") {
        // NOT a return. `uploadWithSlot` cannot know whether the bytes landed —
        // a lost ack on a completed 25 MB PUT looks exactly like a failure — so
        // the message is shown and registration decides. `object_missing` is
        // what makes the failure real.
        step({ type: "transfer_failed", message: transferred.message });
      } else {
        setStep({ phase: "saving", notice: null });
      }

      const registered = await registerReferenceUpload({
        storageKey: slot.storageKey,
        label,
      });
      if (!registered.ok) {
        step({ type: "registration_refused", refusal: registered });
        return;
      }

      step({ type: "registered", duplicate: registered.duplicate });
      setHeld(null);
      setLabel("");
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      step({ type: "threw" });
      return;
    } finally {
      // The reducer settles the phase on every arm above; the live TUS handle
      // is the only thing this has to let go of.
      transfer.current = null;
    }

    // ⚠ OUTSIDE THE TRY, ON PURPOSE. `refresh()` re-enters the gate and can
    // throw; inside the try its failure would overwrite "Reference added." with
    // "Nothing was saved — try again" over a form that has already been cleared,
    // and the staff member would upload a second permanent row. The grid can be
    // stale for sixty seconds; the row cannot be un-created.
    await refresh();
  }

  /**
   * Selected ids the newest page does not contain.
   *
   * The table is append-only and unpaged: past row 60 a selection made earlier
   * can point at a reference that no longer renders. Without a row to tap, the
   * counter reads "4 of 4" over three cards and the fourth can never be
   * released — an unexitable state. These render as de-selectable stubs.
   */
  const unlistedSelection = selection.filter(
    (id) => !references.some((reference) => reference.id === id)
  );

  return (
    <section className="mt-8">
      <h3 className="font-path-display text-base text-hq-ink">
        {IMAGE_LAB_REFERENCE_COPY.heading}
      </h3>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-hq-ink-soft">
        {IMAGE_LAB_REFERENCE_COPY.intro}
      </p>

      {/* ⚠ Stated AT THE POINT OF UPLOAD, not in a help page: the table is
          append-only by trigger, so this is the one moment the warning can
          still change an outcome. */}
      <div className="mt-4 rounded-xl border border-hq-border-strong bg-hq-surface p-4">
        <p className="font-path-display text-sm text-hq-ink">
          {IMAGE_LAB_REFERENCE_COPY.permanence.headline}
        </p>
        <p className="mt-1 text-pretty text-sm leading-relaxed text-hq-ink-soft">
          {IMAGE_LAB_REFERENCE_COPY.permanence.body}
        </p>
      </div>

      <form onSubmit={onUpload} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-hq-ink">
          {IMAGE_LAB_REFERENCE_COPY.upload.fileLabel}
          <input
            ref={fileInput}
            type="file"
            required
            onChange={onFileChange}
            accept={IMAGE_LAB_ACCEPTED_MIME_TYPES_ATTR}
            className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface p-2 text-sm text-hq-ink"
          />
          <span className="text-xs text-hq-ink-soft">
            {IMAGE_LAB_REFERENCE_COPY.upload.accepted}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-hq-ink">
          {IMAGE_LAB_REFERENCE_COPY.upload.labelLabel}
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={IMAGE_LAB_REFERENCE_COPY.upload.labelPlaceholder}
            className="min-h-11 w-full rounded-lg border border-hq-border bg-hq-surface px-3 text-sm text-hq-ink"
          />
          <span className="text-xs text-hq-ink-soft">
            {IMAGE_LAB_REFERENCE_COPY.upload.labelHint}
          </span>
        </label>

        <button
          type="submit"
          disabled={phase !== "idle"}
          className="min-h-11 w-full rounded-lg border border-crm-blue px-4 text-sm font-medium text-hq-ink disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {uploadButtonLabel(phase)}
        </button>
      </form>

      {notice && (
        <p
          role="status"
          className={`mt-3 text-pretty text-sm ${notice.tone === "bad" ? "text-hq-ink" : "text-hq-ink-soft"}`}
        >
          {notice.text}
        </p>
      )}

      {/* The counter, as TEXT. Visible without hover, which is the only way it
          can be visible at 390px. */}
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-path-display text-sm text-hq-ink">
          {IMAGE_LAB_REFERENCE_COPY.picker.selectionLabel}
        </h4>
        <p className="text-sm text-hq-ink-soft">
          {IMAGE_LAB_REFERENCE_COPY.selectionCounter(selection.length, limit)}
        </p>
      </div>
      <p className="mt-1 text-xs text-hq-ink-soft">
        {IMAGE_LAB_REFERENCE_COPY.picker.limitNote(limit)}
      </p>

      {totalCount > references.length && (
        <p className="mt-1 text-xs text-hq-ink-soft">
          {IMAGE_LAB_REFERENCE_COPY.picker.showingSome(
            Math.min(references.length, IMAGE_LAB_REFERENCE_LIST_LIMIT),
            totalCount
          )}
        </p>
      )}

      {loadError && <p className="mt-3 text-sm text-hq-ink">{loadError}</p>}

      {!loading && !loadError && references.length === 0 && (
        <div className="mt-4 rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="font-path-display text-sm text-hq-ink">
            {IMAGE_LAB_REFERENCE_COPY.empty.headline}
          </p>
          <p className="mt-1 text-pretty text-sm text-hq-ink-soft">
            {IMAGE_LAB_REFERENCE_COPY.empty.body}
          </p>
        </div>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {unlistedSelection.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onToggle(id)}
              aria-pressed
              className="flex min-h-11 w-full flex-col gap-2 rounded-xl border border-crm-blue bg-hq-surface p-3 text-left"
            >
              <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-hq-border text-xs text-hq-ink-soft">
                {IMAGE_LAB_REFERENCE_COPY.picker.unlistedSelection}
              </span>
              <span className="text-sm text-hq-ink">
                {IMAGE_LAB_REFERENCE_COPY.picker.untitled}
              </span>
              <span className="text-xs text-hq-ink-soft">
                {IMAGE_LAB_REFERENCE_COPY.picker.selected}
              </span>
            </button>
          </li>
        ))}

        {references.map((reference) => {
          const picked = selection.includes(reference.id);
          return (
            <li key={reference.id}>
              <button
                type="button"
                onClick={() => onToggle(reference.id)}
                aria-pressed={picked}
                className={`flex min-h-11 w-full flex-col gap-2 rounded-xl border p-3 text-left ${
                  picked ? "border-crm-blue" : "border-hq-border"
                } bg-hq-surface`}
              >
                {reference.signedUrl ? (
                  // Plain <img>: the source is a short-lived SIGNED URL on a
                  // private bucket, so it cannot be a stable `next/image`
                  // remote pattern and the optimizer would cache a credential.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={reference.signedUrl}
                    alt={reference.label || IMAGE_LAB_REFERENCE_COPY.picker.untitled}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-hq-border text-xs text-hq-ink-soft">
                    {IMAGE_LAB_REFERENCE_COPY.picker.refreshing}
                  </span>
                )}
                <span className="text-sm text-hq-ink">
                  {reference.label || IMAGE_LAB_REFERENCE_COPY.picker.untitled}
                </span>
                <span className="text-xs text-hq-ink-soft">
                  {new Date(reference.createdAt).toLocaleDateString()} ·{" "}
                  {formatMegabytes(reference.byteSize)}
                </span>
                <span className="text-xs text-hq-ink-soft">
                  {picked
                    ? IMAGE_LAB_REFERENCE_COPY.picker.selected
                    : IMAGE_LAB_REFERENCE_COPY.picker.select}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
