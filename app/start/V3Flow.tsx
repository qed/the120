"use client";

/**
 * The v3 flow's shell (plan Unit 3). Layout and navigation only — every decision
 * lives in app/lib/v3-signup/flow-rules.ts, so the server render and the
 * hydrated client can never disagree about which screen a URL means.
 *
 * ── `?step=` IS THE STEP STATE (the MiniAppShell precedent) ──
 * The step DERIVES from the URL on every render; `go()` only WRITES it. That is
 * what makes browser Back walk the ladder and a refresh restore the screen —
 * and it is why this is not `useState(initialStep)`, which reads the prop once
 * and then ignores every later navigation (the exact bug MiniAppShell's header
 * documents).
 *
 * The DRAFT ROW is the resume anchor behind it: the server resolves the facts
 * from the draft, so a refresh mid-flow lands on the right screen with the right
 * content, and a URL that claims more progress than the draft supports is
 * clamped by `resolveV3Step`.
 *
 * ── WHY LOCAL FACTS SHADOW THE SERVER'S ──
 * A step-2 submit mints the draft through a Server Action, and the props from
 * the last server render do not know about it yet. So the two facts the client
 * can establish for itself (the parent verified; a draft now exists and is
 * named) are held locally and merged over the server's. The `go()` push then
 * re-renders /start with the new ?step= server-side, which re-reads the real
 * state on the same round trip. Without the shadow, "Start their journey"
 * would clamp straight back to step 2.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  resolveV3Step,
  type V3FlowFacts,
  type V3Step,
} from "@/app/lib/v3-signup/flow-rules";
import type { V3DraftView } from "@/app/lib/v3-signup/v3-onboarding-core";
import { StepParent } from "./StepParent";
import { StepAddKid } from "./StepAddKid";
// StepCover / StepStory are NO LONGER MOUNTED (fpv03 U3: cover/story retired
// from signup; the files stay until a later cleanup, and their server surfaces
// — v3SaveStoryAction, /api/fp/cover — stay live so an old tab mid-flow can
// still finish; only UI reachability is gone).
import { StepAccountReady } from "./StepAccountReady";
import { STEP_ORDER, V3BrandHeader } from "./v3-ui";

const STEP_LABELS: Record<V3Step, string> = {
  parent: "Your details",
  kid: "Add your kid",
  ready: "Account ready",
};

/**
 * NOTE (review FIX 9a): this shell deliberately takes NO `existingKids` prop.
 * It had one, plus a `<span hidden data-existing-kids>` whose only job was to
 * keep the unused prop from being flagged dead — a marker element shipped to
 * every family to satisfy a linter. The duplicate guard consumes that data
 * SERVER-side, and page.tsx still has the value for whichever later unit wants
 * to render "your kids" here.
 */
export function V3Flow({
  initialStep,
  facts,
  draft,
  parentEmail,
  consentPolicy,
}: {
  initialStep: V3Step;
  facts: V3FlowFacts;
  draft: V3DraftView | null;
  parentEmail: string | null;
  consentPolicy: { version: string; hash: string; text: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduced = useReducedMotion();

  // Facts this session established after the last server render (see header).
  const [localFacts, setLocalFacts] = useState<Partial<V3FlowFacts>>({});
  const [localDraftId, setLocalDraftId] = useState<string | null>(draft?.id ?? null);

  const merged: V3FlowFacts = useMemo(
    () => ({ ...facts, ...localFacts }),
    [facts, localFacts]
  );

  const rawStep = searchParams.get("step");
  // First paint uses the SERVER's resolution (props), so nothing flashes; every
  // render after that re-resolves from the URL against the merged facts.
  const step: V3Step = rawStep === null ? initialStep : resolveV3Step(rawStep, merged);

  const go = useCallback(
    (next: V3Step) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("step", next);
      // NO router.refresh() beside this push. The pair races the Next 16
      // client cache — the refresh clears the route the in-flight push is
      // resolving against, the navigation never commits, and a step-2 save
      // sits on "Saving…" forever while the draft row lands fine (docs/
      // solutions/ui-bugs/router-push-then-refresh-races-next16-client-cache-
      // redirect-from-the-action-instead-2026-07-28.md). The push alone
      // re-renders /start with the new ?step= server-side, which re-reads the
      // onboarding state — so the facts the refresh existed to reconcile
      // arrive on the same round trip; the local shadow covers the interim.
      router.push(`?${params.toString()}`, { scroll: true });
    },
    [router, searchParams]
  );

  const draftId = localDraftId ?? draft?.id ?? null;
  const firstName = draft?.firstName?.trim() || "your kid";

  return (
    <div className="v3-grain min-h-screen w-full bg-v3-cream text-v3-ink">
      <V3BrandHeader
        step={STEP_ORDER.indexOf(step) + 1}
        totalSteps={STEP_ORDER.length}
        stepLabel={STEP_LABELS[step]}
        // fpv03 (Unit 2, extended by U3 to the reskinned kid step): the
        // reskinned screens carry their own in-content progress kicker, so the
        // header shows the mock's ACCOUNT chip instead of doubling the meter.
        // A signed-in parent gets the same /dashboard destination the escape
        // link below already offers; signed-out it is a static label, because
        // there is no account menu on this screen today.
        end={
          step === "parent" || step === "kid" ? (
            parentEmail ? (
              <Link
                href="/dashboard"
                className="v3-label inline-flex min-h-[44px] items-center font-bold text-v3-ink hover:text-v3-profit"
              >
                Account
              </Link>
            ) : (
              // Signed out there is nothing to open, so the chip must READ
              // non-interactive too: lighter ink, no bold — only the signed-in
              // Link gets the tappable treatment.
              <span className="v3-label text-v3-ink/50">Account</span>
            )
          ) : undefined
        }
      />

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === "parent" && (
              <StepParent
                consentPolicy={consentPolicy}
                onVerified={() => {
                  setLocalFacts((f) => ({ ...f, parentVerified: true }));
                  go("kid");
                }}
              />
            )}

            {step === "kid" && (
              <StepAddKid
                consentPolicy={consentPolicy}
                // A draft that is already NAMED means the family walked back to
                // correct it; an unnamed draft (or none) is a fresh add.
                draftId={merged.kidNamed ? draftId : null}
                initialFullName={
                  draft ? `${draft.firstName} ${draft.lastName}`.trim() : ""
                }
                initialAge={draft?.age != null ? String(draft.age) : ""}
                onAdded={(id) => {
                  setLocalDraftId(id);
                  setLocalFacts((f) => ({ ...f, hasDraft: true, kidNamed: true }));
                  // fpv03 U3: cover/story retired — add-kid walks straight to
                  // the ready screen, which provisions on arrival.
                  go("ready");
                }}
                onResumeExisting={(kid) => {
                  // A live DRAFT can be resumed in place. A provisioned CHILD
                  // cannot — this flow only ever mints — so the family is sent
                  // to the dashboard, which owns every existing kid.
                  if (kid.kind === "draft") {
                    setLocalDraftId(kid.id);
                    setLocalFacts((f) => ({ ...f, hasDraft: true, kidNamed: true }));
                    go("ready");
                    return;
                  }
                  router.push("/dashboard");
                }}
              />
            )}

            {step === "ready" && draftId && (
              <StepAccountReady
                draftId={draftId}
                firstName={firstName}
                age={draft?.age ?? null}
                onBack={() => go("kid")}
              />
            )}

            {/* The one impossible-by-clamp combination, rendered rather than
                blank: a step past `kid` with no draft id in hand. Reachable only
                if the draft read failed on this render, so the honest move is to
                send the family back one rung rather than show an empty page. */}
            {step !== "parent" && step !== "kid" && !draftId && (
              <section className="mx-auto w-full max-w-xl px-5 py-16 text-center">
                <p className="text-base leading-relaxed text-v3-stone">
                  We lost track of that sign-up. Start from your kid&rsquo;s name and we will pick
                  it back up.
                </p>
                <button
                  type="button"
                  onClick={() => go("kid")}
                  className="v3-label mt-5 inline-flex min-h-[44px] items-center text-v3-profit underline underline-offset-4"
                >
                  Back to your kid&rsquo;s details
                </button>
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Signed-in families get a way out of the flow on every screen. Kept
            out of the sticky header so it never competes with the step meter on
            a 390px row. */}
        {parentEmail && step !== "ready" && (
          <div className="mx-auto w-full max-w-5xl px-5 pb-12">
            <a
              href="/dashboard"
              className="v3-label inline-flex min-h-[44px] items-center text-v3-stone underline underline-offset-4 hover:text-v3-ink"
            >
              Parent dashboard
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
