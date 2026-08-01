/**
 * Unit coverage for the R28 erase-entrypoint's PURE arg + guard logic
 * (scripts/erase-fp-family-args.ts). These tests never touch the DB, never
 * construct realEraseFamilyDeps, and never call eraseFamily — they exercise only
 * parseArgs / buildInput / decideMode, the fail-closed decision surface.
 */

import { describe, expect, it } from "vitest";
import { buildInput, decideMode, parseArgs } from "../erase-fp-family-args";

const PARENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMAIL = "erase@example.com";

function build(argv: string[], env: Record<string, string | undefined> = {}) {
  const parsed = parseArgs(argv, env);
  const built = buildInput(parsed);
  return { parsed, built };
}

describe("parseArgs", () => {
  it("parses --flag value and --flag=value forms", () => {
    const p = parseArgs([
      "--parent-user-id",
      PARENT,
      "--parent-email=erase@example.com",
    ]);
    expect(p.parentUserId).toBe(PARENT);
    expect(p.parentEmail).toBe("erase@example.com");
  });

  it("parses --child-ids into a trimmed, non-empty list", () => {
    const p = parseArgs(["--parent-user-id", PARENT, "--child-ids", `${CHILD_A}, ${CHILD_B} ,`]);
    expect(p.childIds).toEqual([CHILD_A, CHILD_B]);
  });

  it("leaves childIds null when --child-ids is absent (full-family)", () => {
    const p = parseArgs(["--parent-user-id", PARENT]);
    expect(p.childIds).toBeNull();
  });

  it("records --confirm with its restated value", () => {
    const p = parseArgs(["--parent-user-id", PARENT, "--confirm", PARENT]);
    expect(p.confirmFlagPresent).toBe(true);
    expect(p.confirmValue).toBe(PARENT);
  });

  it("records --confirm standing alone (no value) as present with null value", () => {
    const p = parseArgs(["--confirm", "--parent-user-id", PARENT]);
    expect(p.confirmFlagPresent).toBe(true);
    expect(p.confirmValue).toBeNull();
  });

  it("reads R28_CONFIRM from env", () => {
    const p = parseArgs(["--parent-user-id", PARENT], { R28_CONFIRM: "erase" });
    expect(p.envConfirm).toBe("erase");
  });
});

describe("buildInput", () => {
  it("refuses when both parent id and email are empty", () => {
    const { built } = build([]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/No target/i);
  });

  it("refuses a missing parent id even when an email is given", () => {
    const { built } = build(["--parent-email", "erase@example.com"]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/Missing --parent-user-id/i);
  });

  it("refuses an obviously-wrong parent id shape", () => {
    const { built } = build(["--parent-user-id", "not-a-uuid"]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/not a UUID/i);
  });

  it("defaults parentEmail to empty string when omitted", () => {
    const { built } = build(["--parent-user-id", PARENT]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.parentUserId).toBe(PARENT);
      expect(built.input.parentEmail).toBe("");
      expect(built.input.childIds).toBeUndefined();
    }
  });

  it("carries parsed child ids into the input", () => {
    const { built } = build(["--parent-user-id", PARENT, "--child-ids", `${CHILD_A},${CHILD_B}`]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.input.childIds).toEqual([CHILD_A, CHILD_B]);
  });

  it("refuses a non-UUID child id", () => {
    const { built } = build(["--parent-user-id", PARENT, "--child-ids", "nope"]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/non-UUID/i);
  });
});

describe("decideMode", () => {
  it("defaults to dry-run when no confirmation is present", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("dry-run");
  });

  it("dry-run wins when --dry-run is explicit even with a matching --confirm", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT, "--confirm", PARENT, "--dry-run"]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("dry-run");
  });

  it("goes real when --confirm re-states the exact target id (full-family, with email)", () => {
    const { parsed, built } = build([
      "--parent-user-id",
      PARENT,
      "--parent-email",
      EMAIL,
      "--confirm",
      PARENT,
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("real");
  });

  it("refuses when --confirm re-states the WRONG id", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT, "--confirm", OTHER]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      const d = decideMode(parsed, built.input);
      expect(d.mode).toBe("refuse");
    }
  });

  it("refuses when --confirm stands alone with no restated id", () => {
    const { parsed, built } = build(["--confirm", "--parent-user-id", PARENT]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("refuse");
  });

  it("refuses R28_CONFIRM=erase without a matching --confirm id (fail-closed)", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT], { R28_CONFIRM: "erase" });
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("refuse");
  });

  it("goes real with R28_CONFIRM=erase AND a matching --confirm id", () => {
    const { parsed, built } = build(
      ["--parent-user-id", PARENT, "--parent-email", EMAIL, "--confirm", PARENT],
      { R28_CONFIRM: "erase" }
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("real");
  });
});

describe("buildInput — child-ids present-but-empty (P3)", () => {
  it("refuses when --child-ids is present but empty ([])", () => {
    // `--child-ids` with no value → flag present, list []. Must refuse (not be
    // silently treated as a full-family erase).
    const { parsed, built } = build(["--parent-user-id", PARENT, "--child-ids"]);
    expect(parsed.childIds).toEqual([]);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error).toMatch(/--child-ids was empty/i);
  });
});

describe("decideMode — confirm value trimming (P3)", () => {
  it("still matches the target when the --confirm value is whitespace-padded (trimmed)", () => {
    // decideMode trims the restated id, so padding around a correct id still
    // authorizes the erase (child-scoped here, so no email is required).
    const { parsed, built } = build([
      "--parent-user-id",
      PARENT,
      "--child-ids",
      CHILD_A,
      "--confirm",
      `  ${PARENT}  `,
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("real");
  });
});

describe("decideMode — child-scoped real decision (P3)", () => {
  it("goes real for a child-scoped run with a matching --confirm and NO email", () => {
    const { parsed, built } = build([
      "--parent-user-id",
      PARENT,
      "--child-ids",
      `${CHILD_A},${CHILD_B}`,
      "--confirm",
      PARENT,
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.input.childIds).toEqual([CHILD_A, CHILD_B]);
      expect(decideMode(parsed, built.input).mode).toBe("real");
    }
  });
});

describe("decideMode — full-family real requires a parent email (P2)", () => {
  it("refuses a full-family real run with NO --parent-email", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT, "--confirm", PARENT]);
    expect(built.ok).toBe(true);
    if (built.ok) {
      const d = decideMode(parsed, built.input);
      expect(d.mode).toBe("refuse");
      if (d.mode === "refuse") expect(d.reason).toMatch(/requires --parent-email/i);
    }
  });

  it("allows a full-family real run WITH a valid --parent-email", () => {
    const { parsed, built } = build([
      "--parent-user-id",
      PARENT,
      "--parent-email",
      EMAIL,
      "--confirm",
      PARENT,
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("real");
  });

  it("allows a child-scoped real run WITHOUT a --parent-email (fallback not used)", () => {
    const { parsed, built } = build([
      "--parent-user-id",
      PARENT,
      "--child-ids",
      CHILD_A,
      "--confirm",
      PARENT,
    ]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("real");
  });

  it("still previews (dry-run) a full-family run with no email and no confirm", () => {
    const { parsed, built } = build(["--parent-user-id", PARENT]);
    expect(built.ok).toBe(true);
    if (built.ok) expect(decideMode(parsed, built.input).mode).toBe("dry-run");
  });
});
