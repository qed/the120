// Pure helper for §08 "The Path": choose which voice of the five Path phases to
// render. The Kids audience gets a "KID VOICE | ORIGINAL" sub-toggle; only the
// combination (audience === "kids" && kidVoice) shows the kid-voiced phases
// (`pathStepsKid`). Every other state — Parents (the control isn't even shown)
// and Kids + ORIGINAL — shows the original `pathSteps`.
//
// Plain, side-effect-free module (repo canon: unit-tested in `node`, no DOM
// harness). No "use server" — the single export is an ordinary function.

import { pathSteps, pathStepsKid } from "./data";
import type { PathStep, PathStepKid } from "./data";
import type { Audience } from "./cta-source";

/**
 * The Path phases to render, chosen by audience + the Kids-only voice toggle.
 * - `kids` + KID VOICE (`kidVoice === true`) → `pathStepsKid` (kid wording)
 * - every other combination → `pathSteps` (the original wording)
 *
 * Both arrays hold five phases, each carrying exactly five pass criteria, so the
 * caller can index them positionally against the structural `pathSteps` fields
 * (num / key / title) that only exist on the original voice.
 */
export function criteriaFor(
  audience: Audience,
  kidVoice: boolean
): PathStep[] | PathStepKid[] {
  return audience === "kids" && kidVoice ? pathStepsKid : pathSteps;
}
