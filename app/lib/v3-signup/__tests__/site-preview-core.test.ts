import { describe, expect, it, vi } from "vitest";

/**
 * The /start website-preview core (fpv03 U3 amendment): the shared allocator
 * derivation + the duplicate ladder, deps-injected. What matters here beyond
 * the derivation suite (fp-handle-derive.test.ts):
 *   - the preview and the allocator answer THE SAME handle for the same
 *     inputs (one shared function, exercised through this entry point);
 *   - the enumeration posture: derived-only probes, picked-handle-only
 *     answers, exhausted folded into `unusable`;
 *   - the outage/bad_request split the wrapper's refund rule keys on.
 */

import {
  previewKidSiteHandle,
  type SitePreviewDeps,
} from "@/app/lib/v3-signup/site-preview-core";

const noneTaken: SitePreviewDeps = {
  loadTakenHandles: async () => new Set<string>(),
};

const withTaken = (...handles: string[]): SitePreviewDeps => ({
  loadTakenHandles: async () => new Set(handles),
});

describe("previewKidSiteHandle — the actual address, all real checks applied", () => {
  it("a plain free name previews its clean handle", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Ethan Nakamura" })).toEqual({
      kind: "ok",
      handle: "ethan",
    });
  });

  it("derives from the FIRST name only, same split as the username generator", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Mary Jane Watson" })).toEqual({
      kind: "ok",
      handle: "mary",
    });
  });

  it("NFKD-normalizes (Zoë → zoe)", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Zoë Alleyne" })).toEqual({
      kind: "ok",
      handle: "zoe",
    });
  });

  it("a sub-3-char name previews the padded legal handle the allocator grants (Al → al2)", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Al Haymon" })).toEqual({
      kind: "ok",
      handle: "al2",
    });
  });

  it("a TAKEN name previews the claim surface's own next variant (mary → mary2), never an invented one", async () => {
    expect(await previewKidSiteHandle(withTaken("mary"), { fullName: "Mary Shelley" })).toEqual({
      kind: "ok",
      handle: "mary2",
    });
    expect(
      await previewKidSiteHandle(withTaken("mary", "mary2", "mary3"), { fullName: "Mary Shelley" })
    ).toEqual({ kind: "ok", handle: "mary4" });
  });

  it("a RESERVED name (Admin) is `unusable` — the placeholder, never an address the claim refuses", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Admin Jones" })).toEqual({
      kind: "unusable",
    });
  });

  it("a blocklisted name is `unusable`", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "Sexy McName" })).toEqual({
      kind: "unusable",
    });
  });

  it("an underivable name (emoji-only) is `unusable`", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "🦄 Sparkles" })).toEqual({
      kind: "unusable",
    });
  });

  it("a fully exhausted ladder collapses into `unusable` (no every-variant-taken oracle)", async () => {
    const everything: SitePreviewDeps = { loadTakenHandles: async (c) => new Set(c) };
    expect(await previewKidSiteHandle(everything, { fullName: "Mary" })).toEqual({
      kind: "unusable",
    });
  });
});

describe("previewKidSiteHandle — wire hygiene", () => {
  it("probes ONLY server-derived candidates, never the raw input", async () => {
    const loadTakenHandles = vi.fn<(candidates: readonly string[]) => Promise<Set<string>>>(
      async () => new Set<string>()
    );
    await previewKidSiteHandle({ loadTakenHandles }, { fullName: "O'Brien Kelly" });
    expect(loadTakenHandles).toHaveBeenCalledTimes(1);
    const candidates = loadTakenHandles.mock.calls[0][0];
    expect(candidates[0]).toBe("obrien");
    // No candidate carries the raw typed string or anything outside the ladder.
    for (const c of candidates) expect(c).toMatch(/^[a-z0-9-]{3,20}$/);
  });

  it("malformed input is `bad_request` and never reaches the DB dep", async () => {
    const loadTakenHandles = vi.fn<(candidates: readonly string[]) => Promise<Set<string>>>(
      async () => new Set<string>()
    );
    for (const bad of [null, {}, { fullName: 7 }, { fullName: "x".repeat(201) }, "Mary"]) {
      expect(await previewKidSiteHandle({ loadTakenHandles }, bad)).toEqual({
        kind: "bad_request",
      });
    }
    expect(loadTakenHandles).not.toHaveBeenCalled();
  });

  it("an empty-but-string name is `unusable` (nothing derivable), not a throw", async () => {
    expect(await previewKidSiteHandle(noneTaken, { fullName: "   " })).toEqual({
      kind: "unusable",
    });
  });

  it("a failed taken-read is `outage` — the refundable kind, distinct from caller faults", async () => {
    const dead: SitePreviewDeps = { loadTakenHandles: async () => null };
    expect(await previewKidSiteHandle(dead, { fullName: "Ethan" })).toEqual({ kind: "outage" });
  });
});
