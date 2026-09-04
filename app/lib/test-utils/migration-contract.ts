import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type MigrationContractSpec = {
  label: string;
  foundationPattern: RegExp;
  upgradePattern?: RegExp;
};

export type MigrationContract = {
  foundation: string;
  upgrades: string[];
  orderedFiles: string[];
  raw: string;
};

export type MigrationContractResolution =
  | { ok: true; value: MigrationContract }
  | { ok: false; error: Error };

const VERSIONED_SQL = /^(\d{14})_[a-z0-9_]+\.sql$/i;

function matches(pattern: RegExp | undefined, value: string): boolean {
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(value);
}

/** Pure classifier, exported so ambiguity and ordering failures stay testable. */
export function classifyMigrationContract(
  fileNames: string[],
  spec: MigrationContractSpec
): Omit<MigrationContract, "raw"> {
  const foundations: string[] = [];
  const upgrades: string[] = [];

  for (const file of fileNames) {
    const foundation = matches(spec.foundationPattern, file);
    const upgrade = matches(spec.upgradePattern, file);
    if (foundation && upgrade) {
      throw new Error(`${spec.label}: ${file} ambiguously matches foundation and upgrade`);
    }
    if (foundation) foundations.push(file);
    if (upgrade) upgrades.push(file);
  }

  if (foundations.length !== 1) {
    throw new Error(
      `${spec.label}: expected exactly one foundation migration, found ${foundations.length}`
    );
  }

  const orderedFiles = [...foundations, ...upgrades].sort((left, right) =>
    left.localeCompare(right)
  );
  const versions = new Map<string, string>();
  for (const file of orderedFiles) {
    const version = file.match(VERSIONED_SQL)?.[1];
    if (!version) throw new Error(`${spec.label}: invalid versioned SQL filename ${file}`);
    const prior = versions.get(version);
    if (prior) {
      throw new Error(`${spec.label}: migration version ${version} is ambiguous: ${prior}, ${file}`);
    }
    versions.set(version, file);
  }

  const foundation = foundations[0]!;
  const foundationVersion = foundation.match(VERSIONED_SQL)![1]!;
  const sortedUpgrades = upgrades.sort((left, right) => left.localeCompare(right));
  for (const upgrade of sortedUpgrades) {
    const upgradeVersion = upgrade.match(VERSIONED_SQL)?.[1];
    if (!upgradeVersion || upgradeVersion <= foundationVersion) {
      throw new Error(`${spec.label}: upgrade must sort after foundation: ${upgrade}`);
    }
  }

  return { foundation, upgrades: sortedUpgrades, orderedFiles };
}

export function resolveMigrationContract(
  migrationsDir: string,
  spec: MigrationContractSpec
): MigrationContract {
  const classified = classifyMigrationContract(readdirSync(migrationsDir), spec);
  const raw = classified.orderedFiles
    .map((file) => `\n-- effective migration: ${file}\n${readFileSync(path.join(migrationsDir, file), "utf8")}`)
    .join("\n");
  return { ...classified, raw };
}

export function safelyResolveMigrationContract(
  migrationsDir: string,
  spec: MigrationContractSpec
): MigrationContractResolution {
  try {
    return { ok: true, value: resolveMigrationContract(migrationsDir, spec) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Return the final effective definition after every ordered upgrade. Tests that
 * inspect a replaceable RPC must use this instead of matching the concatenated
 * foundation first, otherwise a stale foundation can hide a broken upgrade.
 */
export function lastCreateOrReplaceFunction(
  raw: string,
  qualifiedName: string
): string {
  const lower = raw.toLowerCase();
  const marker = `create or replace function ${qualifiedName.toLowerCase()}(`;
  const start = lower.lastIndexOf(marker);
  if (start < 0) throw new Error(`effective migration is missing function ${qualifiedName}`);
  const bodyStart = lower.indexOf("as $$", start);
  if (bodyStart < 0) throw new Error(`function ${qualifiedName} has no dollar-quoted body`);
  const end = lower.indexOf("\n$$;", bodyStart);
  if (end < 0) throw new Error(`function ${qualifiedName} has no closing dollar quote`);
  return raw.slice(start, end + "\n$$;".length);
}

export const ROUND_ONE_BILLING_MIGRATION_SPEC: MigrationContractSpec = {
  label: "Round One billing",
  foundationPattern: /^\d{14}_fp_round_one_billing\.sql$/,
  upgradePattern: /^\d{14}_fp_round_one_billing_upgrade(?:_[a-z0-9_]+)?\.sql$/,
};

export const WATCHTOWER_SCOPE_MIGRATION_SPEC: MigrationContractSpec = {
  label: "Watchtower family scope",
  foundationPattern: /^\d{14}_fp_watchtower_family_scope(?:_PROVISIONAL)?\.sql$/,
  upgradePattern: /^\d{14}_fp_watchtower_family_scope_upgrade(?:_[a-z0-9_]+)?\.sql$/,
};
