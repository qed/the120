"use client";

/**
 * In-app video capture (T1 Unit 10, Decision 11). Records via `MediaRecorder`,
 * which on iOS writes H.264/AAC MP4 that plays EVERYWHERE — the whole reason we do
 * not accept a camera-roll file as the primary path (iOS hands back HEVC `.mov`
 * that desktop Firefox and GPU-less Chrome render as a black rectangle). Enforces
 * the D21 recording cap, generates a POSTER FRAME on-device (so the review list
 * renders even when a clip is unplayable), and routes the file-picker fallback
 * through Mediabunny normalization.
 *
 * This component only CAPTURES — it hands `{ file, poster, durationSeconds }` up via
 * onCaptured; the route (Unit 14) wires the upload (EvidenceUploader) + confirm.
 *
 * Env-less-build safe: no Supabase client anywhere; `getUserMedia`/`MediaRecorder`
 * run only inside handlers/effects; Mediabunny is dynamically imported inside the
 * fallback handler, never at module scope. Streams are torn down on stop/unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VIDEO_RECORDING_SECONDS } from "@/app/fp/lib/evidence-rules";

export type CapturedVideo = {
  /** The recorded/normalized clip — MP4 where the platform allows it. */
  file: File;
  /** A JPEG poster frame generated on-device (always present, always renderable). */
  poster: Blob | null;
  durationSeconds: number;
};

/** Prefer an MP4/H.264 recording; fall back to whatever the platform supports. */
function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Grab a poster frame from a video Blob without re-encoding the clip itself (the
 *  poster is a derived thumbnail; canvas is fine here). Always settles. */
function generatePoster(file: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => done(null), 8000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadeddata = () => {
      // Seek a hair past the start so we don't grab a black first frame.
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timer);
            done(blob);
          },
          "image/jpeg",
          0.7
        );
      } catch {
        clearTimeout(timer);
        done(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

/** Normalize a picked file (commonly HEVC .mov from a camera roll) to MP4 via
 *  Mediabunny. Best-effort: on any failure — unsupported codec, no WebCodecs, an
 *  API mismatch — fall back to the original file. The poster still renders. The
 *  exact conversion path is verified on a real device in Unit 14. */
async function normalizeToMp4(file: File): Promise<File> {
  // Strip any `;codecs=…` params before comparing — a native MediaRecorder MP4 is
  // tagged e.g. `video/mp4;codecs=avc1…`, and a strict `=== "video/mp4"` would miss
  // it and needlessly re-transcode the very case in-app recording exists to avoid.
  const base = file.type.split(";")[0].trim().toLowerCase();
  if (base === "video/mp4") return file;
  try {
    const mb = (await import("mediabunny")) as unknown as {
      Input: new (o: unknown) => unknown;
      Output: new (o: unknown) => { target: { buffer: ArrayBuffer | null } };
      Conversion: { init: (o: unknown) => Promise<{ execute: () => Promise<void> }> };
      BlobSource: new (b: Blob) => unknown;
      BufferTarget: new () => unknown;
      Mp4OutputFormat: new () => unknown;
      ALL_FORMATS: unknown;
    };
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({ input, output });
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) return file;
    return new File([buffer], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
  } catch (e) {
    console.warn("[path/VideoCapture] Mediabunny normalization failed; using original file", e);
    return file;
  }
}

export function VideoCapture({
  disabled = false,
  onCaptured,
  onError,
}: {
  disabled?: boolean;
  onCaptured?: (captured: CapturedVideo) => void;
  onError?: (message: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  const teardownStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    timerRef.current = null;
    capTimerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      teardownStream();
    };
  }, [teardownStream]);

  const emit = useCallback(
    async (blob: Blob, mime: string, durationSeconds: number) => {
      if (mountedRef.current) setStatus("processing");
      const base = new File([blob], `capture-${Date.now()}.${mime.includes("mp4") ? "mp4" : "webm"}`, { type: mime });
      const file = await normalizeToMp4(base);
      const poster = await generatePoster(file);
      if (!mountedRef.current) return;
      setStatus("idle");
      onCaptured?.({ file, poster, durationSeconds });
    },
    [onCaptured]
  );

  const startRecording = useCallback(async () => {
    const mime = pickRecorderMime();
    if (!mime || typeof navigator === "undefined" || !navigator.mediaDevices) {
      onError?.("Recording isn’t supported on this device. Try choosing a file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
        teardownStream();
        void emit(new Blob(chunksRef.current, { type: mime }), mime, durationSeconds);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => {
        if (mountedRef.current) setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      // Hard cap (D21): auto-stop at the ceiling — the moment is captured, the bill bounded.
      capTimerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      }, MAX_VIDEO_RECORDING_SECONDS * 1000);
    } catch {
      onError?.("Couldn’t start the camera. Please allow access, or choose a file instead.");
      teardownStream();
    }
  }, [emit, onError, teardownStream]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const handlePickedFile = useCallback(
    async (file: File) => {
      setStatus("processing");
      try {
        const normalized = await normalizeToMp4(file);
        const poster = await generatePoster(normalized);
        if (!mountedRef.current) return;
        setStatus("idle");
        onCaptured?.({ file: normalized, poster, durationSeconds: 0 });
      } catch {
        if (mountedRef.current) {
          setStatus("idle");
          onError?.("Couldn’t process that video. Please try another file.");
        }
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onCaptured, onError]
  );

  const busy = disabled || status === "processing";

  return (
    <div data-path-video-capture>
      {status !== "recording" ? (
        <button type="button" onClick={() => void startRecording()} disabled={busy}>
          {status === "processing" ? "Processing…" : "Record video"}
        </button>
      ) : (
        <button type="button" onClick={stopRecording}>
          Stop ({elapsed}s / {MAX_VIDEO_RECORDING_SECONDS}s)
        </button>
      )}

      {/* Fallback: pick an existing video (camera roll). Normalized to MP4. */}
      <label>
        <span>or choose a file</span>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          disabled={busy || status === "recording"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handlePickedFile(file);
          }}
        />
      </label>
    </div>
  );
}
