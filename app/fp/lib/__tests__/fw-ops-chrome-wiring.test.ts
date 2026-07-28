import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

const ROW = stripComments(read("../../fw/components/FwOpsTabRow.tsx"));
const CHROME = stripComments(read("../../fw/components/FwOpsChrome.tsx"));
const PANEL = stripComments(read("../../fw/components/FwOpsCreatePanel.tsx"));
const MENU = stripComments(read("../../fw/components/FwOpsRowMenu.tsx"));
const ARCHIVE_CONTROL = stripComments(read("../../fw/components/FwArchiveControl.tsx"));
const LAYOUT = stripComments(read("../../fw/(app)/ops/layout.tsx"));
const PAGE = stripComments(read("../../fw/(app)/ops/page.tsx"));

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
