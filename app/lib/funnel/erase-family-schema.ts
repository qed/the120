/**
 * R28 erasure — THE COVERAGE LEDGER. Pure data + one pure audit function; no
 * I/O, no Supabase, no Next. It is the structural answer to the failure mode
 * that produced this file:
 *
 *   New User Flow v3 added a whole table of a child's personal data
 *   (`fp_onboarding_drafts`: first/last name, AGE, story ANSWERS, the cover),
 *   a table of live sign-in codes (`fp_handoff_codes`), and six `children`
 *   columns — all applied to production — and the family-erasure path did not
 *   touch a single one of them. Nothing failed. Nothing went red. The eraser
 *   simply did not know they existed, because the only record of what it covered
 *   was the eraser's own code.
 *
 * ── HOW THIS CATCHES AN ADDITION (the point of the whole file) ───────────────
 * `auditErasureCoverage` takes the schema shape READ OUT OF THE MIGRATIONS
 * (`__tests__/helpers/migration-schema.ts` parses `supabase/migrations/*.sql`)
 * and reports every table/column that is IN THE SCHEMA but NOT IN THIS LEDGER,
 * and every ledger entry that is no longer in the schema. The test
 * (`__tests__/erase-family-schema-coverage.test.ts`) asserts the report is
 * empty. So:
 *
 *   * add a table with a `child_id` / `profile_id` column  → unclassified-table
 *   * add a column to one of the AUDITED tables            → unclassified-column
 *   * add any `*blob*` / `*storage*` / `*bucket*` column
 *     anywhere in the schema                               → unclassified-external-object
 *   * delete or rename something this ledger names         → stale-* finding
 *
 * The build goes red on the migration's own commit, and the only way to make it
 * green is to WRITE DOWN what erasure does with the new data. "Not erased" is a
 * perfectly acceptable answer — it just has to be an answer, with a reason,
 * instead of a default.
 *
 * ── WHY THESE THREE SCOPES AND NOT "EVERY COLUMN IN THE DATABASE" ───────────
 * A ledger nobody can maintain gets deleted. Each scope is the smallest set that
 * can still catch a real miss:
 *
 *   (1) TABLE scope — anything joined to a child (`child_id`) or to a child's
 *       player profile (`profile_id`), plus the two anchors. This is how BOTH
 *       missed v3 tables would have been caught: each carries `child_id`.
 *   (2) COLUMN scope — the tables where a row-level answer is NOT enough:
 *       the two that hold the kid's identity payload (`children`,
 *       `fp_onboarding_drafts`), the one whose rows SURVIVE erasure by design
 *       (`funnel_student_provisioning` — the never-reissue claim), the one
 *       that is preserved wholesale (`funnel_released_aliases`), and
 *       `fp_handoff_codes` (a credential table small enough that every column
 *       should be looked at). On a table whose ROW is deleted, a new ordinary
 *       column is erased automatically — but `children.fp_cover_blob_key` is
 *       proof that "the row is deleted" is not always the end of the story.
 *   (3) EXTERNAL-OBJECT scope — repo-wide, because this is the one class of
 *       column a row delete CANNOT erase: it names bytes living outside
 *       Postgres, and a Blob URL stays readable forever until the object itself
 *       is deleted.
 *
 * ── THE BLIND SPOT THIS FILE USED TO DECLARE, AND HOW IT CLOSED (2026-08-06) ─
 * An earlier version of this header said the Image Lab tables
 * (`fp_image_lab_runs` / `_images` / `_references`) were invisible here because
 * they had no migration in this repo. Image Lab v1 merged (#140, #143) and they
 * do now — and the tripwire immediately reported both `storage_key` columns,
 * which is the mechanism working exactly as designed. All three are classified
 * below and `fp_image_lab_runs` is really purged by `erase-family-core.ts`.
 *
 * The merge ALSO exposed a hole in the tripwire's own reach, which is fixed
 * here rather than noted: `source_child_id` is a real FK to `children.id`, but
 * TABLE scope matched the column name `child_id` EXACTLY, so a table hanging
 * off a child under any other prefix was silently out of scope. Scope now
 * matches the SUFFIX (`(^|_)child_id$` / `(^|_)profile_id$`), which is what a
 * link-shaped column actually looks like. That also pulled in
 * `path_fw_released_aliases.released_profile_id`, classified below.
 */

/* ───────────────────────────────── table scope ─────────────────────────────── */

/**
 * How a family erasure disposes of a table's rows.
 *
 *   erased-explicitly   the eraser issues a delete against this table itself
 *   erased-by-cascade   a delete the eraser issues takes these rows via an FK
 *                       CASCADE (no statement of its own — the cascade IS the
 *                       coverage, and the FK is named in the note)
 *   scrubbed-in-place   rows SURVIVE by design; named columns are nulled
 *   retained            rows survive and are NOT scrubbed — a deliberate,
 *                       reasoned exception (never a default)
 */
export type TableDisposition =
  | "erased-explicitly"
  | "erased-by-cascade"
  | "scrubbed-in-place"
  | "retained";

export type TableLedgerEntry = { disposition: TableDisposition; note: string };

/** Anchors audited regardless of their column names. */
export const ERASURE_ANCHOR_TABLES = ["children", "parents"] as const;

/**
 * A table is in TABLE scope if it carries a column whose name ENDS IN one of
 * these (i.e. it hangs off a child or off a child's profile) — or is an anchor.
 *
 * SUFFIX, not equality, and the difference is not cosmetic: Image Lab landed
 * `fp_image_lab_runs.source_child_id` — a genuine `references children(id)` —
 * and an exact-name match let a table full of a child's authored text sit
 * entirely outside this audit. A link-shaped column is `<qualifier>_child_id`
 * as often as it is bare `child_id`, so the pattern matches how the schema is
 * really written. (`^|_` anchors the boundary, so a hypothetical `grandchild_id`
 * still matches by design — over-inclusion costs one ledger line.)
 */
export const CHILD_LINK_COLUMNS = ["child_id", "profile_id"] as const;

/** True if `col` names a link to a child or a child's profile. */
export function isChildLinkColumn(col: string): boolean {
  return CHILD_LINK_COLUMNS.some((c) => col === c || col.endsWith(`_${c}`));
}

export const ERASURE_TABLE_LEDGER: Record<string, TableLedgerEntry> = {
  /* ── the anchors ── */
  children: {
    disposition: "erased-explicitly",
    note: "The roster row, deleted per child (step 7). Every column goes with it EXCEPT fp_cover_blob_key, which names an external object — see the external ledger.",
  },
  parents: {
    disposition: "erased-by-cascade",
    note: "parents.id -> auth.users ON DELETE CASCADE. Removed by the parent auth-account delete (step 9), full-family scope only.",
  },

  /* ── the FP/Path graph the eraser walks explicitly ── */
  fp_public_sites: {
    disposition: "erased-explicitly",
    note: "Step 0 — dies first (RESTRICT -> fp_player_profiles). Frees the handle; an operator-locked row is still deleted, loudly.",
  },
  fp_ledger: {
    disposition: "erased-explicitly",
    note: "Step 1 (RESTRICT -> fp_player_profiles). In-game play money, not an accounting record — no retention claim.",
  },
  fp_player_saves: {
    disposition: "erased-explicitly",
    note: "Step 2 (RESTRICT -> fp_player_profiles). The child's whole game document.",
  },
  fp_player_profiles: {
    disposition: "erased-explicitly",
    note: "Step 3 (RESTRICT -> children AND auth.users).",
  },
  path_student_profiles: {
    disposition: "erased-explicitly",
    note: "Step 4 (RESTRICT -> children AND auth.users).",
  },
  fp_task_feedback: {
    disposition: "erased-by-cascade",
    note: "profile_id -> fp_player_profiles ON DELETE CASCADE, so the child's free-text feedback goes with step 3. The append-only trigger exempts service_role, which is what the eraser runs as.",
  },

  /* ── New User Flow v3 ── */
  fp_handoff_codes: {
    disposition: "erased-explicitly",
    note: "Step 4a. child_id -> children ON DELETE CASCADE would take them anyway; deleted explicitly and EARLY so a live sign-in credential stops working before the identity it grants, and so the count is visible in the summary.",
  },
  fp_onboarding_drafts: {
    disposition: "erased-explicitly",
    note: "Step 4b (by child_id) + step 7c (by parent_id, for abandoned drafts). MUST precede the children delete: child_id is ON DELETE SET NULL, so a roster delete first would orphan the row. Its two blob keys are deleted at the store first.",
  },

  /* ── consent + signup evidence ── */
  fp_parental_consent: {
    disposition: "erased-explicitly",
    note: "Step 8 by parent_id (family scope) / step 7 by child_id (child scope). Deliberately LAST: compliance evidence is never destroyed as a side effect, only as an explicit final step of a data-rights erasure.",
  },
  fp_signup_attempts: {
    disposition: "erased-explicitly",
    note: "Step 8 by parent_id, with a parent_email FALLBACK used only when the parent_id delete matched nothing. FULL-FAMILY SCOPE ONLY: a child-scoped erasure leaves the parent's attempt rows (child_id SET NULL), which is correct — they are the parent's own signup evidence.",
  },

  /* ── the provisioning ledgers ── */
  funnel_student_provisioning: {
    disposition: "scrubbed-in-place",
    note: "The row SURVIVES by design (child_id SET NULL + released trigger) because local_part is the never-reissue key. RELEASED_CLAIM_PII_COLUMNS are nulled instead; see the column ledger.",
  },
  funnel_released_aliases: {
    disposition: "retained",
    note: "ERASURE_PRESERVED_TABLES. The never-reissue address ledger: a burned local_part must stay burned or the next same-name child inherits a minor's old mailbox. It retains `email` (which is only local_part@domain) and a now-dangling child_id — a deliberate, documented exception.",
  },

  /* ── the v2 applicant funnel (pre-existing behaviour, recorded here) ── */
  projects: {
    disposition: "erased-by-cascade",
    note: "child_id -> children ON DELETE CASCADE (20260805120000). The kid's project pitch/quiz answers go with the roster row.",
  },
  child_reviews: {
    disposition: "erased-by-cascade",
    note: "child_id -> children ON DELETE CASCADE (20260713110000). Staff review notes about the child.",
  },
  deposits: {
    disposition: "erased-by-cascade",
    note: "child_id -> children ON DELETE CASCADE (20260709200000). ⚠ RETENTION FLAG: these are Stripe payment records (session, payment_intent, amount, refunded_at). A family erasure DESTROYS them today by cascade. If bookkeeping requires them, the fix is a schema/retention decision (anonymize rather than cascade), not a quiet change here.",
  },
  deposit_attempts: {
    disposition: "erased-by-cascade",
    note: "child_id -> children ON DELETE CASCADE (20260811120000). Deposit-policy acceptance evidence (policy hash + accepted IP); same retention flag as `deposits`.",
  },

  /* ── Image Lab v1 (#140/#143) ── */
  fp_image_lab_runs: {
    disposition: "erased-explicitly",
    note: "Step 0a, FIRST in the per-child pass. source_child_id -> children ON DELETE SET NULL, so the roster delete would keep the row and ERASE ITS PROVENANCE — the run would survive, unfindable, still carrying the child's authored text (template / slot_values / resolved_prompt, which routinely contain the kid's own first name inside `pitch`). Purged per the migration's own runbook: walk the iterated_from_run_id lineage (copy-forward descendants carry the same text and are ALSO SET NULL), delete every fp_image_lab_images object at the store, then delete the runs — fp_image_lab_images rows CASCADE with them. Empty in production as of 2026-08-06, so nothing is stranded today.",
  },

  /* ── the FW never-reissue ledger ── */
  path_fw_released_aliases: {
    disposition: "retained",
    note: "The FW twin of funnel_released_aliases: a name-derived local_part freed by an anonymization, recorded FOREVER so the next same-name student cannot inherit it. Retained for the same reason, and note the FK is `released_profile_id -> path_student_profiles ON DELETE RESTRICT` — it would BLOCK step 4 for an enrolled child. Per erase-family-rules.ts an FP-signup child is never enrolled in Path/FW coursework, so this table is expected EMPTY for every subject this eraser sees; if it is not, the path_student_profiles delete raises 23503 and the child is stranded fail-safe rather than half-erased.",
  },

  /* ── telemetry / audit, deliberately NOT erased ── */
  funnel_events: {
    disposition: "retained",
    note: "child_id is a bare uuid with NO foreign key (20260813120000), so nothing cascades and the eraser does not sweep it. Rows keep a child_id + a properties jsonb. NOT ERASED, deliberately: it is product analytics keyed on ids rather than identity, and draining it is a separate decision from this unit. Flagged as a residual-identifier gap in the erasure review notes.",
  },
  crm_audit_log: {
    disposition: "retained",
    note: "Staff action audit trail; child_id is a bare uuid with NO foreign key (20260713110000). Retained ON PURPOSE — an audit log that a subject can delete is not an audit log — and it holds staff actions plus ids, not the child's own content.",
  },
};

/* ──────────────────────────────── column scope ─────────────────────────────── */

/**
 * What erasure does with ONE column's value.
 *
 *   row-deleted      the row itself is deleted; the value goes with it
 *   scrubbed         the row survives; this column is explicitly nulled
 *   preserved        the row survives and this value is deliberately kept
 *   external-object  the value NAMES BYTES OUTSIDE POSTGRES. Deleting the row is
 *                    NOT erasure — the object must be deleted at the store. Every
 *                    such column must ALSO appear in the external-object ledger.
 */
export type ColumnDisposition = "row-deleted" | "scrubbed" | "preserved" | "external-object";

/** Tables whose EVERY column must be classified (see scope (2) in the header). */
export const COLUMN_AUDITED_TABLES = [
  "children",
  "fp_onboarding_drafts",
  "fp_handoff_codes",
  "funnel_student_provisioning",
  "funnel_released_aliases",
] as const;

/** Shorthand: mark a whole list of columns with one disposition. */
const all = (cols: readonly string[], disposition: ColumnDisposition): Record<string, ColumnDisposition> =>
  Object.fromEntries(cols.map((c) => [c, disposition]));

export const ERASURE_COLUMN_LEDGER: Record<string, Record<string, ColumnDisposition>> = {
  // The roster row is DELETED, so every column is erased by that one statement —
  // except the blob key, which only points at the data.
  children: {
    ...all(
      [
        "id",
        "parent_id",
        "first_name",
        "last_name",
        "grade",
        "birth_year",
        "current_school",
        // v2 applicant photo: a data: URL stored INLINE in the row (initial
        // schema comment: "data URL for V2; move to a storage bucket later"),
        // so the row delete really is the erasure. If it is ever moved to a
        // bucket, it becomes an external-object column and this ledger will not
        // let that change land unnoticed.
        "photo",
        "subjects",
        "test_scores",
        "workshop_ids_legacy",
        "interests",
        "project_pitch",
        "portfolio_links",
        "status",
        "submitted_at",
        "created_at",
        "updated_at",
        "group_slug",
        "academics",
        "submission_notified_at",
        "applicant_state",
        "child_email",
        "child_email_none",
        "family_goal",
        "arrived_at",
        "fp_username",
        "photo_consent_revoked_at",
        // v3 Unit 7/8 carry: the cover status/counter and the two columns the
        // brief called out — the kid's AGE and their STORY ANSWERS. All erased
        // by the children row delete.
        "fp_cover_status",
        "fp_cover_generation_count",
        "fp_cover_data_url",
        "fp_kid_age",
        "fp_story_answers",
      ],
      "row-deleted"
    ),
    fp_cover_blob_key: "external-object",
  },

  fp_onboarding_drafts: {
    ...all(
      [
        "id",
        "parent_id",
        "child_id",
        "signup_attempt_id",
        "kid_first_name",
        "kid_last_name",
        "kid_age",
        "answers",
        "cover_status",
        "generation_count",
        "status",
        "created_at",
        "updated_at",
        "cover_data_url",
      ],
      "row-deleted"
    ),
    photo_blob_key: "external-object",
    cover_blob_key: "external-object",
  },

  fp_handoff_codes: all(
    ["id", "code_hash", "child_id", "created_at", "expires_at", "used_at", "consumed_ip", "consumed_ua"],
    "row-deleted"
  ),

  // THE SURVIVOR. Its row is never deleted (never-reissue), so every column here
  // is a real decision rather than a consequence.
  funnel_student_provisioning: {
    ...all(
      [
        // The identity/PII set, nulled by the released-claim scrub. Keep in step
        // with RELEASED_CLAIM_PII_COLUMNS in erase-family-rules.ts (the coverage
        // test asserts the two agree).
        "email",
        "workspace_attempted_email",
        "supabase_user_id",
        "forwarding_target",
        "last_error",
      ],
      "scrubbed"
    ),
    ...all(
      [
        "id",
        "child_id", // SET NULL by the children delete — no identity left in it
        "state",
        "forwarding_state",
        "local_part", // THE never-reissue key: nulling it re-opens the address
        "consent_policy_version",
        "mailbox_ready_at",
        "pending_reason",
        "exception_reason",
        "released_reason",
        "lease_owner",
        "lease_expires_at",
        "attempt_count",
        "ops_alerted_at",
        "created_at",
        "updated_at",
        "workspace_attempted_at",
        "forwarding_requested_at",
        "forwarding_alerted_at",
        "forwarding_first_requested_at",
        "workspace_suspended_at",
      ],
      "preserved"
    ),
  },

  // Preserved wholesale — see the table ledger's note.
  funnel_released_aliases: all(
    ["local_part", "email", "child_id", "reason", "released_at"],
    "preserved"
  ),
};

/* ───────────────────────── external-object scope ───────────────────────────── */

/**
 * Column names that LOOK like a pointer to bytes outside Postgres. Matched
 * repo-wide against every table, because this is the class of column a row
 * delete cannot erase. Intentionally broad: a false positive costs one ledger
 * line, a false negative costs a minor's photo surviving their erasure.
 */
export const EXTERNAL_OBJECT_COLUMN_PATTERN = /(blob|storage|bucket|object_key)/;

export type ExternalObjectEntry = {
  /** true = it really names an external object an erasure must delete. */
  external: boolean;
  note: string;
};

export const ERASURE_EXTERNAL_OBJECT_LEDGER: Record<string, ExternalObjectEntry> = {
  "children.fp_cover_blob_key": {
    external: true,
    note: "Deleted at the store (step 6b) BEFORE the children row, via deps.deleteBlob under the child namespace guard. Null today: the shipped cover path is template-only.",
  },
  "fp_onboarding_drafts.cover_blob_key": {
    external: true,
    note: "Deleted at the store before the draft row (steps 4b / 7c), under the draft namespace guard.",
  },
  "fp_onboarding_drafts.photo_blob_key": {
    external: true,
    note: "The SOURCE PHOTO of a minor — the highest-value object in the system. Deleted at the store before the draft row (steps 4b / 7c).",
  },
  "fp_image_lab_images.storage_key": {
    external: true,
    note: "An object in the private `fp-image-lab` Supabase Storage bucket, at `runs/{run_id}/{image_id}`. The row is CASCADE-deleted with its run, which drops the pointer and leaves the bytes — imagery generated from a minor's own product text — sitting in the bucket, readable to anyone who can mint a signed URL. So the eraser really deletes it: step 0a collects the keys across the run's whole copy-forward lineage and calls deps.deleteImageLabObject BEFORE deleting any run row, exactly the object-before-row rule the cover blobs already follow. A delete failure strands the child and preserves its anchor for the re-run; the row is the ONLY record of its key, so deleting rows past a failed object delete would make the survivors permanently unattributable (migration 20260919120000, purge step 3).",
  },
  "fp_image_lab_references.storage_key": {
    external: false,
    note: "NOT erased by this path, and the reason is structural rather than a shrug. A reference is a STAFF-AUTHORED character sheet or style sample: the table carries no child link of any kind (no FK, no id column that reaches a child), so a family erasure has nothing to select on — and it is APPEND-ONLY BY TRIGGER (fp_image_lab_references_append_only_guard, no role exemption, because fp_image_lab_runs points at these ids inside a uuid[] with no FK and a delete would dangle every referencing run). The migration states the condition that would make this wrong: a reference derived from a child's drawing, product photo, or likeness is an unrecoverable v1 mistake, which is why Unit 4's upload UI forbids it at the point of upload. If references ever become child-derived or gain a child link, this entry flips to external:true and the append-only trigger has to go with it.",
  },
  "funnel_rate_events.bucket": {
    external: false,
    note: "Not storage: the rate-limiter's time/namespace bucket. Nothing external to delete.",
  },
  "path_evidence_items.bucket": {
    external: false,
    note: "Path/FW coursework evidence in Supabase Storage. NOT erased by this path, and deliberately so: erase-family-rules.ts documents that an FP-signup child is never enrolled in Path/FW coursework, and draining that graph (≈10 RESTRICT dependents) is a separate unit. If an FP child ever gains coursework, this entry must flip.",
  },
};

/* ──────────────────────────────── the audit ────────────────────────────────── */

export type CoverageFinding = {
  kind:
    | "unclassified-table"
    | "stale-table"
    | "unclassified-column"
    | "stale-column"
    | "missing-audited-table"
    | "unclassified-external-object"
    | "stale-external-object";
  subject: string;
  detail: string;
};

/** Tables in TABLE scope, derived from the schema (never hand-listed). */
export function tablesInErasureScope(schema: Record<string, string[]>): string[] {
  return Object.entries(schema)
    .filter(
      ([table, cols]) =>
        (ERASURE_ANCHOR_TABLES as readonly string[]).includes(table) ||
        cols.some(isChildLinkColumn)
    )
    .map(([table]) => table)
    .sort();
}

/**
 * The tripwire. Compares the ledger above against a schema shape and returns
 * every discrepancy. EMPTY means every table and column that could hold a
 * child's data has an explicit, written-down disposition.
 */
export function auditErasureCoverage(schema: Record<string, string[]>): CoverageFinding[] {
  const findings: CoverageFinding[] = [];

  // (1) TABLE scope, both directions.
  const scoped = tablesInErasureScope(schema);
  for (const table of scoped) {
    if (!ERASURE_TABLE_LEDGER[table]) {
      findings.push({
        kind: "unclassified-table",
        subject: table,
        detail: `${table} hangs off a child (child_id/profile_id) but ERASURE_TABLE_LEDGER says nothing about it. Decide what a family erasure does with its rows and record it — "retained, because X" is a valid answer.`,
      });
    }
  }
  for (const table of Object.keys(ERASURE_TABLE_LEDGER)) {
    if (!scoped.includes(table)) {
      findings.push({
        kind: "stale-table",
        subject: table,
        detail: `ERASURE_TABLE_LEDGER classifies ${table}, but it is not in the schema's erasure scope any more (dropped, renamed, or its child link went away). Remove or update the entry.`,
      });
    }
  }

  // (2) COLUMN scope, both directions.
  for (const table of COLUMN_AUDITED_TABLES) {
    const cols = schema[table];
    if (!cols) {
      findings.push({
        kind: "missing-audited-table",
        subject: table,
        detail: `${table} is column-audited but no longer exists in the schema. The audit would be silently vacuous — fix COLUMN_AUDITED_TABLES.`,
      });
      continue;
    }
    const ledger = ERASURE_COLUMN_LEDGER[table] ?? {};
    for (const col of cols) {
      if (!ledger[col]) {
        findings.push({
          kind: "unclassified-column",
          subject: `${table}.${col}`,
          detail: `A new column on a column-audited table. Say what erasure does with it: row-deleted / scrubbed / preserved / external-object.`,
        });
      }
    }
    for (const col of Object.keys(ledger)) {
      if (!cols.includes(col)) {
        findings.push({
          kind: "stale-column",
          subject: `${table}.${col}`,
          detail: `Classified in ERASURE_COLUMN_LEDGER but absent from the schema (dropped or renamed).`,
        });
      }
    }
  }

  // (3) EXTERNAL-OBJECT scope, repo-wide, both directions.
  const external: string[] = [];
  for (const [table, cols] of Object.entries(schema)) {
    for (const col of cols) {
      if (EXTERNAL_OBJECT_COLUMN_PATTERN.test(col)) external.push(`${table}.${col}`);
    }
  }
  for (const ref of external) {
    if (!ERASURE_EXTERNAL_OBJECT_LEDGER[ref]) {
      findings.push({
        kind: "unclassified-external-object",
        subject: ref,
        detail: `Looks like a pointer to bytes outside Postgres. A row delete does NOT erase those bytes. Record whether it really is external and, if so, how the erasure deletes the object.`,
      });
    }
  }
  for (const ref of Object.keys(ERASURE_EXTERNAL_OBJECT_LEDGER)) {
    if (!external.includes(ref)) {
      findings.push({
        kind: "stale-external-object",
        subject: ref,
        detail: `Classified in ERASURE_EXTERNAL_OBJECT_LEDGER but absent from the schema (dropped or renamed).`,
      });
    }
  }

  return findings;
}
