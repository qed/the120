"use client";

/**
 * The ops chrome shell (ops redesign Unit 2; R11–R12) — the thin client parent
 * the + control and the inline create panel share.
 *
 * WHY IT EXISTS: `FwOpsTabRow`'s + needs a function, and the panel it toggles
 * (`FwOpsCreatePanel`) is mounted by the LIST PAGE, inside the list area — not
 * by the layout, which also wraps the per-cohort ops pages where no list exists.
 * A server layout cannot pass a function and the page cannot reach a sibling's
 * state, so the layout renders THIS shell instead of the row directly: the shell
 * mounts the row, owns the open flag, and publishes it through context that the
 * page-mounted panel consumes. Client context crosses the server-rendered
 * `children` slot fine — the panel is itself a client component.
 *
 * THE SHELL LIVES IN THE LAYOUT, so it does not unmount when staff navigate
 * between `/fp/fw/ops` and a cohort's ops page — which is what makes the
 * off-list + honest: from a nested page, + opens the panel AND navigates to the
 * list that hosts it, and the open flag survives the trip. (This replaces
 * Unit 1's `#new-weekend` Link fallback, deleted with its anchor.)
 *
 * The STICKY CONTRACT is untouched: this shell adds no wrapper element around
 * the row — `FwOpsTabRow` still renders the `sticky top-[var(--staff-bar-h,0px)]`
 * header at the same depth the layout used to mount it. Pinned in
 * `app/fp/lib/__tests__/fw-ops-chrome-wiring.test.ts`.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import FwOpsTabRow from "./FwOpsTabRow";

const FwOpsCreateContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

/** Null outside the ops shell — the panel renders nothing rather than throwing,
 *  because a misplaced mount should be visibly inert, not a crashed page. */
export function useFwOpsCreate() {
  return useContext(FwOpsCreateContext);
}

const OPS_LIST_PATH = "/fp/fw/ops";

export default function FwOpsChrome({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const onCreateClick = () => {
    if (pathname === OPS_LIST_PATH) {
      // On the list: a plain toggle, so a second tap puts the + away.
      setOpen(!open);
      return;
    }
    // On a nested ops page: open the panel and go to the page that hosts it.
    // The shell persists across this navigation (it lives in the layout), so
    // the flag is still set when the list mounts the panel.
    setOpen(true);
    router.push(OPS_LIST_PATH);
  };

  return (
    <FwOpsCreateContext.Provider value={{ open, setOpen }}>
      <FwOpsTabRow onCreateClick={onCreateClick} />
      {children}
    </FwOpsCreateContext.Provider>
  );
}
