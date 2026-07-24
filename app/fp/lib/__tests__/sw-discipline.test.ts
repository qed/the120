import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
});
