/**
 * THE SCHEMA SHAPE, AS THE REPO REPRESENTS IT.
 *
 * A tiny, deliberately-boring DDL reader over `supabase/migrations/*.sql`. It
 * exists for ONE consumer: the R28 erasure-coverage tripwire
 * (../erase-family-schema-coverage.test.ts), which asserts the erasure ledger in
 * `app/lib/funnel/erase-family-schema.ts` against the REAL set of tables and
 * columns rather than against a list somebody remembered to update.
 *
 * WHY PARSE SQL AT ALL. The failure this guards is precisely "a later migration
 * adds a column holding a child's personal data and nobody updates the eraser".
 * A test that reads the eraser's own list can never see that column. A test that
 * reads the MIGRATIONS sees it the moment it is authored, which is the moment the
 * decision has to be made.
 *
 * SCOPE / NON-GOALS. This is not a SQL parser. It understands exactly the four
 * DDL forms this repo uses to change a table's column set:
 *
 *     create table [if not exists] [public.]<t> ( <col> <type> ..., ... );
 *     alter table [public.]<t> add column [if not exists] <col> ...;   (n per stmt)
 *     alter table [public.]<t> rename column <old> to <new>;
 *     alter table [public.]<t> drop column [if exists] <col>;
 *
 * Migrations are applied in filename (version) order, so a rename or a drop that
 * lands after a create is honored. Everything else — constraints, indexes, RLS,
 * functions, triggers, grants — is ignored on purpose: none of it changes which
 * columns exist.
 *
 * FIDELITY CHECK (2026-08-06). The output was diffed, table by table and column
 * by column, against the LIVE PostgREST OpenAPI definition of the production
 * database (`GET /rest/v1/`, service role) and matched exactly for every table
 * PostgREST exposes — including the two forms that catch a naive reader:
 * `20260714130000` (two `add column` clauses in ONE alter statement) and
 * `20260826120000` (`rename column workshop_ids to workshop_ids_legacy`).
 * If this reader ever silently under-reports, the tripwire it feeds goes quiet
 * about exactly the column it was built to catch, so a fidelity re-check belongs
 * in any change to the regexes below.
 */

import fs from "node:fs";
import path from "node:path";

/** table name -> its column names, in first-seen order. */
export type MigrationSchema = Record<string, string[]>;

/** Column-list entries that are table CONSTRAINTS, not columns. */
const CONSTRAINT_LEADERS = new Set([
  "primary",
  "unique",
  "foreign",
  "constraint",
  "check",
  "exclude",
  "like",
  "references",
]);

/** Strip `--` line comments and `/* *\/` block comments so commented-out DDL
 *  (the repo writes rollback recipes in comments) is never read as real DDL. */
function stripComments(sql: string): string {
  const noBlocks = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlocks
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");
}

/** Split a parenthesised column list on its TOP-LEVEL commas (a column's own
 *  `references x (id)` / `check (...)` parens must not split it). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function applyFile(schema: Map<string, string[]>, sql: string): void {
  const clean = stripComments(sql);

  // create table ... ( ... )
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(clean)) !== null) {
    const table = m[1];
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === "(") depth++;
      else if (clean[i] === ")") depth--;
    }
    const body = clean.slice(m.index + m[0].length, i - 1);
    const cols = schema.get(table) ?? [];
    for (const part of splitTopLevel(body)) {
      const first = part.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!first || CONSTRAINT_LEADERS.has(first) || !/^[a-z0-9_]+$/.test(first)) continue;
      if (!cols.includes(first)) cols.push(first);
    }
    schema.set(table, cols);
  }

  // alter table <t> <clauses>;  — one statement may carry SEVERAL comma-separated
  // `add column` clauses (migration 20260714130000 does exactly that).
  const alterRe = /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)([^;]*)/gi;
  while ((m = alterRe.exec(clean)) !== null) {
    const table = m[1];
    const clauses = m[2] ?? "";
    const cols = schema.get(table) ?? [];

    for (const add of clauses.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) {
      if (!cols.includes(add[1])) cols.push(add[1]);
    }
    for (const ren of clauses.matchAll(
      /rename\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)\s+to\s+([a-z0-9_]+)/gi
    )) {
      const at = cols.indexOf(ren[1]);
      if (at >= 0) cols[at] = ren[2];
      else if (!cols.includes(ren[2])) cols.push(ren[2]);
    }
    for (const drop of clauses.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z0-9_]+)/gi)) {
      const at = cols.indexOf(drop[1]);
      if (at >= 0) cols.splice(at, 1);
    }
    if (cols.length > 0) schema.set(table, cols);
  }
}

/** Absolute path to the migration directory (vitest runs from the repo root). */
export function migrationsDir(): string {
  return path.resolve(process.cwd(), "supabase/migrations");
}

/** Read every migration, in version order, into a table -> columns map. */
export function parseMigrationSchema(dir: string = migrationsDir()): MigrationSchema {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filenames are the version prefix, so this IS apply order
  if (files.length === 0) {
    throw new Error(`migration-schema: no .sql files under ${dir} — the reader would be vacuous`);
  }
  const schema = new Map<string, string[]>();
  for (const f of files) applyFile(schema, fs.readFileSync(path.join(dir, f), "utf8"));
  return Object.fromEntries([...schema.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
