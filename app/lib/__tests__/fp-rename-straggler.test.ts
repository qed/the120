import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Unit 10 straggler catcher (FW-D7/FW-R30) — the PROOF that the whole-app
 * `/path` → `/fp` rename left nothing behind.
 *
 * A rename's silent failure mode is a missed reference: an import specifier the
 * sweep skipped, a route literal in a shell nobody re-read, a proxy prefix left
 * pointing at the old tree. This test is a real repo-wide scanner, not a spot
 * check — it reads every tracked source file and asserts two invariants that,
 * broken, become a 404 or a dead import in production.
 *
 * It is deliberately written to go RED on a planted straggler (drop a
 * `@/app/path/x` import or a `"/path/x"` literal into any scanned file and this
 * reddens) and GREEN only on the full, NAMED allowlist below — never a regex
 * weakened ad hoc mid-commit.
 *
 * ── Check 1: zero `@/app/path/` import specifiers ──────────────────────────────
 * The directory moved to app/fp, so every module specifier must resolve there.
 *
 * ── Check 2: `/path` route-boundary literals reduced to a named allowlist ──────
 * A "route-boundary /path literal" is `/path` immediately followed by `/`, a
 * quote (" ' `), `?`, or end-of-line — i.e. the shapes a URL/route takes. This
 * deliberately does NOT match `/path-notifications` (cron, hyphen),
 * `/path.webmanifest` (the manifest file, dot), `/path-icon-192.png` (asset,
 * hyphen), or the internal IDB/SW names `path-offline-queue` / `path-sw-*` /
 * `path-skip-waiting` / `path-drain` / `fw-offline-queue` (no leading slash) —
 * all of which are KEPT STABLE because renaming them orphans installed queues
 * and caches for zero user value.
 *
 * The only survivors permitted:
 *   - FILE allowlist: docs/**, artifacts/**, supabase/migrations/**, and every
 *     *.md — documentation and immutable migration history that reference the old
 *     path as prose or as the record of what shipped.
 *   - CONTENT allowlist: the ONE live `/path` route literal — the 308 redirect
 *     source in next.config.ts (`/path/:path*` → `/fp/:path*`), which is the
 *     whole mechanism by which old links still resolve.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

// This test file itself necessarily contains both patterns (as the thing it
// searches for), so it must never scan itself.
const SELF = "app/lib/__tests__/fp-rename-straggler.test.ts";

// Directories whose contents are documentation or immutable history — the old
// `/path` name legitimately survives there as prose or as the shipped record.
const ALLOWED_DIR_PREFIXES = ["docs/", "artifacts/", "supabase/migrations/"];

// Binary / asset files are never route-or-import carriers; skip by extension so
// a stray byte sequence can never false-positive the scan.
const SKIP_EXTS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".mp4", ".webm", ".mov", ".zip", ".gz",
  ".md", // markdown is documentation — allowlisted with docs/
];

// The named CONTENT allowlist — the ONLY `/path` route literals permitted in
// scanned source, each QUOTED and capped at the EXACT count of times it may
// appear in its file. Two kinds only:
//   1. next.config.ts — the 308 redirect SOURCE, the one live old-path literal.
//   2. proxy-rules.test.ts — the rename's OWN regression tests, which MUST name
//      the old URLs to assert the proxy matcher no longer covers them and the
//      redirect map still maps them. These are the rename's guardrails.
// The exemption is COUNT-BOUNDED, not a blanket per-file string strip: Check 2
// removes at most `count` occurrences of each literal, so a DUPLICATE or reused
// occurrence beyond the cap — a second bogus `/path/:path*` redirect, or a new
// stray `matches("/path")` — still reddens. The freshness check pins each
// literal to EXACTLY `count`, so a deleted guardrail (a now-dead entry) reddens
// too, rather than silently weakening the scan.
const CONTENT_ALLOWLIST: { file: string; literal: string; count: number }[] = [
  { file: "next.config.ts", literal: '"/path/:path*"', count: 1 },
  { file: "app/crm/__tests__/proxy-rules.test.ts", literal: '"/path/:path*"', count: 1 },
  { file: "app/crm/__tests__/proxy-rules.test.ts", literal: '"/path"', count: 1 },
  { file: "app/crm/__tests__/proxy-rules.test.ts", literal: '"/path/task/1.2.4"', count: 1 },
  { file: "app/crm/__tests__/proxy-rules.test.ts", literal: '"/path/fw/board/tok"', count: 1 },
];

// `/path` followed by a route boundary: `/`, a quote (" ' `), `?`, or end-of-line.
const ROUTE_BOUNDARY = /\/path(?=[/"'`?]|$)/g;
const IMPORT_SPECIFIER = "@/app/path/";

function scannedFiles(): string[] {
  const out = execSync("git ls-files -z", { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => f !== SELF)
    .filter((f) => !ALLOWED_DIR_PREFIXES.some((d) => f.startsWith(d)))
    .filter((f) => !SKIP_EXTS.some((e) => f.toLowerCase().endsWith(e)));
}

const FILES = scannedFiles();

describe("Unit 10 straggler catcher — /path → /fp is complete", () => {
  it("scans a non-trivial set of tracked source files (the scan must not silently no-op)", () => {
    // If git ls-files ever returns nothing (wrong cwd, no git), fail loudly here
    // rather than letting both checks pass vacuously over an empty set.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("Check 1: zero `@/app/path/` import specifiers remain in source", () => {
    const stragglers: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (line.includes(IMPORT_SPECIFIER)) stragglers.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(stragglers, `Found ${IMPORT_SPECIFIER} import stragglers:\n${stragglers.join("\n")}`).toEqual([]);
  });

  it("Check 2: `/path` route-boundary literals reduced to the count-bounded allowlist", () => {
    const stragglers: string[] = [];
    for (const file of FILES) {
      // Per-file remaining budget: at most `count` occurrences of each literal
      // are exempt. A reused/duplicate occurrence exhausts the budget and flags.
      const budget = new Map<string, number>();
      for (const a of CONTENT_ALLOWLIST) {
        if (a.file === file) budget.set(a.literal, (budget.get(a.literal) ?? 0) + a.count);
      }
      const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        let scan = line;
        for (const [lit, remaining] of budget) {
          let rem = remaining;
          while (rem > 0 && scan.includes(lit)) {
            scan = scan.replace(lit, ""); // string arg → removes one (first) occurrence
            rem--;
          }
          budget.set(lit, rem);
        }
        // String.match with a global regex ignores lastIndex — safe to reuse across lines.
        if (scan.match(ROUTE_BOUNDARY)) stragglers.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(stragglers, `Found /path route-literal stragglers (outside the count-bounded allowlist):\n${stragglers.join("\n")}`).toEqual([]);
  });

  it("every allowlist entry is present at its EXACT count (no stale or duplicate exemption)", () => {
    // A dead entry (count below expected) silently weakens the scan; a duplicate
    // (count above expected) is a straggler Check 2 also catches. Pinning the
    // exact count closes both directions and keeps the allowlist honest.
    for (const a of CONTENT_ALLOWLIST) {
      const src = readFileSync(resolve(REPO_ROOT, a.file), "utf8");
      const occurrences = src.split(a.literal).length - 1;
      expect(
        occurrences,
        `${a.file} should contain exactly ${a.count}× ${a.literal}, found ${occurrences}`
      ).toBe(a.count);
    }
    // …and the redirect maps to the right destination, not just that a source exists.
    const nextConfig = readFileSync(resolve(REPO_ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).toContain('destination: "/fp/:path*"');
  });
});
