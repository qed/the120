/**
 * First Profit player-profile ensure (Slice A Unit 2) — the shared core the
 * login route calls on every successful child auth, and the module Slice B's
 * signup route will import as a second caller. House core-module pattern
 * (documented atop app/fp/lib/actions/provision.ts): plain module, NO
 * "use server" (its exports would become public Server Actions), NO
 * `server-only` (the shape stays testable); callers hand in the service-role
 * client.
 *
 * Write discipline (per the plan and the no-transaction learning):
 *   - select-then-insert-if-absent — NEVER a full-row upsert, whose DO UPDATE
 *     arm would overwrite `handle` with freshly-derived defaults on every
 *     login.
 *   - 23505 on user_id/child_id → a concurrent login won the race: re-select
 *     and ADOPT the existing row untouched.
 *   - 23505 on handle → re-derive with the next suffix, bounded retries.
 *   - the fp_player_saves row (revision 0, doc {}) is seeded HERE, on-conflict-
 *     do-nothing, so the client never inserts and the first-save race cannot
 *     exist.
 *   - identity agreement with path_student_profiles is checked here as the
 *     friendly path; the DB trigger (fp_player_profiles_identity_guard) is the
 *     mechanism.
 *
 * PRECONDITION (see ensurePlayerProfile): the caller has ALREADY resolved this
 * user's child_id through the gate — a `path_student_profiles` lookup by
 * user_id — and passes it as `input.childId`. So the user→child_id direction
 * is established; this core does not re-run that identical query, only the
 * child→user direction the gate did not cover.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  classifyInsertConflict,
  deriveHandle,
  deriveHandleWithSuffix,
  HANDLE_PATTERN,
} from "./profile-rules";

// Sequential base..base5 attempts, then a few crypto-random-suffix attempts so
// a 6th same-base-handle child's FIRST login can never wedge on handle
// exhaustion. The random tail is what makes the effective budget collision-
// resistant rather than merely larger.
const MAX_HANDLE_SEQUENTIAL = 5;
const MAX_HANDLE_RANDOM = 4;
const MAX_HANDLE_ATTEMPTS = MAX_HANDLE_SEQUENTIAL + MAX_HANDLE_RANDOM;

/**
 * 4 hex chars from a v4 UUID — lowercase `[0-9a-f]`, always satisfies
 * HANDLE_PATTERN. Minted HERE (the impure boundary), never inside a pure
 * function; injectable so tests are deterministic.
 */
function defaultRandomSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 4);
}

export type EnsureProfileResult =
  | { ok: true; profileId: string; handle: string }
  | {
      ok: false;
      reason:
        | "load_failed"
        | "identity_mismatch"
        | "insert_failed"
        | "handle_exhausted"
        | "save_seed_failed";
    };

type ProfileRow = { id: string; handle: string; child_id?: string };

export async function ensurePlayerProfile(
  db: SupabaseClient,
  input: {
    userId: string;
    childId: string;
    firstName: string;
    /**
     * Test seam only: mints the random handle-suffix fallback. Production
     * callers omit it and get the crypto-backed default; a test injects a
     * deterministic generator to exercise the fallback path.
     */
    randomSuffix?: () => string;
  }
): Promise<EnsureProfileResult> {
  // 1. Existing profile → adopt as-is (handle is minted once, never re-derived).
  //    But first assert its child_id still agrees with the freshly-gated child:
  //    the DB identity trigger only fires on INSERT/UPDATE of user_id/child_id,
  //    so a plain adopt would otherwise silently return a stale profile (and its
  //    save/ledger) if an admin ever re-pointed the path_student_profiles
  //    mapping after this row was created.
  const existing = await db
    .from("fp_player_profiles")
    .select("id, handle, child_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existing.error) {
    console.error(`[fp/login] profile load failed: ${existing.error.message}`);
    return { ok: false, reason: "load_failed" };
  }
  if (existing.data && isProfileRow(existing.data)) {
    if (existing.data.child_id !== input.childId) {
      console.error(
        `[fp/login] identity mismatch: existing profile for user ${input.userId} binds a different child_id than the gate resolved`
      );
      return { ok: false, reason: "identity_mismatch" };
    }
    return seedSave(db, existing.data);
  }

  // 2. Identity agreement with path_student_profiles, the child→user direction
  //    ONLY: this child must not already be bound to a DIFFERENT user. The
  //    user→child direction is a precondition (the caller's gate resolved
  //    input.childId from this user_id via the identical query), so re-running
  //    `select child_id where user_id` here would just re-confirm what the gate
  //    already established — dead I/O on every new-player login. (The DB trigger
  //    enforces both directions regardless; this is the friendly path that
  //    returns a clean refusal instead of a raise.)
  const byChild = await db
    .from("path_student_profiles")
    .select("user_id")
    .eq("child_id", input.childId)
    .maybeSingle();
  if (byChild.error) {
    console.error(`[fp/login] identity check failed: ${byChild.error.message}`);
    return { ok: false, reason: "load_failed" };
  }
  if (byChild.data && byChild.data.user_id !== input.userId) {
    console.error(
      `[fp/login] identity mismatch: child ${input.childId} maps to a different user in path_student_profiles`
    );
    return { ok: false, reason: "identity_mismatch" };
  }

  // 3. Insert with bounded handle uniquification: the sequential base..base5
  //    first, then crypto-random-suffix candidates so a same-base-handle child
  //    beyond the numeric run still resolves to a free handle instead of
  //    wedging on handle_exhausted forever.
  const randomSuffix = input.randomSuffix ?? defaultRandomSuffix;
  for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt++) {
    const handle =
      attempt < MAX_HANDLE_SEQUENTIAL
        ? deriveHandle(input.firstName, attempt)
        : deriveHandleWithSuffix(input.firstName, randomSuffix());
    if (!HANDLE_PATTERN.test(handle)) {
      // deriveHandle guarantees this; belt-and-suspenders against drift from
      // the DB check constraint (which would reject the insert anyway).
      console.error(`[fp/login] derived handle failed shape check`);
      return { ok: false, reason: "insert_failed" };
    }
    const inserted = await db
      .from("fp_player_profiles")
      .insert({ user_id: input.userId, child_id: input.childId, handle })
      .select("id, handle")
      .single();
    if (!inserted.error && inserted.data && isProfileRow(inserted.data)) {
      return seedSave(db, inserted.data);
    }
    if (inserted.error && inserted.error.code === "23505") {
      const kind = classifyInsertConflict(
        `${inserted.error.message} ${inserted.error.details ?? ""}`
      );
      if (kind === "handle") continue; // next suffix
      if (kind === "identity") {
        // Concurrent login created the row between our select and insert:
        // re-select and adopt it untouched.
        const adopted = await db
          .from("fp_player_profiles")
          .select("id, handle")
          .eq("user_id", input.userId)
          .maybeSingle();
        if (!adopted.error && adopted.data && isProfileRow(adopted.data)) {
          return seedSave(db, adopted.data);
        }
        console.error(`[fp/login] adopt-after-conflict re-select failed`);
        return { ok: false, reason: "insert_failed" };
      }
    }
    console.error(
      `[fp/login] profile insert failed: ${inserted.error?.message ?? "malformed row"}`
    );
    return { ok: false, reason: "insert_failed" };
  }
  console.error(`[fp/login] handle uniquification exhausted after ${MAX_HANDLE_ATTEMPTS} attempts`);
  return { ok: false, reason: "handle_exhausted" };
}

/**
 * Seed the save row (revision 0, empty doc) if absent — on conflict do
 * nothing, never touch an existing save. `ignoreDuplicates` makes the upsert
 * an INSERT ... ON CONFLICT DO NOTHING, so a returning login can never reset
 * a real save document.
 */
async function seedSave(db: SupabaseClient, profile: ProfileRow): Promise<EnsureProfileResult> {
  const res = await db
    .from("fp_player_saves")
    .upsert(
      { profile_id: profile.id, revision: 0, doc: {} },
      { onConflict: "profile_id", ignoreDuplicates: true }
    );
  if (res.error) {
    console.error(`[fp/login] save seed failed: ${res.error.message}`);
    return { ok: false, reason: "save_seed_failed" };
  }
  return { ok: true, profileId: profile.id, handle: profile.handle };
}

function isProfileRow(row: { id?: unknown; handle?: unknown; child_id?: unknown }): row is ProfileRow {
  return typeof row.id === "string" && typeof row.handle === "string";
}
