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
import {
  OWN_IDEA,
  QUIZ_BLOCKER_COPY,
  parentAssist,
  quizBandForGrade,
  quizBlockers,
  quizForGroup,
  seedAnswers,
  templatesForGroup,
  type QuizAnswers,
} from "@/app/lib/funnel/quiz-rules";
import {
  ANSWER_MAX_CHARS,
  OWN_IDEA_MAX_CHARS,
  capWellFormed,
} from "@/app/lib/funnel/moderation";

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

  // ── U9: template + quiz state ──
  // CLIENT state, deliberately: the projects row (and with it server-side
  // persistence) is created at COMPOSE (U10) — the quiz's draft answers are
  // pre-project by definition. A refresh loses at most the current quiz's
  // typing; R40's regeneration counter is server-side and unaffected. The
  // template's seeds are editable VALUES; per-question suggestions are
  // PLACEHOLDERS only (never pre-typed — a pre-typed suggestion is the
  // child's answer to every downstream system).
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [ownIdea, setOwnIdea] = useState("");
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [quizNotice, setQuizNotice] = useState<string | null>(null);
  // What the current `answers` were seeded FROM. Re-advancing through the
  // templates step with the SAME choice must not re-seed — a child who edited
  // four answers and pressed Back to re-read the pitch keeps every edit (both
  // reviewers). A different choice re-seeds; that's the child changing their
  // mind about the starting point.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  // A template belongs to the CONFIRMED group. After a door switch the old
  // group's id is stale: nothing renders selected, so the advance button must
  // not be armed by it (both reviewers — cross-group contamination).
  const validTemplateId =
    templateId === OWN_IDEA.id ||
    (confirmedSlug !== null &&
      templatesForGroup(confirmedSlug as GroupSlug).some((t) => t.id === templateId))
      ? templateId
      : null;

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
        // A DIFFERENT door invalidates everything downstream of it: the old
        // group's template and seeded answers are that group's copy, and a
        // stale set would arm the templates advance button with nothing
        // visibly selected — one tap seeds the new group's quiz with the
        // wrong group's project (both reviewers, the unit's top finding).
        if (result.slug !== confirmedSlug) {
          setTemplateId(null);
          setOwnIdea("");
          setAnswers({});
          setQuizNotice(null);
          setSeededFrom(null);
        }
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

        {step === "templates" && confirmedSlug && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Pick a starting point.</h1>
            <p className="mt-3 text-base leading-7 opacity-80">
              Two ready-made starts, or your own idea. You can change everything later —
              this is a starting line, not a contract.
            </p>
            <ul className="mt-7 flex flex-col gap-2.5">
              {templatesForGroup(confirmedSlug as GroupSlug).map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setTemplateId(t.id)}
                    aria-pressed={templateId === t.id}
                    className={`flex w-full flex-col gap-1 rounded-2xl border px-5 py-4 text-left transition-all ${
                      templateId === t.id
                        ? "border-current bg-white shadow-sm"
                        : "border-black/15 bg-white/50 hover:bg-white/80"
                    }`}
                  >
                    <span className="text-[16px] font-semibold">{t.title}</span>
                    <span className="text-[13px] leading-5 opacity-75">{t.pitch}</span>
                    <span className="font-mono text-[0.55rem] uppercase tracking-[0.12em] opacity-60">
                      First customers: {t.firstCustomers}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <div
                  className={`flex w-full flex-col gap-2 rounded-2xl border px-5 py-4 ${
                    templateId === OWN_IDEA.id
                      ? "border-current bg-white shadow-sm"
                      : "border-black/15 bg-white/50"
                  }`}
                >
                  <button
                    onClick={() => setTemplateId(OWN_IDEA.id)}
                    className="flex flex-col gap-1 text-left"
                  >
                    <span className="text-[16px] font-semibold">{OWN_IDEA.title}</span>
                    <span className="text-[13px] leading-5 opacity-75">{OWN_IDEA.pitch}</span>
                  </button>
                  {templateId === OWN_IDEA.id && (
                    <textarea
                      value={ownIdea}
                      onChange={(e) => setOwnIdea(capWellFormed(e.target.value, OWN_IDEA_MAX_CHARS))}
                      placeholder="Tell us in your own words…"
                      maxLength={OWN_IDEA_MAX_CHARS}
                      rows={3}
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-current"
                    />
                  )}
                </div>
              </li>
            </ul>
            <button
              onClick={() => {
                // The chosen template SEEDS the quiz's draft answers — but
                // only when the choice CHANGED since the last seed: the same
                // choice re-advanced (Back to re-read the pitch, forward
                // again) must not wipe the child's edits. Own-idea seeds
                // `what` and its key carries the text, so editing the idea
                // re-seeds too.
                if (!validTemplateId) return;
                const seedKey =
                  validTemplateId === OWN_IDEA.id
                    ? `own:${ownIdea.trim()}`
                    : validTemplateId;
                if (seedKey !== seededFrom) {
                  setAnswers(
                    seedAnswers(
                      validTemplateId === OWN_IDEA.id ? null : validTemplateId,
                      validTemplateId === OWN_IDEA.id ? ownIdea : null
                    )
                  );
                  setSeededFrom(seedKey);
                }
                go(stepNeighbour("templates", "next"));
              }}
              disabled={
                !validTemplateId ||
                (validTemplateId === OWN_IDEA.id && ownIdea.trim() === "")
              }
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              This one →
            </button>
          </section>
        )}

        {step === "templates" && !confirmedSlug && (
          <section>
            <p className="text-base leading-7 opacity-80">Pick a door first.</p>
            <button
              onClick={() => go("doors")}
              className="mt-5 inline-flex h-11 items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em]"
            >
              ← To the doors
            </button>
          </section>
        )}

        {step === "quiz" && confirmedSlug && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Your four questions.</h1>
            {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade)) && (
              <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] opacity-60">
                {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade))}
              </p>
            )}
            <div className="mt-7 flex flex-col gap-5">
              {quizForGroup(confirmedSlug as GroupSlug).map((q) => {
                const band = quizBandForGrade(child.grade);
                return (
                  <label key={q.id} className="flex flex-col gap-1.5">
                    <span className="text-[15px] leading-6">
                      {q.phrasing[band]}
                      {!q.required && (
                        <span className="ml-1 font-mono text-[0.55rem] uppercase opacity-50">
                          optional
                        </span>
                      )}
                    </span>
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [q.id]: capWellFormed(e.target.value, ANSWER_MAX_CHARS),
                        }))
                      }
                      placeholder={q.suggestion[band]}
                      maxLength={ANSWER_MAX_CHARS}
                      rows={2}
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-current"
                    />
                  </label>
                );
              })}
            </div>
            {quizNotice && <p className="mt-4 text-sm opacity-80">{quizNotice}</p>}
            <button
              onClick={() => {
                const blockers = quizBlockers(
                  answers,
                  quizForGroup(confirmedSlug as GroupSlug)
                );
                if (blockers.length > 0) {
                  setQuizNotice(QUIZ_BLOCKER_COPY);
                  return;
                }
                setQuizNotice(null);
                go(stepNeighbour("quiz", "next"));
              }}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
            >
              Shape my project →
            </button>
          </section>
        )}

        {step === "quiz" && !confirmedSlug && (
          <section>
            <p className="text-base leading-7 opacity-80">Pick a door first.</p>
            <button
              onClick={() => go("doors")}
              className="mt-5 inline-flex h-11 items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em]"
            >
              ← To the doors
            </button>
          </section>
        )}

        {!BUILT_STEPS.includes(step) && (
          <section>
            <h1 className="font-display text-3xl leading-tight">
              {child.firstName ? `Nice pick, ${child.firstName}.` : "Nice pick."}
            </h1>
            <p className="mt-3 text-base leading-7 opacity-80">
              The next part — where your answers become a real project — is
              landing here shortly. Your door is saved.
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
