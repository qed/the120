"use client";

/**
 * Direct-to-storage evidence uploader (T1 Unit 9, Decision 4). Requests a
 * metadata-only slot from the `requestUploadSlot` Server Action, then uploads the
 * bytes DIRECT to Supabase Storage — plain PUT under 6 MB, resumable/TUS above,
 * authorized by the server-minted token so no session is needed for the upload
 * leg. Bytes never traverse our origin.
 *
 * This is the generic uploader. The confirm step (inserting the EvidenceItem row
 * keyed on the client `evidenceId`) is Unit 10; this component hands the storage
 * ref up via `onUploaded`. There is no route mounting it until Unit 14, and no
 * student session until Unit 6 — it is built to the contract now.
 *
 * Hazards this file exists to get right:
 *   1. try/catch/finally around the awaited action (docs/solutions/ui-bugs/
 *      server-action-rejection-no-try-finally-freezes-capture-modal): the auth
 *      guard can redirect() (throws) before the action body runs, and a stuck
 *      `busy` flag would freeze the uploader. `finally` clears it; `catch`
 *      surfaces a retryable error. onUploaded fires OUTSIDE that try, so a
 *      consumer's throw can't be misreported as an upload failure.
 *   2. No Supabase client is constructed during render (env-less build hazard) —
 *      supabaseBrowser() is called inside the upload handler only.
 *   3. Cancellation: an in-flight TUS upload is aborted, and every post-await
 *      setState/callback is gated on a mounted ref, so unmounting mid-upload
 *      neither leaks the transfer nor fires callbacks against a dead instance.
 *
 * Upsert is disabled on both legs (first completed upload wins). An already-exists
 * response means a prior attempt already won: interpretUploadResponse maps it to
 * success and we proceed as uploaded, never re-upload or wedge. The TUS leg parses
 * the response BODY for that signal, because tus-js-client's DetailedError only
 * exposes the outer HTTP status (400), not the body's inner statusCode (409).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DetailedError, Upload } from "tus-js-client";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { requestUploadSlot, type UploadSlotResult } from "@/app/path/lib/actions/upload-slot";
import { extensionFor, interpretUploadResponse, MAX_STORABLE_BYTES } from "@/app/path/lib/upload-rules";

type SlotRefusal = Extract<UploadSlotResult, { ok: false }>;

export type UploadedEvidence = {
  evidenceId: string;
  objectPath: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  strategy: "plain" | "tus";
};

type UploaderStatus = "idle" | "preparing" | "uploading" | "done" | "refused" | "error";

/** Small backoff for a transient (429/5xx) plain-leg failure, reusing the still-
 *  valid signed token. The TUS leg has its own internal retryDelays. */
const PLAIN_RETRY_DELAYS_MS = [1000, 3000, 8000];
const PROBE_TIMEOUT_MS = 8000;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Best-effort video duration so the D21 3-minute cap is enforced at slot issue,
 *  not only after the moment. Always settles (timeout escape) so a stalled or
 *  undecodable file degrades to 'duration unknown' rather than wedging at
 *  'preparing'; the server still enforces the size cap regardless. */
function probeVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const done = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), PROBE_TIMEOUT_MS);
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : undefined);
    video.onerror = () => done(undefined);
    video.src = url;
  });
}

/** Normalize a tus-js-client error for interpretUploadResponse. The already-exists
 *  signal (statusCode 409 / error 'Duplicate') lives in the response BODY, which
 *  tus-js-client embeds only as text in .message and never parses — so parse it
 *  here to give the TUS leg the same structured detection the plain leg gets. */
function normalizeTusError(err: unknown): Parameters<typeof interpretUploadResponse>[0] {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DetailedError && err.originalResponse) {
    let statusCode: number | string | null = null;
    let errorName: string | null = null;
    try {
      const body = JSON.parse(err.originalResponse.getBody() || "{}") as {
        statusCode?: number | string;
        error?: string;
      };
      if (body.statusCode != null) statusCode = body.statusCode;
      if (typeof body.error === "string") errorName = body.error;
    } catch {
      // body wasn't JSON — fall back to the outer status + message heuristics
    }
    return { status: err.originalResponse.getStatus(), statusCode, errorName, message };
  }
  return { status: null, statusCode: null, errorName: null, message };
}

export function EvidenceUploader({
  studentId,
  taskId,
  disabled = false,
  onUploaded,
  onRefused,
  onError,
}: {
  studentId: string;
  taskId: string;
  disabled?: boolean;
  onUploaded?: (evidence: UploadedEvidence) => void;
  onRefused?: (refusal: SlotRefusal) => void;
  onError?: (message: string) => void;
}) {
  const [status, setStatus] = useState<UploaderStatus>("idle");
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const uploadRef = useRef<Upload | null>(null);
  const busy = status === "preparing" || status === "uploading";

  // Abort an in-flight TUS upload and stop firing callbacks once unmounted.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadRef.current?.abort().catch(() => {});
      uploadRef.current = null;
    };
  }, []);

  const uploadPlain = useCallback(
    async (slot: Extract<UploadSlotResult, { ok: true; strategy: "plain" }>, file: File, contentType: string) => {
      const supabase = supabaseBrowser(); // constructed in the handler, never at render
      for (let attempt = 0; ; attempt++) {
        const { error } = await supabase.storage
          .from(slot.bucket)
          .uploadToSignedUrl(slot.objectPath, slot.token, file, { contentType, upsert: false });
        if (!error) return;
        // `error` is a StorageError (status?: number, statusCode?: string) — no cast needed.
        const outcome = interpretUploadResponse({
          status: error.status ?? null,
          statusCode: error.statusCode ?? null,
          errorName: error.name ?? null,
          message: error.message,
        });
        if (outcome === "success") return; // already exists — a prior attempt won
        if (outcome === "retry" && attempt < PLAIN_RETRY_DELAYS_MS.length && mountedRef.current) {
          await new Promise((r) => setTimeout(r, PLAIN_RETRY_DELAYS_MS[attempt]));
          continue; // same token is still valid (2h)
        }
        throw new Error(`Upload failed: ${error.message}`);
      }
    },
    []
  );

  const uploadTus = useCallback(
    (slot: Extract<UploadSlotResult, { ok: true; strategy: "tus" }>, file: File, contentType: string) =>
      new Promise<void>((resolve, reject) => {
        const upload = new Upload(file, {
          endpoint: slot.endpoint,
          chunkSize: slot.chunkSize, // exactly 6 MiB — Supabase requires it
          retryDelays: [0, 3000, 5000, 10000, 20000],
          // x-signature authorizes the leg without a session; x-upsert omitted =
          // overwrite disabled, so a completed object is never replaceable.
          headers: { "x-signature": slot.token },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: slot.bucket,
            objectName: slot.objectPath,
            contentType,
            cacheControl: "3600",
          },
          onProgress: (sent, total) => {
            if (mountedRef.current) setProgress(total ? Math.round((sent / total) * 100) : 0);
          },
          onSuccess: () => {
            uploadRef.current = null;
            resolve();
          },
          onError: (err) => {
            uploadRef.current = null;
            const outcome = interpretUploadResponse(normalizeTusError(err));
            if (outcome === "success") {
              upload.abort().catch(() => {}); // tear down retry timers; a prior attempt won
              resolve();
              return;
            }
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        });
        uploadRef.current = upload;
        upload.start();
      }),
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("preparing");
      setProgress(0);
      let uploaded: UploadedEvidence | null = null;
      try {
        // Fast client-side refusal for an over-ceiling file, BEFORE reading/hashing
        // its bytes (an oversized pick would otherwise burn memory/CPU on a child's
        // phone only to be refused server-side). The server still enforces this.
        if (file.size > MAX_STORABLE_BYTES) {
          if (mountedRef.current) {
            setStatus("refused");
            onRefused?.({ ok: false, reason: "link_overflow", cause: "too_large" });
          }
          return;
        }

        const sizeBytes = file.size;
        const contentType = file.type || "application/octet-stream";
        const sha256 = await sha256Hex(await file.arrayBuffer());
        const ext = extensionFor(file.name, contentType);
        const evidenceId = crypto.randomUUID();
        const durationSeconds = contentType.startsWith("video/")
          ? await probeVideoDuration(file)
          : undefined;

        const slot = await requestUploadSlot({
          studentId,
          taskId,
          evidenceId,
          sha256,
          ext,
          contentType,
          sizeBytes,
          durationSeconds,
        });

        if (!slot.ok) {
          if (mountedRef.current) {
            setStatus("refused");
            onRefused?.(slot);
          }
          return; // finally still resets the input
        }

        if (mountedRef.current) setStatus("uploading");
        if (slot.strategy === "plain") {
          await uploadPlain(slot, file, contentType);
        } else {
          await uploadTus(slot, file, contentType);
        }

        if (!mountedRef.current) return;
        setStatus("done");
        setProgress(100);
        uploaded = {
          evidenceId,
          objectPath: slot.objectPath,
          sha256,
          sizeBytes,
          contentType,
          strategy: slot.strategy,
        };
      } catch (e) {
        // The awaited action can reject OUTSIDE its own try (the auth guard's
        // redirect(), a transient network/mint stall). Surface it, never freeze.
        if (mountedRef.current) {
          setStatus("error");
          onError?.(e instanceof Error ? e.message : "Something went wrong uploading. Please try again.");
        }
        return;
      } finally {
        // Always re-enable the picker, on resolve, reject, or early return.
        if (inputRef.current) inputRef.current.value = "";
      }

      // Success callback OUTSIDE the try: the bytes are durably stored, so a
      // consumer's throw here must not flip the uploader to a false 'error'.
      if (uploaded && mountedRef.current) {
        try {
          onUploaded?.(uploaded);
        } catch (e) {
          console.error("[path/EvidenceUploader] onUploaded callback threw:", e);
        }
      }
    },
    [studentId, taskId, onUploaded, onRefused, onError, uploadPlain, uploadTus]
  );

  return (
    <div data-path-evidence-uploader>
      <input
        ref={inputRef}
        type="file"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {status === "preparing" && <p role="status">Preparing…</p>}
      {status === "uploading" && <p role="status">Uploading… {progress}%</p>}
      {status === "done" && <p role="status">Uploaded.</p>}
      {status === "refused" && <p role="status">That file can’t be added here.</p>}
      {status === "error" && <p role="alert">Upload failed. Please try again.</p>}
    </div>
  );
}
