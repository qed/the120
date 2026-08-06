import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glob } from "tinyglobby";
import ts from "typescript";
import { Linter } from "eslint";
import { IMAGE_LAB_IMPORT_RULES } from "../../../../eslint.config.mjs";
import { LAB_SOURCE_EXTENSIONS, LAB_SOURCE_GLOB, isLabTestFile } from "./lab-globs";
import { IMAGE_LAB_BUCKET } from "../lib/image-lab-rules";
import {
  CHILD_SCRUB_COLUMNS,
  LEDGER_SALE_COLUMNS,
} from "../lib/content-picker-loader";

/**
 * The Image Lab's SERVICE-ROLE-ONLY posture, asserted STRUCTURALLY
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4 — the job is assigned by name in the Unit 1 migration header).
 *
 * All three `fp_image_lab_*` tables have RLS ENABLED WITH ZERO POLICIES and
 * `revoke all … from anon, authenticated`. The `requireStaff()` gate in the
 * request is the authorization; the tables carry no policy for any other role
 * ON PURPOSE. The consequence is a failure mode this repo has already paid for:
 *
 *   SERVER CODE HOLDING THE ANON KEY FAILS EVERY TOUCH WITH 42501 IN
 *   PRODUCTION WHILE CI STAYS GREEN, because every test injects a fake and a
 *   fake has no RLS.
 *   (docs/solutions/security-issues/rls-enabled-zero-policies-but-the-server-
 *    code-is-postgrest-anon-key-2026-07-28.md)
 *
 * ── THE PREVIOUS VERSION OF THIS FILE WAS A KEYWORD GREP, AND IT LOST ──────
 * Review defeated it SEVEN ways, each with the full suite green and each
 * handing a Lab module a live anon client:
 *
 *   1. `await import("@/app/lib/supabase/client")` — the regex required the
 *      token `from`.
 *   2. `import * as m from "../../lib/supabase/client"` — the alternation was
 *      anchored to the `@/` alias.
 *   3. a re-export barrel at `app/lib/supabase/anon-barrel.ts`, ONE directory
 *      outside the scanned tree.
 *   4. `import { createClient } from "@supabase/supabase-js"` with
 *      `process.env["NEXT_PUBLIC_SUPABASE" + "_ANON_KEY"]` — `createClient` was
 *      not in the forbidden set and neither string was ever spelled whole.
 *   5. a RELATIVE admin import, bypassing the one-accessor rule.
 *   6. a `.js` module — the glob covered only .ts and .tsx.
 *   7. a production module parked at `lib/__tests__/anon-helper.ts`, which the
 *      scan ignored the whole __tests__ directory and which vitest never ran
 *      either, because it is not `*.test.ts`.
 *
 * Every one of those is a defect in a LEXICAL scan, so the scan is gone. What
 * replaces it is two mechanisms that do not care how a specifier is spelled:
 *
 *   A. `no-restricted-imports` in `eslint.config.mjs`, scoped to the Lab across
 *      EVERY extension. It matches specifiers by glob rather than by a hand
 *      alternation, so relative and aliased spellings are one rule, and it bans
 *      `@supabase/supabase-js` outright. Asserted below by RUNNING the real rule
 *      objects over fixtures, not by reading the config's shape.
 *      ⚠ It does NOT inspect dynamic `import()` — verified against ESLint 9.39,
 *      not assumed — which is exactly why it is not the only mechanism.
 *   B. an IMPORT-GRAPH walk from the Lab's own modules, reading specifiers
 *      through the TypeScript scanner (so a dynamic import IS a specifier),
 *      resolving them to files, and FOLLOWING them — which is what catches a
 *      barrel, a barrel of barrels, and anything else lint cannot see because
 *      the offending specifier is innocent. This is the backstop, and the
 *      fixtures below require it to catch every form on its own.
 *
 * And a NEGATIVE FIXTURE TEST for both. Its absence is why all seven shipped: a
 * guard with no proof that it can fail is a guard with no evidence at all.
 *
 * The behavioural half of the Lab's safety net is `gate-enforcement.test.ts`;
 * this is the half a spy cannot see.
 *
 * ⚠ ON THE REFERENCE PATH THE STAKES ARE HIGHER THAN A FAILED REQUEST. By the
 * time the registration INSERT runs, the browser has already pushed the bytes
 * DIRECT to Storage. A 42501 there leaves an object in the bucket with no row
 * to name it. (The registration path now DELETES the objects it refuses —
 * storage has no append-only trigger, only the table does — but a 42501 fails
 * before any of that logic is reached.)
 *
 * Resolved relative to THIS FILE, never `process.cwd()`: a scan that reads no
 * file is worse than no scan, because it passes.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
/** `app/staff/image-lab/__tests__/` → the repo root. Four levels up. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${dir}`));
const LAB = "app/staff/image-lab/";

/** THE one module allowed to hold a Supabase client for this feature. */
const DB_ACCESSOR = `${LAB}lib/image-lab-db.ts`;

/**
 * ⚠ THE EXTENSION LIST IS SHARED WITH `gate-enforcement.test.ts` NOW.
 *
 * This file learned in Unit 4 that a `.js` module walks past a `{ts,tsx}` glob,
 * and enumerated eight extensions. The sibling guard never got the fix and kept
 * globbing `{ts,tsx}` — so a `.js` route handler AND a `.js` `"use server"`
 * action both shipped ungated past it with the whole suite green. A lesson
 * learned by one guard and not the other is a lesson not learned.
 */
const SOURCE_EXTENSIONS = [...LAB_SOURCE_EXTENSIONS];
const isTestFile = isLabTestFile;

const labSources = async (): Promise<string[]> => {
  const files = await glob([LAB_SOURCE_GLOB], {
    cwd: REPO_ROOT,
    absolute: false,
  });
  const sources = files.map((f) => f.replace(/\\/g, "/")).filter((f) => !isTestFile(f)).sort();
  // An empty expansion would make every assertion below pass vacuously.
  expect(sources.length).toBeGreaterThan(0);
  return sources;
};

// ── Specifier extraction and resolution ──────────────────────────────────────

/**
 * Every module specifier in a file — static imports, `export … from`, AND
 * dynamic `import()`.
 *
 * `ts.preProcessFile` is the TypeScript compiler's own scanner-based extractor,
 * so it sees what the bundler will see: a specifier inside a comment is not
 * reported, and a dynamic import IS.
 */
const specifiersOf = (absFile: string): string[] => {
  const source = readFileSync(absFile, "utf8");
  return ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
};

const resolveFile = (candidate: string): string | null => {
  for (const ext of ["", ...SOURCE_EXTENSIONS]) {
    const withExt = candidate + ext;
    if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const index = path.join(candidate, `index${ext}`);
    if (existsSync(index) && statSync(index).isFile()) return index;
  }
  return null;
};

/** Repo-relative path for a specifier, or null when it is a bare package. */
const resolveSpecifier = (fromAbs: string, specifier: string): string | null => {
  let candidate: string | null = null;
  if (specifier.startsWith("@/")) candidate = path.join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) candidate = path.resolve(path.dirname(fromAbs), specifier);
  if (candidate === null) return null;
  const resolved = resolveFile(candidate);
  if (resolved === null) return null;
  return path.relative(REPO_ROOT, resolved).replace(/\\/g, "/");
};

// ── What counts as a forbidden edge ──────────────────────────────────────────

const ANON_MODULES = ["app/lib/supabase/client.ts", "app/lib/supabase/server.ts"];
const ADMIN_MODULE = "app/lib/supabase/admin.ts";
const VENDOR_CLIENT_PACKAGES = ["@supabase/supabase-js", "@supabase/ssr"];

/**
 * Modules OUTSIDE the Lab whose own Supabase use has been reviewed, and at
 * which the graph walk stops.
 *
 * This list is the walk's only escape hatch, and it is deliberately a list of
 * PATHS rather than a heuristic: adding `app/lib/supabase/anon-barrel.ts` to it
 * would be a one-line diff in this file with this docblock directly above it,
 * which is exactly the review conversation the barrel bypass skipped.
 *
 *   * `app/fp/lib/upload-client.ts` — the shipped direct-to-storage upload leg.
 *     It constructs the BROWSER client to PUT bytes against a server-minted
 *     signed token; it reads no table and it is the reason the Lab does not
 *     reimplement the plain/TUS split. Nothing it does touches fp_image_lab_*.
 *   * `app/crm/lib/auth.ts` — the gate itself. Reading the session through the
 *     cookie-session client and the `staff` row through the service role is its
 *     entire job, and it is the module whose verdict authorizes the Lab.
 */
const AUDITED_CROSSINGS = ["app/fp/lib/upload-client.ts", "app/crm/lib/auth.ts"];

type Violation = { file: string; specifier: string; why: string };

/**
 * Walk the import graph from the Lab's own modules and report every forbidden
 * edge found anywhere in the reachable closure.
 *
 * The closure is what makes this different from a scan: a Lab module importing
 * an innocent-looking `@/app/lib/supabase/anon-barrel` is not itself a lexical
 * match for anything, and the barrel is a directory outside every glob that
 * ever covered this feature. Following the edge is the only way to see it.
 */

/**
 * One edge, judged. `null` means "not forbidden"; `follow` is the resolved
 * target the walk should descend into (absent for a terminus).
 *
 * The three Supabase modules are TERMINI whether or not they are violations:
 * `app/lib/supabase/admin.ts` legitimately constructs a client from the vendor
 * package, and descending into it would report the accessor's own correct
 * import as a Lab violation.
 */
const classifyEdge = (
  fromAbs: string,
  file: string,
  specifier: string
): { violation?: Violation; follow?: string } => {
  if (VENDOR_CLIENT_PACKAGES.includes(specifier)) {
    return {
      violation: { file, specifier, why: "constructs a Supabase client from the vendor package" },
    };
  }
  const target = resolveSpecifier(fromAbs, specifier);
  if (target === null) return {};
  if (ANON_MODULES.includes(target)) {
    return { violation: { file, specifier, why: "reaches an anon-key Supabase client" } };
  }
  if (target === ADMIN_MODULE) {
    return file === DB_ACCESSOR
      ? {}
      : {
          violation: {
            file,
            specifier,
            why: "imports the service-role client outside the one accessor",
          },
        };
  }
  return { follow: target };
};

const walkForbiddenImports = (
  entries: string[],
  crossings: readonly string[] = AUDITED_CROSSINGS
): Violation[] => {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (crossings.includes(file)) continue;

    const abs = path.join(REPO_ROOT, file);
    if (!existsSync(abs)) continue;

    for (const specifier of specifiersOf(abs)) {
      const edge = classifyEdge(abs, file, specifier);
      if (edge.violation) violations.push(edge.violation);
      if (edge.follow) queue.push(edge.follow);
    }
  }
  return violations;
};

/**
 * The same judgement, applied to SOURCE TEXT at a pretend Lab path.
 *
 * This is how the negative fixtures exercise the real classifier without
 * writing a module that would itself become the defect it describes. `asFile`
 * is a repo-relative path under the Lab — it need not exist, because only its
 * DIRECTORY matters for resolving a relative specifier.
 */
const scanCode = (code: string, asFile = `${LAB}lib/fixture.ts`): Violation[] => {
  const abs = path.join(REPO_ROOT, asFile);
  return ts
    .preProcessFile(code, true, true)
    .importedFiles.map((f) => classifyEdge(abs, asFile, f.fileName).violation)
    .filter((v): v is Violation => v !== undefined);
};

// ── Resolving what a `.from()` / `.rpc()` / `.select()` argument actually IS ─

/**
 * ⚠ THE CALL SITE IS PARSED, NOT MATCHED — AND THAT IS THE THIRD LESSON.
 *
 * This guard has now been strengthened three times, and every previous cycle made
 * the ARGUMENT harder to hide while leaving the CALL SITE matched lexically:
 * `callSites` looked for the literal text `.from(` with
 * `new RegExp('\\.' + name + '\\(')`. BRACKET MEMBER ACCESS NEVER SPELLS THAT.
 * Verified on this branch, with the whole Lab suite green at 899/899 and this
 * file at 31/31:
 *
 *   const t = "staff";
 *   await db["from"](t).select("id, email, is_active");
 *   await db["from"]("fp_ledger").select("id, " + "pay" + "er" + ", amount_cents");
 *
 * Neither call was ENUMERATED at all, so none of the argument-resolution
 * hardening ran — the sites could not even be reported as unresolvable. A guard
 * whose enumerator can be stepped around is a guard with no floor.
 *
 * So enumeration now goes through the TypeScript AST (already a dependency —
 * `ts.preProcessFile` is used above). Every `CallExpression` whose callee is a
 * PropertyAccessExpression OR an ElementAccessExpression is inspected, the callee
 * NAME is resolved the same way arguments are, and a callee name that cannot be
 * resolved is a violation outright rather than a skip.
 */

/**
 * ⚠ CROSS-MODULE CONSTANTS, SEEDED FROM THE REAL MODULES.
 *
 * The resolver reads `const` bindings in the SAME file, which is not enough:
 * `db.storage.from(IMAGE_LAB_BUCKET)` and `db.from("children").select(
 * CHILD_SCRUB_COLUMNS)` both name IMPORTED constants, and an unresolvable
 * argument is a violation. Seeding them by hand would be a place for the guard's
 * belief and the code's value to drift, so the values are IMPORTED — if
 * `IMAGE_LAB_BUCKET` changes, this map changes with it and the allowlist below
 * is what reddens.
 */
const IMPORTED_CONSTANTS = new Map<string, string>([
  ["IMAGE_LAB_BUCKET", IMAGE_LAB_BUCKET],
  ["LEDGER_SALE_COLUMNS", LEDGER_SALE_COLUMNS],
  ["CHILD_SCRUB_COLUMNS", CHILD_SCRUB_COLUMNS],
]);

/** A `const NAME = "a" + "b";` table, per file, resolved through the AST. */
const stringConstants = (sf: ts.SourceFile): Map<string, string> => {
  const bindings = new Map<string, string>(IMPORTED_CONSTANTS);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const value = literalValue(node.initializer, bindings);
      if (value !== null) bindings.set(node.name.text, value);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bindings;
};

/**
 * An expression's string VALUE, or null when it cannot be computed statically.
 *
 * Literals, `const` bindings in the same file, and `+`-concatenations of those.
 * A template literal is accepted ONLY when it has no substitutions — `` `fp_${x}` ``
 * is exactly the shape that must stay unresolvable.
 */
const literalValue = (
  node: ts.Expression,
  bindings: Map<string, string>
): string | null => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return bindings.get(node.text) ?? null;
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression, bindings);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalValue(node.left, bindings);
    const right = literalValue(node.right, bindings);
    return left === null || right === null ? null : left + right;
  }
  return null;
};

/**
 * The METHOD NAME a callee refers to.
 *
 * `x.from` and `x["from"]` are the same call. A computed name this cannot resolve
 * comes back `null`, which the caller treats as a violation — an unresolvable
 * `db[pick()](t)` is exactly as unreviewable as an unresolvable table name.
 */
const calleeName = (
  callee: ts.Expression,
  bindings: Map<string, string>
): { name: string | null; target: ts.Expression } | null => {
  if (ts.isPropertyAccessExpression(callee)) {
    return { name: callee.name.text, target: callee.expression };
  }
  if (ts.isElementAccessExpression(callee)) {
    return {
      name: literalValue(callee.argumentExpression, bindings),
      target: callee.expression,
    };
  }
  return null;
};

/**
 * JavaScript's own `X.from(...)` statics. Not table reads, and enumerated rather
 * than heuristically skipped: "the target starts with a capital" would exempt a
 * Lab module that happened to name its handle `DB`.
 */
const BUILTIN_FROM_NAMESPACES = new Set([
  "Array",
  "Buffer",
  "Object",
  "Set",
  "Map",
  "String",
  "Number",
  "BigInt",
  "Date",
  "Promise",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
]);

const isBuiltinNamespace = (target: ts.Expression): boolean =>
  ts.isIdentifier(target) && BUILTIN_FROM_NAMESPACES.has(target.text);

/** Is this the `db.storage` of `db.storage.from(bucket)`? A BUCKET, not a table. */
const isStorageNamespace = (target: ts.Expression, bindings: Map<string, string>): boolean => {
  const inner = calleeName(target, bindings);
  return (
    (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
    inner?.name === "storage"
  );
};

type LabCall = {
  file: string;
  /** `from` (table), `bucket` (storage), or `rpc`. */
  kind: "table" | "bucket" | "rpc";
  /** The resolved name, or null when it could not be computed. */
  table: string | null;
  /** The source text of the argument, for the failure message. */
  expr: string;
  /** The resolved argument of the `.select()` IMMEDIATELY following, if any. */
  select: string | null;
};

/** Callee names that cannot be resolved at all — reported, never skipped. */
type UnresolvableCallee = { file: string; expr: string };

/**
 * Every table, bucket and rpc call in one file, resolved.
 *
 * ⚠ COMMENTS ARE NOT AN ISSUE HERE ANY MORE, and that is a second dividend of
 * the AST. The old scanner stripped comments first because these files QUOTE the
 * very calls being scanned in prose — the docblock above names
 * `.from("fp_ledger")` — and a text scan cannot tell an explanation from a call.
 * The parser only ever sees real syntax.
 */
const labCallsIn = (
  file: string,
  source: string
): { calls: LabCall[]; unresolvableCallees: UnresolvableCallee[] } => {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const bindings = stringConstants(sf);
  const calls: LabCall[] = [];
  const unresolvableCallees: UnresolvableCallee[] = [];

  /** The `.select(…)` argument of the call CHAINED DIRECTLY onto this one. */
  const followingSelect = (call: ts.CallExpression): string | null => {
    const parent = call.parent;
    if (
      parent === undefined ||
      !(ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    ) {
      return null;
    }
    const named = calleeName(parent, bindings);
    if (named?.name !== "select") return null;
    const outer = parent.parent;
    if (outer === undefined || !ts.isCallExpression(outer)) return null;
    const arg = outer.arguments[0];
    return arg === undefined ? null : literalValue(arg, bindings);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const named = calleeName(node.expression, bindings);
      if (named !== null) {
        if (named.name === null) {
          // `db[pick()](t)` — a computed method name. Unreviewable, so it fails.
          unresolvableCallees.push({ file, expr: node.expression.getText(sf) });
        } else if (named.name === "from" || named.name === "rpc") {
          const isBuiltin = named.name === "from" && isBuiltinNamespace(named.target);
          if (!isBuiltin) {
            const arg = node.arguments[0];
            const kind: LabCall["kind"] =
              named.name === "rpc"
                ? "rpc"
                : isStorageNamespace(named.target, bindings)
                  ? "bucket"
                  : "table";
            calls.push({
              file,
              kind,
              table: arg === undefined ? null : literalValue(arg, bindings),
              expr: arg === undefined ? "" : arg.getText(sf),
              select: kind === "table" ? followingSelect(node) : null,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { calls, unresolvableCallees };
};

/** Back-compatible view for the fixtures below: the TABLE calls only. */
const tableCallsIn = (file: string, source: string): LabCall[] =>
  labCallsIn(file, source).calls.filter((c) => c.kind === "table");

const labCalls = async (): Promise<{
  calls: LabCall[];
  unresolvableCallees: UnresolvableCallee[];
}> => {
  const calls: LabCall[] = [];
  const unresolvableCallees: UnresolvableCallee[] = [];
  for (const file of await labSources()) {
    const found = labCallsIn(file, readFileSync(path.join(REPO_ROOT, file), "utf8"));
    calls.push(...found.calls);
    unresolvableCallees.push(...found.unresolvableCallees);
  }
  return { calls, unresolvableCallees };
};

const tableCalls = async (): Promise<LabCall[]> =>
  (await labCalls()).calls.filter((c) => c.kind === "table");

// ── The graph assertions ─────────────────────────────────────────────────────

describe("every Image Lab DB touch goes through the service role", () => {
  it("no module REACHABLE from the Lab reaches an anon client — barrels included", async () => {
    const entries = await labSources();
    expect(walkForbiddenImports(entries)).toEqual([]);
  });

  it("the accessor exists, is server-only, and exports imageLabDb", async () => {
    const source = readFileSync(path.join(REPO_ROOT, DB_ACCESSOR), "utf8");
    expect(source).toMatch(/import\s+["']server-only["']/);
    expect(source).toMatch(/export function imageLabDb\(\)/);
    expect(source).toContain("supabaseAdmin()");
    // And it is genuinely the only Lab module holding the admin edge — proven
    // by the walk above, which reports any other importer as a violation.
    expect(specifiersOf(path.join(REPO_ROOT, DB_ACCESSOR))).toContain(
      "@/app/lib/supabase/admin"
    );
  });

  it("every fp_image_lab_* query is made by a module holding the accessor's handle", async () => {
    // ⚠ MATCHED ON THE PREFIX, not on `fp_image_lab_\w+`. A template literal
    // (`fp_image_lab_${x}`) and a concatenation ("fp_image_lab" + "_references")
    // both slipped past the word-boundary version.
    for (const file of await labSources()) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (!/fp_image_lab/.test(stripped)) continue;
      expect(stripped, `${file} names an Image Lab table without the accessor's handle`).toMatch(
        /\b(imageLabDb|ImageLabDb)\b/
      );
    }
  });

  /**
   * ⚠ THE HANDLE IS THE WHOLE PROJECT, AND UNIT 5 IS THE FIRST TO LEAVE THE LAB.
   *
   * `imageLabDb()` hands back a raw `supabaseAdmin()` client with full project
   * access, and until now the only table assertion above keyed on the literal
   * `fp_image_lab` prefix — which said nothing at all about the five tables this
   * unit newly reads: `children`, `families`, `fp_player_profiles`,
   * `fp_player_saves` and `fp_ledger`. Those are the child-data tables. So the
   * set of tables the Lab may name is enumerated, and adding a sixth is a
   * deliberate edit here rather than a silent one there.
   */
  const LAB_TABLE_ALLOWLIST = new Set([
    // The Lab's own three.
    "fp_image_lab_runs",
    "fp_image_lab_images",
    "fp_image_lab_references",
    // Read by the content picker and by `createRun`'s provenance check.
    "children",
    "families",
    "fp_player_profiles",
    "fp_player_saves",
    "fp_ledger",
  ]);

  /**
   * ⚠ THE SELECT LISTS THE LAB MAY USE AGAINST `fp_ledger`, ENUMERATED.
   *
   * R12a — the buyer's name never leaves the ledger — used to be defended by a
   * `\bpayer\b` TEXT SCAN, and a text scan is a spelling test. Verified: a probe
   * module whose select list was built as `const COLS = "id, " + "pay" + "er"`
   * passed the whole file, because the word is never spelled whole anywhere in
   * it. So the list is RESOLVED and matched against this set, and widening it is
   * a two-file diff with this docblock on the other side of it.
   */
  const LEDGER_SELECT_ALLOWLIST = new Set(["amount_cents, source, created_at"]);

  /**
   * ⚠ AND `children` NEEDED ONE TOO. It sat on the table allowlist with NO
   * select-list allowlist — alone among the child-data tables, and unlike
   * `fp_ledger`, which has had one since Unit 5. Only a literal `select("*")` was
   * blocked, so a Lab module could read ANY column on the roster (a parent's
   * email, an address, a free-text note) and nothing would redden. These five
   * columns are the scrub inputs plus the family join key, and nothing else.
   */
  const CHILDREN_SELECT_ALLOWLIST = new Set([
    "id, parent_id, first_name, last_name, fp_username",
  ]);

  /**
   * ⚠ THE `.rpc()` NAMES THE LAB MAY CALL — DELIBERATELY EMPTY.
   *
   * `imageLabDb()` is full-project admin, and `.rpc()` was NOT SCANNED AT ALL:
   * `imageLabDb().rpc("anything", …)` reaches every SECURITY DEFINER function on
   * the shared project — and therefore every table one of them touches — with
   * zero test failure. There is no `.rpc()` in the Lab today, which is exactly
   * why the gap was silent: nothing exercised it, and the first History aggregate
   * will add one. An empty set means ANY addition is a reviewed diff here.
   */
  const LAB_RPC_ALLOWLIST = new Set<string>();

  /**
   * ⚠ AND THE BUCKET ARGUMENT IS RESOLVED NOW TOO.
   *
   * `db.storage.from(...)` was SKIPPED outright and anything starting `image-lab`
   * was exempt — so a Lab module could read, sign or DELETE objects in ANY bucket
   * on the shared project, including the children's `path-evidence` bucket, and
   * the guard would say nothing. The Lab has exactly one bucket.
   */
  const LAB_BUCKET_ALLOWLIST = new Set(["fp-image-lab"]);

  it("names ONLY the tables on the reviewed allowlist", async () => {
    const calls = await tableCalls();
    expect(calls.length).toBeGreaterThan(0);
    const offenders = calls.filter(
      ({ table }) => table !== null && !LAB_TABLE_ALLOWLIST.has(table)
    );
    expect(
      offenders.map((o) => `${o.file}: ${o.table}`),
      "a Lab module names a table outside the reviewed allowlist"
    ).toEqual([]);
  });

  it("calls NO `.rpc()` at all — the allowlist is empty and additions are reviewed", async () => {
    const rpc = (await labCalls()).calls.filter((c) => c.kind === "rpc");
    expect(
      rpc.map((c) => `${c.file}: .rpc(${c.expr})`),
      "a Lab module calls .rpc() — add the function name to LAB_RPC_ALLOWLIST after reviewing what it can reach"
    ).toEqual(
      rpc
        .filter((c) => c.table !== null && LAB_RPC_ALLOWLIST.has(c.table))
        .map((c) => `${c.file}: .rpc(${c.expr})`)
    );
  });

  it("touches ONLY the Lab's own storage bucket", async () => {
    const buckets = (await labCalls()).calls.filter((c) => c.kind === "bucket");
    expect(buckets.length, "no storage touch found — has the bucket moved?").toBeGreaterThan(0);
    const offenders = buckets.filter(
      (c) => c.table === null || !LAB_BUCKET_ALLOWLIST.has(c.table)
    );
    expect(
      offenders.map((c) => `${c.file}: storage.from(${c.expr})`),
      "a Lab module reaches a bucket outside the reviewed allowlist"
    ).toEqual([]);
  });

  it("reads ONLY the reviewed columns from `children`", async () => {
    const reads = (await tableCalls()).filter((c) => c.table === "children");
    expect(reads.length, "no children read found — has the picker moved?").toBeGreaterThan(0);
    for (const call of reads) {
      expect(
        call.select,
        `${call.file}: the children read's select list does not resolve`
      ).not.toBeNull();
      expect(
        CHILDREN_SELECT_ALLOWLIST.has(call.select ?? ""),
        `${call.file}: children select list "${call.select}" is not on the reviewed allowlist`
      ).toBe(true);
    }
  });

  it("resolves every METHOD NAME, so bracket access cannot hide a call site", async () => {
    const { unresolvableCallees } = await labCalls();
    expect(
      unresolvableCallees.map((c) => `${c.file}: ${c.expr}`),
      "a Lab module calls a method through a name the guard cannot resolve"
    ).toEqual([]);
  });

  /**
   * ⚠ THE HOLE THIS CLOSES WAS THE WHOLE UNIT.
   *
   * The previous version of this pair matched only `.from("literal")`, and the
   * companion test EXEMPTED SCREAMING_CASE identifiers on the stated assumption
   * that "the allowlist test above reads their values from the same file". It did
   * not. Unit 6's loader names every table through a module constant
   * (`const RUNS = "fp_image_lab_runs"`), so NONE of its fourteen `.from()` calls
   * was checked by anything. Verified: a probe module doing
   * `const T = "staff"; db.from(T).select("id, email, is_active")` passed 23/23.
   *
   * The exemption is gone. An argument that cannot be RESOLVED — to a literal, or
   * through a `const` binding in the same file, or through a concatenation of
   * those — is a violation outright.
   */
  it("resolves every table name to a value the allowlist can actually see", async () => {
    const unresolved = (await tableCalls()).filter((call) => call.table === null);
    expect(
      unresolved.map((c) => `${c.file}: .from(${c.expr})`),
      "a Lab module builds a table name the allowlist cannot resolve"
    ).toEqual([]);
  });

  /**
   * ⚠ NON-VACUITY, PER FILE, FOR THE FILE THAT ALMOST GOT AWAY.
   *
   * `expect(calls.length).toBeGreaterThan(0)` is satisfied by ANY file's calls,
   * which is exactly how history-loader's fourteen went unchecked while the suite
   * reported the allowlist as exercised.
   */
  it("the allowlist is non-vacuous for history-loader SPECIFICALLY", async () => {
    const loader = (await tableCalls()).filter((c) =>
      c.file.endsWith("lib/history-loader.ts")
    );
    expect(loader.length).toBeGreaterThanOrEqual(10);
    expect(loader.every((c) => c.table !== null)).toBe(true);
    expect(new Set(loader.map((c) => c.table))).toEqual(
      new Set(["fp_image_lab_runs", "fp_image_lab_images", "fp_image_lab_references"])
    );
  });

  it("NEVER selects `payer` — the only protection a non-consenting third party has", async () => {
    // Two mechanisms, because the word scan alone is a spelling test:
    //
    //  A. STRUCTURAL. Every read of `fp_ledger` must be followed immediately by a
    //     `.select()` whose argument RESOLVES to one of the reviewed lists above.
    //     A concatenation that never spells `payer` still fails, because the
    //     resolved value is what is compared.
    const ledger = (await tableCalls()).filter((call) => call.table === "fp_ledger");
    expect(ledger.length, "no fp_ledger read found — has the picker moved?").toBeGreaterThan(0);
    for (const call of ledger) {
      expect(
        call.select,
        `${call.file}: the fp_ledger read's select list does not resolve`
      ).not.toBeNull();
      expect(
        LEDGER_SELECT_ALLOWLIST.has(call.select ?? ""),
        `${call.file}: fp_ledger select list "${call.select}" is not on the reviewed allowlist`
      ).toBe(true);
    }

    //  B. And the cheap scan, kept, because it also catches the column named in a
    //     comment, a log line, or a type.
    for (const file of await labSources()) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(stripped, `${file} names payer`).not.toMatch(/\bpayer\b/);
      // …and no `select("*")` anywhere, which would pull it without naming it.
      expect(stripped, `${file} selects *`).not.toMatch(/\.select\(\s*["'`]\s*\*/);
    }
  });

  it("the reference loader is server-only, so it can never be bundled to a client", async () => {
    expect(readFileSync(path.join(REPO_ROOT, `${LAB}lib/reference-loader.ts`), "utf8")).toMatch(
      /import\s+["']server-only["']/
    );
  });

  it("the crossing allowlist is short, real, and outside the Lab", () => {
    // A crossing that no longer exists is a stale exemption; one INSIDE the Lab
    // would be a Lab module exempting itself.
    expect(AUDITED_CROSSINGS.length).toBeLessThanOrEqual(3);
    for (const crossing of AUDITED_CROSSINGS) {
      expect(existsSync(path.join(REPO_ROOT, crossing)), crossing).toBe(true);
      expect(crossing.startsWith(LAB)).toBe(false);
    }
  });
});

// ── NEGATIVE FIXTURES: the guard is proven to be able to FAIL ────────────────

/**
 * Code that SHOULD violate, asserted to be caught.
 *
 * Every entry is one of the bypasses review actually shipped past the old scan.
 * They are judged as SOURCE TEXT at a pretend Lab path rather than written to
 * disk, so a fixture can never itself become the defect it describes.
 *
 * ⚠ THE TWO MECHANISMS DO NOT OVERLAP COMPLETELY, and pretending otherwise
 * would be the same mistake again. ESLint 9's `no-restricted-imports` does NOT
 * inspect dynamic `import()` — verified, not assumed — so the dynamic-import
 * bypass is caught by the GRAPH walk alone, which reads specifiers through the
 * TypeScript scanner and sees every form. Each case below records which
 * mechanism answers, and the requirement is that at least one always does.
 */
describe("the guard CATCHES what it is supposed to catch (negative fixtures)", () => {
  const linter = new Linter({ configType: "flat" });

  const lint = (code: string, rules = IMAGE_LAB_IMPORT_RULES.all) =>
    linter.verify(
      code,
      [{ rules: { "no-restricted-imports": ["error", { patterns: rules }] } }],
      "fixture.js"
    );

  const caughtBy = (code: string) => ({
    lint: lint(code).some((m) => m.ruleId === "no-restricted-imports"),
    graph: scanCode(code).length > 0,
  });

  it.each([
    // [why, code, must the LINT rule catch it?]
    [
      "a dynamic import of the anon client",
      `const m = await import("@/app/lib/supabase/client");`,
      false,
    ],
    [
      "a RELATIVE anon import",
      `import * as m from "../../../lib/supabase/client";`,
      true,
    ],
    [
      "a relative cookie-session import",
      `import { x } from "../../../lib/supabase/server";`,
      true,
    ],
    [
      "a direct vendor createClient",
      `import { createClient } from "@supabase/supabase-js";\nconst c = createClient("u", "k");`,
      true,
    ],
    ["the ssr package", `import { createBrowserClient } from "@supabase/ssr";`, true],
    [
      "a relative admin import",
      `import { supabaseAdmin } from "../../../lib/supabase/admin";`,
      true,
    ],
    [
      "an aliased admin import",
      `import { supabaseAdmin } from "@/app/lib/supabase/admin";`,
      true,
    ],
    ["a re-export of the anon client", `export * from "@/app/lib/supabase/client";`, true],
    [
      "a dynamic import inside a helper, three lines deep",
      `export async function db() {\n  const { supabaseBrowser } = await import("../../../lib/supabase/client");\n  return supabaseBrowser();\n}`,
      false,
    ],
  ])("SOMETHING catches %s", (_why, code, lintMustCatch) => {
    const caught = caughtBy(code);
    expect(caught.lint || caught.graph, "neither mechanism caught this").toBe(true);
    // The graph walk is the backstop and must catch EVERY form.
    expect(caught.graph, "the import graph must see this edge").toBe(true);
    if (lintMustCatch) {
      expect(caught.lint, "the lint rule must also reject this specifier").toBe(true);
    }
  });

  it("the ONE accessor is still allowed the admin client, and nothing else", () => {
    expect(
      lint(`import { supabaseAdmin } from "@/app/lib/supabase/admin";`, IMAGE_LAB_IMPORT_RULES.accessor)
    ).toEqual([]);
    expect(
      lint(`import { supabaseBrowser } from "@/app/lib/supabase/client";`, IMAGE_LAB_IMPORT_RULES.accessor)
        .map((m) => m.ruleId)
    ).toContain("no-restricted-imports");
    // …and the graph agrees: the same admin import is a violation from any
    // other Lab file and not from the accessor.
    expect(scanCode(`import { supabaseAdmin } from "@/app/lib/supabase/admin";`)).toHaveLength(1);
    expect(
      scanCode(`import { supabaseAdmin } from "@/app/lib/supabase/admin";`, DB_ACCESSOR)
    ).toEqual([]);
  });

  it("legitimate Lab imports are NOT flagged — a rule that reddens on correct code gets deleted", () => {
    const code = [
      `import { z } from "zod";`,
      `import { requireStaff } from "@/app/crm/lib/auth";`,
      `import { imageLabDb } from "./image-lab-db";`,
      `import { uploadWithSlot } from "@/app/fp/lib/upload-client";`,
    ].join("\n");
    expect(lint(code)).toEqual([]);
    expect(scanCode(code)).toEqual([]);
  });

  it("the eslint config actually carries the rule, scoped to the Lab across every extension", async () => {
    type Block = { files?: unknown; rules?: Record<string, unknown> };
    const config = (await import("../../../../eslint.config.mjs")).default as Block[];
    const globsOf = (block: Block) =>
      (Array.isArray(block.files) ? block.files : []).flat().filter((f) => typeof f === "string");

    const labBlocks = config.filter((block) =>
      globsOf(block).some((f) => f.includes("app/staff/image-lab"))
    );
    expect(labBlocks.length).toBeGreaterThan(0);

    const wide = labBlocks.find((block) =>
      globsOf(block).some((f) => SOURCE_EXTENSIONS.every((ext) => f.includes(ext.slice(1))))
    );
    expect(wide, "the Lab-wide block must cover every module extension").toBeDefined();
    expect(wide?.rules?.["no-restricted-imports"]).toBeDefined();
  });

  // ── …and the GRAPH walk, on a synthetic barrel ──────────────────────────────

  it("the graph walk FOLLOWS edges out of the Lab — the barrel case", async () => {
    // The bypass that shipped: a Lab module imports something innocent, and the
    // innocent thing re-exports the anon client. Lint cannot see it (the
    // specifier is not forbidden) and no glob over the Lab can reach it.
    //
    // Run with an EMPTY crossing list, the same walk over the same entries must
    // report violations — because the Lab really does import
    // `app/fp/lib/upload-client.ts`, which really does import the browser
    // client, exactly the shape a barrel has. That the production run is clean
    // is therefore a fact about the ALLOWLIST, not about a walk that never
    // leaves home and would have found nothing either way.
    const entries = await labSources();
    const unaudited = walkForbiddenImports(entries, []);
    expect(unaudited.length).toBeGreaterThan(0);
    expect(unaudited.map((v) => v.file)).toContain("app/fp/lib/upload-client.ts");
    expect(unaudited.some((v) => v.why.includes("anon-key"))).toBe(true);
  });

  it("the graph walk resolves relative, aliased and dynamic specifiers alike", () => {
    const abs = path.join(REPO_ROOT, `${LAB}lib/reference-loader.ts`);
    const resolved = specifiersOf(abs)
      .map((s) => resolveSpecifier(abs, s))
      .filter((s): s is string => s !== null);
    // Relative (`./image-lab-rules`) and aliased (`@/app/fp/lib/upload-rules`)
    // both land on real repo files — if they did not, the walk would be
    // traversing nothing and every assertion above would pass vacuously.
    expect(resolved).toContain(`${LAB}lib/image-lab-rules.ts`);
    expect(resolved).toContain("app/fp/lib/upload-rules.ts");
  });

  /**
   * ⚠ THE TABLE ALLOWLIST AND THE PAYER FENCE HAD NO NEGATIVE FIXTURES AT ALL —
   * alone among every guard in this file — AND THAT IS EXACTLY WHY BOTH FELL.
   *
   * Each case below is a bypass that was VERIFIED to pass the previous version
   * with the whole suite green. They are judged as SOURCE TEXT so a fixture can
   * never itself become the defect it describes.
   */
  describe("the table allowlist CATCHES what it is supposed to catch", () => {
    const LAB_TABLES = new Set([
      "fp_image_lab_runs",
      "fp_image_lab_images",
      "fp_image_lab_references",
      "children",
      "families",
      "fp_player_profiles",
      "fp_player_saves",
      "fp_ledger",
    ]);
    const LEDGER_OK = new Set(["amount_cents, source, created_at"]);

    const CHILDREN_OK = new Set(["id, parent_id, first_name, last_name, fp_username"]);
    const BUCKET_OK = new Set(["fp-image-lab"]);

    /** The production judgement, applied to one fixture's text. */
    const judge = (code: string) => {
      const found = labCallsIn("fixture.ts", code);
      const calls = found.calls.filter((c) => c.kind === "table");
      return {
        unresolved: calls.filter((c) => c.table === null),
        offTable: calls.filter((c) => c.table !== null && !LAB_TABLES.has(c.table)),
        badLedger: calls.filter(
          (c) => c.table === "fp_ledger" && !LEDGER_OK.has(c.select ?? "")
        ),
        badChildren: calls.filter(
          (c) => c.table === "children" && !CHILDREN_OK.has(c.select ?? "")
        ),
        rpc: found.calls.filter((c) => c.kind === "rpc"),
        badBucket: found.calls.filter(
          (c) => c.kind === "bucket" && (c.table === null || !BUCKET_OK.has(c.table))
        ),
        unresolvableCallees: found.unresolvableCallees,
      };
    };

    /**
     * ⚠ THE BRACKET-ACCESS PROBE, WHICH DEFEATED THE PREVIOUS VERSION ENTIRELY.
     *
     * Not "resolved to the wrong value" — NOT ENUMERATED AT ALL, so no argument
     * check ran and the site could not even be reported as unresolvable. Verified
     * at 31/31 in this file and 899/899 across the Lab.
     */
    it("REPORTS `db[\"from\"](t)` — the bracket probe that passed 31/31", () => {
      const found = judge(
        `const t = "staff";\nconst rows = db["from"](t).select("id, email, is_active");`
      );
      expect(found.unresolved).toEqual([]);
      expect(found.offTable.map((c) => c.table)).toEqual(["staff"]);
    });

    it("REPORTS a bracket-access ledger read whose select never spells payer", () => {
      const found = judge(
        `const rows = db["from"]("fp_ledger").select("id, " + "pay" + "er" + ", amount_cents");`
      );
      expect(found.badLedger).toHaveLength(1);
      expect(found.badLedger[0]!.select).toBe("id, payer, amount_cents");
    });

    it("REPORTS a COMPUTED method name outright — it is unreviewable", () => {
      expect(judge(`const rows = db[pick()]("staff").select("id");`).unresolvableCallees)
        .toHaveLength(1);
    });

    it("REPORTS any `.rpc()`, however it is spelled", () => {
      expect(judge(`await db.rpc("anything", { a: 1 });`).rpc).toHaveLength(1);
      expect(judge(`await db["rpc"]("anything", { a: 1 });`).rpc).toHaveLength(1);
      const named = judge(`const F = "danger";\nawait db.rpc(F);`).rpc;
      expect(named).toHaveLength(1);
      expect(named[0]!.table).toBe("danger");
    });

    it("REPORTS a storage touch on ANOTHER bucket — including the children's", () => {
      expect(
        judge(`await db.storage.from("path-evidence").remove([k]);`).badBucket
      ).toHaveLength(1);
      // …and the old `startsWith("image-lab")` exemption is gone with it.
      expect(judge(`await db.storage.from("image-lab-scratch").list();`).badBucket)
        .toHaveLength(1);
      expect(judge(`await db.storage.from(pickBucket()).download(k);`).badBucket)
        .toHaveLength(1);
    });

    it("REPORTS a `children` read outside its reviewed select list", () => {
      expect(
        judge(`const r = db.from("children").select("id, parent_email, address");`)
          .badChildren
      ).toHaveLength(1);
      expect(
        judge(`const r = db.from("children").select(buildColumns());`).badChildren
      ).toHaveLength(1);
    });

    it("REPORTS `const T = \"staff\"; db.from(T)` — the probe that passed 23/23", () => {
      const found = judge(
        `const T = "staff";\nconst rows = db.from(T).select("id, email, is_active");`
      );
      expect(found.unresolved).toEqual([]);
      expect(found.offTable.map((c) => c.table)).toEqual(["staff"]);
    });

    it("REPORTS a concatenated table name that never spells the table whole", () => {
      const found = judge(`const T = "st" + "aff";\nconst rows = db.from(T).select("id");`);
      expect(found.offTable.map((c) => c.table)).toEqual(["staff"]);
    });

    it("REPORTS a table name it cannot resolve at all — no exemption for ALL CAPS", () => {
      // The old companion test skipped `/^[A-Z_][A-Z0-9_]*$/` outright.
      expect(judge(`const rows = db.from(TABLE_NAME).select("id");`).unresolved).toHaveLength(1);
      expect(judge(`const rows = db.from(pick(x)).select("id");`).unresolved).toHaveLength(1);
      expect(judge("const rows = db.from(`fp_${x}`).select(\"id\");").unresolved).toHaveLength(1);
    });

    it("REPORTS the payer probe: a ledger select built by concatenation", () => {
      // VERIFIED to defeat the `\bpayer\b` scan: the word is never spelled whole.
      const found = judge(
        `const COLS = "id, " + "pay" + "er";\nconst rows = db.from("fp_ledger").select(COLS);`
      );
      expect(found.badLedger).toHaveLength(1);
      expect(found.badLedger[0]!.select).toBe("id, payer");
    });

    it("REPORTS a ledger select it cannot resolve", () => {
      expect(
        judge(`const rows = db.from("fp_ledger").select(buildColumns());`).badLedger
      ).toHaveLength(1);
    });

    it("does NOT report the real shapes — a rule that reddens on correct code gets deleted", () => {
      const found = judge(
        [
          `const RUNS = "fp_image_lab_runs";`,
          `const IMAGE_LAB_BUCKET = "fp-image-lab";`,
          `const COLUMNS = "id, staff_id, " + "created_at";`,
          `const a = db.from(RUNS).select(COLUMNS).eq("id", runId);`,
          `const b = db.from("fp_ledger").select("amount_cents, source, created_at");`,
          `const c = db.storage.from(IMAGE_LAB_BUCKET).createSignedUrl(k, 600);`,
          `const d = Array.from({ length: 3 }, (_, i) => i);`,
          `const e = db.from("children").select("id, parent_id, first_name, last_name, fp_username");`,
        ].join("\n")
      );
      expect(found.offTable).toEqual([]);
      expect(found.badLedger).toEqual([]);
      expect(found.badChildren).toEqual([]);
      expect(found.badBucket).toEqual([]);
      expect(found.rpc).toEqual([]);
      expect(found.unresolved).toEqual([]);
      expect(found.unresolvableCallees).toEqual([]);
    });

    it("resolves a MULTI-LINE concatenated constant — the real RUN_COLUMNS shape", () => {
      const calls = tableCallsIn(
        "f.ts",
        `const C =\n  "id, staff_id, " +\n  "template, created_at";\nconst q = db.from("fp_ledger").select(C);`
      );
      expect(calls[0]!.select).toBe("id, staff_id, template, created_at");
    });
  });

  it("the source list includes every extension and excludes only *.test.*", async () => {
    const sources = await labSources();
    expect(sources.some((f) => isTestFile(f))).toBe(false);
    // A production module under __tests__/ WOULD be scanned — the case that
    // shipped past both the old scan and vitest.
    expect(isTestFile("app/staff/image-lab/lib/__tests__/anon-helper.ts")).toBe(false);
    expect(isTestFile("app/staff/image-lab/lib/__tests__/reference-core.test.ts")).toBe(true);
  });
});
