import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";

/**
 * Unit 2 of the unified-application-flow plan (R4): the parent-facing rename
 * of the old word for the admissions form → "application" must be COMPLETE,
 * and must STAY complete. This is the straggler catcher, following the
 * route-rename playbook
 * (docs/solutions/best-practices/route-rename-boundary-sweep-and-count-
 * bounded-straggler-catcher-2026-07-24.md): scan every parent-facing source,
 * subtract a named, COUNT-BOUNDED allowlist, and pin each allowlisted file to
 * its exact count so a dead entry reddens just like a new straggler does.
 *
 * Scope boundaries (deliberate, from the plan):
 *  - `app/crm/**` is EXCLUDED — staff surfaces keep the old vocabulary.
 *  - Comments are stripped before scanning — they are not parent-visible,
 *    and code identifiers (DossierEditor, dossierCompleteness,
 *    continue_dossier, dossier_submitted_at …) never match the boundary
 *    regex because a word character abuts the term. What the scan catches is
 *    exactly the rendered-string / standalone-literal contexts.
 *  - Funnel session-intent discriminants, nurture template keys, and the
 *    staff-recipient surfaces below legitimately keep the term; each is
 *    allowlisted WITH ITS COUNT and a reason.
 *
 * NOTE for future editors: per the playbook's aftermath section, this
 * scanner reads raw (comment-stripped) source and cannot tell a fixture from
 * a straggler. If new work trips it with a legitimate staff-facing or
 * code-key literal, extend the allowlist with an exact count and a reason —
 * never widen an existing entry for convenience.
 */

const ROOT = process.cwd();

/** Same comment-strip as site-deadline.test.ts: block comments plus
 *  whole-line `//` comments (trailing-URL-safe). String contents survive. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The boundary regex: the term as a standalone word, singular or plural,
 *  any case. Identifiers like `dossierNext` / `continue_dossier` don't
 *  match; string literals, JSX text, and template keys do. */
const TERM = /\bdossiers?\b/gi;

const countMatches = (src: string): number => src.match(TERM)?.length ?? 0;

/**
 * Every hit that is ALLOWED to remain, per file, with its exact count.
 * Anything not listed here must have zero hits.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; count: number; reason: string }> = [
  {
    file: "app/api/notify-submission/route.ts",
    count: 6,
    reason:
      "Staff-recipient email (to admissions@) + /crm/dossiers deep link + " +
      "an API error string no parent UI renders — staff vocabulary stays.",
  },
  {
    file: "app/staff/page.tsx",
    count: 1,
    reason: "Staff front door prose — staff-facing surface keeps the term.",
  },
  {
    file: "app/lib/funnel/session-rules.ts",
    count: 2,
    reason:
      "The dashboard session-target intent discriminant `\"dossier\"` " +
      "(type union + constructor) — a code key, not copy; renaming it is a " +
      "behavior change out of Unit 2's scope.",
  },
  // app/dashboard/data.ts is no longer allowlisted (v3 Unit 9): its single hit
  // was the `next.intent === "dossier"` guard inside the `submittedPlus`
  // computation, and `submittedPlus` existed only to decide whether a card
  // carried the v2 review-walk link. That link retired with the v2 flow, the
  // guard went with it, and the file is now a genuine ZERO — which the
  // straggler sweep above enforces from here on.
  {
    file: "app/lib/v3-signup/remap-rules.ts",
    count: 2,
    reason:
      "The v2→v3 remap table's KEY for that same intent discriminant " +
      "(`ChildNextKey` member + its table row). The key is `surface.intent` " +
      "by construction, so it is spelled by session-rules' union, not chosen " +
      "here — a code key no parent ever sees.",
  },
  {
    file: "app/lib/nurture/rules.ts",
    count: 2,
    reason:
      "Nurture template KEY `account-dossier-nudge` (type union + schedule " +
      "row) — a stable identifier persisted in nurture_sends, never rendered.",
  },
  {
    file: "app/lib/nurture/copy.ts",
    count: 1,
    reason: "The `case \"account-dossier-nudge\"` arm for that same key.",
  },
];

/** Parent-facing source universe: everything under app/ EXCEPT the staff CRM
 *  and the test trees. CSS included (class names/prose could leak copy). */
const FILES: ReadonlyArray<string> = globSync(["app/**/*.{ts,tsx,css}"], {
  cwd: ROOT,
  absolute: false,
})
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => !f.startsWith("app/crm/") && !f.includes("__tests__"));

const SOURCES: ReadonlyMap<string, string> = new Map(
  FILES.map((f) => [f, stripComments(readFileSync(path.resolve(ROOT, f), "utf8"))])
);

describe("R4 straggler catcher: parent-facing sources carry no stray 'dossier'", () => {
  it("scans a sane universe (the glob did not silently go empty)", () => {
    expect(FILES.length).toBeGreaterThan(100);
    // The boundary regex's own sanity: identifiers must NOT match.
    expect(countMatches("DossierEditor dossierNext continue_dossier dossier_submitted_at")).toBe(0);
    expect(countMatches('label "Dossier" and plural dossiers and a-dossier-key')).toBe(3);
  });

  it("every non-allowlisted parent-facing file has ZERO hits", () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file));
    const stragglers: string[] = [];
    for (const [file, src] of SOURCES) {
      if (allowed.has(file)) continue;
      const n = countMatches(src);
      if (n > 0) stragglers.push(`${file}: ${n} hit(s)`);
    }
    expect(stragglers, "parent-facing 'dossier' stragglers — rename to 'application' or allowlist with a count+reason").toEqual([]);
  });

  it("each allowlisted file has EXACTLY its pinned count (freshness — a dead entry or a piggybacked reuse both redden)", () => {
    for (const a of ALLOWLIST) {
      const src = SOURCES.get(a.file);
      expect(src, `${a.file} is allowlisted but was not scanned — moved or deleted? Update the allowlist.`).toBeDefined();
      expect(countMatches(src!), `${a.file} — ${a.reason}`).toBe(a.count);
    }
  });

  it("app/crm is genuinely out of scope, not accidentally empty of the term (the staff vocabulary survives)", () => {
    // A cheap tripwire that the exclusion boundary still means something: the
    // CRM tree keeps using the old term. If this ever hits zero, someone
    // renamed staff surfaces too — which the plan explicitly forbids.
    const crmFiles = globSync(["app/crm/**/*.{ts,tsx}"], { cwd: ROOT, absolute: false })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => !f.includes("__tests__"));
    let crmHits = 0;
    for (const f of crmFiles) {
      crmHits += countMatches(stripComments(readFileSync(path.resolve(ROOT, f), "utf8")));
    }
    expect(crmHits).toBeGreaterThan(0);
  });
});
