import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glob } from "tinyglobby";

/**
 * The properties of the WIRING that no behavioural test in this repo can reach.
 *
 * `environment: "node"` with no jsdom means components cannot be rendered, so a few
 * requirements are properties OF a file rather than of the pure rules it composes —
 * R23's unconditional sign-out, the settled decision that no role-derived value
 * arrives as a server prop, and the invariant that exactly one module reconciles the
 * device's cache owner. A property with no assertion survives exactly until someone
 * refactors past it, so they are asserted where they live: in the source.
 *
 * ── Two lessons from this unit's own review are baked into how these are written ──
 *
 * 1. **Anchor on semantics, not on a spelling you happened to choose.** The first
 *    draft's R23 check rejected the literals `identity &&` and `identity ?`, and a
 *    reviewer walked straight through it with `{Boolean(identity) && <button …>}` — a
 *    real R23 regression. These now use whitespace-tolerant patterns over the whole
 *    identifier, not two anticipated spellings.
 * 2. **Do not pin formatting.** The first draft asserted an exact single-line call
 *    including argument spacing, which reddened on a no-op reformat. A source scan
 *    that cries wolf gets deleted, and then it protects nothing.
 *
 * Resolved relative to THIS FILE, never `process.cwd()` — the working directory is a
 * property of how the runner was invoked, and a scan that reads the wrong file (or no
 * file) is worse than no scan, because it passes.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file://${dir}`), "utf8");
/** `app/lib/staff-bar/__tests__/` → the repo root. Four levels, from THIS file. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${dir}`));

/**
 * Every production source file under `app/`, comment-stripped, keyed by repo path.
 *
 * Tests are EXCLUDED, and not for convenience: the scans below look for symbols by
 * name, and this file necessarily names the very symbols it is asserting the absence
 * of. Stripping comments does not help — they appear inside string literals here, as
 * arguments. The question the scans actually ask is "does any shipped surface still
 * reach this?", which is a question about production code.
 */
const productionSources = async (): Promise<Map<string, string>> => {
  const files = await glob(["app/**/*.ts", "app/**/*.tsx"], {
    cwd: REPO_ROOT,
    absolute: false,
    dot: false,
    ignore: ["**/__tests__/**"],
  });
  // An empty expansion would make every "is it gone?" assertion below pass vacuously,
  // which is the one failure mode a scan like this must not have.
  expect(files.length).toBeGreaterThan(0);
  return new Map(
    files.map((f) => [
      f.replace(/\\/g, "/"),
      stripComments(readFileSync(`${REPO_ROOT}${f}`, "utf8")),
    ])
  );
};

const SOURCE = read("../StaffBar.tsx");

/**
 * The source with comments removed.
 *
 * A scan over raw source cannot tell a comment from a call, and these files are
 * heavily commented BY DESIGN — including comments that name the very identifiers
 * being scanned for, because they explain why the code does what it does. The first
 * draft of the reconcile-outcome assertion below matched the string `clear_failed`
 * inside the comment explaining `clear_failed`, so a mutation that deleted the actual
 * branch passed. (`fp-rename-straggler.test.ts` has the same shape: fix the scan,
 * never the comment.) Any assertion about what the CODE does uses this.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CODE = stripComments(SOURCE);

/** The component's props block — everything the SERVER is allowed to hand it. */
const PROPS_BLOCK = CODE.slice(
  CODE.indexOf("export function StaffBar("),
  CODE.indexOf("const [live, setLive]")
);

describe("StaffBar receives nothing role-derived from the server", () => {
  it("takes exactly two props: the application and an opaque actor id", () => {
    expect(PROPS_BLOCK).toMatch(/application:\s*StaffBarApplication/);
    expect(PROPS_BLOCK).toMatch(/actorUserId:\s*string/);
  });

  it("never takes the email, staff-ness, or guide-ness as a prop", () => {
    // `/fp/fw` navigations are cached into `path-sw-fw-shell-v1`, and props passed to
    // a client component are serialized into that cached payload. A bar whose email
    // or role arrived as a prop would leave a cached shell that DIFFERS between a
    // staff and a non-staff visit — handing the next holder of a shared iPad the
    // previous operator's address and role. Identity comes over a Server Action
    // (a POST, never in that cache) instead.
    for (const forbidden of ["email", "isStaff", "isFwGuide", "identity"]) {
      expect(PROPS_BLOCK, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\s*:`));
    }
  });

  it("resolves identity through the Server Action, not through props", () => {
    expect(CODE).toContain("loadStaffBarIdentity()");
  });
});

describe("R23 — the sign-out control renders unconditionally", () => {
  /** From the identity string (the last thing before it) to the button's own tag. */
  const beforeButton = CODE.slice(
    CODE.indexOf("<span className={skin.email}>"),
    CODE.indexOf("onClick={() => void onSignOut()}")
  );

  it("is not gated on identity by ANY conditional shape", () => {
    // R16 retires the per-subtree sign-outs that today work independently of the
    // identity read (Unit 4 does the retiring). Once they are gone, a gate here would
    // strand a staff member on a page with no way out whenever that read is slow or
    // fails — strictly worse than the three disagreeing-but-functional chromes this
    // replaces. Matches `identity` inside any `&&` or ternary, however it is spelled
    // or wrapped, rather than the two spellings the first draft happened to guess.
    expect(beforeButton.length).toBeGreaterThan(0);
    expect(beforeButton).not.toMatch(/identity[\s\S]{0,40}(&&|\?)/);
    expect(beforeButton).not.toMatch(/(&&|\?)[\s\S]{0,40}identity/);
  });

  it("…and neither is it gated on the queue, the probe, or the persisted copy", () => {
    for (const gate of ["queue", "probe", "persisted", "live"]) {
      expect(beforeButton, gate).not.toMatch(new RegExp(`\\b${gate}\\b[\\s\\S]{0,40}(&&|\\?)`));
    }
  });

  it("the hub link IS conditional — it is the affordance that must not be guessed", () => {
    // Whitespace-tolerant: a formatter wrapping this call must not redden the suite.
    expect(CODE).toMatch(/staffBarShowsHubLink\(\s*\{[\s\S]{0,60}?application[\s\S]{0,60}?identity/);
  });
});

describe("the sign-out redirect is not swallowed", () => {
  it("checks isNextRedirect and rethrows before reporting any failure", () => {
    // `signOutStaffBar` ends in `redirect()`, which Next implements by THROWING a
    // digest. `FwSignOutButton` still catches that digest generically and reports a
    // SUCCESSFUL sign-out as "Couldn't sign out just now" — latent there only because
    // the navigation paints first. Unit 4 retires it; this bar must not inherit it.
    const catchBlock = CODE.slice(
      CODE.indexOf("} catch (e) {", CODE.indexOf("const onSignOut"))
    );
    const rethrow = catchBlock.indexOf("if (isNextRedirect(e)) throw e;");
    const report = catchBlock.search(/setMessage\(/);
    expect(rethrow).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThan(rethrow); // the check comes FIRST
  });
});

describe("the bar decides nothing itself", () => {
  it("delegates both FW-device gates to the tested pure functions", () => {
    // Five reviewers independently found these written inline in this unit's first
    // draft, where flipping either left the whole suite green — the previous unit's
    // headline finding, recurring inside the unit meant to apply it. The two are
    // deliberately DIFFERENT functions: sign-out fails closed on an unresolved actor,
    // the queue probe declines to look. Collapsing them back into one expression is
    // what creates a database on an admissions staffer's browser.
    expect(CODE).toContain("staffBarSignOutActorIsFwGuide(live)");
    expect(CODE).toContain("staffBarQueueProbe(live)");
    expect(CODE).toContain("staffBarSurfaceCreatesFwResidue(application)");
  });

  it("never re-derives those gates inline", () => {
    expect(CODE).not.toMatch(/isFwGuide\s*\?\?/);
    expect(CODE).not.toMatch(/application\s*===\s*"fw"/);
  });

  it("passes the LIVE identity to them, never the persisted copy", () => {
    // A cached identity can predate a mid-event guide grant. Feeding it to the
    // evidence gate would let a stale `isFwGuide:false` be trusted as fact.
    expect(CODE).not.toMatch(/staffBarSignOutActorIsFwGuide\(\s*(identity|persisted)/);
    expect(CODE).not.toMatch(/staffBarQueueProbe\(\s*(identity|persisted)/);
  });
});

describe("the reconcile's resolved outcome is not dropped", () => {
  it("inspects the outcome rather than only catching a rejection", () => {
    // `clear_failed` and `queue_preserved` are RESOLVED values. A bare `.catch()`
    // drops exactly the outcomes B2 added them to surface — and this is the automatic
    // path, which runs far more often than the sign-out button.
    const effect = CODE.slice(CODE.indexOf("void reconcileFwCacheOwner("));
    const then = effect.indexOf(".then(");
    const catchIdx = effect.indexOf(".catch(");
    expect(then).toBeGreaterThanOrEqual(0);
    expect(then).toBeLessThan(catchIdx);
    // The BRANCH, not the word: `outcome.kind` cannot appear in a comment-stripped
    // slice unless the code genuinely inspects the resolved value.
    const body = effect.slice(then, catchIdx);
    expect(body).toMatch(/outcome\.kind[\s\S]{0,60}clear_failed/);
    expect(body).toContain("setMessage(");
  });
});

describe("the bar takes no lock of its own", () => {
  it("never touches navigator.locks — Web Locks are not reentrant, and re-entry HANGS", () => {
    // `runFwSignOut` and `reconcileFwCacheOwner` each acquire `fw-offline-drain`
    // exactly once, internally. A second acquisition here would not error: it would
    // hang sign-out forever on a shared iPad at a live event.
    //
    // Scans for the ACQUISITION, not the lock's name: this file's own docblock names
    // `fw-offline-drain` while explaining why it must not take it, and a scan over raw
    // source cannot tell a comment from a call. (The same shape reddens
    // `fp-rename-straggler.test.ts` — fix the scan, never the comment.)
    expect(SOURCE).not.toContain("navigator.locks");
    expect(SOURCE).not.toContain("locks.request");
  });
});

/* ═══════════════════════════ the Unit 4 tripwire ══ */

const FW_APP_LAYOUT = read("../../../fp/fw/(app)/layout.tsx");
const FW_PWA = read("../../../fp/fw/components/FwPwa.tsx");

describe("exactly one module reconciles the FW cache owner on /fp/fw", () => {
  /** A call, not a mention — both files discuss the reconcile in comments. */
  const callsReconcile = (source: string) => /reconcileFwCacheOwner\(\s*\{/.test(source);
  const mountsStaffBar = /<StaffBar[\s/>]/.test(FW_APP_LAYOUT);

  it("has exactly one reconcile owner mounted in the FW subtree, right now", () => {
    // THE HAZARD THIS EXISTS FOR. The plan schedules `FwPwa`'s reconcile effect for
    // removal in Unit 3, but the removal is only safe at the moment the bar takes it
    // over — and Unit 4 is what mounts the bar here. Deleting it a PR early leaves
    // `main` with NO reconcile on the one subtree where shared iPads change hands;
    // mounting the bar without deleting it races two reconciles on one localStorage
    // key. Both are silent, and both are one line of someone else's diff away.
    //
    // Counted rather than asserted directionally, so it reddens BOTH ways: zero owners
    // (the early deletion) and two owners (the un-retired duplicate).
    const owners = [mountsStaffBar, callsReconcile(FW_PWA)].filter(Boolean).length;
    expect(owners).toBe(1);
  });

  it("names which module owns it today, so the next editor knows what moved", () => {
    // FLIPPED IN UNIT 4, in the same change that mounted the bar here. Before: FwPwa
    // owned the reconcile and the bar was not mounted. After: the bar owns it and
    // FwPwa's effect is gone. The count above is what stopped this being flipped only
    // half way — and it still is, in whichever direction the next change goes.
    expect(mountsStaffBar).toBe(true);
    expect(callsReconcile(FW_PWA)).toBe(false);
  });

  it("FwPwa is still mounted for the things that did NOT move", () => {
    // Only the reconcile moved. SW registration, the drain engine and the queued
    // indicator stay here, because `FwPwa`'s Background Sync effect awaits
    // `navigator.serviceWorker.ready` — which off `/fp/fw` matches no registration and
    // NEVER SETTLES. "Delete the reconcile" must not slide into "delete the mount".
    expect(FW_APP_LAYOUT).toMatch(/<FwPwa[\s/>]/);
  });
});

/* ═══════════════════════ where the bar mounts, and where it must not ══ */

/**
 * The three OUTERMOST guarded layouts — one per application, settled in planning.
 *
 * Paths are repo-relative and compared as a SET against a repo-wide scan below, so
 * this list cannot drift from reality in either direction: a bar added to a fourth
 * layout reddens, and a bar removed from one of these reddens.
 */
const BAR_MOUNTS = [
  "app/staff/layout.tsx",
  "app/crm/(app)/layout.tsx",
  "app/fp/fw/(app)/layout.tsx",
] as const;

/**
 * FW layouts that NEST inside `app/fp/fw/(app)/layout.tsx`. Mounting the bar in these
 * too is the failure the "exactly once" requirement names: it would render two or
 * three bars stacked down the page on `/fp/fw/ops` and `/fp/fw/cohort/X`.
 */
const NESTED_FW_LAYOUTS = [
  "../../../fp/fw/(app)/ops/layout.tsx",
  "../../../fp/fw/(app)/cohort/[cohortId]/layout.tsx",
] as const;

describe("the bar mounts exactly once per page (R15, R18)", () => {
  it("is mounted in each of the three outermost guarded layouts", () => {
    for (const relative of ["../../../staff/layout.tsx", "../../../crm/(app)/layout.tsx"]) {
      expect(read(relative), relative).toMatch(/<StaffBar[\s/>]/);
    }
    expect(FW_APP_LAYOUT).toMatch(/<StaffBar[\s/>]/);
  });

  it("is NOT mounted in the FW layouts that nest inside one of them", () => {
    for (const relative of NESTED_FW_LAYOUTS) {
      expect(read(relative), relative).not.toMatch(/<StaffBar[\s/>]/);
    }
  });

  it("is mounted NOWHERE ELSE in the repo — which is also what gives R18 for free", async () => {
    // The set, not a spot check. R18's three exclusions (the projected board, the
    // family app, and the unauthenticated doors sharing the guarded prefixes) are not
    // enforced by naming them: they fall out of the bar living in `(app)` route groups
    // rather than being matched by URL prefix. That property is only true while this
    // set is exactly the three, so it is the set that is asserted.
    //
    // Scanned over COMMENT-STRIPPED source: `StaffBar.tsx` and several layouts discuss
    // where the bar mounts, and a scan that cannot tell a sentence from a JSX tag would
    // pass on a file that only talks about mounting it.
    const mounts = [...(await productionSources())]
      .filter(([, code]) => /<StaffBar[\s/>]/.test(code))
      .map(([path]) => path)
      .sort();
    expect(mounts).toEqual([...BAR_MOUNTS].sort());
  });

  it("the sticky headers below it offset by the height the bar publishes", () => {
    // FOUND BY MUTATION, not by inspection: reverting these two headers to `top-0`
    // left every other test in this file green, and the failure is invisible until
    // someone scrolls — two `position: sticky` elements that both resolve to `top: 0`
    // do not stack, so the bar (z-30) simply paints over the guide's working header
    // (z-10) and the weekend name disappears mid-shift. That name is wrong-stamp
    // prevention, on the surface this plan is least allowed to regress.
    //
    // The property NAME is read out of `StaffBar.tsx` rather than written twice, so a
    // consistent rename passes and an inconsistent one — the way this actually breaks
    // — reddens. It is a contract between three files; nothing else enforces it.
    const declared = CODE.match(/BAR_HEIGHT_PROPERTY\s*=\s*"(--[a-z0-9-]+)"/);
    expect(declared, "StaffBar must declare the custom property it publishes").not.toBeNull();
    const property = declared![1];
    expect(CODE).toMatch(
      new RegExp(`setProperty\\(\\s*BAR_HEIGHT_PROPERTY|setProperty\\(\\s*"${property}"`)
    );

    for (const relative of NESTED_FW_LAYOUTS) {
      const header = stripComments(read(relative));
      // The offset must be on a STICKY element: `top` on a statically-positioned
      // header is inert, which is the shape of the mistake worth catching.
      expect(header, relative).toMatch(
        new RegExp(`sticky\\s+top-\\[var\\(${property},\\s*0px\\)\\]`)
      );
    }
  });

  it("every mount hands it the two settled props and nothing else", () => {
    // The prop shape is a SECURITY property, not a style one: props to a client
    // component are serialized into the RSC payload, and `/fp/fw` navigations are
    // cached into `path-sw-fw-shell-v1`. An email or a role added here — at any ONE of
    // the three call sites — leaves a cached shell that differs between a staff and a
    // non-staff visit. The component's own props block is pinned at the top of this
    // file; this pins the call sites, which is the half a component signature cannot.
    for (const relative of [
      "../../../staff/layout.tsx",
      "../../../crm/(app)/layout.tsx",
      "../../../fp/fw/(app)/layout.tsx",
    ]) {
      const tag = stripComments(read(relative)).match(/<StaffBar\b([\s\S]*?)\/>/);
      expect(tag, relative).not.toBeNull();
      const attributes = [...tag![1].matchAll(/(\w+)\s*=/g)].map((m) => m[1]).sort();
      expect(attributes, relative).toEqual(["actorUserId", "application"]);
    }
  });
});

/* ═══════════════════════ /fp/fw's role branches stay OUT of the .tsx ══ */

describe("the picker decides nothing itself either (R12, R13, R14)", () => {
  const PICKER = stripComments(read("../../../fp/fw/(app)/page.tsx"));

  it("delegates all three role branches to the tested rules module", () => {
    // The same property `bar-rules.ts` exists for, one route over: no jsdom means an
    // `isStaff ? … : …` written here is a decision CI cannot see. Anchored on the
    // CALLS, so a rule that was imported and then not used still reddens.
    for (const rule of [
      "fwPickerRedirectsToSingleCohort(",
      "fwPickerHeadline(",
      "fwPickerZeroState(",
    ]) {
      expect(PICKER, rule).toContain(rule);
    }
  });

  it("never re-derives a role branch inline", () => {
    // The mutation this stops: reinstating `{isStaff ? "Weekends you can run" : …}`
    // beside the rule call, where the rule is still imported, still called, still
    // green — and no longer the thing on screen.
    expect(PICKER).not.toMatch(/isStaff\s*\?/);
    expect(PICKER).not.toMatch(/cohorts\.length\s*===\s*1/);
  });

  it("renders no server-side hub link — R12 is the bar's, client-evaluated", () => {
    // A staff-only `/staff` link rendered here would sit in HTML the service worker
    // caches into `path-sw-fw-shell-v1`, so the cached shell would differ between a
    // staff and a non-staff visit and hand the next holder of a shared iPad the
    // previous operator's role. The bar carries R12 instead, deciding client-side.
    expect(PICKER).not.toMatch(/href=\{?["'`]\/staff/);
  });
});

/* ═══════════════════════ the disagreeing sign-outs, retired (R16) ══ */

describe("R16 — one sign-out control, and the other two are GONE not merely unlinked", () => {
  /**
   * A repo-wide scan for the retired symbols, over comment-stripped source.
   *
   * "Gone rather than unlinked" is the distinction that matters here. `signOutFwGuide`
   * is a `"use server"` export: an unrendered form does not make it unreachable,
   * because a Server Action is POST-addressable independently of any component that
   * calls it. Leaving it exported would leave a sign-out with no verdict, no drain and
   * no evidence gate one request away from anyone who knows its id — which is the
   * whole defect this unit retires.
   */
  const scanFor = async (symbol: string) =>
    [...(await productionSources())]
      .filter(([, code]) => new RegExp(`\\b${symbol}\\b`).test(code))
      .map(([path]) => path)
      .sort();

  it("the FW ops header's ungated sign-out action no longer exists anywhere", async () => {
    // `app/fp/fw/(app)/ops/layout.tsx` posted a bare <form action={signOutFwGuide}>:
    // no verdict, no drain, no evidence gate, no atomic clear. A guide who is also
    // staff could capture check-ins in the cohort view, walk to /fp/fw/ops, sign out
    // there, and abandon the queue on a shared iPad.
    expect(await scanFor("signOutFwGuide")).toEqual([]);
  });

  it("the per-cohort drain-gated button is retired too — the bar carries its sequence", async () => {
    // Not deleted for tidiness: it awaited a redirect()ing action inside a generic
    // catch with no `isNextRedirect` check, so a SUCCESSFUL sign-out could report
    // "Couldn't sign out just now." `StaffBar` has that fix and a test pinning the
    // ordering (above), so retiring the button is how the defect stops existing rather
    // than being copied.
    expect(await scanFor("FwSignOutButton")).toEqual([]);
  });

  it("the CRM tab row keeps its six sections and gives up identity and sign-out", async () => {
    // R24: the tabs SURVIVE as their own row — folding six destinations plus identity
    // plus sign-out into one bar breaks the survive-at-375px contract the tab row
    // already meets only by scrolling. Only the two things the bar now owns move up.
    const tabs = stripComments(read("../../../crm/components/CrmTabs.tsx"));
    expect(tabs).toMatch(/aria-label="CRM sections"/);
    expect(tabs).not.toMatch(/signOut/);
    expect(tabs).not.toMatch(/\bemail\b/);
    // …and the third disagreeing sign-out (a client-side supabase signOut with no
    // gate, landing on /crm/login regardless of account) is gone with it.
    expect(await scanFor("supabaseBrowser")).not.toContain("app/crm/components/CrmTabs.tsx");
  });
});
