/**
 * A small STATEFUL in-memory Postgres-lite used by the Slice B Unit 11
 * full-sequence E2E and stress tests. It is deliberately NOT the per-unit
 * `handle(state) => cannedResult` fake every earlier signup test used: those
 * fakes returned a fixed answer per query and so could never catch a defect in
 * the SEAM BETWEEN units — a write one core makes that a later core reads back
 * (the Unit 9 learning: "a gate that reads a row is only as wired as the route
 * that writes it"). This harness threads ONE mutable `store` through startSignup
 * → verifyCompletion → recordConsent → consentGate → createChild → the real
 * driveProvisioning, so every assertion is against state a PRIOR step actually
 * persisted.
 *
 * Scope on purpose: it implements only the PostgREST surface these cores use
 * (eq / is / gt / lt / neq / not-is-null / or / in / like / order / limit /
 * single / maybeSingle / insert.select / update.select / upsert / delete), and
 * only the constraints that change control flow (the fp_parental_consent partial
 * unique index; funnel_student_provisioning's UNIQUE(child_id) via upsert). It is
 * NOT a general Postgres. If a future core reaches for an operator not here, add
 * it here rather than widening a canned mock.
 *
 * FAULT INJECTION: `fakeClient(store, faults)` takes an optional plan keyed
 * `"<op>:<table>"` (e.g. `"select:path_student_profiles"`) so route tests can
 * exercise DB-error, zero-row, and trigger-coercion paths without a second
 * mock layer: `error` short-circuits the op with a PostgREST-shaped error,
 * `no-rows` reports success with nothing affected (and mutates nothing), and
 * `coerce` (update only) applies extra values AFTER the patch — modeling a
 * roster trigger rewriting what the caller wrote (the stale-status-echo
 * learning).
 */

import { randomUUID } from "node:crypto";
import { extractSiteContent } from "@/app/fp/lib/fp-public-site-rules";

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

type PgError = { message: string; code?: string; details?: string } | null;
type Predicate = (row: Row) => boolean;

/** One injected fault — see the module header's FAULT INJECTION note. */
export type Fault =
  | { kind: "error"; error: NonNullable<PgError> }
  | { kind: "no-rows" }
  | { kind: "coerce"; values: Row };

/** Faults keyed `"<op>:<table>"`, e.g. `"update:children"`. */
export type FaultPlan = Record<string, Fault>;

/** A per-table INSERT uniqueness guard: return a 23505-shaped error or null. */
type UniqueGuard = (candidate: Row, existing: Row[]) => PgError;

const uniqueGuards: Record<string, UniqueGuard> = {
  // The partial unique index migration 20260830120000 adds:
  //   UNIQUE (signup_attempt_id) WHERE revoked_at IS NULL AND signup_attempt_id
  //   IS NOT NULL. It is what makes "one active consent per attempt" a DB
  //   invariant (consent-core relies on the 23505 to classify a duplicate).
  fp_parental_consent: (cand, existing) => {
    const attemptId = cand.signup_attempt_id;
    if (attemptId == null || cand.revoked_at != null) return null;
    const clash = existing.some(
      (r) => r.signup_attempt_id === attemptId && r.revoked_at == null
    );
    return clash
      ? {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "fp_parental_consent_active_attempt_uq"',
        }
      : null;
  },
  // Real-public-site Unit 2: the claim arbiter. Handle UNIQUE first (the
  // designed `taken` branch), then the profile_id PK (one site per learner) —
  // constraint names mirror the live ones so classifyClaimConflict's
  // message-sniffing sees production shapes.
  fp_public_sites: (cand, existing) => {
    if (existing.some((r) => r.handle === cand.handle)) {
      return {
        code: "23505",
        message: 'duplicate key value violates unique constraint "fp_public_sites_handle_key"',
      };
    }
    if (existing.some((r) => r.profile_id === cand.profile_id)) {
      return {
        code: "23505",
        message: 'duplicate key value violates unique constraint "fp_public_sites_pkey"',
      };
    }
    return null;
  },
};

function matches(row: Row, preds: Predicate[]): boolean {
  return preds.every((p) => p(row));
}

/** Parse consent-core's `.or("child_id.is.null,child_id.eq.<id>")` form. Only
 *  the two arms the codebase actually emits (is.null / eq.<value>) are honored. */
function orPredicate(expr: string): Predicate {
  const arms = expr.split(",").map((arm) => {
    const [col, op, ...rest] = arm.split(".");
    const val = rest.join(".");
    if (op === "is" && val === "null") return (r: Row) => r[col] == null;
    if (op === "eq") return (r: Row) => String(r[col]) === val;
    throw new Error(`fake-supabase: unsupported or() arm "${arm}"`);
  });
  return (r: Row) => arms.some((a) => a(r));
}

type Op = "select" | "insert" | "update" | "delete" | "upsert";

class Builder implements PromiseLike<{ data: unknown; error: PgError }> {
  private preds: Predicate[] = [];
  private op: Op = "select";
  private payload: Row[] = [];
  private returning = false;
  private orderKey: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private onConflict: string[] = [];
  private ignoreDuplicates = false;

  constructor(
    private store: Store,
    private table: string,
    private faults?: FaultPlan
  ) {
    if (!store[table]) store[table] = [];
  }

  private rows(): Row[] {
    return this.store[this.table];
  }

  /* -------- op setters -------- */
  select(cols?: string): this {
    void cols; // column projection is not modeled — callers read named fields
    this.returning = true;
    return this;
  }
  insert(rowOrRows: Row | Row[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = [patch];
    return this;
  }
  upsert(rowOrRows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = "upsert";
    this.payload = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    this.onConflict = (opts?.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  /* -------- filters -------- */
  eq(col: string, val: unknown): this {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.preds.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: null): this {
    this.preds.push((r) => r[col] == null && val === null);
    return this;
  }
  gt(col: string, val: string | number): this {
    this.preds.push((r) => r[col] != null && (r[col] as string | number) > val);
    return this;
  }
  lt(col: string, val: string | number): this {
    this.preds.push((r) => r[col] != null && (r[col] as string | number) < val);
    return this;
  }
  not(col: string, op: string, val: null): this {
    if (op !== "is" || val !== null) throw new Error(`fake-supabase: unsupported not(${op})`);
    this.preds.push((r) => r[col] != null);
    return this;
  }
  or(expr: string): this {
    this.preds.push(orPredicate(expr));
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  like(col: string, pattern: string): this {
    const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
    this.preds.push((r) => typeof r[col] === "string" && (r[col] as string).startsWith(prefix));
    return this;
  }
  // Case-insensitive prefix match — the U12 child-core username pre-seed reads
  // `.ilike("fp_username", "<base>%")` to build its taken-set.
  ilike(col: string, pattern: string): this {
    const prefix = (pattern.endsWith("%") ? pattern.slice(0, -1) : pattern).toLowerCase();
    this.preds.push(
      (r) => typeof r[col] === "string" && (r[col] as string).toLowerCase().startsWith(prefix)
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderKey = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  /* -------- execution -------- */
  private execute(): { rows: Row[]; error: PgError } {
    const fault = this.faults?.[`${this.op}:${this.table}`];
    if (fault?.kind === "error") return { rows: [], error: fault.error };
    if (fault?.kind === "no-rows") return { rows: [], error: null };
    switch (this.op) {
      case "insert": {
        const inserted: Row[] = [];
        for (const raw of this.payload) {
          const row: Row = { ...raw };
          if (row.id === undefined) row.id = randomUUID();
          const guard = uniqueGuards[this.table];
          const err = guard?.(row, this.rows()) ?? null;
          if (err) return { rows: [], error: err };
          this.rows().push(row);
          inserted.push(row);
        }
        return { rows: inserted, error: null };
      }
      case "upsert": {
        const affected: Row[] = [];
        for (const raw of this.payload) {
          const existing =
            this.onConflict.length > 0
              ? this.rows().find((r) => this.onConflict.every((c) => r[c] === raw[c]))
              : undefined;
          if (existing) {
            if (!this.ignoreDuplicates) Object.assign(existing, raw);
            affected.push(existing);
          } else {
            const row: Row = { ...raw };
            if (row.id === undefined) row.id = randomUUID();
            this.rows().push(row);
            affected.push(row);
          }
        }
        return { rows: affected, error: null };
      }
      case "update": {
        const patch = this.payload[0];
        const hit = this.rows().filter((r) => matches(r, this.preds));
        for (const r of hit) {
          Object.assign(r, patch);
          // A "coerce" fault models a BEFORE trigger rewriting the payload:
          // the statement lands, but the stored (and echoed) values differ.
          if (fault?.kind === "coerce") Object.assign(r, fault.values);
        }
        return { rows: hit, error: null };
      }
      case "delete": {
        const keep = this.rows().filter((r) => !matches(r, this.preds));
        const removed = this.rows().filter((r) => matches(r, this.preds));
        this.store[this.table] = keep;
        // Model the ON DELETE SET NULL FKs that deleting a children row triggers:
        // fp_parental_consent.child_id (unbinds the claimed consent so a clean
        // retry can re-claim it) and funnel_student_provisioning.child_id (the
        // claim survives as a released placeholder, never cascaded away). This is
        // load-bearing for the compensation/idempotency stress test.
        if (this.table === "children" && removed.length > 0) {
          const goneIds = new Set(removed.map((r) => r.id));
          for (const t of ["fp_parental_consent", "funnel_student_provisioning"]) {
            for (const r of this.store[t] ?? []) {
              if (goneIds.has(r.child_id)) r.child_id = null;
            }
          }
        }
        return { rows: removed, error: null };
      }
      case "select":
      default: {
        let hit = this.rows().filter((r) => matches(r, this.preds));
        if (this.orderKey) {
          const { col, asc } = this.orderKey;
          hit = [...hit].sort((a, b) => {
            const av = a[col] as string | number;
            const bv = b[col] as string | number;
            if (av === bv) return 0;
            return (av > bv ? 1 : -1) * (asc ? 1 : -1);
          });
        }
        if (this.limitN != null) hit = hit.slice(0, this.limitN);
        return { rows: hit, error: null };
      }
    }
  }

  /* -------- terminals -------- */
  maybeSingle(): Promise<{ data: Row | null; error: PgError }> {
    const { rows, error } = this.execute();
    if (error) return Promise.resolve({ data: null, error });
    if (rows.length > 1) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "multiple (or no) rows returned" },
      });
    }
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single(): Promise<{ data: Row | null; error: PgError }> {
    const { rows, error } = this.execute();
    if (error) return Promise.resolve({ data: null, error });
    if (rows.length !== 1) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "expected exactly one row" },
      });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }
  then<R1 = { data: unknown; error: PgError }, R2 = never>(
    resolve?: ((v: { data: unknown; error: PgError }) => R1 | PromiseLike<R1>) | null,
    reject?: ((e: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    const { rows, error } = this.execute();
    const data = this.returning || this.op === "select" ? rows : null;
    return Promise.resolve({ data, error }).then(resolve, reject);
  }
}

/** A fake SupabaseClient exposing only `.from(table)` over the shared store.
 *  `faults` (optional) injects per-`"<op>:<table>"` failures — module header. */
export function fakeClient(
  store: Store,
  faults?: FaultPlan
): {
  from: (t: string) => Builder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: PgError }>;
} {
  return {
    from: (table: string) => new Builder(store, table, faults),
    // The one RPC the FP site routes call. Implemented via the EXECUTABLE TS
    // SPEC of the SQL function (fp-public-site-rules extractSiteContent —
    // "THE SPEC LIVES HERE"), so route-level tests exercise the real deps
    // builder's RPC seam against the pinned semantics. Faultable like any op.
    rpc: (fn: string, args?: Record<string, unknown>) => {
      const fault = faults?.[`rpc:${fn}`];
      if (fault?.kind === "error") return Promise.resolve({ data: null, error: fault.error });
      if (fn === "fp_public_site_content") {
        const { headline, oneLiner } = extractSiteContent(args?.p_doc);
        return Promise.resolve({ data: [{ headline, one_liner: oneLiner }], error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: `fake-supabase: unknown rpc ${fn}` },
      });
    },
  };
}

/** A fresh store seeded with the fixtures every signup run assumes exist:
 *  a current path_program_versions row (the child mint pins it, no fallback). */
export function newStore(): Store {
  return {
    fp_signup_attempts: [],
    families: [],
    fp_parental_consent: [],
    children: [],
    path_role_grants: [],
    path_families: [],
    path_program_versions: [{ id: "pv-current", is_current: true }],
    path_student_profiles: [],
    fp_player_profiles: [],
    fp_player_saves: [],
    fp_ledger: [],
    funnel_student_provisioning: [],
    funnel_released_aliases: [],
    path_fw_released_aliases: [],
  };
}
