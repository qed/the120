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
 * (eq / is / gt / lt / neq / not.is / or / in / like / order / limit /
 * single / maybeSingle / insert.select / update.select / upsert / delete), and
 * only the constraints that change control flow (the fp_parental_consent partial
 * unique index; funnel_student_provisioning's UNIQUE(child_id) via upsert). It is
 * NOT a general Postgres. If a future core reaches for an operator not here, add
 * it here rather than widening a canned mock. (Watchtower Unit 2 took that
 * invitation: a server-side `max-rows` cap, an unordered-select perturbation, and
 * a never-settling `hang` fault.)
 *
 * FAULT INJECTION: `fakeClient(store, faults)` takes an optional plan keyed
 * `"<op>:<table>"` (e.g. `"select:path_student_profiles"`) so route tests can
 * exercise DB-error, zero-row, and trigger-coercion paths without a second
 * mock layer: `error` short-circuits the op with a PostgREST-shaped error,
 * `no-rows` reports success with nothing affected (and mutates nothing),
 * `coerce` (update only) applies extra values AFTER the patch — modeling a
 * roster trigger rewriting what the caller wrote (the stale-status-echo
 * learning) — and `hang` never settles at all, which is how a route's timeout
 * can be tested (a stalled round trip is NOT an error the database returned;
 * it is the absence of an answer, and only a fault that never resolves models
 * it).
 *
 * ── PER-CALL SCOPING, AND WHY IT EXISTS (v3 Unit 4 review, FIX 5/6) ──
 * A key like `"update:fp_onboarding_drafts"` names an OP ON A TABLE, not a call
 * site — and a core that both RESERVES and SETTLES on one table issues several.
 * A plan that faults them all can only ever exercise the FIRST, which is how a
 * test came to claim it proved the settle-failure branch while actually proving
 * the reservation-failure branch. So a fault may ALSO carry:
 *
 *   `onCalls`      — the 1-based call ordinals of its own `op:table` key it
 *                    applies to. Ordinals count EVERY call of that key, faulted
 *                    or not (a `hang` included — it is still a query issued), so
 *                    `[2]` really is "the second one".
 *   `concurrently` — a mutation applied to the table's rows AFTER the faulted op
 *                    returns. Paired with `no-rows` this is the only honest
 *                    model of a LOST COMPARE-AND-SET: our statement matched zero
 *                    rows *because another writer got there first*, and the
 *                    re-read must see what that writer wrote.
 *
 * A plan value may be a single fault or a LIST of them; the first whose
 * `onCalls` matches (or which has none) wins. A fault with no `onCalls` applies
 * to every call, which is the pre-existing behaviour, unchanged.
 *
 * ── Two FIDELITY gaps this harness used to have, and how they were closed ──
 * A harness that is gentler than Postgres makes green tests lie, so the
 * following is an opt-in knob rather than silent kindness (opt-in because
 * hundreds of existing fixtures were written against the gentle behaviour, and
 * flipping the default would be a repo-wide rewrite rather than a fidelity fix):
 *
 *   - `perturbUnordered` — an unordered select returned rows in INSERTION order,
 *     so deleting every `.order()` from a paging route left its whole test suite
 *     green while production scrambled. With this on, a select WITHOUT `.order()`
 *     comes back in a deliberately perturbed (reversed) order, which is exactly
 *     as valid as any other and reliably breaks anything that was quietly
 *     relying on insertion order.
 *
 *   - `recordCalls` — `select()` DISCARDED its column list and every filter was
 *     collapsed into an anonymous predicate, so the QUERY was unobservable and
 *     only its RESULT could be asserted. That made "this endpoint does not read
 *     column X" and "this read asks for page size N" untestable claims: adding
 *     `parent_id, birth_year` back to a select, or deleting a `.limit()` the
 *     harness's own `maxRows` then truncated identically, changed no response
 *     body anywhere. With a sink array passed, every terminated call is recorded
 *     as a `RecordedCall` — table, op, the literal column string, the filters in
 *     call order, the order key and the client's own `.limit()`. Reading a
 *     child's date of birth under the service role is exactly the kind of thing
 *     a response-body assertion cannot see. Inert when the option is absent.
  */

import { randomUUID } from "node:crypto";
import { extractSiteContent } from "@/app/lib/fp/fp-public-site-rules";

export type Row = Record<string, unknown>;
export type Store = Record<string, Row[]>;

type PgError = { message: string; code?: string; details?: string } | null;
type Predicate = (row: Row) => boolean;

/** One injected fault — see the module header's FAULT INJECTION note. */
export type Fault = (
  | { kind: "error"; error: NonNullable<PgError> }
  | { kind: "no-rows" }
  | { kind: "coerce"; values: Row }
  /** Never settles — models a round trip that stalls rather than fails. */
  | { kind: "hang" }
) & {
  /**
   * 1-based call ordinals of this fault's own `op:table` key that it applies to.
   * Omitted = every call (the pre-existing behaviour). Ordinals count every call
   * of the key, faulted or not, so a core that reserves then settles on one
   * table can have exactly its settle faulted with `onCalls: [2]`.
   */
  onCalls?: readonly number[];
  /**
   * Applied to the table's rows AFTER the faulted op returns. With `no-rows` on
   * an update this is what makes a LOST CAS realistic: the statement affected
   * nothing because a concurrent writer had already moved the row, and the
   * caller's re-read must observe that writer's value rather than its own.
   */
  concurrently?: (rows: Row[]) => void;
};

/** Faults keyed `"<op>:<table>"`, e.g. `"update:children"`. A list lets one key
 *  carry several per-ordinal faults; the first match (or the first unscoped
 *  entry) wins. */
export type FaultPlan = Record<string, Fault | readonly Fault[]>;

/** Resolve the fault, if any, that applies to call `ordinal` of `key`. */
function pickFault(
  plan: FaultPlan | undefined,
  key: string,
  ordinal: number
): Fault | undefined {
  const entry = plan?.[key];
  if (!entry) return undefined;
  const list = Array.isArray(entry) ? (entry as readonly Fault[]) : [entry as Fault];
  return list.find((f) => f.onCalls === undefined || f.onCalls.includes(ordinal));
}

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
  // New User Flow v3 Unit 3 (review FIX 2): migration 20260915120000 adds
  //   UNIQUE (parent_id, lower(kid_first_name), lower(kid_last_name))
  //   WHERE status = 'active'
  // — the DB arbiter that makes the loser of a two-tab add-kid race LOSE.
  // v3AddKid classifies this 23505 as the authoritative duplicate/resume
  // outcome, so it is exactly the kind of constraint that changes control flow
  // and therefore belongs here (module header).
  fp_onboarding_drafts: (cand, existing) => {
    if (cand.status !== "active") return null;
    if (cand.kid_first_name == null || cand.kid_last_name == null) return null;
    const key = (r: Row) =>
      `${String(r.kid_first_name).toLowerCase()}\u0000${String(r.kid_last_name).toLowerCase()}`;
    const clash = existing.some(
      (r) => r.status === "active" && r.parent_id === cand.parent_id && key(r) === key(cand)
    );
    return clash
      ? {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "fp_onboarding_drafts_active_kid_uq"',
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
    // `<col>.not.is.null` is the draft reaper's "names an object in either blob
    // column" read. Added here rather than worked around, per the module
    // header: a core reaching for an operator this fake lacks widens the FAKE.
    if (op === "not" && val === "is.null") return (r: Row) => r[col] != null;
    if (op === "eq") return (r: Row) => String(r[col]) === val;
    throw new Error(`fake-supabase: unsupported or() arm "${arm}"`);
  });
  return (r: Row) => arms.some((a) => a(r));
}

export type FakeOp = "select" | "insert" | "update" | "delete" | "upsert";
type Op = FakeOp;

/** One recorded filter, in the order the caller chained it. `not.is` is the one
 *  compound form the harness models (`.not(col, "is", null)`). */
export type RecordedFilter = {
  op: "eq" | "neq" | "is" | "gt" | "lt" | "not.is" | "or" | "in" | "like" | "ilike";
  col: string;
  value: unknown;
};

/**
 * One terminated call, recorded when `recordCalls` is supplied — the QUERY as
 * issued, not the rows it returned. See the module header for why the result
 * alone is not enough to pin a read.
 */
export type RecordedCall = {
  table: string;
  op: FakeOp;
  /** Exactly the string handed to `.select()`; null if it was never called. */
  columns: string | null;
  filters: RecordedFilter[];
  order: { col: string; ascending: boolean } | null;
  /** The `.limit(n)` the CLIENT asked for — never the server's `maxRows` cap. */
  limit: number | null;
  /** Which terminal ended the call. A `hang` fault records and then never
   *  settles, so a stalled round trip is still visible as an issued query. */
  terminal: "then" | "single" | "maybeSingle";
};

class Builder implements PromiseLike<{ data: unknown; error: PgError }> {
  private preds: Predicate[] = [];
  private op: Op = "select";
  private payload: Row[] = [];
  private returning = false;
  private orderKey: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private onConflict: string[] = [];
  private ignoreDuplicates = false;
  /** Recording state — written always, read only when `recordCalls` is set. */
  private selectCols: string | null = null;
  private filterLog: RecordedFilter[] = [];
  /** Memoized so one terminated call consumes exactly one ordinal, whether the
   *  fault lookup happens in `hangs()` or in `execute()`. */
  private faultResolved = false;
  private resolvedFault: Fault | undefined;

  constructor(
    private store: Store,
    private table: string,
    private faults: FaultPlan | undefined,
    private options: FakeClientOptions = {},
    /** Shared across every builder from one `fakeClient`, so `onCalls` ordinals
     *  count calls made by the whole core run rather than by one builder. */
    private callCounts: Map<string, number> = new Map()
  ) {
    if (!store[table]) store[table] = [];
  }

  /** The fault for THIS call, consuming one ordinal of its `op:table` key.
   *  Resolved lazily because the op is only known once the setters have run. */
  private faultForThisCall(): Fault | undefined {
    if (!this.faultResolved) {
      this.faultResolved = true;
      const key = `${this.op}:${this.table}`;
      const ordinal = (this.callCounts.get(key) ?? 0) + 1;
      this.callCounts.set(key, ordinal);
      this.resolvedFault = pickFault(this.faults, key, ordinal);
    }
    return this.resolvedFault;
  }

  private rows(): Row[] {
    return this.store[this.table];
  }

  /** Push one filter onto the recording log. Cheap and unconditional: the sink
   *  is consulted once, at the terminal, so recording stays inert by default. */
  private note(op: RecordedFilter["op"], col: string, value: unknown): void {
    this.filterLog.push({ op, col, value });
  }

  /* -------- op setters -------- */
  select(cols?: string): this {
    // Column PROJECTION is still not modeled — callers read named fields off the
    // stored row — but the requested list is RECORDED, so "this read asks for
    // exactly these columns" is assertable rather than invisible.
    this.selectCols = cols ?? null;
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
    this.note("eq", col, val);
    this.preds.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.note("neq", col, val);
    this.preds.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: null): this {
    this.note("is", col, val);
    this.preds.push((r) => r[col] == null && val === null);
    return this;
  }
  gt(col: string, val: string | number): this {
    this.note("gt", col, val);
    this.preds.push((r) => r[col] != null && (r[col] as string | number) > val);
    return this;
  }
  lt(col: string, val: string | number): this {
    this.note("lt", col, val);
    this.preds.push((r) => r[col] != null && (r[col] as string | number) < val);
    return this;
  }
  not(col: string, op: string, val: null): this {
    if (op !== "is" || val !== null) throw new Error(`fake-supabase: unsupported not(${op})`);
    this.note("not.is", col, val);
    this.preds.push((r) => r[col] != null);
    return this;
  }
  or(expr: string): this {
    this.note("or", "", expr);
    this.preds.push(orPredicate(expr));
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.note("in", col, vals);
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  like(col: string, pattern: string): this {
    const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
    this.note("like", col, pattern);
    this.preds.push((r) => typeof r[col] === "string" && (r[col] as string).startsWith(prefix));
    return this;
  }
  // Case-insensitive prefix match — the U12 child-core username pre-seed reads
  // `.ilike("fp_username", "<base>%")` to build its taken-set.
  ilike(col: string, pattern: string): this {
    const prefix = (pattern.endsWith("%") ? pattern.slice(0, -1) : pattern).toLowerCase();
    this.note("ilike", col, pattern);
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
    const fault = this.faultForThisCall();
    // `concurrently` models the OTHER writer: it lands after our statement
    // returns, so the caller's own re-read is what observes it.
    const concurrently = () => fault?.concurrently?.(this.rows());
    if (fault?.kind === "error") {
      concurrently();
      return { rows: [], error: fault.error };
    }
    if (fault?.kind === "no-rows") {
      concurrently();
      return { rows: [], error: null };
    }
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
        } else if (this.options.perturbUnordered) {
          // NO `order by` was asked for, so Postgres owes the caller nothing —
          // and a harness that hands back insertion order is quietly promising
          // something the database does not. Reversal is a deterministic
          // perturbation: reproducible in a failure, and different enough from
          // insertion order that anything depending on the latter breaks loudly.
          hit = [...hit].reverse();
        }
        if (this.limitN != null) hit = hit.slice(0, this.limitN);
        // …and THEN the server's own `max-rows`, which the client cannot opt
        // out of: a caller that asks for more than the cap gets the cap back
        // with `error: null` and no truncation signal whatsoever. That silence
        // is the whole bug class (docs/solutions/integration-issues/
        // postgrest-max-rows-1000-silently-truncates-unranged-select-*.md), so
        // the harness reproduces the silence rather than a helpful error.
        const maxRows = this.options.maxRows ?? Number.POSITIVE_INFINITY;
        if (hit.length > maxRows) hit = hit.slice(0, maxRows);
        return { rows: hit, error: null };
      }
    }
  }

  /* -------- terminals -------- */
  /** A `hang` fault never settles — the ONE thing an `error` fault cannot model,
   *  and the only way to exercise a caller's timeout. */
  private hangs(): boolean {
    return this.faultForThisCall()?.kind === "hang";
  }
  /** Record the query as ISSUED — before the fault check, so a stalled or failed
   *  round trip is still observable. Inert unless a sink was supplied. */
  private record(terminal: RecordedCall["terminal"]): void {
    const sink = this.options.recordCalls;
    if (!sink) return;
    sink.push({
      table: this.table,
      op: this.op,
      columns: this.selectCols,
      filters: [...this.filterLog],
      order: this.orderKey
        ? { col: this.orderKey.col, ascending: this.orderKey.asc }
        : null,
      limit: this.limitN,
      terminal,
    });
  }
  maybeSingle(): Promise<{ data: Row | null; error: PgError }> {
    this.record("maybeSingle");
    if (this.hangs()) return new Promise(() => {});
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
    this.record("single");
    if (this.hangs()) return new Promise(() => {});
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
    this.record("then");
    if (this.hangs()) return new Promise(() => {});
    const { rows, error } = this.execute();
    const data = this.returning || this.op === "select" ? rows : null;
    return Promise.resolve({ data, error }).then(resolve, reject);
  }
}

/** Optional client-wide knobs. */
export type FakeClientOptions = {
  /**
   * The server-side `max-rows` cap every SELECT is silently truncated to,
   * mirroring PostgREST's project setting (1000 in production). Defaults to
   * Infinity so existing fixtures are unaffected; a route whose paging you want
   * to actually exercise must opt in with the SAME number its page size uses —
   * a smaller cap makes every page look "short" and the truncation
   * undetectable, which is the real-world failure this models.
   */
  maxRows?: number;
  /**
   * Return a deliberately perturbed row order for a select with NO `.order()`.
   * Off by default so the hundreds of pre-existing fixtures written against
   * insertion order are unaffected; ON is the honest setting for any test whose
   * subject actually depends on ordering (see the module header).
   */
  perturbUnordered?: boolean;
  /**
   * A sink every terminated call is appended to, so the QUERY (columns, filters,
   * order key, client `.limit()`) can be asserted and not merely its rows.
   * Absent by default: nothing is recorded and nothing is allocated per call
   * beyond what the harness already tracks, so the ~10 suites that build a
   * `fakeClient` without options are byte-for-byte unaffected.
   */
  recordCalls?: RecordedCall[];
};

/** A fake SupabaseClient exposing only `.from(table)` over the shared store.
 *  `faults` (optional) injects per-`"<op>:<table>"` failures — module header. */
export function fakeClient(
  store: Store,
  faults?: FaultPlan,
  options?: FakeClientOptions
): {
  from: (t: string) => Builder;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: PgError }>;
} {
  // ONE counter per client, shared by every builder and the rpc seam, so
  // `onCalls` ordinals are per core run rather than per query object.
  const callCounts = new Map<string, number>();
  return {
    from: (table: string) => new Builder(store, table, faults, options ?? {}, callCounts),
    // The one RPC the FP site routes call. Implemented via the EXECUTABLE TS
    // SPEC of the SQL function (fp-public-site-rules extractSiteContent —
    // "THE SPEC LIVES HERE"), so route-level tests exercise the real deps
    // builder's RPC seam against the pinned semantics. Faultable like any op.
    rpc: (fn: string, args?: Record<string, unknown>) => {
      const key = `rpc:${fn}`;
      const ordinal = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, ordinal);
      const fault = pickFault(faults, key, ordinal);
      if (fault?.kind === "hang") return new Promise<never>(() => {});
      if (fault?.kind === "error") return Promise.resolve({ data: null, error: fault.error });
      if (fn === "fp_public_site_content") {
        const { headline, oneLiner, products } = extractSiteContent(args?.p_doc);
        return Promise.resolve({
          data: [{ headline, one_liner: oneLiner, products }],
          error: null,
        });
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
