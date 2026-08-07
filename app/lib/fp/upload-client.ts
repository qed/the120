/**
 * The shared direct-to-storage upload flow (T1 Unit 14, extracted from Unit 9's
 * EvidenceUploader so the video-capture path can drive the SAME slot→upload
 * machinery programmatically — VideoCapture hands a recorded File + poster Blob
 * to the route, which uploads both under ONE evidenceId and then confirms).
 *
 * Everything Unit 9 got right lives here unchanged:
 *   - metadata-only slot from the Server Action; bytes go DIRECT to storage
 *     (plain PUT under 6 MB, TUS above) — never through our origin (Decision 4);
 *   - upsert disabled on both legs; an already-exists response means a prior
 *     attempt won → mapped to success, never a re-upload or a wedge (the TUS leg
 *     parses the response BODY for the inner 409/Duplicate signal);
 *   - the awaited action is wrapped so a guard redirect() or network throw
 *     surfaces as a typed error, never an unhandled rejection;
 *   - no Supabase client at module/render scope (env-less build safe) —
 *     supabaseBrowser() is constructed inside the upload call only.
 *
 * This is a plain module (no JSX); it becomes client code by being imported
 * from client components. Never import it from a server component.
 */

import { DetailedError, Upload } from "tus-js-client";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import {
  extensionFor,
  interpretUploadResponse,
  MAX_STORABLE_BYTES,
  parseTusFailure,
} from "@/app/lib/fp/upload-rules";

/** Small backoff for a transient (429/5xx) plain-leg failure, reusing the still-
 *  valid signed token. The TUS leg has its own internal retryDelays. */
const PLAIN_RETRY_DELAYS_MS = [1000, 3000, 8000];
const PROBE_TIMEOUT_MS = 8000;

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Best-effort video duration so the D21 3-minute cap is enforced at slot issue,
 *  not only after the moment. Always settles (timeout escape) so a stalled or
 *  undecodable file degrades to 'duration unknown' rather than wedging at
 *  'preparing'; the server still enforces the size cap regardless. */
export function probeVideoDuration(file: Blob): Promise<number | undefined> {
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
 *  tus-js-client embeds only as text in .message and never parses. The parsing
 *  itself is the pure, unit-tested `parseTusFailure` (upload-rules); this is the
 *  thin DetailedError adapter around it. */
function normalizeTusError(err: unknown): Parameters<typeof interpretUploadResponse>[0] {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DetailedError && err.originalResponse) {
    return parseTusFailure({
      status: err.originalResponse.getStatus(),
      body: err.originalResponse.getBody() || null,
      message,
    });
  }
  return { status: null, statusCode: null, errorName: null, message };
}

async function uploadPlain(
  slot: { bucket: string; objectPath: string; token: string },
  file: Blob,
  contentType: string,
  isMounted: () => boolean
): Promise<void> {
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
    if (outcome === "retry" && attempt < PLAIN_RETRY_DELAYS_MS.length && isMounted()) {
      await new Promise((r) => setTimeout(r, PLAIN_RETRY_DELAYS_MS[attempt]));
      continue; // same token is still valid (2h)
    }
    throw new Error(`Upload failed: ${error.message}`);
  }
}

function uploadTus(
  slot: { bucket: string; objectPath: string; token: string; endpoint: string; chunkSize: number },
  file: Blob,
  contentType: string,
  callbacks: {
    isMounted: () => boolean;
    onProgress?: (pct: number, uploadedBytes: number) => void;
    /** Receives the live Upload (for abort-on-unmount) and null when it settles. */
    registerUpload?: (upload: Upload | null) => void;
    /** Fires once the creation POST assigned the resumable URL — Unit 11's sync
     *  engine persists it (with its creation time) so a killed tab resumes. */
    onTusUrl?: (url: string) => void;
  },
  /** A previously persisted resumable URL (< 24h old — the CALLER classifies
   *  freshness via sync-rules). Set, creation is skipped and the transfer
   *  resumes from the server's offset. */
  resumeUrl?: string | null
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let reportedUrl: string | null = resumeUrl ?? null;
    const reportUrl = () => {
      if (upload.url && upload.url !== reportedUrl) {
        reportedUrl = upload.url;
        callbacks.onTusUrl?.(upload.url);
      }
    };
    const upload = new Upload(file, {
      endpoint: slot.endpoint,
      // Resume a known upload URL instead of creating a fresh one (TUS spec:
      // a HEAD reads the offset, the PATCH continues from it).
      ...(resumeUrl ? { uploadUrl: resumeUrl } : {}),
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
        reportUrl();
        if (callbacks.isMounted()) {
          callbacks.onProgress?.(total ? Math.round((sent / total) * 100) : 0, sent);
        }
      },
      onSuccess: () => {
        reportUrl();
        callbacks.registerUpload?.(null);
        resolve();
      },
      onError: (err) => {
        callbacks.registerUpload?.(null);
        const outcome = interpretUploadResponse(normalizeTusError(err));
        if (outcome === "success") {
          upload.abort().catch(() => {}); // tear down retry timers; a prior attempt won
          resolve();
          return;
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
    callbacks.registerUpload?.(upload);
    upload.start();
  });
}

/**
 * The Unit 11 engine's upload leg: drive ONE already-minted slot to completion
 * and report a typed outcome instead of throwing — the drain engine folds it
 * into the queue entry via sync-rules' `applyUploadOutcome`. Reuses the exact
 * plain/TUS machinery above (upsert disabled, already-exists → success on both
 * legs), plus TUS resume from a persisted URL.
 */
export async function uploadWithSlot(p: {
  slot:
    | { strategy: "plain"; bucket: string; objectPath: string; token: string }
    | { strategy: "tus"; bucket: string; objectPath: string; token: string; endpoint: string; chunkSize: number };
  file: Blob;
  contentType: string;
  resumeUrl?: string | null;
  isMounted?: () => boolean;
  onProgress?: (pct: number, uploadedBytes: number) => void;
  onTusUrl?: (url: string) => void;
  registerUpload?: (upload: Upload | null) => void;
}): Promise<{ outcome: "success" } | { outcome: "retry"; message: string }> {
  const isMounted = p.isMounted ?? (() => true);
  try {
    if (p.slot.strategy === "plain") {
      await uploadPlain(p.slot, p.file, p.contentType, isMounted);
    } else {
      await uploadTus(
        p.slot,
        p.file,
        p.contentType,
        {
          isMounted,
          onProgress: p.onProgress,
          onTusUrl: p.onTusUrl,
          registerUpload: p.registerUpload,
        },
        p.resumeUrl
      );
    }
    return { outcome: "success" };
  } catch (e) {
    // Every failure here is RETRY posture for the queue: transient network is
    // the common case, and the stale-token/expired-URL cases are handled by the
    // engine's freshness re-mint BEFORE the next attempt (sync-rules).
    return { outcome: "retry", message: e instanceof Error ? e.message : String(e) };
  }
}
