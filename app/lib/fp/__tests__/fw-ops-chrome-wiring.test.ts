import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { fwOpsSectionChips } from "../fw-ops-rules";

/**
 * The ops tab row's WIRING (ops redesign Unit 1) — properties of the source that
 * no behavioural test in this repo can reach. `environment: "node"` with no
 * jsdom means components are never rendered, so the decisions settled in
 * planning are asserted where they live: in the files. Same discipline as
 * `app/lib/staff-bar/__tests__/bar-wiring.test.ts`, whose docblock records the
 * two lessons these follow — anchor on semantics, never on a spelling you
 * happened to choose, and never pin formatting a reformat would redden.
 *
 * Resolved relative to THIS FILE, never `process.cwd()`: a scan that reads the
 * wrong file (or no file) is worse than no scan, because it passes.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file://${dir}`), "utf8");

/**
 * Comment-stripped before matching. These files are heavily commented BY DESIGN,
 * and the comments name the very things being scanned for — the sticky offset,
 * the archived param, the + seam — because they explain why the code does what
 * it does. A scan over raw source cannot tell a comment from a call.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROW = stripComments(read("../../../fp/fw/components/FwOpsTabRow.tsx"));
const CHROME = stripComments(read("../../../fp/fw/components/FwOpsChrome.tsx"));
const PANEL = stripComments(read("../../../fp/fw/components/FwOpsCreatePanel.tsx"));
const MENU = stripComments(read("../../../fp/fw/components/FwOpsRowMenu.tsx"));
const ARCHIVE_CONTROL = stripComments(read("../../../fp/fw/components/FwArchiveControl.tsx"));
const LAYOUT = stripComments(read("../../../fp/fw/(app)/ops/layout.tsx"));
const PAGE = stripComments(read("../../../fp/fw/(app)/ops/page.tsx"));
const COHORT_PAGE = stripComments(read("../../../fp/fw/(app)/ops/cohort/[cohortId]/page.tsx"));
const SECTION_NAV = stripComments(read("../../../fp/fw/components/FwOpsSectionNav.tsx"));
const INLINE_DECISION = stripComments(read("../../../fp/fw/components/FwInlineDecision.tsx"));
const WINDOW_EDIT = stripComments(read("../../../fp/fw/components/FwWindowEdit.tsx"));

describe("the row keeps the sticky-offset contract it inherited from the old header", () => {
  it("is sticky under the bar's published height, with the 0px fallback", () => {
    // Two sticky headers both claiming `top: 0` do not stack — the bar (z-30)
    // simply paints over this row. The `0px` fallback is the named rollback:
    // unmount the bar and the row behaves as a plain top-of-page header. The
    // offset must ride a STICKY element — `top` on a statically-positioned one
    // is inert, which is the shape of the mistake worth catching.
    expect(ROW).toMatch(/sticky\s+top-\[var\(--staff-bar-h,\s*0px\)\]/);
  });
});

describe("the archived toggle is URL state, not client state", () => {
  it("reads the param the list page reads, and flips ?archived=1 via a Link", () => {
    // A query param, not useState: the filtered view is shareable and survives
    // a reload — the settled Unit 9 decision the ops page records. The row must
    // read the SAME spelling the page reads, or the toggle silently filters
    // nothing.
    expect(ROW).toMatch(/searchParams\.get\(\s*"archived"\s*\)/);
    expect(ROW).toMatch(/\?archived=1/);
    expect(PAGE).toMatch(/archived\s*===\s*"1"/);
  });

  it("the page's own toggle link is gone — one toggle, in the row", () => {
    // Unit 1 removed the "Show archived weekends" text link. Two toggles for
    // one param is how they drift; the page only READS the param now.
    expect(PAGE).not.toMatch(/href=[\s\S]{0,60}archived=1/);
  });
});

describe("the guide-view escape hatch survives the redesign", () => {
  it("links to /fp/fw", () => {
    // The one path from the staff surface back to the guide surface. The old
    // header carried it; the row must not lose it.
    expect(ROW).toMatch(/href="\/fp\/fw"/);
  });
});

describe("the + control sits OUTSIDE the scrollable pill region", () => {
  it("renders after the overflow-x-auto nav closes, so 375px cannot scroll it away", () => {
    // The nav meets the survive-at-375px contract by scrolling horizontally; a
    // create control inside it can scroll off the right edge, and a control
    // that has scrolled off-screen does not exist. Structural, not visual (no
    // jsdom): the scroll region must close before the control appears.
    const scrollRegion = ROW.indexOf("overflow-x-auto");
    const navClose = ROW.indexOf("</nav>");
    const createControl = ROW.indexOf('aria-label="New weekend"');
    expect(scrollRegion).toBeGreaterThan(0);
    expect(navClose).toBeGreaterThan(scrollRegion);
    expect(createControl).toBeGreaterThan(navClose);
  });

  it("the + is a real client seam now — no Link fallback, no dead anchor (Unit 2)", () => {
    // Unit 2 closed Unit 1's seam: the shell always passes `onCreateClick`, so
    // the `#new-weekend` fallback Link was deleted WITH its anchor. A surviving
    // reference on either side would be a link to nowhere.
    expect(ROW).toMatch(/onCreateClick/);
    expect(ROW).not.toMatch(/#new-weekend/);
    expect(PAGE).not.toMatch(/new-weekend/);
  });
});

describe("the +/create-panel seam (Unit 2)", () => {
  it("the shell mounts the row WITH the handler and shares the flag via context", () => {
    // The row and the panel need a common client parent; the shell is it. The
    // row must receive the handler (its prop is required — a bare mount is a
    // compile error, pinned here as source anyway) and the panel must consume
    // the same context the shell provides.
    expect(CHROME).toMatch(/<FwOpsTabRow\s+onCreateClick=/);
    expect(CHROME).toMatch(/FwOpsCreateContext\.Provider/);
    expect(PANEL).toMatch(/useFwOpsCreate\(\)/);
  });

  it("the page no longer renders an always-visible create form — the panel owns it", () => {
    // The Unit 1 "New weekend" section is gone; `FwCohortCreate` mounts ONLY
    // inside the collapsible panel. A second, always-visible mount would undo
    // the redesign's point.
    expect(PAGE).not.toMatch(/<FwCohortCreate/);
    expect(PAGE).toMatch(/<FwOpsCreatePanel\s*\/>/);
    expect(PANEL).toMatch(/<FwCohortCreate[\s/>]/);
  });

  it("on success the panel collapses and links to the new weekend", () => {
    // `createFwCohortAction` returns the cohortId for exactly this: "created"
    // is half the job, and the other half (guides, board link) lives on the
    // cohort's ops page.
    expect(PANEL).toMatch(/setOpen\(false\)/);
    expect(PANEL).toMatch(/\/fp\/fw\/ops\/cohort\/\$\{created\.cohortId\}/);
  });
});

describe("the typed archive confirm travels to the server (Unit 2)", () => {
  it("both archive surfaces SEND confirmSlug — the client match is UX, not the boundary", () => {
    // The action schema requires `confirmSlug` and the core re-verifies it
    // against the stored slug. A surface that stops sending it does not
    // quietly weaken the confirm — it breaks archive outright; this pin makes
    // the breakage a red test naming the contract.
    expect(ARCHIVE_CONTROL).toMatch(/archiveCohortAction\(\{\s*cohortId,\s*confirmSlug:\s*typed\s*\}\)/);
    expect(MENU).toMatch(/archiveCohortAction\(\{\s*cohortId,\s*confirmSlug:\s*typed\s*\}\)/);
  });

  it("restore stays confirm-free — it is not destructive", () => {
    expect(MENU).toMatch(/unarchiveCohortAction\(\{\s*cohortId\s*\}\)/);
  });

  it("delete sends the SAME typed confirm (Unit 3) and is gated on the untouched flag", () => {
    // The delete confirm shares archive's rule and posture: typed slug sent to
    // the action, re-verified in the core. The menu item itself only renders
    // when the row's `untouched` flag — the shared classifier's verdict — is
    // true, so the affordance and the act cannot drift.
    expect(MENU).toMatch(/deleteCohortAction\(\{\s*cohortId,\s*confirmSlug:\s*typed\s*\}\)/);
    expect(MENU).toMatch(/\{untouched\s*&&/);
  });
});

describe("the ops layout renders the chrome and keeps its gate", () => {
  it("mounts FwOpsChrome, which mounts the row — the chrome moved again, it did not disappear", () => {
    // Unit 2: the layout renders the client shell (it cannot pass the + a
    // function itself), and the shell renders the row. Both hops pinned so
    // neither mount can be deleted alone.
    expect(LAYOUT).toMatch(/<FwOpsChrome[\s>]/);
    expect(CHROME).toMatch(/<FwOpsTabRow[\s/>]/);
  });

  it("still gates on the cohort-free staff resolver, refusing as a 404", () => {
    // The layout is not load-bearing for authorization (Next 16 layouts do not
    // re-render on navigation; pages and actions re-gate), but stripping the
    // gate would still hand every guide the staff chrome on first mount — and
    // `notFound()` is the refusal shape: to a guide, /fp/fw/ops is not a page.
    expect(LAYOUT).toMatch(/resolveFwStaffGate\(\)/);
    expect(LAYOUT).toMatch(/notFound\(\)/);
  });
});

describe("the cohort page's section nav (redesign Unit 6, R16)", () => {
  /** Every `id="fw-ops-…"` the page's SOURCE carries — the archived page
   *  renders a subset of these, which the derivation (not the source) decides. */
  const pageIds = [...COHORT_PAGE.matchAll(/id="fw-ops-([a-z]+)"/g)].map((m) => m[1]);

  /** All-ok fixture: presence is decided by `archived` alone, so healthy inputs
   *  are enough for parity — chips are the rules suite's business. */
  const entriesFor = (archived: boolean) =>
    fwOpsSectionChips({
      archived,
      board: { ok: true, status: "live" },
      guides: { ok: true, guides: [] },
      replays: { ok: true, openCount: 0 },
      importExceptions: { ok: true, openCount: 0 },
      students: { ok: true, count: 0 },
    });

  it("every section id on the page has a nav entry, and vice versa (parity)", () => {
    // THE pin that reddens when someone adds a ninth section without a nav
    // entry — or a nav entry without a section. The page's source ids are the
    // full (active-weekend) set; the derivation's active output must equal it.
    expect(pageIds.length).toBe(8);
    expect(new Set(pageIds)).toEqual(new Set(entriesFor(false).map((e) => e.key)));
  });

  it("the archived nav is a strict subset of the page's ids — no anchor to nowhere", () => {
    for (const entry of entriesFor(true)) {
      expect(pageIds).toContain(entry.key);
    }
  });

  it("the nav's anchors and focus lookups both target the same fw-ops- ids", () => {
    // The component builds hrefs and its getElementById from one prefix +
    // entry.key — a drifted spelling on either side breaks the jump silently.
    expect(SECTION_NAV).toMatch(/const ID_PREFIX = "fw-ops-"/);
    expect(SECTION_NAV).toMatch(/href=\{`#\$\{ID_PREFIX\}\$\{entry\.key\}`\}/);
    expect(SECTION_NAV).toMatch(/getElementById\(`\$\{ID_PREFIX\}\$\{key\}`\)/);
  });

  it("the page mounts the nav with the derived entries", () => {
    expect(COHORT_PAGE).toMatch(/<FwOpsSectionNav\s+entries=\{navEntries\}/);
    expect(COHORT_PAGE).toMatch(/fwOpsSectionChips\(\{/);
  });

  it("the nav is sticky under the staff-bar + tab-row stack", () => {
    // The offset must ride a sticky element (top on a static one is inert) and
    // must clear BOTH layers above: the bar's published var (with its 0px
    // rollback fallback) plus the tab row's documented 61px constant.
    expect(SECTION_NAV).toMatch(/className="sticky /);
    expect(SECTION_NAV).toMatch(/const TAB_ROW_H = 61/);
    expect(SECTION_NAV).toMatch(
      /top: `calc\(var\(--staff-bar-h, 0px\) \+ \$\{TAB_ROW_H\}px\)`/
    );
  });

  it("jumps move FOCUS to the heading, and the headings can take it", () => {
    // The a11y half of R16's one-interaction requirement: a plain anchor
    // scrolls but leaves focus behind, so Tab lands back at the top. The nav
    // focuses the target; the page's h2s carry tabIndex={-1} to accept it.
    expect(SECTION_NAV).toMatch(/target\.focus\(\{ preventScroll: true \}\)/);
    expect(COHORT_PAGE).toMatch(/tabIndex=\{-1\}/);
  });

  it("sections carry scroll-margin-top so a jumped-to heading clears the sticky chrome", () => {
    expect(COHORT_PAGE).toMatch(/scroll-mt-\[calc\(var\(--staff-bar-h,0px\)\+112px\)\]/);
  });

  it("sections stay fully rendered — no accordion, tabs, or lazy mounts (R16's constraint)", () => {
    // The chips' honesty depends on the nav and the sections rendering from one
    // load; an accordion or lazy mount would reintroduce the second read R16
    // forbids. `force-dynamic` is rendering-mode config, not a lazy mount, and
    // is excluded by matching the import forms specifically.
    expect(COHORT_PAGE).not.toMatch(/<details|<Tabs|Accordion/);
    expect(COHORT_PAGE).not.toMatch(/next\/dynamic|React\.lazy|import\(/);
    // The nav itself holds no open/closed state — it is a strip, not a menu.
    expect(SECTION_NAV).not.toMatch(/useState/);
  });
});

describe("the composed flip's client ids survive a leg-1 settle (redesign Unit 9)", () => {
  /** runFlip's whole body, bounded by the neighbouring declarations — the flip
   *  is the only place both leg ids and both enqueue paths live. */
  const runFlip = INLINE_DECISION.slice(
    INLINE_DECISION.indexOf("const runFlip"),
    INLINE_DECISION.indexOf("const onTap")
  );

  it("derives BOTH per-leg ids before the try, and the catch never re-derives one", () => {
    // Leg 1's settle() releases the undo key. A catch that calls
    // `ledger.idsFor` after that mints a NEW undo id, so the backstop-enqueued
    // pair carries a key the drain has never seen for the landed undo — the
    // pair is rejected and the not_yet is lost. The ids must be held ONCE,
    // above the try, and the catch must reuse those exact ids.
    expect(runFlip.length).toBeGreaterThan(0);
    const tryAt = runFlip.indexOf("try {");
    expect(tryAt).toBeGreaterThan(0);
    const derivations = [...runFlip.matchAll(/ledger\.idsFor\(/g)].map((m) => m.index ?? -1);
    expect(derivations.length).toBe(2);
    for (const at of derivations) expect(at).toBeLessThan(tryAt);
    const catchAt = runFlip.indexOf("} catch");
    expect(catchAt).toBeGreaterThan(tryAt);
    expect(runFlip.slice(catchAt)).not.toContain("idsFor");
  });

  it("every flip enqueue goes through the per-leg-tuple entry point", () => {
    // `enqueueFwFlip` is the ordered two-leg tuple the drain replays with
    // halt-on-first-non-settle; `enqueueFwCheckIns` enqueues independent
    // singles with no ordering, which for a flip can land the not_yet without
    // its undo. The flip path must never reach for the single-action door.
    expect(runFlip).toMatch(/enqueueFwFlip\(\{/);
    expect(runFlip).not.toMatch(/enqueueFwCheckIns\(/);
  });
});

describe("the window editor's re-mint names the token it means to replace (Unit 4)", () => {
  it("passes expectedTokenId from the live-token prop into the action call", () => {
    // The CAS the core threads through the mint sequence: naming the token the
    // page was LOOKING AT is what turns a concurrent re-mint into a
    // `stale_view` refusal instead of a blind revoke of somebody else's fresh
    // link. Dropping the field — or wiring anything but the live-token prop
    // into it — silently degrades the re-mint to exactly that blind revoke.
    expect(WINDOW_EDIT).toMatch(
      /remintBoardTokenForWindowAction\(\{[\s\S]{0,160}?expectedTokenId:\s*liveTokenId/
    );
  });
});
