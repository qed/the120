import { describe, expect, it } from "vitest";
import {
  classifyMigrationContract,
  lastCreateOrReplaceFunction,
  ROUND_ONE_BILLING_MIGRATION_SPEC,
  WATCHTOWER_SCOPE_MIGRATION_SPEC,
} from "../migration-contract";

describe("migration contract resolver", () => {
  it("follows a renamed foundation and every later additive upgrade", () => {
    expect(classifyMigrationContract([
      "20261003120000_fp_round_one_billing_upgrade_dispute_holds.sql",
      "20261001120000_fp_round_one_billing.sql",
      "20261004120000_unrelated.sql",
      "20261002120000_fp_round_one_billing_upgrade_review_state.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toEqual({
      foundation: "20261001120000_fp_round_one_billing.sql",
      upgrades: [
        "20261002120000_fp_round_one_billing_upgrade_review_state.sql",
        "20261003120000_fp_round_one_billing_upgrade_dispute_holds.sql",
      ],
      orderedFiles: [
        "20261001120000_fp_round_one_billing.sql",
        "20261002120000_fp_round_one_billing_upgrade_review_state.sql",
        "20261003120000_fp_round_one_billing_upgrade_dispute_holds.sql",
      ],
    });
  });

  it("accepts the Watchtower foundation after the PROVISIONAL label is removed", () => {
    expect(classifyMigrationContract([
      "20261005120000_fp_watchtower_family_scope.sql",
    ], WATCHTOWER_SCOPE_MIGRATION_SPEC).foundation).toBe(
      "20261005120000_fp_watchtower_family_scope.sql"
    );
  });

  it("fails clearly when a copied foundation makes the effective path ambiguous", () => {
    expect(() => classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
      "20261002120000_fp_round_one_billing.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toThrow(
      "Round One billing: expected exactly one foundation migration, found 2"
    );
  });

  it("rejects an upgrade that sorts before its foundation", () => {
    expect(() => classifyMigrationContract([
      "20261002120000_fp_round_one_billing.sql",
      "20261001120000_fp_round_one_billing_upgrade_dispute_holds.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toThrow(
      "Round One billing: upgrade must sort after foundation"
    );
  });

  it("rejects two effective files with the same ledger version", () => {
    expect(() => classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
      "20261001120000_fp_round_one_billing_upgrade_dispute_holds.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toThrow(
      "Round One billing: migration version 20261001120000 is ambiguous"
    );
  });

  it("extracts the last replaced RPC rather than a stale foundation definition", () => {
    const raw = [
      "create or replace function public.example() returns text as $$\nbegin\nreturn 'old';\nend;\n$$;",
      "create or replace function public.example() returns text as $$\nbegin\nreturn 'new';\nend;\n$$;",
    ].join("\n");
    const effective = lastCreateOrReplaceFunction(raw, "public.example");
    expect(effective).toContain("return 'new'");
    expect(effective).not.toContain("return 'old'");
  });
});
