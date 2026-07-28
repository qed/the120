"use client";

/**
 * Minimal focus management for /fp modals (ops-guide redesign Unit 8): trap Tab
 * inside the container, focus the first focusable on open, Escape calls the
 * close callback, and focus returns to whatever had it before the container
 * opened. Nothing beyond that.
 *
 * A COPY of `app/crm/components/useFocusTrap.ts`, deliberately, rather than an
 * import across the crm boundary: /fp's only crm imports today are lib-level
 * (email templating), and pulling a crm CLIENT module into the FW bundle would
 * couple the guide surface's chunk graph to the staff app's. Fifty lines of
 * standard trap logic is cheaper than the coupling. Keep the two in step if the
 * trap grows behavior.
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void
) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus?.();
    };
  }, [ref, active, onEscape]);
}
