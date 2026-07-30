import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  persistPrefillCore,
  prefillPatchForFields,
  type PrefillPersistDeps,
} from "@/app/lib/funnel/miniapp-core";

/**
 * The prefill-persist responsibility (unified-flow U9; R46/R47) — the one
 * seeding write that moved from the dashboard store to the flow's loader.
 * Behavioural suite over the real core with fake deps, plus the source pins
 * that keep the write's scope and the funnel's ONE status literal honest.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.resolve(here, p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CHILD_ID = "3f2a1c9e-0b7d-4e5f-9a88-1234567890ab";

const fullProject = { name: "Sticker Studio", description: "Custom sticker packs for classmates" };

/* ─────────────────────────── prefillPatchForFields ─────────────────────────── */

describe("prefillPatchForFields — prefillDraft's derivations diffed into a children patch", () => {
  it("null when nothing needs seeding (both fields already carry values)", () => {
    expect(
      prefillPatchForFields(
        { id: CHILD_ID, grade: 7, birthYear: "2013", projectPitch: "A real typed pitch" },
        fullProject
      )
    ).toBeNull();
  });

  it("null when the fields are empty but nothing can derive (no grade, no project)", () => {
    expect(
      prefillPatchForFields({ id: CHILD_ID, grade: null, birthYear: "", projectPitch: "" }, null)
    ).toBeNull();
  });

  it("seeds birth_year from the grade ONLY into an empty field (never-overwrite)", () => {
    expect(
      prefillPatchForFields({ id: CHILD_ID, grade: 7, birthYear: "", projectPitch: "kept" }, null)
    ).toEqual({ birth_year: "2014" });
    // A typed birth year is never overwritten, whatever the grade says.
    expect(
      prefillPatchForFields({ id: CHILD_ID, grade: 7, birthYear: "2010", projectPitch: "kept" }, null)
    ).toBeNull();
  });

  it("seeds project_pitch from a COMPLETE composed project into an empty field only", () => {
    expect(
      prefillPatchForFields({ id: CHILD_ID, grade: null, birthYear: "x", projectPitch: "" }, fullProject)
    ).toEqual({ project_pitch: "Sticker Studio: Custom sticker packs for classmates" });
    // A typed pitch is never overwritten.
    expect(
      prefillPatchForFields(
        { id: CHILD_ID, grade: null, birthYear: "x", projectPitch: "their own words" },
        fullProject
      )
    ).toBeNull();
  });

  it("a PARTIAL project seeds no pitch — ':' or 'Name:' must never persist as the family's pitch", () => {
    for (const project of [
      { name: "", description: "" },
      { name: "Sticker Studio", description: "" },
      { name: "", description: "Custom sticker packs" },
    ]) {
      expect(
        prefillPatchForFields({ id: CHILD_ID, grade: null, birthYear: "x", projectPitch: "" }, project)
      ).toBeNull();
    }
  });

  it("both derivations ride in one patch when both fields are empty", () => {
    expect(
      prefillPatchForFields({ id: CHILD_ID, grade: 6, birthYear: "", projectPitch: "" }, fullProject)
    ).toEqual({
      birth_year: "2015",
      project_pitch: "Sticker Studio: Custom sticker packs for classmates",
    });
  });
});

/* ─────────────────────────── persistPrefillCore ─────────────────────────── */

function harness(opts: {
  userId?: string | null;
  outcome?: "written" | "failed";
}): { deps: PrefillPersistDeps; writes: { childId: string; patch: object }[] } {
  const writes: { childId: string; patch: object }[] = [];
  return {
    writes,
    deps: {
      session: async () => ({
        userId: opts.userId === undefined ? "user-1" : opts.userId,
        writePrefill: async (childId, patch) => {
          writes.push({ childId, patch });
          return opts.outcome ?? "written";
        },
      }),
    },
  };
}

describe("persistPrefillCore — best-effort, observable, never a throw", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no session → skipped, ZERO writes", async () => {
    const h = harness({ userId: null });
    const res = await persistPrefillCore(
      { childId: CHILD_ID, patch: { birth_year: "2014" } },
      h.deps
    );
    expect(res).toBe("skipped");
    expect(h.writes).toHaveLength(0);
  });

  it("success → written, one write carrying exactly the patch", async () => {
    const h = harness({});
    const res = await persistPrefillCore(
      { childId: CHILD_ID, patch: { birth_year: "2014", project_pitch: "p" } },
      h.deps
    );
    expect(res).toBe("written");
    expect(h.writes).toEqual([
      { childId: CHILD_ID, patch: { birth_year: "2014", project_pitch: "p" } },
    ]);
  });

  it("a failed write → failed AND logs (best-effort is never silent best-effort)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ outcome: "failed" });
    const res = await persistPrefillCore(
      { childId: CHILD_ID, patch: { birth_year: "2014" } },
      h.deps
    );
    expect(res).toBe("failed");
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("prefill persist failed");
  });

  it("a rejecting deps layer resolves to failed — never a throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps: PrefillPersistDeps = {
      session: async () => {
        throw new Error("boom");
      },
    };
    expect(
      await persistPrefillCore({ childId: CHILD_ID, patch: { birth_year: "2014" } }, deps)
    ).toBe("failed");
  });
});

/* ─────────────────────────── source pins ─────────────────────────── */

describe("prefill persist — source pins", () => {
  const core = read("../funnel/miniapp-core.ts");

  it("the real write is scoped to the DRAFT row: id predicate AND status = 'draft'", () => {
    // The draft scope closes the race with a concurrent submit — a
    // submitted row must never receive the seed, whatever the caller's
    // stale gate believed.
    expect(core).toMatch(/\.eq\("id", childId\)\s*\.eq\("status", "draft"\)/);
  });

  it("the write path logs its failure (the writePrefill error path is observable)", () => {
    expect(core).toMatch(/prefill write failed: \$\{error\.message\}/);
  });

  it("the ONE derivation stays prefillDraft — never a re-implementation", () => {
    expect(stripComments(core)).toContain("prefillDraft(base, project)");
  });
});

/* ─────────────── the trigger-order quirk guard (probe p6, grep-style sweep) ─────────────── */

describe("no funnel core ever UPDATEs children.status to anything but 'submitted'", () => {
  const funnelDir = path.resolve(here, "../funnel");
  const collect = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) return collect(p);
      return p.endsWith(".ts") ? [p] : [];
    });

  it("sweep: every status literal inside an .update payload is exactly 'submitted', in form-step-core alone", () => {
    // The children_applicant_state_sync trigger derives the ladder off the
    // status flip, and the trigger ORDER (probe p6) makes 'submitted' the
    // only value this patch may ever carry — any new `status: "<x>"` inside
    // an update payload anywhere in the funnel cores fails here until
    // reviewed. Insert payloads (children seeded at draft, projects at
    // active) are out of scope by construction.
    const updateLiterals: { file: string; value: string }[] = [];
    for (const file of collect(funnelDir)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/status:\s*"([^"]+)"/g)) {
        const idx = m.index ?? 0;
        const lastUpdate = src.lastIndexOf(".update(", idx);
        const lastInsert = src.lastIndexOf(".insert(", idx);
        const inUpdate = lastUpdate !== -1 && lastUpdate > lastInsert && idx - lastUpdate < 400;
        if (inUpdate) updateLiterals.push({ file: path.basename(file), value: m[1] });
      }
    }
    // Non-vacuous: the submit patch itself must be found…
    expect(updateLiterals.length).toBeGreaterThan(0);
    // …and every update-payload status literal is the one legal value.
    for (const hit of updateLiterals) {
      expect(hit, `${hit.file} writes status "${hit.value}"`).toMatchObject({
        file: "form-step-core.ts",
        value: "submitted",
      });
    }
  });
});
