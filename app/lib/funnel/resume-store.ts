import "server-only";

/**
 * The persistence seam for the return path (funnel U3) — ONE narrow function
 * per database operation, instead of a hand-authored structural type
 * mirroring PostgREST's chained builders.
 *
 * That earlier shape cost more than it bought: it needed `as unknown as` on
 * both the production clients and the test fakes, which turns the type
 * checker OFF at exactly the seam it was supposed to guard — a supabase-js
 * version bump could rename a method and nothing would fail to compile. Each
 * function below takes and returns plain data, so production passes the real
 * client with no cast and tests pass literal-returning stubs.
 *
 * The rate limiter lives here too, EXPORTED: U6's capture endpoint needs the
 * same DB-backed insert-then-count treatment, and the plan warns that a
 * second hand-derived copy is how two implementations drift apart.
 */

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { assertNoAuthMailToFwStudent } from "@/app/fp/lib/fw-provision-rules";
import { rateCountVerdict, type FunnelRateLimit } from "@/app/lib/funnel/resume-rules";

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export type StoredResumeToken = {
  parentId: string;
  email: string;
  expiresAt: string;
  redeemedAt: string | null;
};

export type ResumeStore = {
  /** Records an attempt, then counts the window INCLUDING it. */
  recordRateEvent: (bucket: string, key: string) => Promise<string | null>;
  countRateEvents: (bucket: string, key: string, sinceIso: string) => Promise<number | null>;
  releaseRateEvent: (eventId: string) => Promise<void>;
  /** Opportunistic prune of rows older than any live window. */
  pruneRateEvents: (beforeIso: string) => Promise<void>;

  findParentIdByEmail: (email: string) => Promise<{ ok: true; id: string | null } | { ok: false }>;
  parentRowExists: (parentId: string) => Promise<boolean | null>;
  insertParentRow: (parentId: string, email: string) => Promise<boolean>;

  insertToken: (row: {
    parentId: string;
    email: string;
    tokenHash: string;
    expiresAt: string;
  }) => Promise<boolean>;
  loadToken: (
    tokenHash: string
  ) => Promise<{ ok: true; row: StoredResumeToken | null } | { ok: false }>;
  /** Single-use CAS. Returns rows affected, or null on error. */
  claimToken: (tokenHash: string, redeemedAtIso: string) => Promise<number | null>;
  /** Compensation: give an un-minted claim back to the family. */
  unclaimToken: (tokenHash: string) => Promise<void>;

  loadChildren: (
    parentId: string
  ) => Promise<
    | {
        ok: true;
        rows: {
          id: string;
          applicantState: unknown;
          createdAt: string;
          status: unknown;
          /** The v3 per-child FP discriminator (plan Unit 8). Optional: a
           *  store built before this unit is a shape we tolerate, and absent
           *  reads as "not FP". */
          fpUsername?: string | null;
        }[];
      }
    | { ok: false }
  >;

  mintSessionFor: (email: string) => Promise<{
    ok: true;
    user: { id: string; appMetadata: Record<string, unknown> | null };
  } | { ok: false }>;
};

/** Production implementation — no casts; each call is checked against the real client. */
export function realResumeStore(
  serverClient: () => Promise<{
    auth: {
      verifyOtp: (o: { type: "email"; token_hash: string }) => Promise<{
        data: { user: { id: string; app_metadata?: Record<string, unknown> } | null };
        error: unknown;
      }>;
    };
  }>
): ResumeStore {
  const admin = supabaseAdmin();
  return {
    async recordRateEvent(bucket, key) {
      const { data, error } = await admin
        .from("funnel_rate_events")
        .insert({ bucket, key_hash: sha256Hex(key) })
        .select("id")
        .single();
      if (error || !data) return null;
      return String(data.id);
    },
    async countRateEvents(bucket, key, sinceIso) {
      const { count, error } = await admin
        .from("funnel_rate_events")
        .select("id", { count: "exact", head: true })
        .eq("bucket", bucket)
        .eq("key_hash", sha256Hex(key))
        .gte("created_at", sinceIso);
      if (error || count === null) return null;
      return count;
    },
    async releaseRateEvent(eventId) {
      const { error } = await admin.from("funnel_rate_events").delete().eq("id", eventId);
      if (error) console.error(`[funnel/resume] strike release failed: ${error.message}`);
    },
    async pruneRateEvents(beforeIso) {
      const { error } = await admin
        .from("funnel_rate_events")
        .delete()
        .lt("created_at", beforeIso);
      if (error) console.error(`[funnel/resume] rate prune failed: ${error.message}`);
    },
    async findParentIdByEmail(email) {
      const { data, error } = await admin.from("parents").select("id").eq("email", email).limit(1);
      if (error) return { ok: false };
      return { ok: true, id: data?.[0]?.id ? String(data[0].id) : null };
    },
    async parentRowExists(parentId) {
      const { data, error } = await admin
        .from("parents")
        .select("id")
        .eq("id", parentId)
        .maybeSingle();
      if (error) return null;
      return data !== null;
    },
    async insertParentRow(parentId, email) {
      const { error } = await admin.from("parents").insert({ id: parentId, email });
      if (error) {
        console.error(`[funnel/resume] parents self-heal failed for ${parentId}: ${error.message}`);
        return false;
      }
      return true;
    },
    async insertToken(row) {
      const { error } = await admin.from("funnel_resume_tokens").insert({
        parent_id: row.parentId,
        email: row.email,
        token_hash: row.tokenHash,
        expires_at: row.expiresAt,
      });
      if (error) console.error(`[funnel/resume] token insert failed: ${error.message}`);
      return !error;
    },
    async loadToken(tokenHash) {
      const { data, error } = await admin
        .from("funnel_resume_tokens")
        .select("parent_id, email, expires_at, redeemed_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) return { ok: false };
      return {
        ok: true,
        row: data
          ? {
              parentId: String(data.parent_id),
              email: String(data.email),
              expiresAt: String(data.expires_at),
              redeemedAt: (data.redeemed_at as string | null) ?? null,
            }
          : null,
      };
    },
    async claimToken(tokenHash, redeemedAtIso) {
      const { data, error } = await admin
        .from("funnel_resume_tokens")
        .update({ redeemed_at: redeemedAtIso })
        .eq("token_hash", tokenHash)
        .is("redeemed_at", null)
        .select("id");
      if (error) return null;
      return (data ?? []).length;
    },
    async unclaimToken(tokenHash) {
      const { error } = await admin
        .from("funnel_resume_tokens")
        .update({ redeemed_at: null })
        .eq("token_hash", tokenHash);
      if (error) console.error(`[funnel/resume] unclaim failed: ${error.message}`);
    },
    async loadChildren(parentId) {
      const { data, error } = await admin
        .from("children")
        .select("id, applicant_state, created_at, status, fp_username")
        .eq("parent_id", parentId)
        .limit(200);
      if (error) return { ok: false };
      return {
        ok: true,
        rows: (data ?? []).map((k) => ({
          id: String(k.id),
          applicantState: k.applicant_state,
          createdAt: String(k.created_at),
          status: k.status,
          fpUsername: typeof k.fp_username === "string" ? k.fp_username : null,
        })),
      };
    },
    async mintSessionFor(email) {
      // The guard sits WITH the mail-capable call, not only in the caller —
      // and the enforcement test proved why: extracting this function into
      // its own module moved `generateLink` away from the core's guard, and
      // `no-auth-mail-guard.test.ts` reddened on the refactor. A guard one
      // file away from its call is one refactor from being no guard at all.
      assertNoAuthMailToFwStudent(email, "funnel/resume mintSession");
      // generateLink DOES NOT SEND for type "magiclink" — it returns the
      // properties and leaves delivery to the caller. Ours never leaves this
      // process: it is verified in-band immediately below. Our own Resend
      // mail carried OUR token, and the CAS win is what authorizes this.
      const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (link.error || !link.data.properties) {
        console.error(`[funnel/resume] generateLink failed: ${link.error?.message}`);
        return { ok: false };
      }
      const supabase = await serverClient();
      const otp = await supabase.auth.verifyOtp({
        type: "email",
        token_hash: link.data.properties.hashed_token,
      });
      if (otp.error || !otp.data.user) {
        console.error(`[funnel/resume] verifyOtp failed`);
        return { ok: false };
      }
      return {
        ok: true,
        user: { id: otp.data.user.id, appMetadata: otp.data.user.app_metadata ?? null },
      };
    },
  };
}

/**
 * The shared DB-backed limiter (R7d), EXPORTED for U6.
 *
 * Insert-then-count: record first, then count including your own row, so two
 * racers at the boundary both see the inflated count and both fail closed —
 * the count-then-insert TOCTOU (both see room, both pass) is unrepresentable.
 * Returns the event id so an INFRA failure can hand the strike back; a
 * genuine denial keeps it.
 */
export async function checkFunnelRateLimit(
  store: ResumeStore,
  bucket: string,
  key: string,
  cfg: FunnelRateLimit,
  nowMs: number
): Promise<{ allowed: boolean; eventId: string | null; infraFailed: boolean }> {
  const eventId = await store.recordRateEvent(bucket, key);
  if (eventId === null) return { allowed: false, eventId: null, infraFailed: true };
  const count = await store.countRateEvents(bucket, key, new Date(nowMs - cfg.windowMs).toISOString());
  if (count === null) return { allowed: false, eventId, infraFailed: true };
  return { allowed: rateCountVerdict(count, cfg), eventId, infraFailed: false };
}
