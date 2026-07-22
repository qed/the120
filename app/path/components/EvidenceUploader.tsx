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
 * ref up via `onUploaded` so that confirm can attach it. There is no route
 * mounting it until Unit 14, and no student session until Unit 6 — it is built to
 * the contract now.
 *
 * Two hazards this file exists to get right:
 *   1. try/catch/finally around the awaited action (docs/solutions/ui-bugs/
 *      server-action-rejection-no-try-finally-freezes-capture-modal): the auth
 *      guard can redirect() (throws) before the action's body runs, and a stuck
 *      `busy` flag would freeze the uploader with no recovery. `finally` always
 *      clears it; `catch` surfaces a retryable error.
 *   2. No Supabase client is constructed during render (env-less build hazard) —
 *      supabaseBrowser() is called inside the upload handler only.
 *
 * Upsert is disabled on both legs (first completed upload wins). An already-exists
 * response means a prior attempt already won: interpretUploadResponse maps it to
 * success and we proceed as uploaded, never re-upload or wedge.
 */

import { useCallback, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { requestUploadSlot, type UploadSlotResult } from "@/app/path/lib/actions/upload-slot";
import { interpretUploadResponse } from "@/app/path/lib/upload-rules";

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

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A path-safe extension matching the action's /^[a-z0-9]{1,8}$/, from the name
 *  then the mime, defaulting to "bin". */
function extensionFor(file: File): string {
  const fromName = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName.length >= 1 && fromName.length <= 8) return fromName;
  const fromMime = (file.type.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return fromMime || "bin";
}

/** Best-effort video duration so the D21 3-minute cap is enforced at slot issue,
 *  not only after the moment. Resolves undefined if metadata can't be read. */
function probeVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : undefined);
    video.onerror = () => done(undefined);
    video.src = url;
  });
}

/** The status number of a tus-js-client error, if it carried an HTTP response. */
function tusErrorStatus(err: unknown): number | null {
  const resp = (err as { originalResponse?: { getStatus?: () => number } } | null)?.originalResponse;
  return typeof resp?.getStatus === "function" ? resp.getStatus() : null;
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
  const busy = status === "preparing" || status === "uploading";

  const uploadPlain = useCallback(
    async (slot: Extract<UploadSlotResult, { ok: true; strategy: "plain" }>, file: File, contentType: string) => {
      const supabase = supabaseBrowser(); // constructed in the handler, never at render
      const { error } = await supabase.storage
        .from(slot.bucket)
        .uploadToSignedUrl(slot.objectPath, slot.token, file, { contentType, upsert: false });
      if (error) {
        const e = error as { status?: number; statusCode?: number | string; name?: string; message: string };
        const outcome = interpretUploadResponse({
          status: e.status ?? null,
          statusCode: e.statusCode ?? null,
          errorName: e.name ?? null,
          message: e.message,
        });
        if (outcome === "success") return; // already exists — a prior attempt won
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
          onProgress: (sent, total) => setProgress(total ? Math.round((sent / total) * 100) : 0),
          onSuccess: () => resolve(),
          onError: (err) => {
            const outcome = interpretUploadResponse({
              status: tusErrorStatus(err),
              message: err instanceof Error ? err.message : String(err),
            });
            if (outcome === "success") {
              resolve(); // already exists — a prior attempt completed
              return;
            }
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        });
        upload.start();
      }),
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("preparing");
      setProgress(0);
      try {
        const sizeBytes = file.size;
        const contentType = file.type || "application/octet-stream";
        const sha256 = await sha256Hex(await file.arrayBuffer());
        const ext = extensionFor(file);
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
          setStatus("refused");
          onRefused?.(slot);
          return; // finally still resets busy via status
        }

        setStatus("uploading");
        if (slot.strategy === "plain") {
          await uploadPlain(slot, file, contentType);
        } else {
          await uploadTus(slot, file, contentType);
        }

        setStatus("done");
        setProgress(100);
        onUploaded?.({
          evidenceId,
          objectPath: slot.objectPath,
          sha256,
          sizeBytes,
          contentType,
          strategy: slot.strategy,
        });
      } catch (e) {
        // The awaited action can reject OUTSIDE its own try (the auth guard's
        // redirect(), a transient network/mint stall). Surface it, never freeze.
        setStatus("error");
        onError?.(e instanceof Error ? e.message : "Something went wrong uploading. Please try again.");
      } finally {
        // Always re-enable the picker, on resolve, reject, or early return — a
        // stuck busy flag is the frozen-modal class this file guards against.
        if (inputRef.current) inputRef.current.value = "";
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
      {status === "uploading" && (
        <p role="status">
          Uploading… {progress}%
        </p>
      )}
      {status === "done" && <p role="status">Uploaded.</p>}
      {status === "refused" && <p role="status">That file can’t be added here.</p>}
      {status === "error" && <p role="alert">Upload failed. Please try again.</p>}
    </div>
  );
}
