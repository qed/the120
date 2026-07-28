"use client";

/**
 * The mini-app shell (funnel U8). Layout only — every decision comes from
 * `miniapp-rules.ts`. The two-register seam is a CLASS-NAME swap at this
 * subtree root (Decision 10): `SKIN_ROOT_CLASSES[skin]`, complete literals.
 *
 * Steps are URL state: changing step is `router.push` with a new `?step=`,
 * so Back walks the ladder and refresh restores the current step. Steps
 * beyond `BUILT_STEPS` render the coming-next stub until their units land.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmDoorAction } from "@/app/lib/funnel/actions/miniapp";
import type { MiniAppChild } from "@/app/lib/funnel/miniapp-core";
import {
  BUILT_STEPS,
  SKIN_ROOT_CLASSES,
  doorsModel,
  handoffCopy,
  miniAppProgress,
  parseStep,
  skinForGrade,
  stepNeighbour,
  type MiniAppStep,
} from "@/app/lib/funnel/miniapp-rules";
import { DOOR_CLASSES } from "@/app/lib/site";
import type { GroupSlug } from "@/app/lib/site";

export function MiniAppShell({
  child,
  hintSlug,
}: {
  child: MiniAppChild;
  hintSlug: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skin = skinForGrade(child.grade);
  // The step DERIVES from the URL — never `useState(initialStep)`, which
  // reads the prop once and ignores every later navigation: the browser Back
  // button would then pop history (new server render, new prop) while the
  // mounted component kept showing the old step. The URL is the single
  // source; `go()` only writes it (the raw-vs-resolved lesson, again).
  const step: MiniAppStep = parseStep(searchParams.get("step"));
  const [confirmedSlug, setConfirmedSlug] = useState<string | null>(child.groupSlug);
  // A TAP is client state and nothing else (R35): switching is choosing.
  const [tappedSlug, setTappedSlug] = useState<GroupSlug | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const doors = useMemo(
    () =>
      doorsModel({
        hintSlug,
        isFirstChild: child.isFirstChild,
        confirmedSlug,
      }),
    [hintSlug, child.isFirstChild, confirmedSlug]
  );
  const selected: GroupSlug | null =
    tappedSlug ?? doors.find((d) => d.preselected)?.slug ?? null;

  const go = (next: MiniAppStep | null) => {
    if (!next) return;
    // Preserve the REST of the query — a bare `?step=` push would drop the
    // `?g=` hint the whole funnel threaded here, and a refresh on the doors
    // step would then render them cold.
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", next);
    router.push(`?${params.toString()}`, { scroll: true });
  };

  const confirm = () => {
    if (!selected) return;
    setNotice(null);
    startTransition(async () => {
      const result = await confirmDoorAction({ childId: child.id, slug: selected });
      if (result.kind === "confirmed") {
        setConfirmedSlug(result.slug);
        // Clear the tap so a later re-entry to the doors shows the SAVED
        // fact, not a stale client selection shadowing it.
        setTappedSlug(null);
        go(stepNeighbour("doors", "next"));
        return;
      }
      setNotice(
        result.kind === "unauthenticated"
          ? "Your session expired — start again and we'll pick this up."
          : "That didn't save. Give it a second and tap again."
      );
    });
  };

  return (
    <div className={`min-h-screen ${SKIN_ROOT_CLASSES[skin]}`}>
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-14">
        {/* R32: the bar keeps running through the mini-app. */}
        <div className="mb-10" aria-hidden>
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-red transition-[width] duration-300"
              style={{ width: `${miniAppProgress(step)}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
            {miniAppProgress(step)}% · {child.firstName}
          </p>
        </div>

        {step === "handoff" && <Handoff child={child} skin={skin} onNext={() => go("doors")} />}

        {step === "doors" && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Five doors. Pick yours.</h1>
            <ul className="mt-7 flex flex-col gap-2.5">
              {doors.map((door) => {
                const isSelected = selected === door.slug;
                return (
                  <li key={door.slug}>
                    <button
                      onClick={() => setTappedSlug(door.slug)}
                      aria-pressed={isSelected}
                      className={`flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all ${
                        isSelected
                          ? "border-current bg-white shadow-sm"
                          : "border-black/15 bg-white/50 opacity-80 hover:opacity-100"
                      }`}
                    >
                      {/* R34: the arch numeral chip in the door's phase colour. */}
                      <span
                        className={`font-mono text-[0.7rem] font-bold tracking-[0.1em] ${DOOR_CLASSES[door.slug].accent}`}
                      >
                        {door.numeral}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-mono text-[0.55rem] uppercase tracking-[0.14em] opacity-60">
                          {door.kicker}
                        </span>
                        <span className="text-[16px] capitalize">The {door.slug}</span>
                        {door.preselected && isSelected && (
                          // R35: one line of band-register copy under the hint.
                          <span className="mt-0.5 text-[12px] opacity-70">
                            {skin === "trail"
                              ? "This looked like your door — tap again if it is."
                              : "Your door, if you want it. Or pick another."}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {notice && <p className="mt-4 text-sm opacity-80">{notice}</p>}

            <button
              onClick={confirm}
              disabled={!selected || pending}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "This one →"}
            </button>
          </section>
        )}

        {!BUILT_STEPS.includes(step) && (
          <section>
            <h1 className="font-display text-3xl leading-tight">
              {child.firstName ? `Nice pick, ${child.firstName}.` : "Nice pick."}
            </h1>
            <p className="mt-3 text-base leading-7 opacity-80">
              The next part — templates, your questions, and the build — is landing
              here shortly. Your door is saved; nothing is lost.
            </p>
            <button
              onClick={() => go(stepNeighbour(step, "back"))}
              className="mt-7 inline-flex h-11 items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em]"
            >
              ← Back
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function Handoff({
  child,
  skin,
  onNext,
}: {
  child: MiniAppChild;
  skin: ReturnType<typeof skinForGrade>;
  onNext: () => void;
}) {
  const copy = handoffCopy(child.firstName, skin);
  return (
    <section>
      <h1 className="font-display text-3xl leading-tight">{copy.title}</h1>
      <p className="mt-3 text-base leading-7 opacity-80">{copy.line}</p>
      <button
        onClick={onNext}
        className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
      >
        {skin === "trail" ? "I'm ready →" : "Let's go →"}
      </button>
    </section>
  );
}
