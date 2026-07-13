"use client";

/**
 * Shared toast primitive (plan Unit 4; reused by Units 5–8). Mounted once in
 * `app/crm/(app)/layout.tsx` so every CRM screen — pipeline now, dossiers /
 * dashboard / library later — reports actions through the same stack.
 * Bottom-right, 4s auto-dismiss, max 3 stacked, mono uppercase labels (§11).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "info" | "error";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastApi {
  toast: (variant: ToastVariant, message: string) => void;
}

const VARIANT_HEX: Record<ToastVariant, string> = {
  success: "#0E8A5F",
  info: "#0300ED",
  error: "#D92632",
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>.");
  return ctx;
}

const AUTO_DISMISS_MS = 4000;
const MAX_STACK = 3;

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, variant, message }].slice(-MAX_STACK));
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(340px,calc(100vw-2.5rem))] flex-col gap-2 print:hidden"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-[10px] border bg-white px-3.5 py-2.5 shadow-[0_4px_18px_rgba(19,20,22,0.14)]"
            style={{ borderColor: VARIANT_HEX[t.variant] }}
          >
            <span
              aria-hidden
              className="mt-[3px] h-2 w-2 flex-none"
              style={{ backgroundColor: VARIANT_HEX[t.variant] }}
            />
            <p className="min-w-0 font-mono text-[10.5px] uppercase leading-relaxed tracking-[0.08em] text-crm-ink">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="ml-auto cursor-pointer text-[14px] leading-none text-crm-faint hover:text-crm-ink"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
