import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFLINE_URL,
  PATH_MANIFEST_URL,
  SW_SCOPE,
  SW_URL,
} from "../sync-rules";
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

  it("only caches the offline page and content-hashed static assets — never navigations or RSC payloads", () => {
    // The two cache write sites: the offline precache and the static-prefix
    // runtime cache. Nothing may cache a navigation response.
    expect(swSource).toContain(`const OFFLINE_URL = "${OFFLINE_URL}"`);
    expect(swSource).toContain('const STATIC_PREFIX = "/_next/static/"');
    // The navigate branch serves fetch() and falls back to caches.match — it
    // must not put() anything.
    const navigateBranch = swSource.slice(
      swSource.indexOf('request.mode === "navigate"'),
      swSource.indexOf("STATIC_PREFIX)", swSource.indexOf('request.mode === "navigate"'))
    );
    expect(navigateBranch).not.toContain("cache.put");
    expect(navigateBranch).not.toContain("cache.add");
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

describe("scope decision parity (the System-Wide Impact decision, pinned)", () => {
  it("the manifest is /path-scoped — the marketing site must never be installable as The Path", () => {
    expect(manifest.scope).toBe(SW_SCOPE);
    expect(manifest.start_url).toBe(SW_SCOPE);
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("The Path");
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

  it("registration uses updateViaCache 'none' and the guarded hostname (PathPwa)", () => {
    const pwa = readFileSync(resolve(__dirname, "../../components/pwa/PathPwa.tsx"), "utf8");
    expect(pwa).toContain('updateViaCache: "none"');
    expect(pwa).toContain("shouldRegisterServiceWorker(window.location.hostname)");
    expect(pwa).toContain("scope: SW_SCOPE");
  });
});
