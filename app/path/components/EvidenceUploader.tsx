"use client";

/**
 * Direct-to-storage evidence uploader (T1 Unit 9, Decision 4). Requests a
 * metadata-only slot from the `requestUploadSlot` Server Action, then uploads the
 * bytes DIRECT to Supabase Storage — plain PUT under 6 MB, resumable/TUS above,
 * authorized by the server-minted token so no session is needed for the upload
 * leg. Bytes never traverse our origin.
 *
 * This is the generic PICKER uploader. The slot→upload machinery itself lives in
 * `upload-client.ts` (extracted in Unit 14 so the video-capture path can drive
 * the same flow programmatically); this component owns the file input, the
 * status line, and the lifecycle guards:
 *
 *   1. try/catch/finally posture (docs/solutions/ui-bugs/server-action-rejection-
 *      no-try-finally-freezes-capture-modal) — the flow returns typed results and
 *      never throws, `finally` re-enables the picker, and onUploaded fires OUTSIDE
 *      the flow so a consumer's throw can't be misreported as an upload failure.
 *   2. No Supabase client during render (env-less build hazard) — construction
 *      happens inside upload-client's handlers only.
 *   3. Cancellation: an in-flight TUS upload is aborted on unmount, and every
 *      post-await setState/callback is gated on a mounted ref.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import {
  uploadEvidenceFile,
  type SlotRefusal,
  type UploadedEvidence,
} from "@/app/path/lib/upload-client";

export type { UploadedEvidence };

type UploaderStatus = "idle" | "preparing" | "uploading" | "done" | "refused" | "error";

export function EvidenceUploader({
  studentId,
  taskId,
  disabled = false,
  onPick,
  onUploaded,
  onRefused,
  onError,
}: {
  studentId: string;
  taskId: string;
  disabled?: boolean;
  /**
   * DURABLE mode (T1 Unit 11): when set, the picked File is handed straight up
   * — the parent enqueues it in the offline queue and the sync engine drives
   * the same slot→upload machinery. The in-component flow below then never
   * runs; it remains as the LEGACY direct path for browsers without IndexedDB
   * (private-mode Safari), where a durable queue cannot exist.
   */
  onPick?: (file: File) => void;
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

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("preparing");
      setProgress(0);
      let uploaded: UploadedEvidence | null = null;
      try {
        const result = await uploadEvidenceFile({
          studentId,
          taskId,
          file,
          fileName: file.name,
          isMounted: () => mountedRef.current,
          onStatus: (s) => {
            if (mountedRef.current) setStatus(s);
          },
          onProgress: (pct) => {
            if (mountedRef.current) setProgress(pct);
          },
          registerUpload: (u) => {
            uploadRef.current = u;
          },
        });

        if (!mountedRef.current) return;
        if (!result.ok) {
          if (result.kind === "refused") {
            setStatus("refused");
            onRefused?.(result.refusal);
          } else {
            setStatus("error");
            onError?.(result.message);
          }
          return; // finally still resets the input
        }

        setStatus("done");
        setProgress(100);
        uploaded = result.uploaded;
      } finally {
        // Always re-enable the picker, on resolve, refusal, or early return.
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
    [studentId, taskId, onUploaded, onRefused, onError]
  );

  return (
    <div data-path-evidence-uploader>
      <input
        ref={inputRef}
        type="file"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (onPick) {
            onPick(file);
            // The parent owns the flow now — just re-arm the picker.
            if (inputRef.current) inputRef.current.value = "";
            return;
          }
          void handleFile(file);
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
