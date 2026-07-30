"use server";

/**
 * Form-step Server Actions (unified-flow Unit 5) — thin wrappers over
 * `app/lib/funnel/form-step-core.ts` so a client component can invoke them
 * and the core's `deps` parameter never reaches the wire.
 *
 * PII discipline: no funnel event is emitted here (Unit 6 owns the merged
 * flow's emission call sites, behind the locked/read-only guard), and the
 * verdicts pass through untouched — they carry no form-field values by the
 * core's contract.
 */

import {
  saveFormStepCore,
  submitApplicationCore,
  type SaveFormStepResult,
  type SubmitApplicationResult,
} from "@/app/lib/funnel/form-step-core";

export async function saveFormStepAction(input: unknown): Promise<SaveFormStepResult> {
  return saveFormStepCore(input);
}

export async function submitApplicationAction(input: unknown): Promise<SubmitApplicationResult> {
  return submitApplicationCore(input);
}
