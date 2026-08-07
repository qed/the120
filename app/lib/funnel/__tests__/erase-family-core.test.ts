import { describe, expect, it, vi } from "vitest";
import { eraseFamily, type EraseFamilyDeps } from "../erase-family-core";
import {
  CHILD_LEAF_DELETE_ORDER,
  ERASURE_PRESERVED_TABLES,
  FAMILY_EVIDENCE_DELETE_ORDER,
  PARENT_SCOPED_DELETE_ORDER,
  RELEASED_CLAIM_PII_COLUMNS,
  RELEASED_CLAIM_PRESERVED_COLUMN,
  dedupeAuthUserIds,
  hasWorkspaceMailbox,
  planSubjectBlobDeletes,
} from "../erase-family-rules";

/**
 * A stateful in-memory Postgres-ish fake that ENFORCES the three RESTRICT FKs and
 * the children CASCADE (deposits) / SET-NULL (consent, attempts, AND the
 * provisioning claim + its released trigger), so a WRONG deletion order actually
 * raises 23503 (proving the order the core uses is the one that works). It records
 * every delete in call order for the "each table emptied in order" assertion.
 */
type Rows = Record<string, unknown>[];
type Tables = Record<string, Rows>;

function makeDb(seed: Tables, opts: { selectFaultTable?: string; deleteFaultTable?: string } = {}) {
  const t: Tables = JSON.parse(JSON.stringify(seed));
  const deleteLog: string[] = [];

  const matches = (row: Record<string, unknown>, filters: { col: string; val: unknown; kind: "eq" | "in" }[]) =>
    filters.every((f) => (f.kind === "in" ? (f.val as unknown[]).includes(row[f.col]) : row[f.col] === f.val));

  function runDelete(table: string, filters: { col: string; val: unknown; kind: "eq" | "in" }[]) {
    // Injected DELETE fault (the row-stage partial-failure path): deletes on
    // the named table fail; every other operation runs normally.
    if (opts.deleteFaultTable === table) {
      return { data: null, error: { message: `delete fault (injected) on ${table}` } };
    }
    const rows = t[table] ?? [];
    const doomed = rows.filter((r) => matches(r, filters));
    // RESTRICT enforcement (referenced side): refuse if a referencing row exists.
    for (const r of doomed) {
      if (table === "fp_player_profiles") {
        const pid = r.id;
        if (
          (t.fp_ledger ?? []).some((x) => x.profile_id === pid) ||
          (t.fp_player_saves ?? []).some((x) => x.profile_id === pid) ||
          // Real-public-site Unit 2: fp_public_sites.profile_id is RESTRICT too —
          // the site row must die FIRST or this raises (proving the order).
          (t.fp_public_sites ?? []).some((x) => x.profile_id === pid)
        ) {
          return { data: null, error: { message: `23503: fp_player_profiles ${pid} still referenced` } };
        }
      }
      if (table === "children") {
        const cid = r.id;
        if ((t.fp_player_profiles ?? []).some((x) => x.child_id === cid) || (t.path_student_profiles ?? []).some((x) => x.child_id === cid)) {
          return { data: null, error: { message: `23503: children ${cid} still referenced` } };
        }
      }
      // The Path student graph is student_id -> path_student_profiles ON
      // DELETE RESTRICT, for EVERY graph table. Modeled so the suite cannot
      // pin an ordering production refuses: the step-3b drain must empty all
      // seven tables before the step-4 profile delete can succeed.
      if (table === "path_student_profiles") {
        const sid = r.id;
        const graphTables = [
          "path_evidence_items",
          "path_reviews",
          "path_task_events",
          "path_notification_sends",
          "path_notification_events",
          "path_cohort_members",
          "path_fw_replay_rejects",
          "path_task_progress",
        ];
        for (const g of graphTables) {
          if ((t[g] ?? []).some((x) => x.student_id === sid)) {
            return { data: null, error: { message: `23503: path_student_profiles ${sid} still referenced by ${g}` } };
          }
        }
      }
      // The graph's ONE inter-table FK: path_evidence_items.(task_progress_id,
      // student_id) -> path_task_progress ON DELETE RESTRICT — evidence rows
      // must die before their progress row, proving the drain's order.
      if (table === "path_task_progress") {
        const pid = r.id;
        if ((t.path_evidence_items ?? []).some((x) => x.task_progress_id === pid)) {
          return { data: null, error: { message: `23503: path_task_progress ${pid} still referenced by evidence` } };
        }
      }
    }
    // Apply the delete.
    t[table] = rows.filter((r) => !matches(r, filters));
    deleteLog.push(`${table}(${doomed.length})`);
    // Image Lab: `fp_image_lab_images.run_id -> fp_image_lab_runs ON DELETE
    // CASCADE` (so the purge deletes runs and the image rows go with them), and
    // `iterated_from_run_id -> fp_image_lab_runs ON DELETE SET NULL` (which is
    // why the lineage MUST be walked before anything is deleted).
    if (table === "fp_image_lab_runs") {
      const gone = new Set(doomed.map((r) => r.id));
      t.fp_image_lab_images = (t.fp_image_lab_images ?? []).filter((x) => !gone.has(x.run_id));
      for (const r of t.fp_image_lab_runs ?? []) {
        if (gone.has(r.iterated_from_run_id)) r.iterated_from_run_id = null;
      }
    }
    // children side effects: deposits CASCADE; consent/attempts SET NULL; the
    // provisioning claim SET NULL + the released trigger (row SURVIVES).
    if (table === "children") {
      for (const r of doomed) {
        const cid = r.id;
        t.deposits = (t.deposits ?? []).filter((x) => x.child_id !== cid);
        // v3: fp_handoff_codes.child_id -> children ON DELETE CASCADE.
        t.fp_handoff_codes = (t.fp_handoff_codes ?? []).filter((x) => x.child_id !== cid);
        // v3: fp_onboarding_drafts.child_id -> children ON DELETE **SET NULL**.
        // Modeled precisely because it is the ordering hazard: a draft deleted
        // AFTER the roster row can no longer be found by child_id, so a test
        // that asserts the draft is gone is really asserting the order.
        for (const d of t.fp_onboarding_drafts ?? []) if (d.child_id === cid) d.child_id = null;
        // Image Lab: `fp_image_lab_runs.source_child_id -> children ON DELETE SET
        // NULL`. Modeled precisely because it is the SAME ordering hazard as the
        // drafts: a run purged AFTER the roster row can no longer be found by
        // child at all, so a test that asserts the run is gone is really
        // asserting the order.
        for (const r of t.fp_image_lab_runs ?? []) if (r.source_child_id === cid) r.source_child_id = null;
        for (const c of t.fp_parental_consent ?? []) if (c.child_id === cid) c.child_id = null;
        for (const a of t.fp_signup_attempts ?? []) if (a.child_id === cid) a.child_id = null;
        // NOT cascade: the claim's child_id → children is ON DELETE SET NULL, and
        // funnel_provisioning_child_deleted flips the orphan to released/child_deleted.
        for (const p of t.funnel_student_provisioning ?? []) {
          if (p.child_id === cid) {
            p.child_id = null;
            if (p.state !== "released") {
              p.state = "released";
              p.released_reason = p.released_reason ?? "child_deleted";
            }
            p.lease_owner = null;
            p.lease_expires_at = null;
          }
        }
      }
    }
    return { data: doomed, error: null };
  }

  function runUpdate(
    table: string,
    patch: Record<string, unknown>,
    filters: { col: string; val: unknown; kind: "eq" | "in" }[]
  ) {
    const rows = t[table] ?? [];
    const hit = rows.filter((r) => matches(r, filters));
    for (const r of hit) Object.assign(r, patch);
    return { data: hit, error: null };
  }

  type State = {
    table: string;
    op: "select" | "delete" | "update";
    filters: { col: string; val: unknown; kind: "eq" | "in" }[];
    patch?: Record<string, unknown>;
    /** PostgREST .range(from, to) — inclusive slice, like the real thing. */
    range?: { from: number; to: number };
  };
  function builder(state: State): Record<string, unknown> {
    const exec = () => {
      if (state.op === "delete") return runDelete(state.table, state.filters);
      if (state.op === "update") return runUpdate(state.table, state.patch ?? {}, state.filters);
      // Injected SELECT fault (the lock-read-error path): reads on the named
      // table fail; deletes/updates still run.
      if (opts.selectFaultTable === state.table) {
        return { data: null, error: { message: "select fault (injected)" } };
      }
      const rows = (t[state.table] ?? []).filter((r) => matches(r, state.filters));
      const sliced = state.range ? rows.slice(state.range.from, state.range.to + 1) : rows;
      return { data: sliced, error: null };
    };
    return {
      select() {
        return builder(state);
      },
      delete() {
        return builder({ ...state, op: "delete" });
      },
      update(patch: Record<string, unknown>) {
        return builder({ ...state, op: "update", patch });
      },
      eq(col: string, val: unknown) {
        return builder({ ...state, filters: [...state.filters, { col, val, kind: "eq" }] });
      },
      in(col: string, val: unknown[]) {
        return builder({ ...state, filters: [...state.filters, { col, val, kind: "in" }] });
      },
      range(from: number, to: number) {
        return builder({ ...state, range: { from, to } });
      },
      maybeSingle() {
        const r = exec();
        return Promise.resolve(r.error ? r : { data: (r.data && r.data[0]) ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
  }

  const db = { from: (table: string) => builder({ table, op: "select", filters: [] }) } as never;
  return { db, t, deleteLog };
}

/** Draft ids are real uuids because blob keys are NAMESPACED BY OWNER ID and the
 *  ownership guard (`keyBelongsTo`) parses them — a fake id would make every
 *  blob look "not owned" and the delete tests would prove the wrong thing. */
const DRAFT_A = "11111111-2222-4333-8444-555555555555";
const DRAFT_B = "22222222-3333-4444-8555-666666666666";
const DRAFT_ORPHAN = "33333333-4444-4555-8666-777777777777";
/** children ids used by the blob seeds (same reason). */
const CHILD_UUID = "44444444-5555-4666-8777-888888888888";

function seedFamily(): Tables {
  return {
    // path-a child (childA): one shared auth account authA (both profiles ref it)
    // path-b child (childB): auth authB + a provisioned mailbox (claim carries the
    // durable supabase_user_id + a burned local_part).
    children: [
      { id: "childA", parent_id: "parentU" },
      { id: "childB", parent_id: "parentU" },
    ],
    parents: [{ id: "parentU" }],
    fp_player_profiles: [
      { id: "ppA", user_id: "authA", child_id: "childA" },
      { id: "ppB", user_id: "authB", child_id: "childB" },
    ],
    fp_player_saves: [{ profile_id: "ppA" }, { profile_id: "ppB" }],
    fp_ledger: [
      { id: "l1", profile_id: "ppA" },
      { id: "l2", profile_id: "ppA" },
    ],
    path_student_profiles: [
      { id: "pspA", user_id: "authA", child_id: "childA" },
      { id: "pspB", user_id: "authB", child_id: "childB" },
    ],
    funnel_student_provisioning: [
      {
        id: "claimB",
        child_id: "childB",
        email: "childb@the120.school",
        workspace_attempted_email: "childb@the120.school",
        local_part: "childb",
        supabase_user_id: "authB",
        state: "complete",
      },
    ],
    fp_parental_consent: [
      { id: "c1", parent_id: "parentU", child_id: "childA", signup_attempt_id: "a1" },
      { id: "c2", parent_id: "parentU", child_id: "childB", signup_attempt_id: "a2" },
    ],
    fp_signup_attempts: [
      { id: "a1", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childA" },
      { id: "a2", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childB" },
    ],
    deposits: [{ child_id: "childA", parent_id: "parentU" }],
    // ── step 8b: the parent-keyed RESTRICT referrers of auth.users ──
    // The verifier grant EVERY v3 parent holds (the row that stranded the first
    // live erasure) plus one notification-send log line. Both must be swept or
    // the fake's deleteAuthUser refuses the parent delete.
    path_role_grants: [{ id: "g1", user_id: "parentU", role: "verifier" }],
    path_notification_sends: [
      { id: "n1", recipient_user_id: "parentU", kind: "path_weekly" },
    ],
    // ── New User Flow v3 ──
    // Live one-time sign-in codes (CASCADE-backed, deleted explicitly).
    fp_handoff_codes: [
      { id: "h1", child_id: "childA", code_hash: "hashA" },
      { id: "h2", child_id: "childB", code_hash: "hashB" },
    ],
    // The kid-first onboarding drafts: two carried to children, plus ONE
    // ABANDONED draft (child_id null) reachable only by parent_id — the row the
    // parent auth CASCADE would otherwise swallow silently.
    fp_onboarding_drafts: [
      {
        id: DRAFT_A,
        parent_id: "parentU",
        child_id: "childA",
        kid_first_name: "Ada",
        kid_age: 9,
        answers: { dream: "robots" },
        cover_data_url: "data:image/svg+xml;base64,AAA",
        photo_blob_key: null,
        cover_blob_key: null,
        status: "consumed",
      },
      {
        id: DRAFT_B,
        parent_id: "parentU",
        child_id: "childB",
        kid_first_name: "Bo",
        kid_age: 11,
        answers: { dream: "bakery" },
        cover_data_url: "data:image/svg+xml;base64,BBB",
        photo_blob_key: null,
        cover_blob_key: null,
        status: "consumed",
      },
      {
        id: DRAFT_ORPHAN,
        parent_id: "parentU",
        child_id: null,
        kid_first_name: "Cy",
        kid_age: 7,
        answers: { dream: "lemonade" },
        cover_data_url: "data:image/svg+xml;base64,CCC",
        photo_blob_key: null,
        cover_blob_key: null,
        status: "active",
      },
    ],
  };
}

/** seedFamily plus a fully ACTIVE childA: rows in every student-graph table,
 *  two evidence rows naming three real objects under pspA's own folder. The
 *  task-#16 scenario — before the drain, this family could not be erased. */
function activeChildSeed(): Tables {
  const seed = seedFamily();
  seed.path_task_progress = [{ id: "tp1", student_id: "pspA", state: "verified" }];
  seed.path_task_events = [
    { id: "te1", student_id: "pspA", transition: "submit", actor: "authA" },
    { id: "te2", student_id: "pspA", transition: "verify", actor: "parentU" },
  ];
  seed.path_reviews = [{ id: "rv1", student_id: "pspA", opened_by: "parentU" }];
  seed.path_evidence_items = [
    {
      id: "ev1",
      student_id: "pspA",
      task_progress_id: "tp1",
      bucket: "path-evidence",
      object_path: "pspA/ev1/photo.jpg",
      poster_object_path: null,
    },
    {
      id: "ev2",
      student_id: "pspA",
      task_progress_id: "tp1",
      bucket: "path-evidence",
      object_path: "pspA/ev2/video.mp4",
      poster_object_path: "pspA/ev2/poster.jpg",
    },
  ];
  seed.path_notification_events = [{ id: "ne1", student_id: "pspA", kind: "submitted" }];
  seed.path_notification_sends.push({
    id: "n2",
    recipient_user_id: "parentU",
    student_id: "pspA",
    kind: "submitted",
  });
  seed.path_cohort_members = [{ id: "cm1", student_id: "pspA", cohort_id: "cohort1" }];
  // The FW leg cohort membership concedes: a guide's rejected offline replay
  // about this student — student-keyed, RESTRICT, drained with the graph.
  seed.path_fw_replay_rejects = [{ id: "rr1", student_id: "pspA", action: "check_in" }];
  return seed;
}

/** A single path-b child, for the resumability strand/resume scenario (its auth
 *  account is recoverable across the profile deletion via the claim's
 *  supabase_user_id). */
function seedPathBOnly(): Tables {
  return {
    children: [{ id: "childB", parent_id: "parentU" }],
    parents: [{ id: "parentU" }],
    fp_player_profiles: [{ id: "ppB", user_id: "authB", child_id: "childB" }],
    fp_player_saves: [{ profile_id: "ppB" }],
    fp_ledger: [],
    path_student_profiles: [{ id: "pspB", user_id: "authB", child_id: "childB" }],
    funnel_student_provisioning: [
      {
        id: "claimB",
        child_id: "childB",
        email: "childb@the120.school",
        workspace_attempted_email: "childb@the120.school",
        local_part: "childb",
        supabase_user_id: "authB",
        state: "complete",
      },
    ],
    fp_parental_consent: [{ id: "c2", parent_id: "parentU", child_id: "childB", signup_attempt_id: "a2" }],
    fp_signup_attempts: [
      { id: "a2", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childB" },
    ],
    deposits: [],
  };
}

/** Deps whose auth delete enforces RESTRICT (fails while a profile still refs the
 *  user) and cascades the parent's `parents` row — plus a Workspace call log.
 *  `authFails` forces every auth delete to report not-ok; `suspendResult` overrides
 *  the suspend outcome (for the workspace-error strand path). */
function makeDeps(
  t: Tables,
  opts: {
    workspaceConfigured?: boolean;
    authFails?: boolean;
    suspendResult?: "suspended" | "missing" | "error";
    /** v3 blob port. Absent = no adapter configured (today's production shape). */
    blobConfigured?: boolean;
    /** Keys the fake store actually holds; anything else answers "missing". */
    blobStore?: Set<string>;
    /** Force every blob delete to report a store outage. */
    blobFails?: boolean;
    /** Force the adapter to THROW rather than answer (a rude SDK). */
    blobThrows?: boolean;
    /** Image Lab bucket contents; anything else answers "missing". */
    imageLabStore?: Set<string>;
    /** Force every Image Lab object delete to report a store outage. */
    imageLabFails?: boolean;
    /** path-evidence bucket contents; anything else answers "missing". */
    evidenceStore?: Set<string>;
    /** Force every evidence object delete to report a store outage. */
    evidenceFails?: boolean;
  } = {}
) {
  const wsCalls: string[] = [];
  const deletedAuth: string[] = [];
  const blobCalls: string[] = [];
  const imageLabCalls: string[] = [];
  const evidenceCalls: string[] = [];
  const deps: EraseFamilyDeps = {
    db: undefined as never, // filled by caller
    workspaceConfigured: opts.workspaceConfigured ?? true,
    blobConfigured: opts.blobConfigured ?? false,
    deleteBlob:
      opts.blobConfigured === true
        ? vi.fn(async (key: string) => {
            blobCalls.push(key);
            if (opts.blobThrows) throw new Error("blob store unreachable");
            if (opts.blobFails) return "error" as const;
            // Idempotent by contract: an absent object is a COMPLETED erasure.
            if (!opts.blobStore || !opts.blobStore.has(key)) return "missing" as const;
            opts.blobStore.delete(key);
            return "deleted" as const;
          })
        : undefined,
    // Unlike deleteBlob there is no "configured" flag: the Image Lab bucket is
    // the same service-role client, so the dep is always present (fail-closed by
    // type). Idempotent by contract — an absent object is a COMPLETED erasure.
    deleteImageLabObject: vi.fn(async (key: string) => {
      imageLabCalls.push(key);
      if (opts.imageLabFails) return "error" as const;
      if (!opts.imageLabStore || !opts.imageLabStore.has(key)) return "missing" as const;
      opts.imageLabStore.delete(key);
      return "deleted" as const;
    }),
    // Step 3b: same idempotent contract, third store (path-evidence).
    deleteEvidenceObject: vi.fn(async (key: string) => {
      evidenceCalls.push(key);
      if (opts.evidenceFails) return "error" as const;
      if (!opts.evidenceStore || !opts.evidenceStore.has(key)) return "missing" as const;
      opts.evidenceStore.delete(key);
      return "deleted" as const;
    }),
    deleteAuthUser: vi.fn(async (userId: string) => {
      if (opts.authFails) return { ok: false };
      if ((t.fp_player_profiles ?? []).some((x) => x.user_id === userId) || (t.path_student_profiles ?? []).some((x) => x.user_id === userId)) {
        return { ok: false }; // RESTRICT: a profile still references this account
      }
      // The step-8b referrers, modeled with the SAME RESTRICT the live schema
      // has (the first live erasure 23503'd on the verifier grant). A core that
      // skips the sweep cannot delete the parent here — the fake proves the
      // sweep, not just the counters.
      if (
        (t.path_role_grants ?? []).some((x) => x.user_id === userId) ||
        (t.path_notification_sends ?? []).some((x) => x.recipient_user_id === userId)
      ) {
        return { ok: false }; // RESTRICT: a grant / send-log row still references it
      }
      deletedAuth.push(userId);
      // parent cascade: remove parents row + SET NULL on consent/attempts parent_id
      t.parents = (t.parents ?? []).filter((p) => p.id !== userId);
      // v3: fp_onboarding_drafts.parent_id -> auth.users ON DELETE CASCADE. The
      // drafts vanish WITH THE ROW BUT NOT WITH THEIR BLOBS, which is exactly
      // why the parent-scoped sweep must run BEFORE this. Modeled so a sweep
      // that ran too late would silently "pass".
      t.fp_onboarding_drafts = (t.fp_onboarding_drafts ?? []).filter((d) => d.parent_id !== userId);
      for (const c of t.fp_parental_consent ?? []) if (c.parent_id === userId) c.parent_id = null;
      for (const a of t.fp_signup_attempts ?? []) if (a.parent_id === userId) a.parent_id = null;
      return { ok: true };
    }),
    suspendWorkspaceUser: vi.fn(async (email: string) => {
      wsCalls.push(`suspend:${email}`);
      return (opts.suspendResult ?? "suspended") as "suspended" | "missing" | "error";
    }),
    deleteWorkspaceUser: vi.fn(async (email: string) => {
      wsCalls.push(`delete:${email}`);
      return "deleted" as const;
    }),
    now: () => 0,
  };
  return { deps, wsCalls, deletedAuth, blobCalls, imageLabCalls, evidenceCalls };
}

describe("eraseFamily — full family, FK-safe order", () => {
  it("erases every table in order, deletes the parent, and scrubs (not deletes) the released claim", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps, wsCalls } = makeDeps(t, { workspaceConfigured: true });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(true);
    expect(out.stranded).toEqual([]);
    expect(out.scope).toBe("family");
    expect(out.childrenErased).toBe(2);
    expect(out.parentAccountDeleted).toBe(true);

    // Every FP, Path, and CRM table is empty.
    for (const table of [
      "fp_ledger",
      "fp_player_saves",
      "fp_player_profiles",
      "path_student_profiles",
      "children",
      "parents",
      "fp_parental_consent",
      "fp_signup_attempts",
      "deposits",
      // step 8b: without this sweep the fake's RESTRICT refuses the parent
      // delete outright, so parentAccountDeleted above is the real proof; the
      // emptiness check is the accounting.
      "path_role_grants",
      "path_notification_sends",
    ]) {
      expect(t[table], `${table} should be empty`).toHaveLength(0);
    }
    expect(out.deleted.path_role_grants).toBe(1);
    expect(out.deleted.path_notification_sends).toBe(1);

    // The provisioning claim SURVIVES (SET NULL + released, never cascaded away):
    // its local_part is preserved (never-reissue) while the PII is scrubbed.
    expect(t.funnel_student_provisioning).toHaveLength(1);
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim[RELEASED_CLAIM_PRESERVED_COLUMN]).toBe("childb"); // local_part kept
    for (const col of RELEASED_CLAIM_PII_COLUMNS) expect(claim[col], `${col} scrubbed`).toBeNull();
    expect(claim.state).toBe("released");
    expect(out.scrubbedReleasedClaims).toBe(1);

    // Per-child order: ledger + saves BEFORE the profile, profile + psp BEFORE
    // the children row. Assert for childA (which has ledger rows).
    const idx = (frag: string) => deleteLog.findIndex((s) => s.startsWith(frag));
    const ledgerAt = deleteLog.indexOf("fp_ledger(2)");
    const profilesFirstAt = idx("fp_player_profiles");
    const pspFirstAt = idx("path_student_profiles");
    const childrenFirstAt = idx("children");
    expect(ledgerAt).toBeGreaterThanOrEqual(0);
    expect(ledgerAt).toBeLessThan(profilesFirstAt); // ledger before profile (RESTRICT)
    expect(profilesFirstAt).toBeLessThan(childrenFirstAt);
    expect(pspFirstAt).toBeLessThan(childrenFirstAt);

    // Consent evidence removed as the deliberate final step (after all children).
    const lastChildrenAt = deleteLog.lastIndexOf("children(1)");
    const consentFamilyAt = deleteLog.findIndex((s) => s.startsWith("fp_parental_consent"));
    expect(consentFamilyAt).toBeGreaterThan(lastChildrenAt);
    expect(deleteLog).toContain("fp_parental_consent(2)");

    // Workspace suspend precedes delete for the path-b child, gated ON.
    expect(wsCalls).toEqual(["suspend:childb@the120.school", "delete:childb@the120.school"]);
    expect(out.workspace).toMatchObject({ suspended: 1, deleted: 1, skipped: 0 });
  });

  it("step 8b sweeps the parent-keyed RESTRICT referrers BEFORE the account delete (the first-live-erasure bug)", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps, deletedAuth } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    // The parent really died — impossible without the sweep, because the fake's
    // deleteAuthUser enforces the grant/send-log RESTRICT like production does.
    expect(out.parentAccountDeleted).toBe(true);
    expect(deletedAuth).toContain("parentU");
    // And the order log shows the sweep landed before the account delete.
    const grantAt = deleteLog.indexOf("path_role_grants(1)");
    const sendsAt = deleteLog.indexOf("path_notification_sends(1)");
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(sendsAt).toBeGreaterThanOrEqual(0);
    const parentAt = out.order.findIndex((s) => s.startsWith("auth_users:parent"));
    const grantOrderAt = out.order.findIndex((s) => s.startsWith("path_role_grants"));
    expect(grantOrderAt).toBeGreaterThanOrEqual(0);
    expect(grantOrderAt).toBeLessThan(parentAt);
  });

  it("a CHILD-SCOPED erasure leaves the parent's grant and mail history untouched", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
      childIds: ["childA"],
    });

    expect(out.ok).toBe(true);
    // The parent survives a child-scoped erasure — and so must their verifier
    // grant (they still verify their OTHER kid's work) and their send log.
    expect(t.path_role_grants).toHaveLength(1);
    expect(t.path_notification_sends).toHaveLength(1);
    expect(out.deleted.path_role_grants).toBe(0);
    expect(out.deleted.path_notification_sends).toBe(0);
  });

  it("an ACTIVE child's whole student graph is drained — objects first, evidence before progress, graph before profile", async () => {
    // The task-#16 scenario: childA has submitted work. Every graph table has
    // a row, the evidence rows name real objects in the fake store, and the
    // fake enforces BOTH RESTRICT directions (graph -> profile, evidence ->
    // progress), so this passing PROVES the drain and its order.
    const seed = activeChildSeed();
    const store = new Set([
      "pspA/ev1/photo.jpg",
      "pspA/ev2/video.mp4",
      "pspA/ev2/poster.jpg",
    ]);
    const { db, t, deleteLog } = makeDb(seed);
    const { deps, evidenceCalls } = makeDeps(t, { evidenceStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.stranded).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.parentAccountDeleted).toBe(true);
    // Every graph table emptied and counted.
    for (const table of [
      "path_evidence_items",
      "path_reviews",
      "path_task_events",
      "path_notification_sends",
      "path_notification_events",
      "path_cohort_members",
      "path_fw_replay_rejects",
      "path_task_progress",
    ]) {
      expect(t[table], `${table} should be empty`).toHaveLength(0);
    }
    expect(out.deleted.path_task_progress).toBe(1);
    expect(out.deleted.path_evidence_items).toBe(2);
    // The BYTES are gone — all three objects deleted at the store.
    expect(store.size).toBe(0);
    expect(evidenceCalls.sort()).toEqual(["pspA/ev1/photo.jpg", "pspA/ev2/poster.jpg", "pspA/ev2/video.mp4"]);
    expect(out.pathEvidence.objectsDeleted).toBe(3);
    // Order: evidence rows before task_progress (the composite RESTRICT), and
    // the whole graph before the profile row.
    const evidenceAt = deleteLog.indexOf("path_evidence_items(2)");
    const progressAt = deleteLog.indexOf("path_task_progress(1)");
    const profileAt = deleteLog.findIndex((s) => s.startsWith("path_student_profiles"));
    expect(evidenceAt).toBeGreaterThanOrEqual(0);
    expect(evidenceAt).toBeLessThan(progressAt);
    expect(progressAt).toBeLessThan(profileAt);
  });

  it("an evidence-store outage strands the child, preserves EVERY graph row, and the step-8b sweep does NOT run", async () => {
    // Object-before-row, fail-closed: a failed object delete must keep the
    // rows (they are the only record of the keys) — and the parent's grant +
    // send log must survive too, because sweeping the send log while the
    // child's task events survive would let the cron's reconcile re-derive
    // the sends and RE-EMAIL the erasure-requesting parent (ADV-3 gating).
    const seed = activeChildSeed();
    const { db, t } = makeDb(seed);
    const { deps, deletedAuth } = makeDeps(t, {
      evidenceStore: new Set(["pspA/ev1/photo.jpg"]),
      evidenceFails: true,
    });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(false);
    expect(out.pathEvidence.objectsErrored).toBeGreaterThan(0);
    // The whole graph is preserved for the re-run — nothing half-deleted.
    expect(t.path_evidence_items).toHaveLength(2);
    expect(t.path_task_progress).toHaveLength(1);
    expect((t.children as { id: string }[]).map((c) => c.id)).toContain("childA");
    // And the 8b sweep did not run: grant + send log intact, parent deferred.
    expect(deletedAuth).not.toContain("parentU");
    expect(t.path_role_grants).toHaveLength(1);
    expect(out.deleted.path_role_grants).toBe(0);
    expect(out.deleted.path_notification_sends).toBe(0);
  });

  it("a re-run after the store recovers finishes the active child cleanly", async () => {
    const seed = activeChildSeed();
    const store = new Set(["pspA/ev1/photo.jpg", "pspA/ev2/video.mp4", "pspA/ev2/poster.jpg"]);
    const { db, t } = makeDb(seed);
    const first = makeDeps(t, { evidenceStore: store, evidenceFails: true });
    first.deps.db = db;
    const run1 = await eraseFamily(first.deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(run1.ok).toBe(false);

    const second = makeDeps(t, { evidenceStore: store });
    second.deps.db = db;
    const run2 = await eraseFamily(second.deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(run2.ok).toBe(true);
    expect(run2.parentAccountDeleted).toBe(true);
    expect(store.size).toBe(0);
    expect(t.path_evidence_items).toHaveLength(0);
    expect(t.children).toHaveLength(0);
  });

  it("a mid-loop row-delete failure STOPS the drain — the send log never outlives its derivation inputs", async () => {
    // ADV-16-1: task_events (a derivation input for the notification cron's
    // reconcile) fails to delete. The drain must STOP there, leaving the send
    // log intact — deleting it while the events survive would let the cron
    // re-derive the sends and re-email the erasure-requesting parent.
    const seed = activeChildSeed();
    const store = new Set(["pspA/ev1/photo.jpg", "pspA/ev2/video.mp4", "pspA/ev2/poster.jpg"]);
    const { db, t } = makeDb(seed, { deleteFaultTable: "path_task_events" });
    const { deps } = makeDeps(t, { evidenceStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(false);
    // Tables BEFORE the fault were drained; the fault table and everything
    // AFTER it survive — including both notification tables.
    expect(t.path_evidence_items).toHaveLength(0);
    expect(t.path_reviews).toHaveLength(0);
    expect(t.path_task_events).toHaveLength(2); // the fault
    expect((t.path_notification_sends as { student_id?: string }[]).filter((s) => s.student_id === "pspA")).toHaveLength(1);
    expect(t.path_notification_events).toHaveLength(1);
    expect(out.order).toContain("student_graph:stopped-at:path_task_events(child:childA)");
    // Child anchor preserved for the re-run; parent deferred.
    expect((t.children as { id: string }[]).map((c) => c.id)).toContain("childA");
    expect(out.parentAccountDeleted).toBe(false);
  });

  it("the evidence read PAGINATES — an object on row 501+ is still deleted", async () => {
    // ADV-16-2: PostgREST silently truncates unranged selects. Seed 501
    // evidence rows with the ONLY object-bearing row last: an unpaginated
    // read (one page of 500) would never see its key, stage 4 would delete
    // the row anyway, and the child's media would survive an ok:true erasure.
    const seed = activeChildSeed();
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 500; i++) {
      rows.push({
        id: `evp${i}`,
        student_id: "pspA",
        task_progress_id: "tp1",
        bucket: "path-evidence",
        object_path: null, // kind='log'/'link' rows: no object
        poster_object_path: null,
      });
    }
    rows.push({
      id: "evLast",
      student_id: "pspA",
      task_progress_id: "tp1",
      bucket: "path-evidence",
      object_path: "pspA/evLast/photo.jpg",
      poster_object_path: null,
    });
    seed.path_evidence_items = rows;
    const store = new Set(["pspA/evLast/photo.jpg"]);
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t, { evidenceStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(true);
    expect(store.size).toBe(0); // the past-page-1 object really died
    expect(out.pathEvidence.objectsDeleted).toBe(1);
    expect(t.path_evidence_items).toHaveLength(0);
  });

  it("a refused evidence key (outside the student's folder) is never deleted and strands the child", async () => {
    // The namespace guard: a row pointing at ANOTHER student's folder — or at
    // a foreign bucket — must only ever fail to delete, never delete.
    const seed = activeChildSeed();
    (seed.path_evidence_items as Record<string, unknown>[]).push({
      id: "evX",
      student_id: "pspA",
      task_progress_id: "tp1",
      bucket: "path-evidence",
      object_path: "OTHER-student/evX/photo.jpg",
      poster_object_path: null,
    });
    const store = new Set(["OTHER-student/evX/photo.jpg"]);
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t, { evidenceStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(false);
    expect(out.pathEvidence.objectsRefused).toBe(1);
    expect(store.has("OTHER-student/evX/photo.jpg")).toBe(true); // never deleted
    expect(t.path_evidence_items.length).toBeGreaterThan(0); // rows preserved
  });

  it("RESTRICT never blocks (order is correct) — no stranded rows", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(out.stranded).toEqual([]);
  });

  it("the fake truly enforces RESTRICT (guards the guard)", async () => {
    // Deleting a profile while its ledger rows exist MUST raise — proving the
    // order-correctness test above is meaningful, not vacuous.
    const { db, t } = makeDb(seedFamily());
    const res = await (db as unknown as {
      from: (tbl: string) => { delete: () => { eq: (c: string, v: string) => { select: (s: string) => Promise<{ error: unknown }> } } };
    })
      .from("fp_player_profiles")
      .delete()
      .eq("child_id", "childA")
      .select("*");
    expect(res.error).toBeTruthy();
    expect(t.fp_player_profiles).toHaveLength(2); // nothing deleted
  });

  it("is idempotent + resumable — a second full run is a clean no-op", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const first = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(first.ok).toBe(true);

    const { deps: deps2, wsCalls: ws2 } = makeDeps(t);
    deps2.db = db;
    const second = await eraseFamily(deps2, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(second.ok).toBe(true);
    expect(second.childrenErased).toBe(0);
    expect(second.deleted.fp_ledger).toBe(0);
    expect(second.deleted.children).toBe(0);
    expect(ws2).toEqual([]); // no children left, no mailbox calls
  });
});

describe("eraseFamily — resumability strand guard (FIX 1)", () => {
  it("run 1: an auth-delete + workspace failure STRANDS the child, PRESERVES its anchor + the parent, ok:false", async () => {
    const { db, t } = makeDb(seedPathBOnly());
    const { deps } = makeDeps(t, { workspaceConfigured: true, authFails: true, suspendResult: "error" });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(false);
    // The child anchor SURVIVES so a re-run re-enumerates it.
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual(["childB"]);
    expect(out.childrenErased).toBe(0);
    // Both failures are recorded as stranded, keyed on the child.
    expect(out.stranded).toContain("auth_users:authB");
    expect(out.stranded).toContain("workspace:suspend:childB");
    // The parent account is NOT deleted while an anchor is preserved (deleting it
    // would CASCADE the preserved anchor away, orphaning the account).
    expect(out.parentAccountDeleted).toBe(false);
    expect(t.parents).toHaveLength(1);
    // The claim is untouched (child not deleted → not released → not scrubbed).
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim.supabase_user_id).toBe("authB");
    expect(out.scrubbedReleasedClaims).toBe(0);
  });

  it("run 2 (now healthy) recovers the auth id from the claim, completes teardown, clears stranded → ok:true", async () => {
    const { db, t } = makeDb(seedPathBOnly());
    // Run 1 strands.
    const { deps: d1 } = makeDeps(t, { workspaceConfigured: true, authFails: true, suspendResult: "error" });
    d1.db = db;
    const first = await eraseFamily(d1, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(first.ok).toBe(false);
    // Profiles are gone after run 1 — the ONLY remaining handle to authB is the
    // claim's supabase_user_id (the resumability recovery under test).
    expect(t.fp_player_profiles).toHaveLength(0);
    expect(t.path_student_profiles).toHaveLength(0);

    // Run 2 with healthy deps.
    const { deps: d2, wsCalls: ws2, deletedAuth } = makeDeps(t, { workspaceConfigured: true });
    d2.db = db;
    const second = await eraseFamily(d2, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(second.ok).toBe(true);
    expect(second.stranded).toEqual([]);
    expect(second.childrenErased).toBe(1);
    // authB was recovered from the claim and finally deleted.
    expect(deletedAuth).toContain("authB");
    // The mailbox suspend+delete ran on resume (recovered email).
    expect(ws2).toEqual(["suspend:childb@the120.school", "delete:childb@the120.school"]);
    // Child anchor gone; the claim survives, scrubbed, local_part intact.
    expect(t.children).toHaveLength(0);
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim.local_part).toBe("childb");
    expect(claim.supabase_user_id).toBeNull();
    expect(claim.email).toBeNull();
    expect(second.scrubbedReleasedClaims).toBe(1);
    expect(second.parentAccountDeleted).toBe(true);
  });
});

describe("eraseFamily — Workspace gating + scoping", () => {
  it("SKIPS the Google legs entirely when workspace is unconfigured (no real call)", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps, wsCalls } = makeDeps(t, { workspaceConfigured: false });
    deps.db = db;
    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(deps.suspendWorkspaceUser).not.toHaveBeenCalled();
    expect(deps.deleteWorkspaceUser).not.toHaveBeenCalled();
    expect(wsCalls).toEqual([]);
    expect(out.workspace.skipped).toBe(1); // the one path-b child
    expect(out.workspace.suspended).toBe(0);
    // Everything else still fully erased.
    expect(t.children).toHaveLength(0);
    expect(out.parentAccountDeleted).toBe(true);
  });

  it("child-scoped erasure removes only that child + its consent, PRESERVING the parent", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
      childIds: ["childA"],
    });
    expect(out.scope).toBe("child");
    expect(out.parentAccountDeleted).toBe(false);
    // childA gone, childB intact.
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual(["childB"]);
    // childA's consent gone; childB's + the parent account survive.
    expect((t.fp_parental_consent as { id: string }[]).map((c) => c.id)).toEqual(["c2"]);
    expect(t.parents).toHaveLength(1);
    // The parent's signup attempts are NOT touched in child scope.
    expect(t.fp_signup_attempts).toHaveLength(2);
  });
});

describe("eraseFamily — attempt delete is scoped by parent_id (FIX 3)", () => {
  it("does NOT delete a DIFFERENT principal's attempt row that reused the same parent_email", async () => {
    // Family A (parentA) and Family B (parentB) share the parent_email; B has no
    // children/profiles here — only its attempt evidence, which must survive an
    // erasure of A.
    const seed: Tables = {
      children: [{ id: "childA", parent_id: "parentA" }],
      parents: [{ id: "parentA" }, { id: "parentB" }],
      fp_player_profiles: [{ id: "ppA", user_id: "authA", child_id: "childA" }],
      fp_player_saves: [{ profile_id: "ppA" }],
      fp_ledger: [],
      path_student_profiles: [{ id: "pspA", user_id: "authA", child_id: "childA" }],
      funnel_student_provisioning: [],
      fp_parental_consent: [{ id: "cA", parent_id: "parentA", child_id: "childA" }],
      fp_signup_attempts: [
        { id: "atA", parent_id: "parentA", parent_email: "shared@example.com", child_id: "childA" },
        { id: "atB", parent_id: "parentB", parent_email: "shared@example.com", child_id: null },
      ],
      deposits: [],
    };
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentA", parentEmail: "shared@example.com" });

    expect(out.ok).toBe(true);
    // A's attempt is gone; B's attempt (same email, different principal) SURVIVES.
    expect((t.fp_signup_attempts as { id: string }[]).map((a) => a.id)).toEqual(["atB"]);
    expect(out.deleted.fp_signup_attempts).toBe(1);
  });

  it("falls back to the parent_email scope ONLY when the parent_id delete matched nothing", async () => {
    // A prior partial run already SET-NULLed parent_id on the attempt; the
    // parent_id-scoped delete now matches nothing, so the email fallback runs.
    const seed: Tables = {
      children: [],
      parents: [{ id: "parentA" }],
      fp_player_profiles: [],
      fp_player_saves: [],
      fp_ledger: [],
      path_student_profiles: [],
      funnel_student_provisioning: [],
      fp_parental_consent: [],
      fp_signup_attempts: [
        { id: "atA", parent_id: null, parent_email: "solo@example.com", child_id: null },
      ],
      deposits: [],
    };
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentA", parentEmail: "solo@example.com" });

    expect(out.deleted.fp_signup_attempts).toBe(1);
    expect(t.fp_signup_attempts).toHaveLength(0);
  });
});

describe("erase-family-rules pure helpers", () => {
  it("dedupeAuthUserIds collapses the shared account and drops blanks", () => {
    expect(dedupeAuthUserIds(["a", "a", null, "b", undefined, ""])).toEqual(["a", "b"]);
  });
  it("hasWorkspaceMailbox only accepts a real @-address", () => {
    expect(hasWorkspaceMailbox("x@the120.school")).toBe(true);
    expect(hasWorkspaceMailbox(null)).toBe(false);
    expect(hasWorkspaceMailbox("")).toBe(false);
    expect(hasWorkspaceMailbox("not-an-email")).toBe(false);
  });

  it("documents the FK-safe order + the released-claim scrub posture", () => {
    // fp_ledger and fp_player_saves precede fp_player_profiles (both RESTRICT).
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_ledger")).toBeLessThan(
      CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_profiles")
    );
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_saves")).toBeLessThan(
      CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_profiles")
    );
    expect(FAMILY_EVIDENCE_DELETE_ORDER).toContain("fp_parental_consent");
    // The never-reissue alias ledger is preserved, never erased.
    expect(ERASURE_PRESERVED_TABLES).toContain("funnel_released_aliases");
    // The released-claim scrub keeps local_part but nulls the PII columns.
    expect(RELEASED_CLAIM_PRESERVED_COLUMN).toBe("local_part");
    expect(RELEASED_CLAIM_PII_COLUMNS).toContain("email");
    expect(RELEASED_CLAIM_PII_COLUMNS).toContain("supabase_user_id");
    expect(RELEASED_CLAIM_PII_COLUMNS).not.toContain("local_part");
  });
});

describe("eraseFamily — fp_public_sites dies FIRST (real-public-site Unit 2)", () => {
  function seedWithSite(site: Record<string, unknown> = {}): Tables {
    const t = seedPathBOnly();
    t.fp_public_sites = [
      {
        profile_id: "ppB",
        handle: "cedric",
        published: true,
        operator_locked: false,
        first_published_at: "2026-08-03T00:00:00Z",
        ...site,
      },
    ];
    return t;
  }

  it("CHILD_LEAF_DELETE_ORDER lists fp_public_sites first; the executor deletes it before the profile (RESTRICT-proven)", async () => {
    expect(CHILD_LEAF_DELETE_ORDER[0]).toBe("fp_public_sites");
    const seed = seedWithSite();
    const { db, t, deleteLog } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(t.fp_public_sites).toHaveLength(0);
    // The makeDb RESTRICT guard raises 23503 if the profile is deleted while a
    // site row references it — so a green run PROVES the order. Assert it
    // anyway off the delete log:
    const siteAt = deleteLog.findIndex((d) => d.startsWith("fp_public_sites("));
    const profileAt = deleteLog.findIndex((d) => d.startsWith("fp_player_profiles("));
    expect(siteAt).toBeGreaterThanOrEqual(0);
    expect(siteAt).toBeLessThan(profileAt);
  });

  it("an OPERATOR-LOCKED site is deleted (data rights outrank the lock) but NEVER silently: loud log + order marker", async () => {
    const seed = seedWithSite({ operator_locked: true });
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(summary.order.some((o) => o.includes("site-locked-released"))).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR-LOCKED"))).toBe(true);
    errors.mockRestore();
  });

  it("a FAILED lock read does not block the erasure and does not silently skip observability: ambiguity marker + delete proceeds", async () => {
    const seed = seedWithSite({ operator_locked: true });
    const { db, t } = makeDb(seed, { selectFaultTable: "fp_public_sites" });
    const { deps } = makeDeps(t);
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(t.fp_public_sites).toHaveLength(0);
    expect(summary.order.some((o) => o.includes("site-lock-read-failed"))).toBe(true);
    // The read failure must NOT masquerade as the locked-release marker.
    expect(summary.order.some((o) => o.includes("site-locked-released"))).toBe(false);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("lock read failed"))).toBe(true);
    errors.mockRestore();
  });

  it("idempotent re-run: a second erasure after a complete first run is a clean no-op for the site step", async () => {
    const seed = seedWithSite();
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const first = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(first.ok).toBe(true);
    const second = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(second.ok).toBe(true);
    expect(second.deleted.fp_public_sites).toBe(0);
    expect(second.stranded).toHaveLength(0);
  });
});

/* ══════════════════════ New User Flow v3 (2026-08-06) ══════════════════════ */

describe("eraseFamily — v3 onboarding drafts + handoff codes", () => {
  it("removes every draft and handoff code, and removes the drafts BEFORE the roster row (SET NULL proves the order)", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    expect(out.stranded).toEqual([]);
    // Nothing of the kid-first flow survives: the two carried drafts, the
    // abandoned one, and both sign-in codes.
    expect(t.fp_onboarding_drafts).toHaveLength(0);
    expect(t.fp_handoff_codes).toHaveLength(0);
    expect(out.deleted.fp_onboarding_drafts).toBe(3);
    expect(out.deleted.fp_handoff_codes).toBe(2);

    // ORDER. The fake models child_id -> children as ON DELETE SET NULL, so a
    // draft deleted after its children row could no longer be matched by
    // child_id and WOULD SURVIVE. Empty above already proves it; assert the log
    // too so a regression names itself.
    const draftAt = deleteLog.findIndex((d) => d.startsWith("fp_onboarding_drafts("));
    const codesAt = deleteLog.findIndex((d) => d.startsWith("fp_handoff_codes("));
    const childrenAt = deleteLog.findIndex((d) => d.startsWith("children("));
    expect(draftAt).toBeGreaterThanOrEqual(0);
    expect(draftAt).toBeLessThan(childrenAt);
    expect(codesAt).toBeLessThan(childrenAt);
  });

  it("sweeps the ABANDONED (child_id null) draft before the parent cascade could swallow it", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    // The parent-scoped sweep is a real delete in the log, not a cascade: the
    // fake's deleteAuthUser CASCADEs drafts away, so a sweep that ran late would
    // leave `fp_onboarding_drafts` empty too but WITHOUT this delete entry (and
    // without its blobs deleted).
    const parentSweepAt = deleteLog.lastIndexOf("fp_onboarding_drafts(1)");
    expect(parentSweepAt).toBeGreaterThanOrEqual(0);
    expect(out.parentAccountDeleted).toBe(true);
    expect(PARENT_SCOPED_DELETE_ORDER).toContain("fp_onboarding_drafts");
  });

  it("child-scoped erasure takes that child's draft + codes and LEAVES the parent's other rows", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
      childIds: ["childA"],
    });

    expect(out.ok).toBe(true);
    expect(out.deleted.fp_onboarding_drafts).toBe(1);
    expect(out.deleted.fp_handoff_codes).toBe(1);
    // childB's draft and the parent's abandoned draft survive — the parent is
    // still a live account and those rows are not this run's business.
    expect((t.fp_onboarding_drafts as { id: string }[]).map((d) => d.id).sort()).toEqual(
      [DRAFT_B, DRAFT_ORPHAN].sort()
    );
    expect((t.fp_handoff_codes as { id: string }[]).map((h) => h.id)).toEqual(["h2"]);
  });

  it("is idempotent: a second run re-deletes nothing and stays clean", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    const { deps: d2 } = makeDeps(t);
    d2.db = db;
    const second = await eraseFamily(d2, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(second.ok).toBe(true);
    expect(second.deleted.fp_onboarding_drafts).toBe(0);
    expect(second.deleted.fp_handoff_codes).toBe(0);
    expect(second.blobs).toMatchObject({ deleted: 0, errored: 0, unconfigured: 0, refused: 0 });
  });

  it("END STATE: no row anywhere still holds the kid's name, age, story answers, cover bytes, or a handoff code", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    // Sweep EVERY surviving row in EVERY table for any of the seeded personal
    // values — a blunt instrument on purpose: it does not care which table a
    // future migration puts the data in.
    const needles = ["Ada", "Bo", "Cy", "robots", "bakery", "lemonade", "hashA", "hashB", "AAA", "BBB", "CCC"];
    const survivors = JSON.stringify(t);
    for (const needle of needles) {
      expect(survivors.includes(needle), `"${needle}" still present after erasure`).toBe(false);
    }
    // And the ages / answers, wherever they might sit.
    for (const table of Object.values(t)) {
      for (const row of table) {
        expect(row.kid_age ?? null).toBeNull();
        expect(row.fp_kid_age ?? null).toBeNull();
        expect(row.fp_story_answers ?? null).toBeNull();
      }
    }
  });
});

describe("eraseFamily — external blob objects (the two-store erasure)", () => {
  const draftCover = `fp/v3/drafts/${DRAFT_A}/cover-1.png`;
  const draftPhoto = `fp/v3/drafts/${DRAFT_A}/photo.png`;
  const childCover = `fp/v3/children/${CHILD_UUID}/cover-1.png`;

  /** One path-a child that HAS blob-backed art (the shape the AI path will
   *  produce; today every key is null). */
  function seedWithBlobs(): Tables {
    return {
      children: [
        { id: CHILD_UUID, parent_id: "parentU", fp_cover_blob_key: childCover, fp_cover_status: "final" },
      ],
      parents: [{ id: "parentU" }],
      fp_player_profiles: [{ id: "pp1", user_id: "auth1", child_id: CHILD_UUID }],
      fp_player_saves: [{ profile_id: "pp1" }],
      fp_ledger: [],
      path_student_profiles: [{ id: "psp1", user_id: "auth1", child_id: CHILD_UUID }],
      funnel_student_provisioning: [],
      fp_parental_consent: [],
      fp_signup_attempts: [],
      deposits: [],
      fp_handoff_codes: [],
      fp_onboarding_drafts: [
        {
          id: DRAFT_A,
          parent_id: "parentU",
          child_id: CHILD_UUID,
          kid_first_name: "Ada",
          photo_blob_key: draftPhoto,
          cover_blob_key: draftCover,
          cover_status: "final",
        },
      ],
    };
  }

  it("deletes every object at the store, OBJECT BEFORE ROW, within the subject's own namespace", async () => {
    const store = new Set([draftCover, draftPhoto, childCover]);
    const { db, t, deleteLog } = makeDb(seedWithBlobs());
    const { deps, blobCalls } = makeDeps(t, { blobConfigured: true, blobStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    expect(out.blobs).toMatchObject({ deleted: 3, missing: 0, errored: 0, refused: 0, unconfigured: 0 });
    expect(store.size).toBe(0); // the bytes are actually gone
    expect([...blobCalls].sort()).toEqual([childCover, draftCover, draftPhoto].sort());

    // OBJECT BEFORE ROW: the draft's keys are deleted before the draft row.
    // (Reversed, a crash between the two would leave bytes nothing points at —
    // unreachable forever.)
    const firstDraftBlob = out.order.findIndex((o) => o.startsWith("blob:deleted(draft:"));
    const draftRowOp = out.order.findIndex((o) => o.startsWith("fp_onboarding_drafts:"));
    expect(firstDraftBlob).toBeGreaterThanOrEqual(0);
    expect(draftRowOp).toBeGreaterThan(firstDraftBlob);
    expect(deleteLog.findIndex((d) => d.startsWith("fp_onboarding_drafts("))).toBeGreaterThanOrEqual(0);
    expect(t.fp_onboarding_drafts).toHaveLength(0);
    expect(t.children).toHaveLength(0);
  });

  it("a MISSING object is success, not a failure (already-deleted = erased)", async () => {
    const { db, t } = makeDb(seedWithBlobs());
    // Empty store: every key answers "missing".
    const { deps } = makeDeps(t, { blobConfigured: true, blobStore: new Set() });
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    expect(out.stranded).toEqual([]);
    expect(out.blobs).toMatchObject({ deleted: 0, missing: 3, errored: 0 });
    // Rows still removed — a missing object does not block the erasure.
    expect(t.fp_onboarding_drafts).toHaveLength(0);
    expect(t.children).toHaveLength(0);
    expect(out.parentAccountDeleted).toBe(true);
  });

  it("a STORE OUTAGE is reported honestly: stranded, ok:false, and the rows that name the objects are PRESERVED", async () => {
    const { db, t } = makeDb(seedWithBlobs());
    const { deps } = makeDeps(t, { blobConfigured: true, blobFails: true });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    expect(out.blobs.errored).toBeGreaterThan(0);
    expect(out.stranded.some((s) => s.startsWith("blob:error:"))).toBe(true);
    // The draft row SURVIVES: deleting it would make its objects unreachable.
    expect(t.fp_onboarding_drafts).toHaveLength(1);
    expect(out.deleted.fp_onboarding_drafts).toBe(0);
    // The child anchor and the parent account survive too, so a re-run finishes.
    expect(t.children).toHaveLength(1);
    expect(out.parentAccountDeleted).toBe(false);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("blob delete failed"))).toBe(true);
    errors.mockRestore();
  });

  it("a THROWING adapter is treated as an outage, never as success", async () => {
    const { db, t } = makeDb(seedWithBlobs());
    const { deps } = makeDeps(t, { blobConfigured: true, blobThrows: true });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(out.ok).toBe(false);
    expect(out.blobs.errored).toBeGreaterThan(0);
    expect(t.fp_onboarding_drafts).toHaveLength(1);
    errors.mockRestore();
  });

  it("resumes to completion once the store recovers (run 1 strands, run 2 finishes)", async () => {
    const store = new Set([draftCover, draftPhoto, childCover]);
    // A path-b child, so run 2 can still resolve the auth account after run 1
    // deleted the profile rows (the claim's supabase_user_id is the durable
    // handle — the existing resumability contract, unchanged by the blob work).
    const seed = seedWithBlobs();
    seed.funnel_student_provisioning = [
      {
        id: "claim1",
        child_id: CHILD_UUID,
        email: "kid@the120.school",
        workspace_attempted_email: "kid@the120.school",
        local_part: "kid",
        supabase_user_id: "auth1",
        state: "complete",
      },
    ];
    const { db, t } = makeDb(seed);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps: d1 } = makeDeps(t, { blobConfigured: true, blobFails: true });
    d1.db = db;
    const first = await eraseFamily(d1, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(first.ok).toBe(false);

    const { deps: d2 } = makeDeps(t, { blobConfigured: true, blobStore: store });
    d2.db = db;
    const second = await eraseFamily(d2, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(second.ok).toBe(true);
    expect(second.stranded).toEqual([]);
    expect(store.size).toBe(0);
    expect(t.fp_onboarding_drafts).toHaveLength(0);
    expect(t.children).toHaveLength(0);
    expect(second.parentAccountDeleted).toBe(true);
    errors.mockRestore();
  });

  it("NO ADAPTER + a real key is STRANDED, never silently skipped (unlike the Workspace legs)", async () => {
    const { db, t } = makeDb(seedWithBlobs());
    const { deps } = makeDeps(t, { blobConfigured: false });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    // 3 distinct objects (2 draft + 1 child). 5 attempts, because the draft row
    // is deliberately PRESERVED by the per-child pass and the family-level
    // parent-scoped sweep then re-reads and re-attempts the same two keys —
    // idempotent, and it keeps the sweep unconditional rather than
    // state-dependent.
    expect(out.blobs.unconfigured).toBe(5);
    expect(new Set(out.stranded.filter((s) => s.startsWith("blob:unconfigured:")).map((s) => s.split(":").pop())).size).toBe(3);
    expect(out.stranded.some((s) => s.startsWith("blob:unconfigured:"))).toBe(true);
    expect(t.fp_onboarding_drafts).toHaveLength(1); // rows kept for the re-run
    expect(t.children).toHaveLength(1);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("no blob adapter"))).toBe(true);
    errors.mockRestore();
  });

  it("NO ADAPTER and NO keys (today's production shape) is a clean, complete erasure", async () => {
    // The shipped cover path is template-only: cover_data_url is written inline
    // and every blob key is NULL. Nothing to delete, nothing to strand.
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t, { blobConfigured: false });
    deps.db = db;
    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(out.ok).toBe(true);
    expect(out.blobs).toEqual({ deleted: 0, missing: 0, errored: 0, refused: 0, unconfigured: 0 });
    expect(t.fp_onboarding_drafts).toHaveLength(0);
  });

  it("a key OUTSIDE the subject's namespace is refused, not deleted (never another child's art)", async () => {
    const foreign = `fp/v3/children/${DRAFT_B}/cover-1.png`; // a DIFFERENT owner
    const seed = seedWithBlobs();
    (seed.children[0] as Record<string, unknown>).fp_cover_blob_key = foreign;
    const store = new Set([foreign, draftCover, draftPhoto]);
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t, { blobConfigured: true, blobStore: store });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.blobs.refused).toBe(1);
    expect(store.has(foreign)).toBe(true); // NOT deleted
    expect(out.ok).toBe(false);
    expect(out.stranded.some((s) => s.startsWith("blob:not_owned:"))).toBe(true);
    // The mis-keyed child's anchor is preserved for triage.
    expect(t.children).toHaveLength(1);
    errors.mockRestore();
  });

  it("a failed DRAFT READ strands rather than pretending there were no drafts", async () => {
    const { db, t } = makeDb(seedWithBlobs(), { selectFaultTable: "fp_onboarding_drafts" });
    const { deps } = makeDeps(t, { blobConfigured: true, blobStore: new Set() });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(out.ok).toBe(false);
    expect(out.stranded.some((s) => s.startsWith("fp_onboarding_drafts:read:"))).toBe(true);
    expect(t.fp_onboarding_drafts).toHaveLength(1);
    expect(t.children).toHaveLength(1);
    errors.mockRestore();
  });
});

/* ───────────────────────── Image Lab purge (#140/#143) ──────────────────── */

/**
 * The Image Lab is the THIRD store a family erasure has to reach into, and the
 * only one whose purge is a procedure rather than a delete. These fixtures put
 * the two hazards the migration's runbook names on the table:
 *
 *   * a COPY-FORWARD DESCENDANT (`run2` iterated from `run1`) that carries the
 *     same child's authored text but has no `source_child_id` of its own, and
 *   * a run belonging to nobody in this family (`run3`), which must survive.
 *
 * Keys are `runs/{run_id}/{image_id}` — the deterministic scheme the migration
 * pins — because the executor re-derives ownership from it.
 */
function seedWithImageLab(): Tables {
  const t = seedFamily();
  t.fp_image_lab_runs = [
    { id: "run1", source_child_id: "childA", iterated_from_run_id: null, resolved_prompt: "Hi, I'm Ada…" },
    // The descendant: no child link of its own, reachable ONLY by lineage.
    { id: "run2", source_child_id: null, iterated_from_run_id: "run1", resolved_prompt: "Hi, I'm Ada…" },
    // Somebody else's run entirely.
    { id: "run3", source_child_id: null, iterated_from_run_id: null, resolved_prompt: "a synthetic pitch" },
  ];
  t.fp_image_lab_images = [
    { id: "img1", run_id: "run1", state: "done", attempted_at: "t0", storage_key: "runs/run1/img1" },
    { id: "img2", run_id: "run2", state: "done", attempted_at: "t0", storage_key: "runs/run2/img2" },
    { id: "img3", run_id: "run3", state: "done", attempted_at: "t0", storage_key: "runs/run3/img3" },
  ];
  return t;
}

const LAB_KEYS = ["runs/run1/img1", "runs/run2/img2", "runs/run3/img3"];

describe("eraseFamily — the Image Lab purge (source_child_id is SET NULL, so order is everything)", () => {
  it("deletes the child's runs AND their copy-forward descendants, objects first, leaving other runs alone", async () => {
    const store = new Set(LAB_KEYS);
    const { db, t, deleteLog } = makeDb(seedWithImageLab());
    const { deps, imageLabCalls } = makeDeps(t, { imageLabStore: store });
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    // run1 (linked) and run2 (its descendant) are gone; run3 is untouched.
    expect((t.fp_image_lab_runs ?? []).map((r) => r.id)).toEqual(["run3"]);
    expect(out.deleted.fp_image_lab_runs).toBe(2);
    // Their image rows CASCADEd; run3's survives.
    expect((t.fp_image_lab_images ?? []).map((r) => r.id)).toEqual(["img3"]);
    // And the BYTES are really gone from the bucket — the whole point.
    expect(imageLabCalls.sort()).toEqual(["runs/run1/img1", "runs/run2/img2"]);
    expect([...store]).toEqual(["runs/run3/img3"]);
    expect(out.imageLab.objectsDeleted).toBe(2);

    // ORDER: the purge must precede the `children` delete, or source_child_id is
    // SET NULL and the run survives with its provenance erased.
    expect(deleteLog.indexOf("fp_image_lab_runs(2)")).toBeGreaterThanOrEqual(0);
    expect(deleteLog.indexOf("fp_image_lab_runs(2)")).toBeLessThan(deleteLog.indexOf("children(1)"));
  });

  it("an object the store could not delete PRESERVES every run row (the row is the only record of its key)", async () => {
    const store = new Set(LAB_KEYS);
    const { db, t } = makeDb(seedWithImageLab());
    const { deps } = makeDeps(t, { imageLabStore: store, imageLabFails: true });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    expect(out.imageLab.objectsErrored).toBeGreaterThan(0);
    expect(out.stranded.some((s) => s.startsWith("image_lab:error:"))).toBe(true);
    // Nothing deleted: rows AND objects both survive for the re-run.
    expect((t.fp_image_lab_runs ?? [])).toHaveLength(3);
    expect(out.deleted.fp_image_lab_runs).toBe(0);
    expect([...store].sort()).toEqual([...LAB_KEYS].sort());
    // The child anchor is preserved, so the re-run can still find the runs.
    expect((t.children ?? []).some((c) => c.id === "childA")).toBe(true);
    errors.mockRestore();
  });

  it("an IN-FLIGHT cell defers the whole child rather than erasing around bytes still landing", async () => {
    const seed = seedWithImageLab();
    // The descendant's cell is latched with a vendor call running: no
    // storage_key yet, so its object would land AFTER a purge that ran now.
    seed.fp_image_lab_images[1] = {
      id: "img2",
      run_id: "run2",
      state: "requested",
      attempted_at: "t0",
      storage_key: null,
    };
    const store = new Set(["runs/run1/img1", "runs/run3/img3"]);
    const { db, t } = makeDb(seed);
    const { deps, imageLabCalls } = makeDeps(t, { imageLabStore: store });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    expect(out.imageLab.deferredInFlight).toBe(1);
    expect(out.stranded).toContain("fp_image_lab_runs:in_flight:childA");
    // NOTHING was touched — not even the settled sibling's object, because the
    // whole child is deferred to the re-run.
    expect(imageLabCalls).toEqual([]);
    expect((t.fp_image_lab_runs ?? [])).toHaveLength(3);
    expect((t.children ?? []).some((c) => c.id === "childA")).toBe(true);
    errors.mockRestore();
  });

  it("a key outside its own run's namespace is refused, never deleted", async () => {
    const seed = seedWithImageLab();
    seed.fp_image_lab_images[0].storage_key = "runs/run3/img1"; // wrong run
    const store = new Set(["runs/run3/img1", "runs/run2/img2", "runs/run3/img3"]);
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t, { imageLabStore: store });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    expect(out.imageLab.objectsRefused).toBe(1);
    expect(out.stranded.some((s) => s.startsWith("image_lab:not_owned:"))).toBe(true);
    expect(store.has("runs/run3/img1")).toBe(true); // NOT deleted
    expect((t.fp_image_lab_runs ?? [])).toHaveLength(3); // rows preserved
    errors.mockRestore();
  });

  it("a failed run READ strands rather than concluding the child had no runs", async () => {
    const { db, t } = makeDb(seedWithImageLab(), { selectFaultTable: "fp_image_lab_runs" });
    const { deps } = makeDeps(t, { imageLabStore: new Set(LAB_KEYS) });
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(false);
    expect(out.stranded.some((s) => s.startsWith("fp_image_lab_runs:read:"))).toBe(true);
    expect((t.fp_image_lab_runs ?? [])).toHaveLength(3);
    expect((t.children ?? []).some((c) => c.id === "childA")).toBe(true);
    errors.mockRestore();
  });

  it("costs one SELECT and nothing else when the child has no runs (production today)", async () => {
    const { db, t } = makeDb(seedFamily()); // no fp_image_lab_* rows at all
    const { deps, imageLabCalls } = makeDeps(t, {});
    deps.db = db;

    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });

    expect(out.ok).toBe(true);
    expect(out.deleted.fp_image_lab_runs).toBe(0);
    expect(imageLabCalls).toEqual([]);
    expect(out.imageLab).toEqual({
      objectsDeleted: 0,
      objectsMissing: 0,
      objectsErrored: 0,
      objectsRefused: 0,
      deferredInFlight: 0,
    });
  });
});

describe("planSubjectBlobDeletes (pure)", () => {
  const id = "44444444-5555-4666-8777-888888888888";
  it("drops blanks, collapses duplicates, and applies the namespace guard", () => {
    const plan = planSubjectBlobDeletes({
      scope: "child",
      ownerId: id,
      keys: [
        null,
        undefined,
        "   ",
        ` fp/v3/children/${id}/cover-1.png `,
        `fp/v3/children/${id}/cover-1.png`,
        `fp/v3/drafts/${id}/cover-1.png`, // right owner, WRONG scope
        "some/other/thing.png",
      ],
    });
    expect(plan.map((p) => p.key)).toEqual([
      `fp/v3/children/${id}/cover-1.png`,
      `fp/v3/drafts/${id}/cover-1.png`,
      "some/other/thing.png",
    ]);
    expect(plan.map((p) => p.owned)).toEqual([true, false, false]);
  });

  it("is empty when a subject owns no objects (the shipped, template-only case)", () => {
    expect(planSubjectBlobDeletes({ scope: "draft", ownerId: id, keys: [null, null] })).toEqual([]);
  });
});
