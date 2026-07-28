import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { glob } from "tinyglobby";
import {
  OFFLINE_URL,
  PATH_MANIFEST_URL,
  SW_SCOPE,
  SW_URL,
} from "../sync-rules";
import {
  FW_APP_SHELL_PREFIX,
  FW_BOARD_PREFIX,
  FW_OPS_PREFIX,
  FW_SHELL_CACHE_NAME,
  FW_SW_SCOPE,
  FW_SW_URL,
} from "../fw-sync-rules";
import nextConfig from "@/next.config";

/**
 * The service worker and the manifest are UNTESTABLE at runtime in this repo
 * (no jsdom, no SW harness) — so their DISCIPLINE is pinned the way the
 * migration-parity tests pin SQL: parse the artifact's text and assert the
 * rules that, broken, become a silent multi-hour outage. Same idiom as
 * app/crm/__tests__/audit-actions-parity.test.ts.
 */

const swSource = readFileSync(resolve(__dirname, "../../../../public/sw.js"), "utf8");
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../public/path.webmanifest"), "utf8")
) as Record<string, unknown>;

describe("sw.js discipline", () => {
  it("never calls skipWaiting outside the user-driven message handler", () => {
    // Exactly one occurrence, and it sits inside the message listener guarded
    // by the toast's message string — a blind install-time skipWaiting is the
    // v1-HTML/v2-chunks ChunkLoadError.
    const occurrences = swSource.match(/skipWaiting\(\)/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const messageHandler = swSource.slice(swSource.indexOf('addEventListener("message"'));
    expect(messageHandler).toContain('"path-skip-waiting"');
    expect(messageHandler.indexOf("skipWaiting()")).toBeGreaterThan(-1);
    // And the install handler must NOT contain it.
    const installHandler = swSource.slice(
      swSource.indexOf('addEventListener("install"'),
      swSource.indexOf('addEventListener("activate"')
    );
    expect(installHandler).not.toContain("skipWaiting");
  });

  it("caches the offline page and content-hashed static assets — and, since Unit 8, the FW app shell (nothing else)", () => {
    expect(swSource).toContain(`const OFFLINE_URL = "${OFFLINE_URL}"`);
    expect(swSource).toContain('const STATIC_PREFIX = "/_next/static/"');
    // The GENERAL navigate clause — every navigation that is NOT the FW app shell
    // (all of the Path, and the board) — serves fetch() and falls back to the
    // cached /offline page. It must never cache a navigation response. This is the
    // pinned invariant; the FW exception below is the ONE carve-out.
    const generalNavClause = swSource.slice(
      swSource.indexOf("// Every other navigation"),
      swSource.indexOf("STATIC_PREFIX)", swSource.indexOf("// Every other navigation"))
    );
    expect(generalNavClause).toContain("caches.match(OFFLINE_URL)");
    // MUTATION GUARD: adding any cache write to the general clause reddens here —
    // the pin holds for every Path navigation.
    expect(generalNavClause).not.toContain("cache.put");
    expect(generalNavClause).not.toContain("cache.add");
    expect(generalNavClause).not.toContain("caches.open");
  });

  it("ignores non-GET and cross-origin requests", () => {
    expect(swSource).toContain('request.method !== "GET"');
    expect(swSource).toContain("url.origin !== self.location.origin");
  });

  it("the Background Sync handler only nudges pages — uploads never run in the SW", () => {
    const syncHandler = swSource.slice(
      swSource.indexOf('addEventListener("sync"'),
      swSource.indexOf('addEventListener("fetch"')
    );
    expect(syncHandler).toContain('postMessage("path-drain")');
    // No fetch/upload machinery inside the sync handler.
    expect(syncHandler).not.toContain("fetch(");
  });
});

describe("the FW app-shell caching exception (Unit 8, Decision 15) — deliberately narrow", () => {
  it("the shell cache name is the -v2 generation (ops-guide redesign Unit 8) — by VALUE", () => {
    // The redesign retired the per-task page; v1 shells hold its URLs plus Server
    // Action ids that deploy removed. The bump makes activate() sweep every v1
    // entry, so no v1 content lingers past the deploy — which also re-affirms the
    // PII posture of the DENSER v2 shell (roster sidebar + full task detail in
    // every cached entry). Pinned by value, not just parity: a revert to -v1 in
    // BOTH files would keep the parity test green while resurrecting dead action
    // ids on installed iPads. The `path-sw-` prefix is a kept identifier.
    expect(FW_SHELL_CACHE_NAME).toBe("path-sw-fw-shell-v2");
  });

  it("the identity-clear invariant still sweeps the shell cache (load-bearing for the denser v2 shell)", () => {
    // fw-sync-client's residue clear must delete the FW shell cache by its shared
    // constant — with the v2 shell carrying the roster sidebar and all task detail
    // in every entry, this clear is what keeps a handed-over iPad from serving the
    // previous guide's cohort to the next one.
    const client = stripComments(readFileSync(resolve(__dirname, "../fw-sync-client.ts"), "utf8"));
    expect(client).toContain("caches.delete(FW_SHELL_CACHE_NAME)");
  });

  it("the SW's constants match the app's (parity with fw-sync-rules)", () => {
    expect(swSource).toContain(`const FW_SHELL_CACHE_NAME = "${FW_SHELL_CACHE_NAME}"`);
    expect(swSource).toContain(`const FW_APP_SHELL_PREFIX = "${FW_APP_SHELL_PREFIX}"`);
    expect(swSource).toContain(`const FW_BOARD_PREFIX = "${FW_BOARD_PREFIX}"`);
    expect(swSource).toContain(`const FW_OPS_PREFIX = "${FW_OPS_PREFIX}"`);
  });

  it("the exception is SCOPED — isFwAppShell requires /fp/fw and EXCLUDES the board AND ops subtrees", () => {
    const predicate = swSource.slice(
      swSource.indexOf("function isFwAppShell("),
      swSource.indexOf("async function fwAppShell(")
    );
    // Requires the app-shell prefix…
    expect(predicate).toContain("FW_APP_SHELL_PREFIX");
    // …and MUTATION GUARD (delete class): removing either exclusion reddens. The ops
    // exclusion keeps cross-cohort staff HTML out of a shared iPad's cache (security).
    expect(predicate).toContain("FW_BOARD_PREFIX");
    expect(predicate).toContain("FW_OPS_PREFIX");
    expect(predicate).toContain("return false");
  });

  it("the FW navigation cache writes ONLY to the FW shell cache, never the runtime/precache, and is BOUNDED", () => {
    const fwShell = swSource.slice(
      swSource.indexOf("async function fwAppShell("),
      swSource.indexOf("async function precacheOffline(")
    );
    // The only cache it opens is the FW shell cache…
    expect(fwShell).toContain("caches.open(FW_SHELL_CACHE_NAME)");
    // …never the precache or the static runtime cache (relocate-class mutation).
    expect(fwShell).not.toContain("PRECACHE_NAME");
    expect(fwShell).not.toContain("RUNTIME_CACHE_NAME");
    // Bounded like the static runtime cache — an unbounded authed-shell cache over a
    // multi-day event is the performance-review finding.
    expect(fwShell).toContain("FW_SHELL_CACHE_MAX_ENTRIES");
    expect(fwShell).toContain("cache.delete");
  });

  it("the navigate handler routes the FW app shell through the exception, everything else through the pin", () => {
    const navBranch = swSource.slice(
      swSource.indexOf('request.mode === "navigate"'),
      swSource.indexOf("STATIC_PREFIX)", swSource.indexOf('request.mode === "navigate"'))
    );
    // The FW clause is gated on the scoping predicate and delegates to fwAppShell.
    expect(navBranch).toContain("isFwAppShell(url)");
    expect(navBranch).toContain("fwAppShell(request)");
    // The FW clause must come BEFORE the general fetch-fallback, or a FW nav would
    // fall through to the never-cache path and never be cacheable.
    expect(navBranch.indexOf("isFwAppShell(url)")).toBeLessThan(
      navBranch.indexOf("caches.match(OFFLINE_URL)")
    );
  });

  it("the FW shell cache is PRESERVED by the activate sweep (not swept as a stale path-sw-* cache)", () => {
    const activate = swSource.slice(
      swSource.indexOf('addEventListener("activate"'),
      swSource.indexOf('addEventListener("message"')
    );
    expect(activate).toContain("k !== FW_SHELL_CACHE_NAME");
  });
});

describe("scope decision parity (the System-Wide Impact decision, pinned)", () => {
  it("the manifest is /fp-scoped — the marketing site must never be installable as First Profit", () => {
    expect(manifest.scope).toBe(SW_SCOPE);
    expect(manifest.start_url).toBe(SW_SCOPE);
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("First Profit");
  });

  it("manifest icons exist on disk at the declared paths", () => {
    const icons = manifest.icons as { src: string; sizes: string }[];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of icons) {
      const file = readFileSync(resolve(__dirname, "../../../../public", icon.src.replace(/^\//, "")));
      // PNG signature — a truncated or mis-generated icon fails here, not on a phone.
      expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  it("the apple-touch-icon file convention exists in the /path segment (180×180 PNG)", () => {
    const file = readFileSync(resolve(__dirname, "../../apple-icon.png"));
    expect(file.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR width/height at fixed offsets: 180×180 exactly (iOS's preferred size).
    expect(file.readUInt32BE(16)).toBe(180);
    expect(file.readUInt32BE(20)).toBe(180);
  });

  it("no root app/manifest.* exists — that would inject the manifest into every marketing page", () => {
    for (const name of ["manifest.ts", "manifest.js", "manifest.json", "manifest.webmanifest"]) {
      expect(() => readFileSync(resolve(__dirname, "../../../../app", name))).toThrow();
    }
  });

  it("PATH_MANIFEST_URL names the public file the /path layout links", () => {
    expect(PATH_MANIFEST_URL).toBe("/path.webmanifest");
    const layout = readFileSync(resolve(__dirname, "../../layout.tsx"), "utf8");
    expect(layout).toContain(`manifest: "${PATH_MANIFEST_URL}"`);
  });
});

describe("sw.js delivery headers (next.config.ts)", () => {
  it("serves /sw.js with no-store semantics — a CDN-cached worker is an outage of the update path", async () => {
    const headers = await nextConfig.headers?.();
    const swRule = headers?.find((h) => h.source === SW_URL);
    expect(swRule).toBeDefined();
    const cacheControl = swRule?.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl?.value).toContain("no-store");
    expect(cacheControl?.value).toContain("no-cache");
  });

  it("the board/feed subtree ships no-store + noindex on its NEW /fp path (Unit 10)", async () => {
    // FW Unit 6's projected board is the repo's ONE unauthenticated read surface;
    // after the /fp rename its header rule must follow the tree to /fp/fw/board or
    // a CDN edge could cache a minor's first-name-plus-initial grid, or a crawler
    // index it. Pins the moved `source` so an accidental revert reddens here.
    const headers = await nextConfig.headers?.();
    const boardRule = headers?.find((h) => h.source === "/fp/fw/board/:path*");
    expect(boardRule).toBeDefined();
    const cacheControl = boardRule?.headers.find((h) => h.key === "Cache-Control");
    expect(cacheControl?.value).toContain("no-store");
    const robots = boardRule?.headers.find((h) => h.key === "X-Robots-Tag");
    expect(robots?.value).toContain("noindex");
  });

  it("registration uses updateViaCache 'none' and the guarded hostname (PathPwa)", () => {
    const pwa = readFileSync(resolve(__dirname, "../../components/pwa/PathPwa.tsx"), "utf8");
    expect(pwa).toContain('updateViaCache: "none"');
    expect(pwa).toContain("shouldRegisterServiceWorker(window.location.hostname)");
    expect(pwa).toContain("scope: SW_SCOPE");
  });

  it("deploymentId is configured and resolves from a per-deployment build variable (Unit 5)", () => {
    // Peter's decision, 2026-07-27. Without it a guide iPad left open across a deploy
    // runs the old bundle: sign-out clears the device's residue FIRST, then calls a
    // Server Action whose id no longer resolves — leaving a device that looks
    // handed-over-ready with a live session and copy saying "try again", which can
    // never work. With it, Next hard-navigates on a deployment mismatch.
    expect("deploymentId" in nextConfig).toBe(true);
    // Locally and in CI none of the three variables is set and `undefined` is the
    // deliberate "feature off" value — skew protection during `next dev` would fight
    // the fast-refresh loop it exists to survive in production.
    expect((nextConfig as { deploymentId?: string }).deploymentId).toBeUndefined();
  });

  it("…and the fallback ORDER is real, verified with the variables actually set", async () => {
    // The first version of this test copy-pasted the production formula and compared
    // the two — which, in an environment where all three variables are unset, passes
    // for ANY order including a wrong one (testing review). This one sets the
    // variables to distinct values and re-imports the config fresh, so the priority
    // chain is exercised rather than mirrored.
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "explicit-id");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "vercel-id");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha-id");
    try {
      vi.resetModules();
      let cfg = (await import("@/next.config")).default as { deploymentId?: string };
      expect(cfg.deploymentId).toBe("explicit-id"); // the documented override wins

      vi.stubEnv("NEXT_DEPLOYMENT_ID", "");
      vi.resetModules();
      cfg = (await import("@/next.config")).default as { deploymentId?: string };
      expect(cfg.deploymentId).toBe("vercel-id"); // then the platform's own id

      vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
      vi.resetModules();
      cfg = (await import("@/next.config")).default as { deploymentId?: string };
      expect(cfg.deploymentId).toBe("sha-id"); // then the commit, same for all instances
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

/* ═════════════════════════ Unit 5: registration discipline, repo-wide (R18) ══ */

/**
 * Resolved from THIS FILE, never `process.cwd()`. A scan that reads the wrong
 * directory — or no files at all — is worse than no scan, because it passes silently.
 * That exact mistake was caught in a sibling test during Unit 3's review.
 */
const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
/** `app/fp/lib/__tests__/` → the repo root. Four levels up, from THIS file. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", `file://${TEST_DIR}`));

/**
 * Comments removed before scanning.
 *
 * Same helper, same reason, as `bar-wiring.test.ts`. These files are heavily commented
 * BY DESIGN, including comments that name the very identifiers being scanned for —
 * this file's own docblocks say `serviceWorker.register` repeatedly. Unit 3 shipped an
 * assertion satisfied by the comment explaining the branch it meant to pin, and Unit
 * 4's reviewer defeated three more. Fix the scan, never the comment.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * THE FILES THAT MAY REGISTER A SERVICE WORKER — asserted by SET EQUALITY, not by a
 * directory prefix.
 *
 * ⚠️ The plan's wording for this check ("nothing outside `app/fp/fw/**` calls
 * `serviceWorker.register`") is not implementable as written, and saying so is part of
 * the finding rather than a shortcut around it. `PathPwa.tsx` lives at
 * `app/fp/components/pwa/` — outside that glob — and legitimately registers the same
 * worker script at the wider `/fp` scope. A literal reading would have to fail on day
 * one or carve out a second directory prefix, and a prefix carve-out re-opens the hole
 * for the next component added beside it.
 *
 * Equality is strictly stronger than the plan's version in both directions: a third
 * registrar reddens ANYWHERE, including inside `app/fp/fw/**`, which a prefix check
 * would have permitted. Two workers at two scopes is the design; a third is a bug
 * wherever it lives.
 */
const ALLOWED_REGISTRARS = [
  "app/fp/components/pwa/PathPwa.tsx",
  "app/fp/fw/components/FwPwa.tsx",
];

const productionSources = async (): Promise<Map<string, string>> => {
  const files = await glob(["app/**/*.ts", "app/**/*.tsx", "public/**/*.js"], {
    cwd: REPO_ROOT,
    absolute: false,
    dot: false,
    ignore: ["**/__tests__/**"],
  });
  // An empty expansion would make every "is it gone?" assertion below pass vacuously,
  // which is the one failure mode a scan like this must never have.
  expect(files.length).toBeGreaterThan(0);
  return new Map(
    files.map((f) => [
      f.replace(/\\/g, "/"),
      stripComments(readFileSync(`${REPO_ROOT}${f}`, "utf8")),
    ])
  );
};

/**
 * Does this source register a service worker?
 *
 * STRUCTURAL, not a spelling. Anchoring on the literal `navigator.serviceWorker.register(`
 * is walked through by one intermediate variable — `const sw = navigator.serviceWorker;
 * sw.register(...)` — which is ordinary code, not an attack. The property is "a
 * `register(` call whose receiver traces to `serviceWorker`, or a `register(` call
 * taking a worker URL constant", so both spellings and the destructured form match.
 */
const REGISTER_CALL_PATTERNS = [
  // Dot or BRACKET access reaching `register` within reach of `serviceWorker` — the
  // review defeated the dot-only version with `navigator["serviceWorker"]["register"](`.
  // The lookbehind excludes the Background Sync API's `registration.sync.register(…)`,
  // which legitimately appears near `serviceWorker` in both PWA components and is a
  // tag registration, not a worker registration.
  /\bserviceWorker\b[\s\S]{0,120}?(?<!\bsync)(?<!\bsync\?)(\.\s*register|\[\s*["'`]register["'`]\s*\])\s*\(/g,
  // Any register call taking one of the worker URL constants…
  /(?<!\bsync)(?<!\bsync\?)(\.\s*register|\[\s*["'`]register["'`]\s*\])\s*\(\s*(FW_)?SW_URL\b/g,
  // …or the literal script path.
  /\bregister\b\s*(\]\s*)?\(\s*["'`]\/sw\.js["'`]/g,
];

const registersAWorker = (code: string) =>
  REGISTER_CALL_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(code);
  });

/**
 * How many DISTINCT register-call sites a source contains — the per-file half the
 * set-equality below cannot see. The review's second defeat: a rogue second
 * registration added INSIDE an already-allowed file leaves the file set unchanged.
 * Counting by position (deduped across patterns) closes it.
 */
const registerCallCount = (code: string): number => {
  const positions = new Set<number>();
  for (const p of REGISTER_CALL_PATTERNS) {
    p.lastIndex = 0;
    for (let m = p.exec(code); m !== null; m = p.exec(code)) {
      // Key on the position of the call's OPENING PAREN — the one token every
      // pattern's match contains at a comparable place — so one call matched by two
      // patterns (a registration is usually both "near serviceWorker" and "taking
      // SW_URL") counts once, not twice.
      positions.add(m.index + m[0].lastIndexOf("("));
    }
  }
  return positions.size;
};

describe("service-worker registration is confined to the two PWA components (Unit 5, R18)", () => {
  it("EXACTLY these two files register a worker — a third anywhere reddens", async () => {
    const sources = await productionSources();
    const registrars = [...sources.entries()]
      .filter(([, code]) => registersAWorker(code))
      .map(([file]) => file)
      .sort();
    expect(registrars).toEqual([...ALLOWED_REGISTRARS].sort());
    // …and EXACTLY ONE call site inside each. The set equality alone is file-level:
    // a second, broader-scoped registration added inside PathPwa or FwPwa would not
    // change which files match (testing review's defeat #2).
    for (const file of ALLOWED_REGISTRARS) {
      expect(registerCallCount(sources.get(file) ?? ""), file).toBe(1);
    }
  });

  it("the detector is not vacuous — it fires on all three spellings it claims to catch", () => {
    // MUTATION-TESTING THE SCAN ITSELF. The assertion above is an equality against a
    // two-element list, so a detector that matched NOTHING would fail loudly — but one
    // that matched only the spelling used today would pass while missing a real third
    // registrar written any other way. These are the mutations a reviewer would write.
    expect(registersAWorker('navigator.serviceWorker.register(FW_SW_URL, { scope })')).toBe(true);
    expect(registersAWorker('const sw = navigator.serviceWorker;\nsw.register(SW_URL, {})')).toBe(true);
    expect(
      registersAWorker('const { serviceWorker } = navigator;\nserviceWorker\n  .register("/sw.js")')
    ).toBe(true);
    expect(registersAWorker('worker.register("/sw.js", { scope: "/" })')).toBe(true);
    // BRACKET NOTATION — the exact spelling the testing review walked through the
    // first version of this detector with. Both halves bracketed, and mixed.
    expect(
      registersAWorker('navigator["serviceWorker"]["register"](FW_SW_URL, { scope: "/" })')
    ).toBe(true);
    expect(registersAWorker('navigator["serviceWorker"].register("/sw.js")')).toBe(true);
    expect(registersAWorker('navigator.serviceWorker["register"](SW_URL)')).toBe(true);
    // And the counter sees two calls as two — the per-file half of the assertion.
    expect(
      registerCallCount(
        'navigator.serviceWorker.register(FW_SW_URL, {});' +
          'navigator.serviceWorker.register("/sw.js", { scope: "/" });'
      )
    ).toBe(2);
    // And it does NOT fire on unrelated `register(` calls, or the scan would name every
    // file with an event registry and be deleted for crying wolf.
    expect(registersAWorker('formRegistry.register(field)')).toBe(false);
    expect(registersAWorker('register(handler)')).toBe(false);
  });

  it("FwPwa registers at FW_SW_SCOPE with updateViaCache 'none' and the hostname guard", () => {
    // PathPwa's twin of this has existed since T1 Unit 11; FwPwa's was never pinned,
    // and that gap is what this unit closes. Broadening this scope to "/" would put the
    // FW worker — the one carrying the app-shell caching exception — in control of the
    // marketing site.
    const pwa = stripComments(
      readFileSync(resolve(TEST_DIR, "../../fw/components/FwPwa.tsx"), "utf8")
    );
    // ANCHORED TO THE CALL, not the file. `toContain` over the whole source is
    // satisfied by a decoy literal in dead code while the real call registers at the
    // broad scope (testing review's defeat #3) — so the assertions run against the
    // register call's own argument list, sliced from the call to its options
    // object's closing brace.
    // Anchored on the WORKER registration specifically (the call taking FW_SW_URL) —
    // a bare `.register(` search finds the Background Sync tag registration first.
    const callStart = pwa.search(/(\.\s*register|\[\s*["'`]register["'`]\s*\])\s*\(\s*FW_SW_URL/);
    expect(callStart).toBeGreaterThan(-1);
    const callArgs = pwa.slice(callStart, pwa.indexOf("})", callStart) + 2);
    expect(callArgs).toContain("FW_SW_URL");
    expect(callArgs).toContain("scope: FW_SW_SCOPE");
    expect(callArgs).toContain('updateViaCache: "none"');
    expect(pwa).toContain("shouldRegisterServiceWorker(window.location.hostname)");
  });

  it("the SCOPE is the only thing separating the two registrations — so it is pinned by value", () => {
    // ⚠️ BOTH components register the SAME SCRIPT: `SW_URL` and `FW_SW_URL` are both
    // "/sw.js". So a substitute-constant mutation in FwPwa (`FW_SW_SCOPE` → `SW_SCOPE`)
    // changes nothing about which file is fetched and everything about what the worker
    // controls — it would hand the FW worker the whole `/fp` subtree. The `toContain`
    // above only checks the KEY is present and survives that mutation, which is why the
    // VALUES are pinned here too.
    expect(FW_SW_URL).toBe(SW_URL);
    expect(FW_SW_SCOPE).toBe("/fp/fw");
    expect(SW_SCOPE).toBe("/fp");
    // The FW scope must be strictly INSIDE the Path scope. Not a tautology: it is the
    // property that makes two workers on one origin coherent, because the more specific
    // registration is what wins for `/fp/fw` navigations. Were they siblings, the
    // app-shell exception would never fire.
    expect(FW_SW_SCOPE.startsWith(SW_SCOPE)).toBe(true);
    expect(FW_SW_SCOPE.length).toBeGreaterThan(SW_SCOPE.length);
  });
});
