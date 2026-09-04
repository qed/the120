import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyMigrationContract,
  lastCreateOrReplaceFunction,
  resolveMigrationContract,
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
      deploymentFiles: [
        "20261001120000_fp_round_one_billing.sql",
        "20261002120000_fp_round_one_billing_upgrade_review_state.sql",
        "20261003120000_fp_round_one_billing_upgrade_dispute_holds.sql",
      ],
    });
  });

  it("uses only additive upgrades as deployment input for an existing install", () => {
    const spec = {
      ...ROUND_ONE_BILLING_MIGRATION_SPEC,
      deploymentMode: "existing-install-upgrade" as const,
    };
    expect(classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
      "20261002120000_fp_round_one_billing_upgrade_dispute_holds.sql",
    ], spec).deploymentFiles).toEqual([
      "20261002120000_fp_round_one_billing_upgrade_dispute_holds.sql",
    ]);
  });

  it("requires an additive migration in existing-install mode", () => {
    expect(() => classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
    ], {
      ...ROUND_ONE_BILLING_MIGRATION_SPEC,
      deploymentMode: "existing-install-upgrade",
    })).toThrow("existing-install mode requires an additive upgrade");
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

  it("rejects a ledger version collision with an unrelated migration", () => {
    expect(() => classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
      "20261002120000_fp_round_one_billing_upgrade_dispute_holds.sql",
      "20261002120000_other-feature.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toThrow(
      "Round One billing: migration version 20261002120000 is ambiguous"
    );
  });

  it("rejects a billing-shaped migration outside the declared naming contract", () => {
    expect(() => classifyMigrationContract([
      "20261001120000_fp_round_one_billing.sql",
      "20261002120000_fp_round_one_billing_hotfix.sql",
    ], ROUND_ONE_BILLING_MIGRATION_SPEC)).toThrow(
      "Round One billing: unrecognized candidate migration"
    );
  });

  it("keeps an unused foundation out of existing-install deployment SQL", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "migration-contract-"));
    try {
      writeFileSync(
        path.join(directory, "20261001120000_fp_round_one_billing.sql"),
        "foundation-only-sentinel"
      );
      writeFileSync(
        path.join(directory, "20261002120000_fp_round_one_billing_upgrade_holds.sql"),
        "upgrade-only-sentinel"
      );
      const resolved = resolveMigrationContract(directory, {
        ...ROUND_ONE_BILLING_MIGRATION_SPEC,
        deploymentMode: "existing-install-upgrade",
      });

      expect(resolved.foundationRaw).toContain("foundation-only-sentinel");
      expect(resolved.upgradeRaw).toContain("upgrade-only-sentinel");
      expect(resolved.allRaw).toContain("foundation-only-sentinel");
      expect(resolved.allRaw).toContain("upgrade-only-sentinel");
      expect(resolved.deploymentRaw).not.toContain("foundation-only-sentinel");
      expect(resolved.deploymentRaw).toContain("upgrade-only-sentinel");
      expect(resolved.raw).toBe(resolved.deploymentRaw);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  it("accepts normal SQL whitespace and a named dollar quote on the final RPC", () => {
    const raw = [
      "create or replace function public.example() returns text as $$\nbegin\nreturn 'old';\nend;\n$$;",
      "CREATE OR REPLACE FUNCTION public.example () RETURNS text AS $body$\nBEGIN\nRETURN 'new';\nEND;\n$body$ ;",
    ].join("\n");
    const effective = lastCreateOrReplaceFunction(raw, "public.example");
    expect(effective).toContain("RETURN 'new'");
    expect(effective).not.toContain("return 'old'");
  });
});
