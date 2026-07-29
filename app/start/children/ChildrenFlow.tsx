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

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col justify-center px-6 py-16">
      {/* R32/X1: the floating nav card carries the bar at add_child (20%). */}
      <ProgressNavCard model={navCardForStep("add_child", null)} />

      {/* U10 fidelity (audit drift 12): Georgia display heading. */}
      <h1 className="display text-3xl text-ink">
        {children.length === 0 ? "Who's applying?" : "Your children"}
      </h1>
      <p className="mt-3 text-base leading-7 text-ink-soft">
        {children.length === 0
          ? "Their first name and the grade they're in now. You can add more later."
          : "Pick who you're working on, or add another."}
      </p>

      {loadFailed && (
        <p className="mt-5 text-sm leading-6 text-ink-soft">
          We couldn&apos;t load your children just now — adding one below still works.
        </p>
      )}

      {children.length > 0 && (
        <ul className="mt-7 flex flex-col gap-2">
          {children.map((c) => {
            const isActive = active?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => persistSelection(c.id)}
                  aria-pressed={isActive}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                    isActive
                      ? "border-ink bg-white"
                      : "border-line bg-white/60 hover:border-ink-soft"
                  }`}
                >
                  <span className="text-[15px] text-ink">{c.firstName}</span>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
                    Grade {c.grade}
                    {isActive ? " · Active" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        // The forward path (U8): into the mini-app for the active child. The
        // hint travels ONLY when this is the family's first child — R36 says
        // siblings pick cold, and the grid is where first-ness is known.
        <a
          href={
            // R36: first-child-only means FIRST-BORN, not only-child. The list
            // arrives created_at-ordered from the core, so children[0] IS the
            // first child — gating on length === 1 dropped the hint the moment
            // a sibling was added, for the very child it was destined for
            // (both reviewers, independently).
            hintSlug && active.id === children[0]?.id
              ? `/start/child/${active.id}?g=${encodeURIComponent(hintSlug)}`
              : `/start/child/${active.id}`
          }
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
        >
          {`Start building with ${active.firstName} →`}
        </a>
      )}

      {seats && (
        // R31: the seats implication is surfaced here, not discovered at
        // checkout.
        <p className="mt-4 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
          {seats}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4 border-t border-line pt-8">
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

        {notice && <p className="text-sm leading-6 text-ink-soft">{notice}</p>}

        {/* U10 fidelity (audit item 8): once a child exists, the add
            affordance goes SECONDARY (white with a red outline) so the
            per-child CTAs keep the red (handoff addchild spec). */}
        <button
          onClick={submit}
          disabled={pending}
          className={`mt-1 inline-flex h-11 items-center justify-center rounded-full px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-colors disabled:cursor-wait disabled:opacity-60 ${
            children.length === 0
              ? "bg-red text-white hover:bg-red-dark"
              : "border border-red bg-white text-red hover:bg-red/5"
          }`}
        >
          {pending ? "Adding…" : children.length === 0 ? "Add my child →" : "Add another →"}
        </button>
      </div>
    </main>
  );
}
