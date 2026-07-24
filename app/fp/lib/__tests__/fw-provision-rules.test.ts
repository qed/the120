import { describe, expect, it } from "vitest";

import "@/app/fp/content/registry";
import { getProgram, MANIFEST_2026_27 } from "@/app/fp/content/manifest";
import { buildProgramRows } from "@/app/fp/content/seed-rows";
import {
  assertNoAuthMailToFwStudent,
  buildFwLocalBase,
  buildFwProgressRows,
  buildFwStudentCreateUserPayload,
  buildFwTombstoneEmail,
  buildNormalizedFwName,
  FW_LOCAL_SUFFIX,
  FW_NAME_PART_MAX,
  FW_STUDENT_EMAIL_DOMAIN,
  fwEmailForLocalPart,
  fwLocalPartFromEmail,
  isFwStudentAddress,
  MAX_FW_LOCAL_ATTEMPTS,
  pickFwLocalPart,
} from "../fw-provision-rules";

const noneTaken: ReadonlySet<string> = new Set<string>();

/** The address a name pair resolves to with nothing in the way. */
function emailFor(first: string, last: string, taken: ReadonlySet<string> = noneTaken): string {
  return pickFwLocalPart({ firstName: first, lastName: last, taken }).email;
}

describe("the FW address namespace — deliverable by design, mail-proof by mechanism", () => {
  it("derives on the REAL domain, unlike the Path's reserved .invalid", () => {
    // FW-D2: the address is a future contact channel for the family, so it must
    // be a domain that can actually receive. That is exactly why every other
    // guard in this file exists.
    expect(FW_STUDENT_EMAIL_DOMAIN).toBe("the120.school");
    expect(FW_STUDENT_EMAIL_DOMAIN.endsWith(".invalid")).toBe(false);
  });

  it("builds maya.chen.fw@the120.school from a plain name pair", () => {
    expect(emailFor("Maya", "Chen")).toBe("maya.chen.fw@the120.school");
  });

  it("round-trips local part → email → local part", () => {
    expect(fwLocalPartFromEmail(fwEmailForLocalPart("maya.chen"))).toBe("maya.chen");
    expect(fwEmailForLocalPart("maya.chen")).toContain(`.${FW_LOCAL_SUFFIX}@`);
  });

  it("recognises the namespace by SHAPE, with no database lookup", () => {
    expect(isFwStudentAddress("maya.chen.fw@the120.school")).toBe(true);
    expect(isFwStudentAddress("MAYA.CHEN.FW@THE120.SCHOOL")).toBe(true); // case-insensitive
    expect(isFwStudentAddress("  maya.chen.fw@the120.school  ")).toBe(true); // trimmed
  });

  it("does NOT claim addresses outside the namespace", () => {
    // A staff address on the same domain, a Path student, and a parent must all
    // stay mailable — the guard is scoped to `.fw@`, not to the whole domain.
    expect(isFwStudentAddress("peter@the120.school")).toBe(false);
    expect(isFwStudentAddress("s-abc.students.the120.invalid@x")).toBe(false);
    expect(isFwStudentAddress("parent@gmail.com")).toBe(false);
    expect(isFwStudentAddress("maya.chen.fw@example.com")).toBe(false); // right label, wrong domain
    expect(isFwStudentAddress(".fw@the120.school")).toBe(false); // empty local base
  });
});

describe("assertNoAuthMailToFwStudent — the single choke-point (regression guard)", () => {
  it("THROWS on any FW student recipient", () => {
    expect(() => assertNoAuthMailToFwStudent("maya.chen.fw@the120.school", "notify/send")).toThrow(
      /FW student namespace/
    );
  });

  it("throws on the anonymize TOMBSTONE address too — that is why it stays in-namespace", () => {
    // Decision 10 renames a deleted student's account to removed-<id>.fw@…
    // rather than off-domain, precisely so this guard keeps covering it.
    const tombstone = buildFwTombstoneEmail("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(isFwStudentAddress(tombstone)).toBe(true);
    expect(() => assertNoAuthMailToFwStudent(tombstone, "notify/send")).toThrow();
  });

  it("lets every non-FW recipient through untouched", () => {
    expect(() => assertNoAuthMailToFwStudent("parent@gmail.com", "notify/send")).not.toThrow();
    expect(() => assertNoAuthMailToFwStudent("peter@the120.school", "crm/offer")).not.toThrow();
  });

  it("names the calling context in the message, so the offender is findable", () => {
    expect(() => assertNoAuthMailToFwStudent("a.b.fw@the120.school", "fw-import#row12")).toThrow(
      /fw-import#row12/
    );
  });

  it("buildFwTombstoneEmail fails closed on a malformed profile id", () => {
    expect(() => buildFwTombstoneEmail("")).toThrow();
    expect(() => buildFwTombstoneEmail("has space")).toThrow();
    expect(() => buildFwTombstoneEmail("has@at")).toThrow();
  });
});

describe("name folding — accents, hyphens, apostrophes, and the fail-closed floor", () => {
  it("folds accents to ASCII (composed AND decomposed inputs agree)", () => {
    const composedFirst = "José";
    const composedLast = "Peña";
    // The same names typed with COMBINING marks (U+0301 acute, U+0303 tilde) —
    // what an iPad keyboard may actually emit. Both spellings must land on ONE
    // address, or one child entered on two devices gets two accounts and half a
    // record each.
    const decomposedFirst = "José";
    const decomposedLast = "Peña";
    expect(decomposedFirst).not.toBe(composedFirst); // the inputs really do differ
    expect(decomposedLast).not.toBe(composedLast);
    expect(emailFor(composedFirst, composedLast)).toBe("jose.pena.fw@the120.school");
    expect(emailFor(decomposedFirst, decomposedLast)).toBe("jose.pena.fw@the120.school");
    expect(buildNormalizedFwName(decomposedFirst, decomposedLast)).toBe(
      buildNormalizedFwName(composedFirst, composedLast)
    );
  });

  it("joins apostrophe elisions and keeps hyphens as address-safe separators", () => {
    expect(emailFor("Jean-Luc", "O'Brien")).toBe("jean-luc.obrien.fw@the120.school");
    expect(emailFor("Jean-Luc", "O’Brien")).toBe("jean-luc.obrien.fw@the120.school"); // curly
  });

  it("levels spaces and stray punctuation in multi-part names", () => {
    expect(emailFor("Mary  Kate", "van der Berg")).toBe("mary-kate.van-der-berg.fw@the120.school");
  });

  it("emits only address-safe characters, ever", () => {
    for (const [f, l] of [
      ["Maya", "Chen"],
      ["José", "Peña"],
      ["Jean-Luc", "O'Brien"],
      ["Mary  Kate", "van der Berg"],
      ["Zoë", "Ng"],
    ] as const) {
      expect(buildFwLocalBase(f, l)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("caps each part so the local part stays inside the 64-octet limit", () => {
    const long = "Wolfeschlegelsteinhausenbergerdorff";
    const base = buildFwLocalBase(long, long);
    const [first, last] = base.split(".");
    expect(first.length).toBeLessThanOrEqual(FW_NAME_PART_MAX);
    expect(last.length).toBeLessThanOrEqual(FW_NAME_PART_MAX);
    // base + ".fw" + a 3-digit collision integer must still fit in 64.
    expect(base.length + FW_LOCAL_SUFFIX.length + 1 + 3).toBeLessThanOrEqual(64);
    expect(base).not.toMatch(/-\./); // a cap landing mid-separator leaves no dangling dash
  });

  it("FAILS CLOSED on a name with nothing address-safe in it", () => {
    // Refusing beats mangling: a name that folds to "" would otherwise produce
    // `.chen` and collide every unnameable student onto one account.
    expect(() => buildFwLocalBase("", "Chen")).toThrow(/first name/);
    expect(() => buildFwLocalBase("Maya", "   ")).toThrow(/last name/);
    expect(() => buildFwLocalBase("маша", "陈")).toThrow(); // no ASCII-foldable characters
    expect(() => buildFwLocalBase("!!!", "???")).toThrow();
  });
});

describe("buildNormalizedFwName — ONE key both sides of a match compare on", () => {
  it("produces a stable lowercase 'first last' key", () => {
    expect(buildNormalizedFwName("Maya", "Chen")).toBe("maya chen");
    expect(buildNormalizedFwName("  MAYA ", " Chen  ")).toBe("maya chen");
  });

  it("makes accent and separator variance match — the realistic guide-typing spread", () => {
    const target = buildNormalizedFwName("José", "Peña");
    expect(buildNormalizedFwName("Jose", "Pena")).toBe(target);
    expect(buildNormalizedFwName("Jean-Luc", "O'Brien")).toBe(
      buildNormalizedFwName("Jean Luc", "OBrien")
    );
  });

  it("does NOT collapse genuinely different names", () => {
    expect(buildNormalizedFwName("Maya", "Chen")).not.toBe(buildNormalizedFwName("Maya", "Chan"));
  });

  it("returns '' rather than a wildcard when nothing survives", () => {
    expect(buildNormalizedFwName("", "")).toBe("");
    expect(buildNormalizedFwName("!!!", "???")).toBe("");
  });
});

describe("pickFwLocalPart — collision suffixing and the released-alias ledger", () => {
  it("gives the first student of a name the clean address", () => {
    expect(pickFwLocalPart({ firstName: "Maya", lastName: "Chen", taken: noneTaken })).toEqual({
      localPart: "maya.chen",
      email: "maya.chen.fw@the120.school",
      attempt: 1,
    });
  });

  it("suffixes silently from 2 on a live collision", () => {
    const pick = pickFwLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: new Set(["maya.chen"]),
    });
    expect(pick.email).toBe("maya.chen2.fw@the120.school");
    expect(pick.attempt).toBe(2);
  });

  it("walks past a run of collisions to the first genuinely free integer", () => {
    const pick = pickFwLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: new Set(["maya.chen", "maya.chen2", "maya.chen3"]),
    });
    expect(pick.localPart).toBe("maya.chen4");
  });

  it("SKIPS a released alias even though the address is technically free (Decision 10)", () => {
    // The first Maya Chen was anonymized. `maya.chen` is free in auth.users — and
    // permanently off the table, because FW-D2 makes the address a channel a
    // family may still hold, and re-minting it would silently repoint that
    // channel at a different child.
    const pick = pickFwLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: new Set(["maya.chen"]), // the ledger row, not a live account
    });
    expect(pick.localPart).toBe("maya.chen2");
  });

  it("refuses to guess past the bound rather than looping forever", () => {
    const all = new Set<string>(["maya.chen"]);
    for (let i = 2; i <= MAX_FW_LOCAL_ATTEMPTS + 1; i += 1) all.add(`maya.chen${i}`);
    expect(() => pickFwLocalPart({ firstName: "Maya", lastName: "Chen", taken: all })).toThrow(
      /refusing to guess/
    );
  });

  it("propagates the fail-closed name refusal", () => {
    expect(() => pickFwLocalPart({ firstName: " ", lastName: "Chen", taken: noneTaken })).toThrow();
  });
});

describe("buildFwStudentCreateUserPayload — the createUser contract", () => {
  const payload = buildFwStudentCreateUserPayload({ email: "maya.chen.fw@the120.school" });

  it("ALWAYS carries email_confirm: true — without it Supabase mails a real child", () => {
    // The hosted project has confirmations ON (config.toml lies). On the Path's
    // `.invalid` domain omitting the flag caused a silent lockout; here the
    // domain DELIVERS, so the same omission sends a signup email to a minor.
    // The literal-true type makes leaving it out a compile error.
    expect(payload.email_confirm).toBe(true);
  });

  it("is PASSWORD-LESS — a dormant account has no credential to leak or reset", () => {
    expect("password" in payload).toBe(false);
  });

  it("stamps app_metadata.role = student (server-set, keeps any future session off /crm)", () => {
    expect(payload.app_metadata).toEqual({ role: "student" });
  });

  it("carries exactly the three intended keys — nothing extra rides into createUser", () => {
    expect(Object.keys(payload).sort()).toEqual(["app_metadata", "email", "email_confirm"]);
  });

  it("REFUSES an address outside the FW namespace", () => {
    // An off-namespace address would escape the refusal guard, the released-alias
    // ledger, and the no-catch-all ops invariant in one step.
    expect(() => buildFwStudentCreateUserPayload({ email: "maya@gmail.com" })).toThrow();
    expect(() => buildFwStudentCreateUserPayload({ email: "maya.chen@the120.school" })).toThrow();
  });
});

describe("buildFwProgressRows — the all-locked FW materialization", () => {
  // The REAL pinned content, not a fixture: the count this asserts is the count
  // a Boston student actually gets.
  const rows = buildProgramRows(getProgram("2026-27"), { isCurrent: true });

  it("materializes exactly one LOCKED row per task in the pinned version (125)", () => {
    const built = buildFwProgressRows({
      studentId: "student-1",
      programVersionId: "2026-27",
      tasks: rows.tasks,
    });
    expect(built).toHaveLength(MANIFEST_2026_27.tasks);
    expect(built).toHaveLength(125);
    expect(built.every((r) => r.state === "locked")).toBe(true);
  });

  it("promotes NOTHING to available — FW has no gating (FW-D5)", () => {
    const built = buildFwProgressRows({
      studentId: "student-1",
      programVersionId: "2026-27",
      tasks: rows.tasks,
    });
    // The Path's builder opens the first task of each first-phase criterion; if
    // this ever starts doing the same, a guide's drill-down would imply a gate
    // that does not exist and the board would open non-zero.
    expect(built.filter((r) => r.state !== "locked")).toEqual([]);
  });

  it("snapshots NO band — Unit 3's fw_move_task stamps it at the check-in", () => {
    const built = buildFwProgressRows({
      studentId: "student-1",
      programVersionId: "2026-27",
      tasks: rows.tasks,
    });
    expect(built.every((r) => r.snapshot_band === null)).toBe(true);
  });

  it("carries each task's TRUE criterion through (the three-column FK depends on it)", () => {
    const built = buildFwProgressRows({
      studentId: "student-1",
      programVersionId: "2026-27",
      tasks: rows.tasks,
    });
    const byTask = new Map(rows.tasks.map((t) => [t.task_id, t.criterion_id]));
    expect(built.every((r) => byTask.get(r.task_id) === r.criterion_id)).toBe(true);
    // Every row is stamped with the caller's student and version, no exceptions.
    expect(new Set(built.map((r) => r.student_id))).toEqual(new Set(["student-1"]));
    expect(new Set(built.map((r) => r.program_version_id))).toEqual(new Set(["2026-27"]));
  });

  it("emits one row per task with no duplicates", () => {
    const built = buildFwProgressRows({
      studentId: "student-1",
      programVersionId: "2026-27",
      tasks: rows.tasks,
    });
    expect(new Set(built.map((r) => r.task_id)).size).toBe(built.length);
  });

  it("THROWS on zero tasks — a student with no rows is a tap-dead tree reported as success", () => {
    expect(() =>
      buildFwProgressRows({ studentId: "s", programVersionId: "2026-27", tasks: [] })
    ).toThrow(/zero tasks/);
  });
});

describe("name refusals — homoglyphs, control characters, and undecomposable Latin", () => {
  it("transliterates Latin letters that have no Unicode decomposition", () => {
    // NFD cannot reduce these, so stripping marks leaves them intact. Dropping
    // them silently would turn Weiß into "wei" and Ørsted into "rsted" —
    // an address for a child whose name is not that.
    expect(emailFor("Weiß", "Chen")).toBe("weiss.chen.fw@the120.school");
    expect(emailFor("Lars", "Ørsted")).toBe("lars.orsted.fw@the120.school");
    expect(emailFor("Æsa", "Ng")).toBe("aesa.ng.fw@the120.school");
  });

  it("REFUSES a homoglyph rather than minting a near-miss address", () => {
    // Cyrillic а in "Mаya" is visually identical to Latin a in most fonts.
    // This used to fold to "m-ya", minting m-ya.chen@ for a child the roster
    // shows as "Maya Chen" — and producing a match key that would never find
    // the real Maya again.
    expect(() => buildFwLocalBase("Mаya", "Chen")).toThrow(/cannot be folded/);
    expect(() => buildNormalizedFwName("Mаya", "Chen")).toThrow(/cannot be folded/);
  });

  it("REFUSES a non-Latin script outright", () => {
    expect(() => buildFwLocalBase("Маша", "Chen")).toThrow();
    expect(() => buildFwLocalBase("Maya", "陈")).toThrow();
  });

  it("REFUSES Unicode control and format characters (bidi override, zero-width)", () => {
    // U+202E flips display order; U+200B is invisible. Either one stored in a
    // name renders spoofed on a guide roster and a projected board.
    expect(() => buildFwLocalBase("Ma‮ya", "Chen")).toThrow(/control or format/);
    expect(() => buildFwLocalBase("Ma​ya", "Chen")).toThrow(/control or format/);
    expect(() => buildNormalizedFwName("Ma‮ya", "Chen")).toThrow(/control or format/);
  });

  it("still accepts every ordinary name shape after the tightening", () => {
    for (const [f, l] of [
      ["Maya", "Chen"],
      ["José", "Peña"],
      ["Jean-Luc", "O Brien"],
      ["Zoë", "Ng"],
      ["Mary Kate", "van der Berg"],
      ["Aoife", "Ní Bhriain"],
    ] as const) {
      expect(() => buildFwLocalBase(f, l), `${f} ${l}`).not.toThrow();
    }
  });
});
