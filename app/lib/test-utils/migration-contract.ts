import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type MigrationContractSpec = {
  label: string;
  deploymentMode: "fresh-foundation" | "existing-install-upgrade";
  foundationPattern: RegExp;
  upgradePattern?: RegExp;
  candidatePattern?: RegExp;
};

export type MigrationContract = {
  foundation: string;
  upgrades: string[];
  orderedFiles: string[];
  deploymentFiles: string[];
  foundationRaw: string;
  upgradeRaw: string;
  allRaw: string;
  deploymentRaw: string;
  /** @deprecated Prefer deploymentRaw so an unused foundation cannot mask an upgrade. */
  raw: string;
};

export type MigrationContractResolution =
  | { ok: true; value: MigrationContract }
  | { ok: false; error: Error };

const VERSIONED_SQL = /^(\d{14})_.+\.sql$/i;

function matches(pattern: RegExp | undefined, value: string): boolean {
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(value);
}

/** Pure classifier, exported so ambiguity and ordering failures stay testable. */
export function classifyMigrationContract(
  fileNames: string[],
  spec: MigrationContractSpec
): Pick<
  MigrationContract,
  "foundation" | "upgrades" | "orderedFiles" | "deploymentFiles"
> {
  const foundations: string[] = [];
  const upgrades: string[] = [];

  // Supabase identifies migrations by this version, irrespective of their
  // feature suffix. Check the whole directory before narrowing to this
  // contract so an unrelated migration cannot silently steal the same ledger
  // version.
  const versions = new Map<string, string>();
  for (const file of fileNames) {
    const version = file.match(VERSIONED_SQL)?.[1];
    if (!version) continue;
    const prior = versions.get(version);
    if (prior) {
      throw new Error(
        `${spec.label}: migration version ${version} is ambiguous: ${prior}, ${file}`
      );
    }
    versions.set(version, file);
  }

  for (const file of fileNames) {
    const foundation = matches(spec.foundationPattern, file);
    const upgrade = matches(spec.upgradePattern, file);
    const candidate = matches(spec.candidatePattern, file);
    if (foundation && upgrade) {
      throw new Error(`${spec.label}: ${file} ambiguously matches foundation and upgrade`);
    }
    if (candidate && !foundation && !upgrade) {
      throw new Error(`${spec.label}: unrecognized candidate migration ${file}`);
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

  const foundation = foundations[0]!;
  const foundationVersion = foundation.match(VERSIONED_SQL)![1]!;
  const sortedUpgrades = upgrades.sort((left, right) => left.localeCompare(right));
  for (const upgrade of sortedUpgrades) {
    const upgradeVersion = upgrade.match(VERSIONED_SQL)?.[1];
    if (!upgradeVersion || upgradeVersion <= foundationVersion) {
      throw new Error(`${spec.label}: upgrade must sort after foundation: ${upgrade}`);
    }
  }

  if (spec.deploymentMode === "existing-install-upgrade" && sortedUpgrades.length === 0) {
    throw new Error(`${spec.label}: existing-install mode requires an additive upgrade`);
  }

  const deploymentFiles = spec.deploymentMode === "fresh-foundation"
    ? orderedFiles
    : sortedUpgrades;

  return { foundation, upgrades: sortedUpgrades, orderedFiles, deploymentFiles };
}

function readMigrations(migrationsDir: string, files: string[]): string {
  return files
    .map((file) =>
      `\n-- effective migration: ${file}\n${readFileSync(path.join(migrationsDir, file), "utf8")}`
    )
    .join("\n");
}

export function resolveMigrationContract(
  migrationsDir: string,
  spec: MigrationContractSpec
): MigrationContract {
  const classified = classifyMigrationContract(readdirSync(migrationsDir), spec);
  const foundationRaw = readMigrations(migrationsDir, [classified.foundation]);
  const upgradeRaw = readMigrations(migrationsDir, classified.upgrades);
  const allRaw = readMigrations(migrationsDir, classified.orderedFiles);
  const deploymentRaw = readMigrations(migrationsDir, classified.deploymentFiles);
  return {
    ...classified,
    foundationRaw,
    upgradeRaw,
    allRaw,
    deploymentRaw,
    raw: deploymentRaw,
  };
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
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `\\bcreate\\s+or\\s+replace\\s+function\\s+${escapedName}\\s*\\(`,
    "gi"
  );
  let match: RegExpExecArray | null;
  let start = -1;
  while ((match = declaration.exec(raw)) !== null) start = match.index;
  if (start < 0) throw new Error(`effective migration is missing function ${qualifiedName}`);

  const tail = raw.slice(start);
  const bodyStart = /\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i.exec(tail);
  if (!bodyStart) throw new Error(`function ${qualifiedName} has no dollar-quoted body`);
  const delimiter = bodyStart[1]!;
  const contentsStart = bodyStart.index + bodyStart[0].length;
  const close = tail.indexOf(delimiter, contentsStart);
  if (close < 0) throw new Error(`function ${qualifiedName} has no closing dollar quote`);
  const afterClose = close + delimiter.length;
  const semicolon = /^\s*;/.exec(tail.slice(afterClose));
  if (!semicolon) throw new Error(`function ${qualifiedName} has no terminating semicolon`);
  return tail.slice(0, afterClose + semicolon[0].length);
}

export const ROUND_ONE_BILLING_MIGRATION_SPEC: MigrationContractSpec = {
  label: "Round One billing",
  deploymentMode: "fresh-foundation",
  foundationPattern: /^\d{14}_fp_round_one_billing\.sql$/,
  upgradePattern: /^\d{14}_fp_round_one_billing_upgrade(?:_[a-z0-9_]+)?\.sql$/,
  candidatePattern: /^\d{14}_fp_round_one_billing.*\.sql$/i,
};

export const WATCHTOWER_SCOPE_MIGRATION_SPEC: MigrationContractSpec = {
  label: "Watchtower family scope",
  deploymentMode: "fresh-foundation",
  foundationPattern: /^\d{14}_fp_watchtower_family_scope(?:_PROVISIONAL)?\.sql$/,
  upgradePattern: /^\d{14}_fp_watchtower_family_scope_upgrade(?:_[a-z0-9_]+)?\.sql$/,
  candidatePattern: /^\d{14}_fp_watchtower_family_scope.*\.sql$/i,
};
