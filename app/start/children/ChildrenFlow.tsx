"use client";

/**
 * The Add a Child grid and form (funnel U7; R31, R32).
 *
 * Every decision it renders comes from `child-rules.ts`. The one thing it owns
 * is the ACTIVE-CHILD selection, which this repo has never had durably: the
 * dashboard's equivalent is ephemeral React state, so a refresh drops to the
 * grid. Here the selection is persisted to `localStorage`, keyed per family,
 * so it survives a refresh — R32's progress bar is per-child and has nothing
 * to describe without a stable answer.
 */

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { addChildAction } from "@/app/lib/funnel/actions/children";
import {
  CHILD_FIELD_MESSAGES,
  GRADE_REFUSAL_COPY,
  activeChildAfterAdd,
  gradeVerdict,
  resolveActiveChild,
  seatsCopy,
  type ChildFieldError,
  type FunnelChild,
} from "@/app/lib/funnel/child-rules";
import { GRADES } from "@/app/dashboard/data";
import { navCardForStep } from "@/app/lib/funnel/nav-card-rules";
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";

const ACTIVE_KEY = "the120.funnel.activeChild";

/**
 * The durable active-child selection, as an external store.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: reading
 * localStorage during render is a hydration mismatch, and restoring it in an
 * effect is a synchronous setState the React Compiler correctly rejects. This
 * is the primitive designed for exactly this shape — and subscribing to
 * `storage` events means a parent with two tabs open sees one answer, which a
 * per-tab useState would not give.
 *
 * Every access is try/caught: private mode and disabled storage must degrade
 * to "no durable selection", never to a crash on the funnel's own screen.
 */
const activeChildStore = {
  subscribe(onChange: () => void) {
    const handler = (e: StorageEvent) => {
      if (e.key === null || e.key === ACTIVE_KEY) onChange();
    };
    window.addEventListener("storage", handler);
    window.addEventListener("the120:active-child", onChange);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("the120:active-child", onChange);
    };
  },
  get(): string | null {
    try {
      return window.localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  },
  /** Server snapshot: nothing is selected until the client says so. */
  serverGet(): string | null {
    return null;
  },
  set(id: string) {
    try {
      window.localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* storage disabled — the selection lives for this page load only */
    }
    // Same-tab listeners: the `storage` event only fires in OTHER tabs.
    window.dispatchEvent(new Event("the120:active-child"));
  },
};

export function ChildrenFlow({
  initialChildren,
  loadFailed,
  hintSlug,
}: {
  initialChildren: FunnelChild[];
  loadFailed: boolean;
  /** The `?g=` door hint, forwarded into the mini-app for the FIRST child
   *  only (R36) — siblings pick cold. */
  hintSlug: string | null;
}) {
  const [children, setChildren] = useState<FunnelChild[]>(initialChildren);
  const selectedId = useSyncExternalStore(
    activeChildStore.subscribe,
    activeChildStore.get,
    activeChildStore.serverGet
  );
  const [firstName, setFirstName] = useState("");
  const [grade, setGrade] = useState<string>("");
  const [errors, setErrors] = useState<ChildFieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const persistSelection = useCallback((id: string) => activeChildStore.set(id), []);

  const active = resolveActiveChild(children, selectedId);
  const seats = seatsCopy(children.length);

  const submit = () => {
    setNotice(null);
    startTransition(async () => {
      const result = await addChildAction({ firstName, grade });
      if (result.kind === "added") {
        setChildren(result.children);
        // R31: adding a sibling must not move the active child — INCLUDING an
        // implicitly-active one. `active?.id`, never the raw stored value:
        // on a fresh device the store is null while the furthest-progressed
        // child is already rendered as Active, and passing the raw null would
        // hand the brand-new sibling the active slot (both reviewers,
        // independently). Only a genuinely FIRST child becomes active.
        persistSelection(activeChildAfterAdd(active?.id ?? null, result.childId));
        setFirstName("");
        setGrade("");
        setErrors([]);
        // Straight into the unified application flow for the child just
        // added (2026-07-30): the server landing rule picks the first step.
        // The `?g=` hint rides only for the family's FIRST-BORN (R36 —
        // `children` here is the pre-add snapshot, so empty means first).
        window.location.href =
          hintSlug && children.length === 0
            ? `/start/child/${result.childId}?g=${encodeURIComponent(hintSlug)}`
            : `/start/child/${result.childId}`;
        return;
      }
      if (result.kind === "invalid") {
        setErrors(result.fields);
        return;
      }
      setNotice(
        result.kind === "too_many"
          ? "That's a lot of children — get in touch and we'll set the rest up with you."
          : result.kind === "unauthenticated"
            ? "Your session expired. Start again and we'll pick up where you left off."
            : "Something went wrong on our end. Try that again in a moment."
      );
    });
  };

  // U10 fidelity, batch B3 (audit drift 16/X7): Add Children is a
  // marketing-register scene in the handoff — desktop body is the 960px
  // column, the child cards flow into a responsive grid
  // (`repeat(auto-fit,minmax(340px,1fr))` → two columns at 960; screenshot
  // 14), and the add-form's name/grade pair sits side by side (the
  // prototype's `1fr 1fr` field grid). Mobile is untouched below md/lg.
  return (
    <>
    {/* R32/X1: the floating nav card carries the bar at add_child (20%). It
        mounts ABOVE the column (2026-07-30) so it holds the home nav's
        exact full-width geometry. */}
    <ProgressNavCard model={navCardForStep("add_child", null)} />
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col justify-center px-6 py-16 lg:max-w-[960px]">

      {/* 2026-07-30: this page is ONLY Add a Child. Existing children live
          on the parent dashboard — the picker grid is retired. */}
      <a
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 self-start font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted transition-colors hover:text-ink"
      >
        ← Back to dashboard
      </a>
      {/* U10 fidelity (audit drift 12): Georgia display heading. */}
      <h1 className="display text-3xl text-ink">Add a child</h1>
      <p className="mt-3 text-base leading-7 text-ink-soft lg:max-w-[560px]">
        Their first name and the grade they&apos;re in now. You can add more later.
      </p>

      {loadFailed && (
        <p className="mt-5 text-sm leading-6 text-ink-soft">
          We couldn&apos;t load your children just now — adding one below still works.
        </p>
      )}

      {seats && (
        // R31: the seats implication is surfaced here, not discovered at
        // checkout.
        <p className="mt-4 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
          {seats}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4 border-t border-line pt-8 md:grid md:grid-cols-2 md:items-start">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
            Child&apos;s first name
          </span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="off"
            className="h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink outline-none focus:border-ink"
          />
          {errors.includes("first_name") && (
            <span className="text-[12px] leading-5 text-red">
              {CHILD_FIELD_MESSAGES.first_name}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
            Grade they&apos;re in now
          </span>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="h-11 rounded-xl border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-ink"
          >
            <option value="">Pick a grade</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
          {errors.includes("grade") && (
            <span className="text-[12px] leading-5 text-red">
              {GRADE_REFUSAL_COPY.out_of_range}
            </span>
          )}
          {grade !== "" && gradeVerdict(grade).ok && (
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.1em] text-muted">
              {gradeVerdict(grade).ok &&
                `${(gradeVerdict(grade) as { band: string }).band === "trail" ? "Trail" : "HQ"} band`}
            </span>
          )}
        </label>

        {notice && <p className="text-sm leading-6 text-ink-soft md:col-span-2">{notice}</p>}

        {/* U10 fidelity (audit item 8): once a child exists, the add
            affordance goes SECONDARY (white with a red outline) so the
            per-child CTAs keep the red (handoff addchild spec). */}
        <button
          onClick={submit}
          disabled={pending}
          className="mt-1 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:opacity-60 md:col-span-2 md:justify-self-start"
        >
          {/* ONE promise (2026-07-30): the submit adds the child AND enters
              the unified flow, so the label says where it goes. */}
          {pending ? "Adding…" : "Start building →"}
        </button>
      </div>
    </main>
    </>
  );
}
