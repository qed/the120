/**
 * First Profit public-site CORES (real-public-site plan, Unit 2) — the
 * injected-db logic behind /api/fp/site/* : self-read, availability, claim,
 * publish. House core-module pattern (../login/profile-core.ts is the
 * sibling): plain module, NO "use server", NO `server-only`; the routes hand
 * in the service-role client + the impure edges, tests inject fakes.
 *
 * ── Atomic claim (the read-only-gate lesson, honored) ──
 * The claim's ARBITER is the fp_public_sites handle UNIQUE constraint hit by a
 * plain INSERT — never a select-then-insert gate, never an upsert (a blind
 * upsert's DO UPDATE arm would let a re-claim overwrite another row's
 * content; see the blind-upsert learning — there is deliberately NO onConflict
 * anywhere here). The pre-read below answers only the caller's OWN prior
 * claim (idempotent re-claim / already-claimed); losing any read-to-insert
 * race lands in the 23505 classifier, which is a designed branch, not an
 * error.
 *
 * ── No-transaction multi-step writes (compensation, not pretense) ──
 * PostgREST has no client transactions. The claim is ONE INSERT carrying the
 * full content snapshot (row is born content-complete — extraction happens
 * BEFORE the insert via the shared SQL function, so the single statement is
 * the atomic unit). Publish is ONE UPDATE (content re-sync + published +
 * first_published_at together — the CHECK constraint requires the stamp to
 * ride the same statement) followed by the parent email; a failed email never
 * rolls back the publish — it flags loudly for operator attention instead
 * (post-write verify + compensation, per the multi-step-write learning).
 *
 * ── Content enforcement ──
 * headline/one_liner are blocklist-enforced INSIDE the shared extraction
 * (fp_public_site_content → fp_clamp_public_text: blocked strings extract as
 * EMPTY, so the renderer's default copy shows) — ONE enforcement point shared
 * with the projection trigger, at the lowest shared writer (the content-safety
 * solution doc). This module deliberately does NOT re-screen the extraction's
 * output: the SQL checks the RAW value before truncation, and re-checking the
 * truncated text is not idempotent (see currentContent). Client screening is
 * UX; the extraction is the gate (a save-doc write can bypass the client
 * entirely, R20 threat model).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SITE_DOC_VERSION_GATE,
  type SiteContent,
  type SiteProduct,
} from "@/app/fp/lib/fp-public-site-rules";
import { buildFpSiteLiveNotice } from "@/app/fp/lib/parent-email/rules";
import {
  classifyClaimConflict,
  deriveSiteStatus,
  handleShapeVerdict,
  suggestHandleCandidates,
  SUGGESTION_RESULT_LIMIT,
  type SiteRowFlags,
  type SiteStatus,
} from "./site-rules";

export type SiteCoreDeps = {
  /** Service-role client. */
  db: SupabaseClient;
  /**
   * doc jsonb → clamped {headline, oneLiner} via the SHARED SQL extraction
   * (RPC public.fp_public_site_content, service role — granted in
   * 20260908120000_fp_public_sites_ops.sql). NULL result = extraction
   * unavailable (treated as "nothing extractable", never a hard failure —
   * projection freshness is publish's job to repeat). The TS spec
   * (extractSiteContent) is the test-side implementation.
   */
  extractContent: (doc: unknown) => Promise<SiteContent | null>;
  /** Resend wrapper (app/lib/email.ts sendEmail) — never throws. */
  sendMail: (input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<{ ok: boolean }>;
  /** Where the parent manages the page (the family dashboard URL). */
  manageUrl: string;
};

/* ------------------------------------------------------------- child gate */

export type FpChildResolution =
  | { ok: true; profileId: string; childId: string; fpUsername: string | null }
  | { ok: false; reason: "not_child" | "outage" };

/**
 * The FP child gate: the session's user must resolve to an EXISTING
 * fp_player_profiles row (NOT merely any authenticated JWT — the anon key can
 * mint fresh principals, R20). The child's fp_username rides along for the
 * feature-gate allowlist. Identity flows ONLY from the verified userId; no
 * profile id is ever accepted from a request body (R24).
 */
export async function resolveFpChild(
  db: SupabaseClient,
  userId: string
): Promise<FpChildResolution> {
  const res = await db
    .from("fp_player_profiles")
    .select("id, child_id, children!inner(fp_username)")
    .eq("user_id", userId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/site] child gate query failed: ${res.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = res.data as
    | { id?: unknown; child_id?: unknown; children?: { fp_username?: unknown } | { fp_username?: unknown }[] }
    | null;
  if (!row || typeof row.id !== "string" || typeof row.child_id !== "string") {
    return { ok: false, reason: "not_child" };
  }
  const child = Array.isArray(row.children) ? row.children[0] : row.children;
  const fpUsername =
    child && typeof child.fp_username === "string" && child.fp_username ? child.fp_username : null;
  return { ok: true, profileId: row.id, childId: row.child_id, fpUsername };
}

/* --------------------------------------------------------------- self-read */

/** The OWN row's projected (server-sanitized) public content — what the
 *  public page would render. Null when no row exists. `products` is the
 *  sanitized card array ({n, name, oneLiner} — see SiteProduct). */
export type SiteProjectedContent = { headline: string; oneLiner: string; products: SiteProduct[] };

export type SiteReadResult =
  | { ok: true; handle: string | null; status: SiteStatus; projected: SiteProjectedContent | null }
  | { ok: false; reason: "outage" };

type SiteRow = SiteRowFlags & {
  handle: string;
  headline: string;
  one_liner: string;
  products: SiteProduct[];
};

/** Defensive element filter for the products column read-back (server-written
 *  data, but the shape check keeps a malformed row from reaching the client). */
function coerceProducts(value: unknown): SiteProduct[] {
  if (!Array.isArray(value)) return [];
  const out: SiteProduct[] = [];
  for (const el of value) {
    const p = el as { n?: unknown; name?: unknown; oneLiner?: unknown } | null;
    if (
      p !== null &&
      typeof p === "object" &&
      typeof p.n === "number" &&
      typeof p.name === "string" &&
      typeof p.oneLiner === "string"
    ) {
      out.push({ n: p.n, name: p.name, oneLiner: p.oneLiner });
    }
  }
  return out;
}

async function readOwnSiteRow(
  db: SupabaseClient,
  profileId: string
): Promise<{ ok: true; row: SiteRow | null } | { ok: false }> {
  const res = await db
    .from("fp_public_sites")
    .select("handle, headline, one_liner, products, published, operator_locked, first_published_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/site] own-row read failed: ${res.error.message}`);
    return { ok: false };
  }
  const row = res.data as
    | {
        handle?: unknown;
        headline?: unknown;
        one_liner?: unknown;
        products?: unknown;
        published?: unknown;
        operator_locked?: unknown;
        first_published_at?: unknown;
      }
    | null;
  if (!row) return { ok: true, row: null };
  if (typeof row.handle !== "string") return { ok: false };
  return {
    ok: true,
    row: {
      handle: row.handle,
      headline: typeof row.headline === "string" ? row.headline : "",
      one_liner: typeof row.one_liner === "string" ? row.one_liner : "",
      products: coerceProducts(row.products),
      published: row.published === true,
      operator_locked: row.operator_locked === true,
      first_published_at: typeof row.first_published_at === "string" ? row.first_published_at : null,
    },
  };
}

/**
 * The split-storage READ-BACK (designed with the write, per the lesson): what
 * FP hydrate and room-open consume. `offline` deliberately covers BOTH
 * parent-unpublished and operator-locked without distinguishing them.
 *
 * `projected` (Unit 7 review, cross-repo divergence fix) is the OWN row's
 * server-sanitized content — the exact strings the public page renders. It
 * lets the FP room tell the learner when a typed headline/one-liner was
 * stored empty by the blocklist (the public page shows default copy) instead
 * of silently previewing raw text forever. Own-row data only — no new
 * exposure beyond what the child already wrote and the anon RPC would serve.
 */
export async function readSiteStatus(
  db: SupabaseClient,
  profileId: string
): Promise<SiteReadResult> {
  const read = await readOwnSiteRow(db, profileId);
  if (!read.ok) return { ok: false, reason: "outage" };
  return {
    ok: true,
    handle: read.row?.handle ?? null,
    status: deriveSiteStatus(read.row),
    projected: read.row
      ? { headline: read.row.headline, oneLiner: read.row.one_liner, products: read.row.products }
      : null,
  };
}

/* ------------------------------------------------------------ availability */

export type AvailabilityResult =
  | { ok: true; verdict: "available" | "taken" | "yours" | "invalid"; suggestions: string[] }
  | { ok: false; reason: "outage" };

/** DB-side taken filter for suggestion candidates: one `in` query, keep the
 *  first SUGGESTION_RESULT_LIMIT free ones (each already passed the identical
 *  validate → reserved → blocklist pipeline in suggestHandleCandidates). */
async function filterFreeSuggestions(
  db: SupabaseClient,
  candidates: readonly string[]
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const res = await db
    .from("fp_public_sites")
    .select("handle")
    .in("handle", candidates as string[]);
  if (res.error) {
    // Suggestions are a nicety: degrade to none rather than failing the answer.
    console.error(`[fp/site] suggestion taken-check failed: ${res.error.message}`);
    return [];
  }
  const taken = new Set(((res.data ?? []) as { handle?: unknown }[]).map((r) => String(r.handle)));
  return candidates.filter((c) => !taken.has(c)).slice(0, SUGGESTION_RESULT_LIMIT);
}

export async function checkAvailability(
  db: SupabaseClient,
  input: { profileId: string; rawHandle: string }
): Promise<AvailabilityResult> {
  const shaped = handleShapeVerdict(input.rawHandle);
  if (!shaped.ok) return { ok: true, verdict: "invalid", suggestions: [] };
  const res = await db
    .from("fp_public_sites")
    .select("profile_id")
    .eq("handle", shaped.handle)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/site] availability read failed: ${res.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const owner = (res.data as { profile_id?: unknown } | null)?.profile_id;
  if (owner === undefined || owner === null) {
    return { ok: true, verdict: "available", suggestions: [] };
  }
  if (owner === input.profileId) return { ok: true, verdict: "yours", suggestions: [] };
  // Taken by someone else — NEVER identifies the other owner. Suggestions ride
  // the identical validation pipeline + a DB taken-check.
  return {
    ok: true,
    verdict: "taken",
    suggestions: await filterFreeSuggestions(db, suggestHandleCandidates(shaped.handle)),
  };
}

/* ------------------------------------------------------------------- claim */

export type ClaimResult =
  | { ok: true; handle: string; status: SiteStatus }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "taken"; suggestions: string[] }
  | { ok: false; reason: "already-claimed"; handle: string }
  | { ok: false; reason: "outage" };

/** Content snapshot for the claim backfill / publish re-sync: current doc →
 *  docVersion gate → shared extraction. NULL sentinel = key absent/
 *  unextractable. Blocklist enforcement lives INSIDE the shared extraction
 *  (fp_clamp_public_text: raw-value check, then truncate — the lowest shared
 *  writer, per docs/solutions/security-issues/content-safety-must-live-at-the-
 *  lowest-shared-writer-not-the-api-endpoints-2026-08-03.md) and is
 *  deliberately NOT re-run here: the SQL checks the RAW value BEFORE
 *  truncation, so re-screening the TRUNCATED output is not idempotent — a
 *  legitimate headline whose 120-char cut lands right after a word-class
 *  fragment ("...a proven meth|odology") would token-match the fragment and
 *  be blanked here while the SQL correctly kept it (Unit 7 review P2). */
async function currentContent(
  deps: SiteCoreDeps,
  profileId: string
): Promise<{ headline: string | null; oneLiner: string | null; products: SiteProduct[] | null }> {
  const none = { headline: null, oneLiner: null, products: null };
  const save = await deps.db
    .from("fp_player_saves")
    .select("doc")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (save.error || !save.data) return none;
  const doc = (save.data as { doc?: unknown }).doc;
  // docVersion gate — the SAME rule as the projection trigger (a JSON number
  // whose text form is SITE_DOC_VERSION_GATE): an unknown/missing version must
  // be SKIPPED here too, never fed to the extraction (the rules-module
  // contract for Unit 2 callers).
  const version = (doc as { docVersion?: unknown } | null | undefined)?.docVersion;
  if (typeof version !== "number" || String(version) !== SITE_DOC_VERSION_GATE) {
    return none;
  }
  const extracted = await deps.extractContent(doc);
  if (!extracted) return none;
  return { headline: extracted.headline, oneLiner: extracted.oneLiner, products: extracted.products };
}

/** The child's roster first name (the120 profile is authoritative). */
async function rosterFirstName(db: SupabaseClient, childId: string): Promise<string> {
  const res = await db.from("children").select("first_name").eq("id", childId).maybeSingle();
  const name = (res.data as { first_name?: unknown } | null)?.first_name;
  return typeof name === "string" ? name : "";
}

export async function claimSite(
  deps: SiteCoreDeps,
  input: { profileId: string; childId: string; rawHandle: string }
): Promise<ClaimResult> {
  const shaped = handleShapeVerdict(input.rawHandle);
  if (!shaped.ok) return { ok: false, reason: "invalid" };

  // Own prior claim (cheap answer, NOT the arbiter — see module header):
  const existing = await readOwnSiteRow(deps.db, input.profileId);
  if (!existing.ok) return { ok: false, reason: "outage" };
  if (existing.row) {
    if (existing.row.handle === shaped.handle) {
      // Idempotent re-claim of the caller's own handle (timeout-retry path).
      return { ok: true, handle: existing.row.handle, status: deriveSiteStatus(existing.row) };
    }
    // One site per learner; no renames in v1.
    return { ok: false, reason: "already-claimed", handle: existing.row.handle };
  }

  // Snapshot content BEFORE the one atomic INSERT: the row is born
  // content-complete. A doc edit racing this window is healed by the
  // projection trigger (row now exists) and by publish's authoritative re-sync.
  const [content, firstName] = await Promise.all([
    currentContent(deps, input.profileId),
    rosterFirstName(deps.db, input.childId),
  ]);

  // Publish-state columns written EXPLICITLY at their defaults (a claim is
  // never a publish — R9b): self-documenting, and the row is complete without
  // leaning on DB defaults.
  const inserted = await deps.db.from("fp_public_sites").insert({
    profile_id: input.profileId,
    handle: shaped.handle,
    first_name: firstName,
    headline: content.headline ?? "",
    one_liner: content.oneLiner ?? "",
    products: content.products ?? [],
    published: false,
    operator_locked: false,
    first_published_at: null,
  });
  if (!inserted.error) return { ok: true, handle: shaped.handle, status: "claimed" };

  if (inserted.error.code === "23505") {
    const kind = classifyClaimConflict(
      `${inserted.error.message} ${inserted.error.details ?? ""}`
    );
    if (kind === "handle") {
      // Lost the race / taken since the availability badge — the DESIGNED
      // branch (client-minted-idempotency-key learning), with fresh
      // suggestions so the flow never dead-ends.
      return {
        ok: false,
        reason: "taken",
        suggestions: await filterFreeSuggestions(deps.db, suggestHandleCandidates(shaped.handle)),
      };
    }
    if (kind === "profile") {
      // A concurrent claim by the SAME account won: re-read and answer
      // idempotently (adopt) or as already-claimed.
      const won = await readOwnSiteRow(deps.db, input.profileId);
      if (won.ok && won.row) {
        return won.row.handle === shaped.handle
          ? { ok: true, handle: won.row.handle, status: deriveSiteStatus(won.row) }
          : { ok: false, reason: "already-claimed", handle: won.row.handle };
      }
      return { ok: false, reason: "outage" };
    }
  }
  // The reserved-handle guard raises P0001 'reserved' — shape screening makes
  // this unreachable, but a hostile-timed seed change lands here safely.
  if (/reserved/i.test(inserted.error.message)) return { ok: false, reason: "invalid" };
  console.error(`[fp/site] claim insert failed: ${inserted.error.message}`);
  return { ok: false, reason: "outage" };
}

/* ----------------------------------------------------------------- publish */

export type PublishResult =
  | { ok: true; status: "published"; firstPublish: boolean; parentNotified: boolean }
  | { ok: false; reason: "no-site" }
  | { ok: false; reason: "locked"; status: "offline" }
  | { ok: false; reason: "outage" };

/**
 * Publish = the explicit go-live call (NEVER inferred from save writes). In
 * order: refuse when locked (no write, no email, locked state in the answer);
 * re-sync content from the current doc + first_name from the roster; flip
 * `published` AND stamp `first_published_at` in the SAME statement (the
 * published-implies-stamped CHECK requires it; idempotency: the stamp is
 * written only when null); then notify the parent on every hidden→visible
 * transition. Email failure or a missing parent email NEVER un-publishes —
 * it flags loudly for operator attention (notification is the discovery
 * path; silent failure is forbidden).
 */
export async function publishSite(
  deps: SiteCoreDeps,
  input: { profileId: string; childId: string }
): Promise<PublishResult> {
  const existing = await readOwnSiteRow(deps.db, input.profileId);
  if (!existing.ok) return { ok: false, reason: "outage" };
  if (!existing.row) return { ok: false, reason: "no-site" };
  if (existing.row.operator_locked) {
    // Operator lock ALWAYS wins: nothing becomes visible, no email, and the
    // child sees the same undistinguished offline state the self-read shows.
    return { ok: false, reason: "locked", status: "offline" };
  }

  const everPublished = existing.row.first_published_at !== null;

  // Authoritative refresh: publish is the moment content becomes visible.
  const [content, firstName] = await Promise.all([
    currentContent(deps, input.profileId),
    rosterFirstName(deps.db, input.childId),
  ]);
  const contentPatch = {
    first_name: firstName,
    ...(content.headline !== null ? { headline: content.headline } : {}),
    ...(content.oneLiner !== null ? { one_liner: content.oneLiner } : {}),
    ...(content.products !== null ? { products: content.products } : {}),
  };
  const nowIso = new Date().toISOString();

  // ── CAS on the visibility transition (double-email race, review item) ──
  // ONE statement: content + published + first_published_at together, guarded
  // by BOTH `operator_locked = false` (a lock landing between the read above
  // and this write must win) AND `published = false` — the CAS. A returned
  // row means THIS call owns the hidden→visible transition and therefore the
  // R21 email; zero rows means either already-visible (a concurrent publish
  // won — refresh content only, send NOTHING) or locked-meanwhile.
  //
  // DELIBERATE PER PLAN: a child republish after a PARENT takedown is a
  // designed hidden→visible transition and RE-NOTIFIES the parent (R21/R22).
  // Unit 6's client must therefore never auto-retry publish while the status
  // is `offline` — only an explicit child action may land here.
  //
  // ACCEPTED GAP (round-2 review, documented not defended): if the function
  // dies BETWEEN this CAS landing and notifyParent completing (process kill /
  // deploy cutover mid-request), the R21 email is lost with no attention flag
  // — a retry takes the refresh arm (the CAS already consumed the
  // transition). Accepted at this scale because the window is one in-process
  // await on a low-volume endpoint and the failure needs a platform-level
  // kill at exactly that instant; an email outbox is deliberately NOT built
  // for it. Operator recovery: the migration's POST-APPLY/ops note carries
  // the reconciliation query (recent first_published_at vs the mail log).
  const transition = await deps.db
    .from("fp_public_sites")
    .update({
      ...contentPatch,
      published: true,
      first_published_at: existing.row.first_published_at ?? nowIso,
      updated_at: nowIso,
    })
    .eq("profile_id", input.profileId)
    .eq("operator_locked", false)
    .eq("published", false)
    .select("handle, headline");
  if (transition.error) {
    console.error(`[fp/site] publish write failed: ${transition.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const won = ((transition.data ?? []) as { handle?: unknown; headline?: unknown }[])[0];
  if (won && typeof won.handle === "string") {
    // This call flipped hidden→visible: it owns the notification.
    const parentNotified = await notifyParent(deps, {
      childId: input.childId,
      childFirstName: firstName,
      handle: won.handle,
      headline: typeof won.headline === "string" ? won.headline : "",
    });
    return { ok: true, status: "published", firstPublish: !everPublished, parentNotified };
  }

  // CAS missed: already visible (idempotent republish / concurrent winner) or
  // locked. Refresh content only — still lock-guarded, never a flag write,
  // never an email.
  const refresh = await deps.db
    .from("fp_public_sites")
    .update({ ...contentPatch, updated_at: nowIso })
    .eq("profile_id", input.profileId)
    .eq("operator_locked", false)
    .select("handle, published");
  if (refresh.error) {
    console.error(`[fp/site] publish refresh failed: ${refresh.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = ((refresh.data ?? []) as { handle?: unknown; published?: unknown }[])[0];
  if (!row || typeof row.handle !== "string" || row.published !== true) {
    // Zero rows (or a row that is not visible): a lock landed between read
    // and write, or a concurrent unpublish — the hidden state wins; nothing
    // was published or sent by this call.
    return { ok: false, reason: "locked", status: "offline" };
  }
  return { ok: true, status: "published", firstPublish: false, parentNotified: false };
}

/** Resolve the parent's email off the roster and send the R21 notice.
 *  Compensation-style: any failure returns false AND logs the loud
 *  operator-attention flag — the publish already stands. */
async function notifyParent(
  deps: SiteCoreDeps,
  input: { childId: string; childFirstName: string; handle: string; headline: string }
): Promise<boolean> {
  const attention = (why: string): false => {
    // The single loud marker an operator can alert on: a child's page went
    // live and the parent notification did NOT go out.
    console.error(
      `[fp/site] OPERATOR ATTENTION: page went live for child ${input.childId} but the parent was NOT notified (${why})`
    );
    return false;
  };
  // The WHOLE body is wrapped (review item): a THROWING read (vs a returned
  // .error) would otherwise skip the attention flag and be eaten upstream —
  // and because the CAS makes notification once-per-transition, that R21
  // email would then be lost forever, silently. Every failure mode funnels
  // through attention().
  try {
    const child = await deps.db
      .from("children")
      .select("parent_id")
      .eq("id", input.childId)
      .maybeSingle();
    const parentId = (child.data as { parent_id?: unknown } | null)?.parent_id;
    if (child.error || typeof parentId !== "string") return attention("no parent mapping");
    const parent = await deps.db
      .from("parents")
      .select("email, first_name")
      .eq("id", parentId)
      .maybeSingle();
    const parentRow = parent.data as { email?: unknown; first_name?: unknown } | null;
    const email = typeof parentRow?.email === "string" ? parentRow.email.trim() : "";
    if (parent.error || !email) return attention("no parent email on file");

    const rendered = buildFpSiteLiveNotice({
      parentFirstName: typeof parentRow?.first_name === "string" ? parentRow.first_name : null,
      childFirstName: input.childFirstName,
      handle: input.handle,
      headline: input.headline,
      manageUrl: deps.manageUrl,
    });
    const sent = await deps.sendMail({ to: email, ...rendered });
    if (!sent.ok) return attention("send failed");
    return true;
  } catch (err) {
    return attention(
      `threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
