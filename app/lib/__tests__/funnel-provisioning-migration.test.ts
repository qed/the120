import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FORWARDING_STATES, PROVISION_STATES } from "@/app/lib/funnel/provision-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = "supabase/migrations/20260817120000_funnel_student_provisioning.sql";
const FENCING = "supabase/migrations/20260818120000_funnel_provisioning_fencing.sql";
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");
/** Every migration that touches the provisioning tables, concatenated in
 *  version order — grant/policy pins must see the WHOLE history, since a
 *  later file can widen what an earlier one narrowed. */
const allProvisioningSql = () => read(MIGRATION) + "\n" + read(FENCING);

/**
 * Wrap U6 part 2. The provisioning invariants live in SQL; these pin the
 * SQL, the same discipline the waitlist migration carries. Each pin guards
 * a failure that would either strand a paid family or hand an address to
 * the wrong person.
 */

/** The `in (...)` list of a NAMED constraint — anchored on the constraint
 *  name, never the column name (the audit-actions-parity scar). */
function constraintValues(source: string, constraintName: string): string[] | null {
  const re = new RegExp(
    `add constraint ${constraintName}\\s+check \\(([\\s\\S]*?in \\(([\\s\\S]*?)\\))\\)`,
    "g"
  );
  const lists = [...source.matchAll(re)].map((m) => m[2]);
  if (lists.length === 0) return null;
  return [...lists[lists.length - 1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the provisioning state vocabulary — CHECK ↔ TS parity", () => {
  const sql = read(MIGRATION);

  it("state CHECK matches PROVISION_STATES exactly", () => {
    const values = constraintValues(sql, "funnel_student_provisioning_state_check");
    expect(values, "state CHECK not found").not.toBeNull();
    expect([...(values as string[])].sort()).toEqual([...PROVISION_STATES].sort());
    expect(new Set(values).size).toBe((values as string[]).length);
  });

  it("forwarding CHECK matches FORWARDING_STATES exactly", () => {
    const values = constraintValues(sql, "funnel_student_provisioning_forwarding_check");
    expect(values, "forwarding CHECK not found").not.toBeNull();
    expect([...(values as string[])].sort()).toEqual([...FORWARDING_STATES].sort());
  });

  it("the scanner returns null for an absent constraint name (the assertions above can fail)", () => {
    expect(constraintValues(sql, "no_such_constraint_check")).toBeNull();
  });
});

describe("the two uniqueness guarantees", () => {
  const sql = read(MIGRATION);

  it("UNIQUE(child_id): one provisioning per child, so replays converge", () => {
    expect(sql).toMatch(
      /create unique index if not exists funnel_student_provisioning_child_id_key\s+on public\.funnel_student_provisioning \(child_id\);/
    );
  });

  it("the local_part unique is TOTAL — a partial index would silently re-open released addresses", () => {
    const m =
      /create unique index if not exists funnel_student_provisioning_local_part_key\s+on public\.funnel_student_provisioning \(local_part\)([\s\S]*?);/.exec(
        sql
      );
    expect(m, "local_part unique index not found").not.toBeNull();
    // NO `where` clause. This is the whole point of the pin: the index
    // must arbitrate released and placeholder rows forever.
    expect(m![1]).not.toMatch(/where/i);
  });
});

describe("RLS posture, stated and pinned", () => {
  const sql = read(MIGRATION);

  it("RLS is enabled on both tables", () => {
    expect(sql).toContain("alter table public.funnel_student_provisioning enable row level security");
    expect(sql).toContain("alter table public.funnel_released_aliases enable row level security");
  });

  it("the claim table has exactly ONE policy: parent-scoped SELECT", () => {
    const policies = sql.match(/create policy[\s\S]*?on public\.funnel_student_provisioning/g) ?? [];
    expect(policies).toHaveLength(1);
    const policy = /create policy "provisioning: own children"[\s\S]*?;/.exec(sql);
    expect(policy).not.toBeNull();
    expect(policy![0]).toContain("for select");
    expect(policy![0]).toContain("parent_id = auth.uid()");
    expect(policy![0]).not.toMatch(/for (all|insert|update|delete)/);
  });

  it("the ledger has ZERO policies — service-role RPC only, deliberately", () => {
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.funnel_released_aliases/);
    // And the deliberateness is stated in the file, not just absent.
    expect(sql).toContain("ZERO policies, deliberately");
  });

  it("the family session sees a NARROW column set — lease and exception detail never cross PostgREST", () => {
    expect(sql).toContain(
      "revoke all on table public.funnel_student_provisioning from anon, authenticated"
    );
    // ALL grants to authenticated across EVERY migration, unioned: Postgres
    // grants are additive, so a second statement in a later file would
    // silently widen the surface while a first-match-only pin stayed green
    // (adversarial review of this very test).
    const everyMigration = allProvisioningSql();
    const grants = [
      ...everyMigration.matchAll(
        /grant select \(([^)]+)\)\s+on (?:table )?public\.funnel_student_provisioning to authenticated/g
      ),
    ];
    expect(grants, "expected exactly one narrow grant across all migrations").toHaveLength(1);
    const cols = [...new Set(grants.flatMap((g) => g[1].split(",").map((c) => c.trim())))].sort();
    expect(cols).toEqual(["child_id", "email", "forwarding_state", "state"]);
    // And no table-wide (non-column-list) select grant anywhere.
    expect(everyMigration).not.toMatch(
      /grant select on (?:table )?public\.funnel_student_provisioning to authenticated/
    );
  });
});

describe("the RPCs", () => {
  const sql = read(MIGRATION);

  it("both carry the deposit_fulfil grant posture: revoked from public/anon/authenticated, granted to service_role", () => {
    // The reassign RPC's LIVE definition is the fencing migration's
    // four-arg version (the three-arg original was dropped there).
    const cases: Array<[string, string]> = [
      [sql, "provision_lease(uuid, text, integer)"],
      [read(FENCING), "provision_reassign_local_part(uuid, text, text, text)"],
    ];
    for (const [source, fn] of cases) {
      const esc = fn.replace(/[()]/g, "\\$&").replace(/, /g, ",\\s*");
      expect(source).toMatch(
        new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`)
      );
      expect(source).toMatch(
        new RegExp(`grant execute on function public\\.${esc} to service_role`)
      );
    }
  });

  it("the lease is takeable ONLY when retryable or expired — a live lease refuses, a crashed run cannot hold forever", () => {
    const lease = /create or replace function public\.provision_lease[\s\S]*?\$\$;/.exec(sql);
    expect(lease).not.toBeNull();
    expect(lease![0]).toContain("state in ('pending', 'identity_only')");
    expect(lease![0]).toContain("state = 'in_progress' and lease_expires_at < now()");
  });

  it("reassignment parks the abandoned part on a placeholder row IN THE SAME TRANSACTION, and never in the ledger", () => {
    // The LIVE definition lives in the fencing migration (last wins).
    const fn = /create or replace function public\.provision_reassign_local_part[\s\S]*?\$\$;/.exec(
      read(FENCING)
    );
    expect(fn).not.toBeNull();
    // The placeholder insert targets the CLAIM table (total unique keeps
    // arbitrating), with a null child and the 'unissued' reason…
    expect(fn![0]).toMatch(/insert into public\.funnel_student_provisioning[\s\S]*?'unissued'/);
    // …and the never-reissue ledger is untouched (it was never issued).
    expect(fn![0]).not.toContain("funnel_released_aliases");
    // A 23505 on the new part rolls the whole move back as 'conflict'.
    expect(fn![0]).toContain("when unique_violation then");
  });
});

describe("the fencing migration (review follow-up)", () => {
  const sql = read(FENCING);

  it("the FK is SET NULL, never CASCADE — a deleted child must not free an issued address", () => {
    // The original cascade let a parent's ordinary Remove-child delete a
    // claim row outright, removing its local_part from the total unique
    // index (data-migrations review, high). SET NULL degrades the row to
    // a placeholder instead.
    expect(sql).toMatch(/foreign key \(child_id\) references public\.children \(id\) on delete set null/);
    // Comments stripped first: the file's header EXPLAINS the cascade bug
    // at length, and that prose must not read as a touch.
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/on delete cascade/);
  });

  it("the orphaned claim is flipped to released/child_deleted by trigger, keeping the address arbitrated", () => {
    const fn = /create or replace function public\.funnel_provisioning_child_deleted[\s\S]*?\$\$;/.exec(sql);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("NEW.state := 'released'");
    expect(fn![0]).toContain("'child_deleted'");
    expect(sql).toContain("before update of child_id on public.funnel_student_provisioning");
  });

  it("the reassign RPC is lease-fenced: only the current leaseholder may move an address", () => {
    const fn = /create or replace function public\.provision_reassign_local_part[\s\S]*?\$\$;/.exec(sql);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain("lease_owner = p_owner");
    expect(fn![0]).toContain("state = 'in_progress'");
    expect(fn![0]).toContain("'lost_lease'");
    // And the unfenced three-arg original is dropped, not overloaded —
    // an overload would 300 every PostgREST caller.
    expect(sql).toContain(
      "drop function if exists public.provision_reassign_local_part(uuid, text, text);"
    );
  });

  it("adds the workspace-attempt marker columns idempotently", () => {
    expect(sql).toContain("add column if not exists workspace_attempted_at");
    expect(sql).toContain("add column if not exists workspace_attempted_email");
  });
});

describe("the refund-release RPC (W15, U8) — one transaction or nothing", () => {
  const REFUND = "supabase/migrations/20260821120000_funnel_refund_release.sql";
  const sql = () => read(REFUND);
  const fn = () =>
    /create or replace function public\.deposit_refund_release[\s\S]*?\$\$;/.exec(sql())![0];

  it("the refund mark, the claim flip, and the ledger insert live in ONE function body", () => {
    const body = fn();
    expect(body).toContain("update public.deposits");
    expect(body).toContain("set state = 'suspend_pending'");
    expect(body).toContain("insert into public.funnel_released_aliases");
  });

  it("a replayed refund is exactly-one-ledger-row idempotent", () => {
    expect(fn()).toContain("on conflict (local_part) do nothing");
    expect(fn()).toContain("'noop_replay'");
  });

  it("out-of-order delivery answers no_deposit — the zero-row-refund lesson survives the rewrite", () => {
    expect(fn()).toContain("'no_deposit'");
  });

  it("the claim's lease is TORN UP in the same statement — a running drive's fenced writes then refuse", () => {
    const flip = /set state = 'suspend_pending'[\s\S]*?where child_id = v_child/.exec(fn());
    expect(flip).not.toBeNull();
    expect(flip![0]).toContain("lease_owner = null");
  });

  it("the ledger records the local part read INSIDE the transaction (FOR UPDATE precedes the insert)", () => {
    const body = fn();
    const lockAt = body.indexOf("for update", body.indexOf("funnel_student_provisioning"));
    const insertAt = body.indexOf("insert into public.funnel_released_aliases");
    expect(lockAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(lockAt);
  });

  it("carries the deposit_fulfil grant posture", () => {
    expect(sql()).toContain(
      "revoke all on function public.deposit_refund_release(text) from public, anon, authenticated"
    );
    expect(sql()).toContain(
      "grant execute on function public.deposit_refund_release(text) to service_role"
    );
  });

  it("adds workspace_suspended_at idempotently", () => {
    expect(sql()).toContain("add column if not exists workspace_suspended_at");
  });
});

describe("idempotency — every statement re-runnable", () => {
  const sql = read(MIGRATION);

  it("guards every CREATE and both constraint adds", () => {
    const noComments = sql.replace(/--.*$/gm, "");
    for (const s of noComments.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) {
      if (/^create table/i.test(s)) expect(s, s.slice(0, 60)).toMatch(/if not exists/i);
      if (/^create( unique)? index/i.test(s)) expect(s, s.slice(0, 60)).toMatch(/if not exists/i);
    }
    const constraintAdds = [...sql.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    expect(constraintAdds.length).toBe(2);
    for (const name of constraintAdds) {
      expect(sql, name).toContain(`where conname = '${name}'`);
    }
  });

  it("the ledger keeps no foreign key to children — it must survive anonymization", () => {
    const ledger = /create table if not exists public\.funnel_released_aliases[\s\S]*?\);/.exec(sql);
    expect(ledger).not.toBeNull();
    expect(ledger![0]).not.toContain("references");
    expect(ledger![0]).toContain("local_part text primary key");
  });
});
