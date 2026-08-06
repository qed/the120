import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { glob } from "tinyglobby";
import ts from "typescript";
import { LAB_ROUTABLE_GLOB, LAB_SOURCE_GLOB } from "./lab-globs";

/**
 * The Image Lab's GATE WIRING (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3; requirements in
 * first-profit repo: docs/brainstorms/2026-08-05-image-lab-requirements.md, R1).
 *
 * This file is the SECURITY BOUNDARY for the whole feature, so it asserts
 * BEHAVIOUR first and source second. The distinction is the whole point:
 *
 *   A SOURCE SCAN CANNOT ANSWER "WAS THE GATE REACHED".
 *
 * The previous version of this file was a scan only, and review defeated it
 * three ways with the full suite green: an inner-scope `const requireStaff =
 * async () => {}` shadowing the real import; an ungated `api/generate/route.ts`
 * that the `{page,layout}` glob never looked at; and a gate behind
 * `if (process.env.NODE_ENV !== "production")`. Each of those is a completely
 * open surface that a diff review also misses, because the import block is
 * untouched.
 *
 * So: `requireStaff` is MOCKED WITH A SPY, every routable module under the Lab
 * is dynamically imported, its entry points are actually INVOKED, and the spy
 * must have been called. A gate that is shadowed, deleted, or never reached
 * fails, because the mock is the only thing that could have answered.
 *
 * The source scan is kept as a SUPPLEMENTARY fence for the two properties a
 * spy cannot see — that the gate is the authoritative import rather than any
 * function of that name, and that it is UNCONDITIONAL (under `NODE_ENV=test`
 * a production-only bypass calls the spy quite happily).
 *
 * ⚠ AND IT RUNS OVER SERVER ACTIONS, NOT ONLY OVER ROUTABLE FILES. The four
 * fences used to iterate the `{page,layout,template,default,route}` glob alone,
 * which does not match `lib/reference-actions.ts` — so the ONLY check reaching
 * an action was the behavioural invoke, under exactly the NODE_ENV a production
 * bypass survives. Verified: an action gated by
 * `if (process.env.NODE_ENV !== "production") { await gate(); }` passed this
 * file with fourteen tests green while shipping a wide-open POST. `gatedFiles()`
 * is the union, and every fence below uses it.
 *
 * Prior art for why wiring gets asserted at all:
 *   docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-\
 *     mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md
 *   docs/solutions/security-issues/an-inert-defensive-branch-has-no-\
 *     behavioural-signature-assert-the-wiring-2026-07-27.md
 *
 * ── Why the file list is DISCOVERED, not written down ──────────────────────
 * The failure worth catching is a module added under `/staff/image-lab` in
 * Units 4–6 that forgets the gate — Unit 5 adds exactly a POST route that calls
 * a PAID model, and ROUTE HANDLERS AND SERVER ACTIONS DO NOT RENDER THROUGH
 * LAYOUTS AT ALL, so the layout gate provably cannot cover them. (`proxy.ts` is
 * a JWT-only outer fence and its own docblock says it does not reliably cover
 * Server Function calls.) The glob therefore covers every Next routable
 * convention, and there is deliberately NO pinned list of today's files to
 * update: a checklist a new page must be added to trains the next author to
 * update the checklist, which is the habit that neuters the guard.
 *
 * Resolved relative to THIS FILE, never `process.cwd()`: a scan that reads no
 * file is worse than no scan, because it passes.
 */

// ── The spy ──────────────────────────────────────────────────────────────────

const { requireStaffSpy } = vi.hoisted(() => ({ requireStaffSpy: vi.fn() }));

vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: requireStaffSpy }));

beforeEach(() => {
  requireStaffSpy.mockReset();
  requireStaffSpy.mockResolvedValue({
    staffId: "00000000-0000-4000-8000-000000000000",
    email: "gate-test@the120.example",
  });
});

// ── Discovery ────────────────────────────────────────────────────────────────

const dir = fileURLToPath(new URL(".", import.meta.url));
/** `app/staff/image-lab/__tests__/` → the repo root. Four levels up. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${dir}`));
const LAB = "app/staff/image-lab/";

/**
 * EVERY Next routable convention under the Lab, IN EVERY EXTENSION.
 *
 * `page`/`layout`/`template`/`default` render; `route` does not render at all
 * and is reached directly. Missing `route` is what let an ungated
 * `api/generate/route.ts` sit invisible under the old `{page,layout}` glob.
 *
 * ⚠ AND MISSING `.js` LET THE SAME THING HAPPEN AGAIN. The glob was
 * `.{ts,tsx}`, so `app/staff/image-lab/api/probe/route.js` — an ungated,
 * network-reachable POST — passed this file 20/20 and the Lab suite 899/899.
 * `next.config.ts` sets no `pageExtensions`, so Next routes it in full. The
 * SIBLING guard (`service-role-only`) had already learned this in Unit 4 and
 * enumerated eight extensions; the fix was never carried across. The list is now
 * shared (`./lab-globs`) so the two cannot drift again.
 */
const ROUTABLE_GLOB = LAB_ROUTABLE_GLOB;

const routableFiles = async (): Promise<string[]> => {
  const files = await glob([ROUTABLE_GLOB], {
    cwd: REPO_ROOT,
    absolute: false,
    ignore: ["**/__tests__/**"],
  });
  // An empty expansion would make every assertion below pass vacuously.
  expect(files.length).toBeGreaterThan(0);
  return files.map((f) => f.replace(/\\/g, "/")).sort();
};

/**
 * Every `"use server"` module under the Lab.
 *
 * ⚠ SERVER ACTIONS ARE NOT ROUTABLE FILES, and that gap was a wide-open POST.
 * `ROUTABLE_GLOB` matches `{page,layout,template,default,route}` only, so
 * `lib/reference-actions.ts` was reached by the BEHAVIOURAL invoke and by
 * nothing else — and the behavioural invoke runs under `NODE_ENV=test`, which
 * is precisely the condition a production bypass leaves true. Verified: an
 * action gated by `if (process.env.NODE_ENV !== "production") { await gate(); }`
 * passed the whole file with fourteen tests green, while shipping an ungated
 * network-reachable endpoint — and Unit 5's paid endpoint is an action.
 *
 * So the four source fences below run over THESE files as well.
 */
/**
 * ⚠ AND THIS GLOB WAS `.{ts,tsx}` TOO, so the `.js` hole was DOUBLE. Verified:
 * `app/staff/image-lab/lib/probe-actions.js` — `"use server"`, one ungated
 * exported action — was invisible to this scan as well as to the routable one,
 * and passed 20/20.
 */
const labSourceFiles = async (): Promise<string[]> => {
  const sources = await glob([LAB_SOURCE_GLOB], {
    cwd: REPO_ROOT,
    absolute: false,
    ignore: ["**/__tests__/**"],
  });
  return sources.map((f) => f.replace(/\\/g, "/")).sort();
};

/** A module-scope `"use server"` directive: the first statement of the file. */
const MODULE_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/;

const actionFiles = async (): Promise<string[]> => {
  const sources = await labSourceFiles();
  return sources.filter((f) =>
    MODULE_DIRECTIVE.test(readFileSync(`${REPO_ROOT}${f}`, "utf8"))
  );
};

/**
 * Every `"use server"` directive that is NOT at module scope.
 *
 * ⚠ A FUNCTION-SCOPE `"use server"` IS A NETWORK-REACHABLE ENDPOINT WITH ITS OWN
 * ACTION ID, and every check in this file — the four source fences and the
 * behavioural invoke — iterates EXPORTED FUNCTIONS. An inline action declared
 * inside a page body or a form handler is exported by nothing, so all five skip
 * it silently while Next still serves it.
 *
 * The answer is a BAN rather than half a mechanism: covering inline actions
 * properly means slicing arbitrary nested closures out of a page component, which
 * is the sort of extractor this file's own history shows always has one more
 * shape it does not know. The Lab declares its actions at module scope; a
 * function-scope directive fails loudly and the author moves it into a
 * `"use server"` module, where all five checks reach it.
 */
const inlineServerDirectives = (source: string): string[] => {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use server" &&
      node.parent !== sf
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push(`line ${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

/** Everything the source fences apply to: what Next can render, plus what a
 *  browser can POST to directly. */
const gatedFiles = async (): Promise<string[]> => {
  const files = [...(await routableFiles()), ...(await actionFiles())];
  expect(files.length).toBeGreaterThan(0);
  return files;
};

/** Repo-relative path → a specifier this test can `import()`. */
const specifierFor = (file: string) => `../${file.slice(LAB.length)}`;

/**
 * Comments removed before any scan.
 *
 * These files are heavily commented by design, and every comment here NAMES
 * `requireStaff` while explaining why it is called twice. A scan over raw source
 * could not tell the explanation from the call, so deleting the call would leave
 * the supplementary fence green. Same helper shape as `bar-wiring.test.ts`; fix
 * the scan, never the comment.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sourceOf = (file: string) =>
  stripComments(readFileSync(`${REPO_ROOT}${file}`, "utf8"));

/**
 * Timeout for the tests that DYNAMICALLY IMPORT page modules.
 *
 * Vitest's 5000ms default is a transform budget, not a work budget: the first
 * test to import a `page.tsx` pays for Vite to transform it and its whole
 * import graph (react, next/link), and under a full-suite run that alone
 * exceeds the default on a cold cache. A behavioural gate test cannot be
 * allowed to red on machine load — a security test that flakes is a security
 * test that gets skipped.
 */
const IMPORT_TIMEOUT_MS = 30_000;

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/**
 * The entry points Next itself can call on a module.
 *
 * `page`/`layout`/`template`/`default` are reached through the DEFAULT export;
 * a ROUTE HANDLER HAS NO DEFAULT EXPORT AT ALL — it exports `GET`/`POST`/… — so
 * anything keyed on `export default` passes vacuously over exactly the module
 * type that layouts cannot protect.
 */
const entryPointsOf = (mod: Record<string, unknown>, file: string) => {
  const entries: { name: string; call: () => unknown }[] = [];
  if (/\/route\.tsx?$/.test(file)) {
    for (const method of HTTP_METHODS) {
      const handler = mod[method];
      if (typeof handler === "function") {
        entries.push({
          name: method,
          call: () =>
            (handler as (...a: unknown[]) => unknown)(
              new Request("http://localhost/staff/image-lab", { method }),
              { params: Promise.resolve({}) }
            ),
        });
      }
    }
    return entries;
  }
  if (typeof mod.default === "function") {
    entries.push({
      name: "default",
      call: () =>
        (mod.default as (...a: unknown[]) => unknown)({
          children: null,
          params: Promise.resolve({}),
          searchParams: Promise.resolve({}),
        }),
    });
  }
  return entries;
};

// ── The headline assertion: the gate is REACHED ──────────────────────────────

describe("every routable Image Lab module actually REACHES the gate (R1)", () => {
  it("invoking each entry point calls the authoritative requireStaff", async () => {
    const files = await routableFiles();

    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ specifierFor(file))) as Record<
        string,
        unknown
      >;
      const entries = entryPointsOf(mod, file);

      // A routable module with nothing to invoke is not "gated by default", it
      // is an untested surface — and for a `route.ts` it means the method
      // exports are a shape this test does not know how to call.
      expect(
        entries.map((e) => e.name),
        `${file} exposes no entry point this test can invoke`
      ).not.toEqual([]);

      for (const entry of entries) {
        requireStaffSpy.mockClear();
        try {
          await entry.call();
        } catch {
          // Irrelevant. What matters is whether the gate was reached BEFORE
          // whatever threw — a module that throws before gating fails below.
        }
        expect(
          requireStaffSpy,
          `${file} → ${entry.name}() did not call requireStaff()`
        ).toHaveBeenCalled();
      }
    }
  }, IMPORT_TIMEOUT_MS);

  it("the discovery finds the layout and all three segment pages, and no list pins it", async () => {
    // NOT an equality assertion against a written-down list — that is what
    // trains an author to edit the list instead of adding the gate. This only
    // proves the glob's expansion is real and covers the known shapes.
    const files = await routableFiles();
    expect(files).toContain(`${LAB}layout.tsx`);
    expect(files).toContain(`${LAB}page.tsx`);
    expect(files.filter((f) => /\/page\.tsx$/.test(f)).length).toBeGreaterThanOrEqual(3);
  });
});

// ── Supplementary source fence ───────────────────────────────────────────────

/**
 * The function body starting at `start`, bounded by the first closing brace in
 * COLUMN ZERO.
 *
 * Bounding matters: a slice that runs to end of file is satisfied by a dead
 * `await requireStaff()` sitting in an uncalled helper BELOW the export, which
 * is a mutation review used to defeat the previous version of this file.
 */
const functionBody = (code: string, start: number) => {
  // Step over the PARAMETER LIST first. A destructured signature closes on a
  // line of its own (`}: Readonly<{ children }>) {`), so searching for the
  // column-zero brace from `start` would end the "body" before it began.
  let i = code.indexOf("(", start);
  for (let depth = 0; i > -1 && i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) {
      i++;
      break;
    }
  }
  const open = code.indexOf("{", i);
  if (open === -1) return "";
  const end = code.indexOf("\n}", open);
  return code.slice(open, end === -1 ? code.length : end);
};

/**
 * Every exported entry point in a module, as source slices.
 *
 * ⚠ `async` IS NOT PART OF THE THREAT MODEL. The earlier pattern required it, so
 * an exported NON-async function in a `"use server"` module was invisible to all
 * four source fences — while still being a network-reachable POST endpoint. And
 * because the sibling exports in the same file DID match, the
 * `expect(bodies.length).toBeGreaterThan(0)` guard passed happily on their
 * behalf, so the hole was silent rather than loud.
 *
 * A Server Action must be async to be callable from a client, but nothing stops
 * one being declared without the keyword and returning a promise — and nothing
 * about "did this body await the gate" needs the keyword to be true.
 */
/**
 * ⚠ AND A BARE-IDENTIFIER PARAMETER IS NOT PART OF THE THREAT MODEL EITHER.
 *
 * The pattern required `(` or `function` after `async`, so
 * `export const foo = async input => {}` — a perfectly ordinary Server Action —
 * matched NOTHING, and all four source fences skipped it while
 * `expect(bodies.length).toBeGreaterThan(0)` passed on a gated sibling's behalf.
 * VERIFIED: a probe action
 *
 *   export const wideOpen = async input => {
 *     if (process.env.NODE_ENV !== "production") { await requireStaff(); }
 *     …
 *   }
 *
 * passed all 39 tests while being a network-reachable, UNGATED POST in
 * production. The parenless arrow is now sliced like any other export.
 *
 * The body of a parenless arrow starts after the `=>`; the paren-stepping in
 * {@link functionBody} would otherwise run off into the first `(` it could find.
 * A CONCISE body (no `{`) yields "" deliberately — an exported function with no
 * braced body cannot contain `await requireStaff();` as a standalone statement,
 * so it must fail the fence loudly rather than be skipped quietly.
 */
const EXPORTED_HEAD =
  /export\s+(?:(default)\s+)?(?:(?:async\s+)?function\s*(\w+)?|const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:(\w+)\s*=>|\(|function\b))/g;

/** The body starting at the first `{` at or after `i`, bounded as above. */
const bracedBodyFrom = (code: string, i: number) => {
  const rest = code.slice(i);
  if (!/^\s*\{/.test(rest)) return "";
  const open = code.indexOf("{", i);
  const end = code.indexOf("\n}", open);
  return code.slice(open, end === -1 ? code.length : end);
};

/** Every exported entry point, NAMED, as a source slice. */
const exportedFunctionEntries = (code: string): { name: string; body: string }[] => {
  const entries: { name: string; body: string }[] = [];
  for (const match of code.matchAll(EXPORTED_HEAD)) {
    const name = match[1] !== undefined ? "default" : match[2] ?? match[3] ?? "(anonymous)";
    // Group 4 is the bare identifier of a parenless arrow; when it matched, the
    // match ends AT the `=>` and the body follows directly.
    const body =
      match[4] !== undefined
        ? bracedBodyFrom(code, match.index + match[0].length)
        : functionBody(code, match.index);
    entries.push({ name, body });
  }
  return entries;
};

const exportedFunctionBodies = (code: string) =>
  exportedFunctionEntries(code).map((entry) => entry.body);

const GATE_CALL = /await\s+requireStaff\s*\(\s*\)/;

/**
 * Awaits that may legitimately precede the gate.
 *
 * `const { runId } = await params;` is the STANDARD Next 16 way to read a
 * dynamic segment, and Units 4–6 add dynamic segments. A rule that reddens on
 * correct code is a rule that gets deleted, so the ordering assertion allows
 * awaits whose operand is the route props (`params`, `searchParams`, `props`,
 * `props.params`, …) and nothing else. Everything else — a DB read, a fetch, a
 * storage call — must come after the gate, or the work is done, the row is
 * touched, and only then is the visitor redirected.
 */
const ALLOWED_EARLY_AWAIT = /^\s*(params|searchParams|props(\.\w+)?)\b/;

describe("supplementary source fence — properties a spy cannot see", () => {
  it("each module imports the ONE authoritative gate", async () => {
    // Not any function of that name: `app/crm/lib/auth.ts` verifies the session
    // against the auth server AND the `staff` row's `is_active`, memoized per
    // request.
    for (const file of await gatedFiles()) {
      expect(sourceOf(file), file).toMatch(
        /import\s*\{[^}]*\brequireStaff\b[^}]*\}\s*from\s*["']@\/app\/crm\/lib\/auth["']/
      );
    }
  });

  it("the identifier is never re-bound or aliased inside a module", async () => {
    // The inner-scope shadow: `const requireStaff = async () => {};` in the page
    // body, real import untouched. The behavioural test above already reddens on
    // it; this names the cause in the failure message and covers a shadow in a
    // module the invoker could not reach.
    for (const file of await gatedFiles()) {
      const code = sourceOf(file);
      expect(code, `${file} re-binds requireStaff`).not.toMatch(
        /(?:const|let|var|function)\s+requireStaff\b/
      );
      expect(code, `${file} aliases requireStaff`).not.toMatch(
        /\brequireStaff\s+as\s+\w+/
      );
    }
  });

  it("the gate is an UNCONDITIONAL top-level statement in every entry point", async () => {
    // `if (process.env.NODE_ENV !== "production") await requireStaff();` calls
    // the spy under vitest and is off in production — invisible to a
    // behavioural test, and the reason this fence exists.
    for (const file of await gatedFiles()) {
      const bodies = exportedFunctionBodies(sourceOf(file));
      expect(bodies.length, `${file}: no exported entry point found`).toBeGreaterThan(0);

      for (const body of bodies) {
        const gateAt = body.search(GATE_CALL);
        expect(gateAt, `${file}: an exported entry point never awaits the gate`).toBeGreaterThan(-1);

        // Its own statement, on its own line — not a branch tail.
        const line = body.slice(0, gateAt).split("\n").pop()! + body.slice(gateAt).split("\n")[0];
        expect(line.trim(), `${file}: the gate is not a standalone statement`).toMatch(
          /^(?:(?:const|let)\s+(?:\{[^}]*\}|\w+)\s*=\s*)?await\s+requireStaff\s*\(\s*\)\s*;$/
        );

        // …and nothing branches between the entry point and the gate, so the
        // standalone statement above cannot be standalone INSIDE an `if` block.
        expect(
          body.slice(0, gateAt),
          `${file}: the gate sits behind a branch`
        ).not.toMatch(/\b(?:if|else|switch|try|catch|for|while)\s*[({]/);
      }
    }
  });

  it("the gate is the FIRST await — only route props may be read before it", async () => {
    for (const file of await gatedFiles()) {
      for (const body of exportedFunctionBodies(sourceOf(file))) {
        const gateAt = body.search(GATE_CALL);
        const before = body.slice(0, gateAt);
        for (const match of before.matchAll(/\bawait\s/g)) {
          const operand = before.slice(match.index + match[0].length);
          expect(
            ALLOWED_EARLY_AWAIT.test(operand),
            `${file}: "await ${operand.split("\n")[0].trim()}" precedes the gate`
          ).toBe(true);
        }
      }
    }
  });

  /**
   * ⚠ THE FENCE'S EXPORT LIST IS CROSS-CHECKED AGAINST THE MODULE'S RUNTIME
   * `Object.keys`. AN EXPORT THE REGEX COULD NOT SLICE FAILS LOUDLY.
   *
   * This is the structural answer to the whole class of bug the two fixes above
   * are instances of. A regex over source will always have shapes it does not
   * know — the parenless arrow was one, `export { foo }` list-exports are
   * another, and there will be a third — and every one of them was SILENT,
   * because the emptiness guard was satisfied by the exports it COULD see. The
   * runtime module knows exactly which functions it exports. If the fence cannot
   * name one of them, the fence is not covering it, and that is a failure rather
   * than a gap.
   */
  it("the source fence can SEE every function the module actually exports", async () => {
    for (const file of await gatedFiles()) {
      const mod = (await import(/* @vite-ignore */ specifierFor(file))) as Record<
        string,
        unknown
      >;
      const runtime = Object.keys(mod).filter((key) => typeof mod[key] === "function");
      expect(runtime.length, `${file} exports no function at all`).toBeGreaterThan(0);

      const sliced = new Set(exportedFunctionEntries(sourceOf(file)).map((e) => e.name));
      const invisible = runtime.filter((name) => !sliced.has(name));
      expect(
        invisible,
        `${file}: the source fence cannot slice ${invisible.join(", ")} — it is exported and UNCHECKED`
      ).toEqual([]);
    }
  }, IMPORT_TIMEOUT_MS);

  it("every `use server` file under the Lab gates each of its exported actions", async () => {
    // Server Actions do not render through a layout either, and `proxy.ts` does
    // not reliably cover Server Function calls. BEHAVIOURAL, for the same reason
    // as everything above — and paired with the four SOURCE fences, which now
    // iterate these files too. Behavioural alone is not enough here: it runs
    // under NODE_ENV=test, so a production-only bypass calls the spy happily.
    const files = await actionFiles();
    expect(files.length, "the Lab declares no server actions to check").toBeGreaterThan(0);

    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ specifierFor(file))) as Record<
        string,
        unknown
      >;
      const actions = Object.entries(mod).filter(
        ([, value]) => typeof value === "function"
      );
      expect(actions.length, `${file} declares "use server" but exports no action`).toBeGreaterThan(0);

      for (const [name, action] of actions) {
        requireStaffSpy.mockClear();
        try {
          await (action as (...a: unknown[]) => unknown)();
        } catch {
          // See above: only "was the gate reached" is under test.
        }
        expect(
          requireStaffSpy,
          `${file} → ${name}() did not call requireStaff()`
        ).toHaveBeenCalled();
      }
    }
  }, IMPORT_TIMEOUT_MS);
});

// ── The three DISCOVERY holes ────────────────────────────────────────────────

describe("gate discovery covers every shape a Lab endpoint can take", () => {
  it("the globs cover EVERY module extension, not just .ts/.tsx", () => {
    // The `.js` route handler and the `.js` server action both shipped ungated
    // past the old `{ts,tsx}` globs. Asserted on the glob STRINGS, because the
    // expansion cannot prove the absence of a file nobody wrote.
    for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]) {
      expect(LAB_ROUTABLE_GLOB, `routable glob misses .${ext}`).toContain(ext);
      expect(LAB_SOURCE_GLOB, `source glob misses .${ext}`).toContain(ext);
    }
    // …and the routable glob still names every routable convention.
    for (const convention of ["page", "layout", "template", "default", "route"]) {
      expect(LAB_ROUTABLE_GLOB).toContain(convention);
    }
  });

  it("NO `use server` directive sits below module scope anywhere in the Lab", async () => {
    for (const file of await labSourceFiles()) {
      const inline = inlineServerDirectives(readFileSync(`${REPO_ROOT}${file}`, "utf8"));
      expect(
        inline,
        `${file}: a function-scope "use server" is a network-reachable action with its own id, and every check in this file iterates EXPORTED functions — so all five skip it. Declare it in a "use server" module instead.`
      ).toEqual([]);
    }
  });

  it("SEES a function-scope `use server` — the negative fixture", () => {
    // A page with an inline action: exported by nothing, gated by nothing, and
    // invisible to all five checks above.
    expect(
      inlineServerDirectives(
        [
          "export default async function Page() {",
          "  async function purge(id) {",
          '    "use server";',
          "    await danger(id);",
          "  }",
          "  return <form action={purge} />;",
          "}",
        ].join("\n")
      )
    ).toHaveLength(1);
    // …and a genuine module-scope directive is NOT reported.
    expect(
      inlineServerDirectives('"use server";\nexport async function a() { return 1; }')
    ).toEqual([]);
    // Nor is one behind a leading docblock, which every action file here has.
    expect(
      inlineServerDirectives('/** header */\n"use server";\nexport async function a() {}')
    ).toEqual([]);
  });

  /**
   * ⚠ LOCATION IS A HOLE TOO. Everything above is anchored to
   * `app/staff/image-lab/`, so a Lab endpoint written at
   * `app/api/image-lab/generate/route.ts` — where EVERY other API route in this
   * repo lives, which is exactly where an author would put it — inherits none of
   * the Lab's guarantees: not the gate fences, not the service-role walk, not the
   * table allowlist.
   *
   * The cores are the tell. Nothing outside the Lab has any business importing
   * them, so a relocated endpoint reddens here the moment it wires itself up.
   */
  it("NOTHING outside the Lab imports run-core, history-core, reference-core or image-lab-db", async () => {
    const LAB_ONLY = [
      "app/staff/image-lab/lib/run-core",
      "app/staff/image-lab/lib/history-core",
      "app/staff/image-lab/lib/reference-core",
      "app/staff/image-lab/lib/image-lab-db",
    ];
    const sources = await glob(["app/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}", "scripts/**/*.ts"], {
      cwd: REPO_ROOT,
      absolute: false,
    });
    expect(sources.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const raw of sources) {
      const file = raw.replace(/\\/g, "/");
      if (file.startsWith(LAB)) continue;
      const specifiers = ts
        .preProcessFile(readFileSync(`${REPO_ROOT}${file}`, "utf8"), true, true)
        .importedFiles.map((f) => f.fileName);
      for (const specifier of specifiers) {
        // Aliased or relative — normalize both onto a repo-relative suffix.
        const normalized = specifier.replace(/^@\//, "app/").replace(/\\/g, "/");
        if (LAB_ONLY.some((core) => normalized.endsWith(core.slice("app/".length)) &&
            normalized.includes("image-lab"))) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      "a module outside app/staff/image-lab/ imports a Lab core — it inherits NONE of the Lab's gate, service-role or allowlist guarantees"
    ).toEqual([]);
  });
});

// ── Route segment config ─────────────────────────────────────────────────────

describe("Image Lab route segment config (R5a — noindex, force-dynamic)", () => {
  /**
   * Imported for their MODULE-SCOPE exports only. `metadata` and `dynamic` are
   * plain values evaluated at import, so this reads the real exports Next reads
   * rather than a copy of them — the `staff-route.test.ts` technique.
   */
  it("every rendering module declares force-dynamic", async () => {
    // Including the LAYOUT, which gates and reads the session and was the one
    // guarded module in the Lab whose dynamic-ness was neither declared nor
    // pinned. Route handlers are excluded: they are dynamic by default and
    // carry no rendering config.
    const files = (await routableFiles()).filter((f) => !/\/route\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const mod = (await import(/* @vite-ignore */ specifierFor(file))) as Record<
        string,
        unknown
      >;
      expect(mod.dynamic, `${file} must declare force-dynamic`).toBe("force-dynamic");
    }
  }, IMPORT_TIMEOUT_MS);

  it("the layout declares noindex, and no module declares anything weaker", async () => {
    // Next merges `metadata` shallowly from the root segment DOWN, nearest
    // wins. The LAYOUT's declaration is the one that covers every page beneath
    // it — including the bench, which deliberately declares no `metadata` of its
    // own because it would be byte-identical. Without a declaration ANYWHERE
    // under /staff, the root layout's PUBLIC marketing metadata is what a staff
    // surface inherits.
    const layout = (await import("../layout")) as Record<string, unknown>;
    expect((layout.metadata as { robots: unknown }).robots).toEqual({
      index: false,
      follow: false,
    });

    for (const file of await routableFiles()) {
      const mod = (await import(/* @vite-ignore */ specifierFor(file))) as Record<
        string,
        unknown
      >;
      const metadata = mod.metadata as { robots?: unknown } | undefined;
      if (metadata === undefined) continue;
      expect(metadata.robots, `${file} declares metadata without noindex`).toEqual({
        index: false,
        follow: false,
      });
    }
  }, IMPORT_TIMEOUT_MS);
});

// ── The shell renders its own copy ───────────────────────────────────────────

/** `…/image-lab/page.tsx` → "bench"; `…/image-lab/history/page.tsx` → "history". */
const segmentOf = (file: string) => {
  const rest = file.slice(LAB.length).replace(/\/?page\.tsx$/, "");
  return rest === "" ? "bench" : rest.split("/").pop()!;
};

describe("each page renders ITS OWN segment and ITS OWN copy", () => {
  const pageFiles = async () =>
    (await routableFiles()).filter((f) => /\/page\.tsx$/.test(f));

  it("passes the segment its path says it is, and the panel that says so", async () => {
    // The three page files are near-identical copies — exactly the shape where a
    // paste leaves the wrong segment, driving `aria-current` and the active
    // style onto the wrong tab with every test green. The expectation is DERIVED
    // FROM THE PATH, so a fourth segment is covered the day it is added.
    for (const file of await pageFiles()) {
      const segment = segmentOf(file);
      const code = sourceOf(file);
      expect(code, `${file} must pass current="${segment}"`).toContain(
        `current="${segment}"`
      );
      // And the copy constant that belongs to THIS surface. With no jsdom,
      // nothing else in the suite would notice a page rendering another
      // segment's strings — or rendering none at all.
      expect(code, `${file} must render its own copy`).toContain(
        `IMAGE_LAB_${segment.toUpperCase()}_COPY`
      );
      // The shell's entire product until Units 4–6 IS copy on a screen, so the
      // panel that carries it has to be mounted.
      expect(code, `${file} must mount ImageLabPanel`).toMatch(/<ImageLabPanel[\s/>]/);
    }
  });

  it("the bench passes the notice's tone to the panel", async () => {
    // Dropping `tone` renders the generation notice in the NEUTRAL skin — the
    // off state looks exactly like the two informational panels beside it — with
    // every test green.
    const bench = sourceOf(`${LAB}page.tsx`);
    expect(bench).toMatch(/<ImageLabPanel[\s\S]{0,120}?tone=\{notice\.tone\}/);
  });
});

// ── The card and the bench cannot disagree ───────────────────────────────────

describe("the hub card carries the generation state (Unit 3 requirement 4)", () => {
  const HUB = () => sourceOf("app/staff/page.tsx");

  it("links to the Lab", () => {
    expect(HUB()).toMatch(/href="\/staff\/image-lab"/);
  });

  it("BOTH call sites read the same live flag through their pure rule", () => {
    /**
     * The pair is the subject, not either half.
     *
     * `shell-rules.test.ts` proves the two pure functions agree with EACH OTHER
     * for a given boolean; it cannot see what boolean the pages pass. Change the
     * bench to `imageLabGenerationNotice(false)` — a plausible shape while
     * stubbing Units 4–6 — and the whole suite stays green while the hub card
     * reads "Generation is on" and the bench it links to reads "Generation is
     * off". That is precisely the disagreement the pure module exists to
     * prevent, so both call sites are pinned here, together.
     */
    expect(HUB(), "the /staff card must render the live flag").toContain(
      "imageLabCardLine(isImageLabLive())"
    );
    expect(
      sourceOf(`${LAB}page.tsx`),
      "the bench must render the same live flag"
    ).toContain("imageLabGenerationNotice(isImageLabLive())");
  });

  it("reads the flag SERVER-side — no NEXT_PUBLIC_ variant exists anywhere", async () => {
    // The flag is an operational fact about the deployment. A NEXT_PUBLIC_ copy
    // would be a second reader of the same switch, resolved at BUILD time, that
    // could disagree with the server's answer on a warm deploy.
    //
    // Scanned REPO-WIDE, not just `app/**`: `next.config.ts`, `proxy.ts`, and a
    // root `.env*` are all places a build-time public copy would be introduced,
    // and all three were outside the old glob.
    const sources = await glob(
      ["app/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}", "*.{ts,tsx,mjs,js,json}", ".env*"],
      { cwd: REPO_ROOT, absolute: false, dot: true, ignore: ["**/__tests__/**"] }
    );
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.filter((f) =>
      /NEXT_PUBLIC_IMAGE_LAB/.test(readFileSync(`${REPO_ROOT}${f}`, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});

describe("the extractor the four source fences depend on", () => {
  /**
   * ⚠ A FENCE THAT CANNOT SEE AN EXPORT IS NOT A FENCE. `exportedFunctionBodies`
   * required the `async` keyword, so an exported NON-async function in a
   * `"use server"` module was invisible to every source assertion above — while
   * remaining a network-reachable POST endpoint. Worse, the emptiness guard
   * (`bodies.length > 0`) passed on its async SIBLINGS' behalf, so the hole was
   * silent. These fixtures are what keep the extractor honest.
   */
  const fixture = [
    'export async function alpha(input?: unknown) {',
    "  await requireStaff();",
    "  return input;",
    "\n}",
    "",
    "export function beta(input?: unknown) {",
    "  return Promise.resolve(input);",
    "\n}",
    "",
    "export const gamma = async (input?: unknown) => {",
    "  await requireStaff();",
    "  return input;",
    "\n}",
    "",
    "export const delta = (input?: unknown) => {",
    "  return Promise.resolve(input);",
    "\n}",
  ].join("\n");

  it("sees an exported NON-async function and a non-async arrow, not only the async ones", () => {
    const bodies = exportedFunctionBodies(fixture);
    expect(bodies).toHaveLength(4);
    // The two that used to be invisible are the two with no gate in them.
    const ungated = bodies.filter((body) => !GATE_CALL.test(body));
    expect(ungated).toHaveLength(2);
  });

  it("still reports EVERY body, so one gated sibling cannot vouch for the file", () => {
    const gated = exportedFunctionBodies(fixture).filter((body) => GATE_CALL.test(body));
    expect(gated).toHaveLength(2);
    expect(gated.length).toBeLessThan(exportedFunctionBodies(fixture).length);
  });

  // ── NEGATIVE FIXTURES for the two shapes that shipped past this fence ──────

  /**
   * ⚠ THE PARENLESS ASYNC ARROW. VERIFIED to pass all 39 tests while being an
   * ungated network-reachable POST in production, because the extractor matched
   * NOTHING for it and the gated sibling satisfied the emptiness guard.
   */
  const parenless = [
    "export const gated = async (input?: unknown) => {",
    "  await requireStaff();",
    "  return input;",
    "\n}",
    "",
    "export const wideOpen = async input => {",
    '  if (process.env.NODE_ENV !== "production") {',
    "    await requireStaff();",
    "  }",
    "  return danger(input);",
    "\n}",
    "",
    "export const concise = async input => danger(input);",
  ].join("\n");

  it("SEES a parenless async arrow, and reports it as ungated at the top level", () => {
    const entries = exportedFunctionEntries(parenless);
    expect(entries.map((e) => e.name)).toEqual(["gated", "wideOpen", "concise"]);

    const wideOpen = entries.find((e) => e.name === "wideOpen")!;
    // The gate IS in the body — behind a branch. The unconditional fence reads
    // what precedes it, and what precedes it is an `if`.
    expect(wideOpen.body).toMatch(GATE_CALL);
    expect(wideOpen.body.slice(0, wideOpen.body.search(GATE_CALL))).toMatch(
      /\b(?:if|else|switch|try|catch|for|while)\s*[({]/
    );

    // A CONCISE body cannot hold a standalone gate statement, so it is reported
    // as an empty body and reddens the fence rather than being skipped.
    expect(entries.find((e) => e.name === "concise")!.body).toBe("");
  });

  it("the cross-check NAMES an export the regex cannot slice — `export { foo }`", () => {
    // List-exports are invisible to the head regex in exactly the way the
    // parenless arrow was. The runtime `Object.keys` cross-check is what turns
    // that from a silent gap into a failure.
    const listExport = [
      "async function hidden(input?: unknown) {",
      "  return input;",
      "\n}",
      "",
      "export { hidden };",
    ].join("\n");
    const sliced = new Set(exportedFunctionEntries(listExport).map((e) => e.name));
    expect(sliced.has("hidden")).toBe(false);
    // …which is precisely what the production cross-check asserts on: a runtime
    // export named `hidden` with no slice by that name.
    expect(["hidden"].filter((name) => !sliced.has(name))).toEqual(["hidden"]);
  });

  it("still names a default export and an ordinary declaration", () => {
    const names = exportedFunctionEntries(
      [
        "export default async function Page(props) {",
        "  await requireStaff();",
        "\n}",
        "",
        "export async function POST(request) {",
        "  await requireStaff();",
        "\n}",
      ].join("\n")
    ).map((e) => e.name);
    expect(names).toEqual(["default", "POST"]);
  });
});
