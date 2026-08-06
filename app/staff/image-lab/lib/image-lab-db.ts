import "server-only";

/**
 * Image Lab — THE ONE database handle, and the only module under
 * `app/staff/image-lab/` allowed to import a Supabase client at all
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4; the job is assigned by name in the Unit 1 migration header).
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 * All three `fp_image_lab_*` tables have RLS ENABLED WITH ZERO POLICIES and
 * `revoke all … from anon, authenticated`. That is the intended posture — the
 * `requireStaff()` gate in the request IS the authorization — but it has a
 * failure mode this repo has already been bitten by: server code holding the
 * ANON key fails every read and write with 42501 IN PRODUCTION while CI stays
 * green, because the tests inject fakes and a fake has no RLS
 * (docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-code-
 * is-postgrest-anon-key-2026-07-28.md).
 *
 * The migration header states the rule in prose and then says, correctly, that
 * PROSE IS NOT A MECHANISM. This module is the mechanism's first half: a single
 * import surface, so "which client does the Image Lab use" has exactly one
 * answer and one place to read it. The second half is
 * `__tests__/service-role-only.test.ts`, which fails if any other module under
 * the Lab imports a Supabase client, reaches for the anon key, or queries an
 * `fp_image_lab_*` table outside the loaders.
 *
 * ── WHY THE STAKES ARE HIGHER ON THE REFERENCE PATH ────────────────────────
 * By the time the registration INSERT runs, the browser has ALREADY pushed the
 * bytes direct to Storage. A 42501 there is not a failed request — it is a
 * failed request PLUS an orphaned object in the bucket, one per attempt, with no
 * row to name it. Getting the client right is the difference between an error
 * message and accumulating unattributable objects.
 *
 * ⚠ AND AN ORPHAN *CAN* BE TIDIED UP — an earlier version of this docblock said
 * it could not, which was simply false and was about to be inherited by Units
 * 5–6 as a reason to accept the gap. The append-only trigger is `before update
 * or delete` on the TABLE `fp_image_lab_references`; STORAGE OBJECTS have no
 * trigger and no policy, and the service role removes them freely. So
 * `reference-core.ts` deletes the object on every non-duplicate refusal arm of
 * registration. What a 42501 leaves behind is an orphan because the code never
 * REACHES that cleanup, not because cleanup is impossible.
 *
 * A thin named wrapper rather than a re-export: the name is what makes a call
 * site legible ("this is a service-role touch on Image Lab data") and what the
 * static guard can key on.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";

/** The service-role client every Image Lab DB and Storage touch goes through. */
export function imageLabDb() {
  return supabaseAdmin();
}

export type ImageLabDb = ReturnType<typeof imageLabDb>;
