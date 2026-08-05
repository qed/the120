import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveProgressRateLimitKeys,
  deriveRequestedTaskIds,
  filterMapsToTaskIds,
  hasCompletionsOutsideRequest,
  isAllowedProgressStaffRole,
  PROGRESS_ALLOWED_STAFF_ROLES,
  PROGRESS_BUSINESSES_CAP,
  PROGRESS_DOC_VERSION,
  PROGRESS_IDEAS_CAP,
  PROGRESS_IP_RATE_LIMIT,
  PROGRESS_FUTURE_STAMP_TOLERANCE_MS,
  PROGRESS_ID_MAX_CHARS,
  PROGRESS_MAP_ENTRIES_CAP,
  PROGRESS_MAP_KEY_MAX_CHARS,
  PROGRESS_MAP_SCAN_CAP,
  PROGRESS_MAX_REQUESTED_TASK_IDS,
  PROGRESS_MAX_TIMESTAMP_MS,
  PROGRESS_RATE_LIMIT,
  PROGRESS_REFUSAL_STATUS,
  PROGRESS_TASK_ID_PATTERN,
  shapeProgress as shapeProgressAt,
  shapeProgressRefusal,
  walkSaveDoc as walkSaveDocAt,
  type ProgressCompletionMaps,
  type ProgressRefusalReason,
} from "../progress-rules";
import { shapeSuggestionsRefusal } from "@/app/api/fp/suggestions/suggestions-rules";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import { readStaffRoleCheckRoles } from "@/app/api/fp/__tests__/helpers/staff-role-check";

/* ------------------------------------------------------------- role vocabulary */

describe("progress rules — staff role vocabulary", () => {
  it("is exactly the production vocabulary: ['admin']", () => {
    expect(PROGRESS_ALLOWED_STAFF_ROLES).toEqual(["admin"]);
  });

  it("parity: the allowed set equals the staff table's role CHECK (crm_core migration)", () => {
    // Deliberately re-derived per R2 — this endpoint owns its OWN assertion
    // against the DB vocabulary (only the SQL parse is shared with the
    // suggestions test), so the two allowed sets may diverge from each other
    // but neither may diverge from the database in silence.
    expect([...PROGRESS_ALLOWED_STAFF_ROLES]).toEqual(readStaffRoleCheckRoles());
  });

  it("isAllowedProgressStaffRole: exact string membership only", () => {
    expect(isAllowedProgressStaffRole("admin")).toBe(true);
    for (const v of ["", "Admin", "ADMIN", "admin ", "super_admin", "staff", null, undefined, 1, {}]) {
      expect(isAllowedProgressStaffRole(v), JSON.stringify(v)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------- refusal */

describe("progress rules — refusal shaping", () => {
  const reasons: ProgressRefusalReason[] = [
    "missing_token",
    "invalid_token",
    "not_staff",
    "rate_limited",
    "outage",
  ];

  it("every reason produces the SAME byte-identical 401 (no oracle)", () => {
    const shaped = reasons.map((r) => shapeProgressRefusal(r));
    for (const s of shaped) expect(s.status).toBe(401);
    for (const s of shaped) expect(s.body).toBe(shaped[0]!.body);
    expect(PROGRESS_REFUSAL_STATUS).toBe(401);
  });

  it("the body is the login surface's copy, and never names staff/roles/this endpoint", () => {
    const body = shapeProgressRefusal("not_staff").body;
    expect(body).not.toMatch(/staff|role|progress|admin/i);
    const parsed = JSON.parse(body) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    // Pinned to the constant, not merely "a string" — an empty error would
    // otherwise satisfy a typeof assertion while changing the surface's voice.
    expect(parsed.error).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(SIGN_IN_FAILED_MESSAGE.length).toBeGreaterThan(0);
  });

  it("is byte-identical to the suggestions refusal — one voice across staff surfaces", () => {
    expect(shapeProgressRefusal("outage").body).toBe(shapeSuggestionsRefusal("outage").body);
  });
});

/* -------------------------------------------------------------- rate limiting */

describe("progress rules — rate limiting", () => {
  it("pins the budgets so a future tightening is a deliberate edit", () => {
    expect(PROGRESS_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 60 });
    expect(PROGRESS_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 120 });
    expect(PROGRESS_IP_RATE_LIMIT.limit).toBeGreaterThanOrEqual(PROGRESS_RATE_LIMIT.limit);
  });

  it("pins the EXACT key format (both segments present, own namespace)", () => {
    expect(deriveProgressRateLimitKeys("1.2.3.4", "sub-1")).toEqual({
      userKey: "fp-progress:1.2.3.4:sub-1",
      ipKey: "fp-progress-ip:1.2.3.4",
    });
  });

  it("pins the EXACT escaped output for a hostile (ip,user) pair", () => {
    expect(deriveProgressRateLimitKeys("2001:db8::1", "user:x")).toEqual({
      userKey: "fp-progress:2001%3Adb8%3A%3A1:user%3Ax",
      ipKey: "fp-progress-ip:2001%3Adb8%3A%3A1",
    });
  });

  it("escapes both segments — no ':' aliasing across (ip,user) pairs", () => {
    const a = deriveProgressRateLimitKeys("2001:db8::1", "user:x");
    const b = deriveProgressRateLimitKeys("2001:db8:", ":1:user:x");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.ipKey).not.toBe(b.ipKey);
  });

  it("is TOTAL: a lone-surrogate sub does not throw before the strikes are recorded", () => {
    // encodeURIComponent("\ud800") throws URIError, and unverifiedJwtSub hands
    // the claim through unvalidated — the throw would land BEFORE either bucket
    // is written, bypassing throttling entirely.
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    expect(() => deriveProgressRateLimitKeys("1.2.3.4", loneSurrogate)).not.toThrow();
    expect(() => deriveProgressRateLimitKeys(loneSurrogate, "sub-1")).not.toThrow();
    const keys = deriveProgressRateLimitKeys("1.2.3.4", loneSurrogate);
    expect(keys.userKey.startsWith("fp-progress:1.2.3.4:")).toBe(true);
  });
});

/* ------------------------------------------------------------------- fixtures */

const child = (over: Record<string, unknown> = {}) => ({
  id: "c-1",
  fp_username: "alex.fp",
  ...over,
});

/**
 * The pinned walk clock. Every fixture stamp below sits in the PAST relative to
 * it, so the future-stamp clamp is inert unless a test opts into it — a fixture
 * that re-clamps itself as the calendar moves is a test that fails on a Tuesday
 * for no reason anyone can find.
 */
const NOW = new Date("2026-09-15T00:00:00Z");
const NOW_MS = NOW.getTime();

// Thin wrappers so the ~50 call sites that do not care about the clock do not
// have to name it. Both real functions REQUIRE it.
const walkSaveDoc = (doc: unknown, now: Date = NOW) => walkSaveDocAt(doc, now);
const shapeProgress = (
  children: Parameters<typeof shapeProgressAt>[0],
  profiles: Parameters<typeof shapeProgressAt>[1],
  saves: Parameters<typeof shapeProgressAt>[2],
  requestedTaskIds: Parameters<typeof shapeProgressAt>[3],
  now: Date = NOW
) => shapeProgressAt(children, profiles, saves, requestedTaskIds, now);

/** The tasks the fixture docs use, as a caller would name them: the criterion
 *  on screen plus its one predecessor. */
const ASKED = ["1.1.5", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"];

/**
 * A well-formed id NO fixture ever completes. Requesting it filters every map
 * to empty while keeping the request non-empty — which matters, because an
 * EMPTY request returns no children at all (see the refusal test).
 */
const ASK_UNUSED = ["9.9.9"];

/** Every key any fixture below uses — the "nothing was filtered" list, so a
 *  walk assertion stays a walk assertion. */
const ASK_ALL = [
  "1.1.1",
  "1.1.2",
  "1.1.3",
  "1.1.4",
  "1.1.5",
  "1.2.1",
  "4.1.1",
  "1.1#0",
  "1.1#1",
  "1.2#4",
];

/** Every fixture doc must carry the version the walk understands. */
const doc = (over: Record<string, unknown>) => ({ docVersion: PROGRESS_DOC_VERSION, ...over });

const EMPTY_WALK = { ideas: [], businesses: [], truncated: false, docUnreadable: false };

const wellFormedDoc = doc({
  ideas: [
    {
      id: "idea-1",
      fields: { productName: "  Dog Walking  ", oneLiner: "I walk dogs" },
      done: {},
      doneAt: {},
      doneByTask: { "1.1.1": true, "1.1.2": true },
      doneAtByTask: { "1.1.1": 1_754_000_000_000, "1.1.2": 1_754_100_000_000 },
    },
  ],
  businesses: [
    {
      id: "biz-1",
      ideaId: "idea-1",
      promotedAt: 1_754_200_000_000,
      doneByTask: { "4.1.1": true },
      doneAtByTask: { "4.1.1": 1_754_300_000_000 },
    },
  ],
});

/* ------------------------------------------- anonymisation (the 08-05 redesign) */

describe("progress rules — the wire shape is anonymised", () => {
  /** Every key at every depth of a value. */
  const deepKeys = (value: unknown, into = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) {
      for (const v of value) deepKeys(v, into);
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        into.add(k);
        deepKeys(v, into);
      }
    }
    return into;
  };

  it("no field named `band` or `label` survives ANYWHERE in the shaped output", () => {
    // Asserted by deep key-walk over a fixture rather than by reading the type,
    // so a future re-add of either field fails loudly instead of type-checking.
    const rows = shapeProgress(
      [child({ id: "c-1", fp_username: "alex.fp" })],
      [{ id: "p-1", child_id: "c-1" }],
      [{ profile_id: "p-1", doc: wellFormedDoc }],
      ASK_ALL
    );
    const keys = deepKeys(rows);
    expect(keys.has("band")).toBe(false);
    expect(keys.has("label")).toBe(false);
    // …and the fixture really did produce a populated row, so the assertion
    // above is not passing on an empty walk.
    expect(rows[0]!.ideas[0]!.doneByTask).toEqual({ "1.1.1": true, "1.1.2": true });
  });

  it("the child-authored idea label is DROPPED even when the doc carries one", () => {
    const rows = shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [
        {
          profile_id: "p-1",
          doc: doc({ ideas: [{ id: "i", fields: { productName: "SOMETHING A KID TYPED" } }] }),
        },
      ],
      ASK_ALL
    );
    expect(JSON.stringify(rows)).not.toContain("SOMETHING A KID TYPED");
  });

  it("but the username SURVIVES — the WIP drill-down needs it", () => {
    const rows = shapeProgress([child({ fp_username: "alex.fp" })], [], [], ASK_ALL);
    expect(rows[0]!.username).toBe("alex.fp");
  });
});

/* ----------------------------------------------------- requested task ids */

describe("progress rules — deriveRequestedTaskIds", () => {
  const ok = (raw: unknown): string[] => {
    const res = deriveRequestedTaskIds(raw);
    expect(res.ok, JSON.stringify(raw)).toBe(true);
    return res.ok ? res.ids : [];
  };
  const refused = (raw: unknown): string => {
    const res = deriveRequestedTaskIds(raw);
    expect(res.ok, JSON.stringify(raw)).toBe(false);
    return res.ok ? "" : res.reason;
  };

  it("pins the cap constant", () => {
    expect(PROGRESS_MAX_REQUESTED_TASK_IDS).toBe(32);
  });

  it("accepts a well-formed list of stable ids, in order", () => {
    expect(ok(["1.1.5", "1.2.1", "1.2.2"])).toEqual(["1.1.5", "1.2.1", "1.2.2"]);
  });

  it("accepts legacy `${stepId}#${index}` keys, including the 0th", () => {
    expect(ok(["1.1#0", "1.2#4"])).toEqual(["1.1#0", "1.2#4"]);
  });

  it("accepts the comma-separated `?tasks=` form the route receives", () => {
    expect(ok("1.1.5,1.2.1,1.2.2")).toEqual(["1.1.5", "1.2.1", "1.2.2"]);
    // A trailing/doubled comma is a delimiter artifact, not an id.
    expect(ok("1.1.5,,1.2.1,")).toEqual(["1.1.5", "1.2.1"]);
  });

  it("the comma-string form is exactly as STRICT as the array form", () => {
    // `?tasks=` is the route's real input, so leniency here would be leniency
    // everywhere. Only the delimiter is forgiving; a segment is not trimmed.
    expect(refused("1.1.5, 1.2.1")).toBe("malformed");
    expect(refused("1.1.5,1.2.1 ")).toBe("malformed");
    expect(refused(" 1.1.5,1.2.1")).toBe("malformed");
    expect(refused("1.1.5,\t1.2.1")).toBe("malformed");
  });

  it("pins BOTH cap boundaries: 32 accepted, 33 refused", () => {
    // The control that stops a caller reconstructing the old full-cohort
    // export by naming all 125 task ids at once.
    const at = Array.from({ length: 32 }, (_, i) => `1.1.${i + 1}`);
    expect(ok(at)).toHaveLength(32);
    expect(refused([...at, "1.2.1"])).toBe("too_many");
  });

  it("counts the RAW length against the cap — 33 duplicates cannot inflate work", () => {
    expect(refused(Array.from({ length: 33 }, () => "1.1.1"))).toBe("too_many");
  });

  it("duplicates COLLAPSE rather than refusing", () => {
    expect(ok(["1.1.1", "1.1.1", "1.2.1", "1.1.1"])).toEqual(["1.1.1", "1.2.1"]);
  });

  it("refuses a non-list", () => {
    for (const bad of [undefined, null, 7, {}, true, { tasks: ["1.1.1"] }]) {
      expect(refused(bad)).toBe("not_a_list");
    }
  });

  it("refuses an empty list, in either form", () => {
    expect(refused([])).toBe("empty");
    expect(refused("")).toBe("empty");
    expect(refused(",,,")).toBe("empty");
  });

  it("refuses a list containing a non-string", () => {
    expect(refused(["1.1.1", 2])).toBe("malformed");
    expect(refused(["1.1.1", null])).toBe("malformed");
    expect(refused([["1.1.1"]])).toBe("malformed");
  });

  it("refuses malformed ids — including the hostile shapes", () => {
    for (const bad of [
      "__proto__",
      "hasOwnProperty",
      "1.2.3 ", // whitespace is a client bug, never silently repaired
      " 1.2.3",
      "1.2.3%00",
      "1.2.3\u0000",
      "1.2.3\n",
      "1.2", // a criterion id is not a task id
      "1.2.3.4",
      "1.2.-1",
      "1.2.0", // task numbering is 1-based
      "0.1.1",
      "01.1.1", // no leading zeros
      "a.b.c",
      "1.2.3;drop",
      "1.2#", // a legacy key needs its index
      "%31.1.1",
      "١.١.١", // non-ASCII digits
      "x".repeat(10_000),
      `1.1.1${"0".repeat(10_000)}`,
    ]) {
      expect(refused([bad]), JSON.stringify(bad)).toBe("malformed");
    }
  });

  it("PROPERTY: no id the pattern accepts can exceed the map-key cap", () => {
    // Boundary segments in every position, both id forms — the accepted
    // language's widest members, not one hand-picked literal.
    const segments = ["1", "9", "10", "99"];
    let accepted = 0;
    for (const phase of segments) {
      for (const criterion of segments) {
        for (const tail of [...segments, "0"]) {
          for (const id of [`${phase}.${criterion}.${tail}`, `${phase}.${criterion}#${tail}`]) {
            const legal = PROGRESS_TASK_ID_PATTERN.test(id);
            // `x.y.0` is illegal (tasks are 1-based); `x.y#0` is legal.
            expect(legal, id).toBe(!id.endsWith(".0"));
            if (!legal) continue;
            accepted++;
            expect(id.length, id).toBeLessThanOrEqual(PROGRESS_MAP_KEY_MAX_CHARS);
            expect(deriveRequestedTaskIds([id]).ok, id).toBe(true);
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(100);
  });

  it("PROPERTY: nothing longer than 8 characters is accepted at all", () => {
    // The converse bound. Built only from characters the pattern can contain,
    // so this is not passing on an alphabet mismatch.
    const alphabet = "0123456789.#";
    for (let length = 9; length <= PROGRESS_MAP_KEY_MAX_CHARS; length++) {
      for (let seed = 0; seed < 8; seed++) {
        let candidate = "";
        for (let i = 0; i < length; i++) {
          candidate += alphabet[(i * 7 + seed * 13 + length) % alphabet.length];
        }
        expect(PROGRESS_TASK_ID_PATTERN.test(candidate), candidate).toBe(false);
      }
    }
    // …and a real id one character too long is refused, not silently sliced.
    expect(deriveRequestedTaskIds(["99.99.99.9"]).ok).toBe(false);
  });

  it("NO refusal ever echoes a submitted value (R3: the list is untrusted input)", () => {
    const secrets = ["SEKRIT-1", "../../etc/passwd", "<script>", "x".repeat(5_000)];
    for (const secret of secrets) {
      const res = deriveRequestedTaskIds([secret]);
      expect(res.ok).toBe(false);
      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain(secret);
      // The whole result is a bare reason code and nothing else.
      expect(res.ok || Object.keys(res)).toEqual(["ok", "reason"]);
    }
    // Same for the oversized and non-list cases.
    expect(JSON.stringify(deriveRequestedTaskIds(["1.1.1", "LEAK-ME"]))).not.toContain("LEAK-ME");
    expect(
      JSON.stringify(deriveRequestedTaskIds(Array.from({ length: 40 }, () => "LEAK-ME")))
    ).not.toContain("LEAK-ME");
    expect(JSON.stringify(deriveRequestedTaskIds({ tasks: "LEAK-ME" }))).not.toContain("LEAK-ME");
  });

  it("never throws, on anything", () => {
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    for (const raw of [undefined, null, Number.NaN, [loneSurrogate], loneSurrogate, [Symbol.iterator]]) {
      expect(() => deriveRequestedTaskIds(raw)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------- map set-membership */

describe("progress rules — filterMapsToTaskIds", () => {
  const maps = (): ProgressCompletionMaps => ({
    done: { "1.1#0": true, "1.2#4": true },
    doneAt: { "1.1#0": 10, "1.2#4": 20 },
    doneByTask: { "1.1.5": true, "1.2.1": true, "1.3.1": true },
    doneAtByTask: { "1.1.5": 30, "1.2.1": 40, "1.3.1": 50 },
  });

  it("keeps exactly the requested keys across all four maps", () => {
    expect(filterMapsToTaskIds(maps(), new Set(["1.1.5", "1.1#0"]))).toEqual({
      done: { "1.1#0": true },
      doneAt: { "1.1#0": 10 },
      doneByTask: { "1.1.5": true },
      doneAtByTask: { "1.1.5": 30 },
    });
  });

  it("an empty request keeps nothing — set membership, never a wildcard", () => {
    expect(filterMapsToTaskIds(maps(), new Set())).toEqual({
      done: {},
      doneAt: {},
      doneByTask: {},
      doneAtByTask: {},
    });
  });

  it("a requested id with no completion simply yields nothing (no null padding)", () => {
    expect(filterMapsToTaskIds(maps(), new Set(["5.5.5"])).doneByTask).toEqual({});
  });

  it("does not mutate its input", () => {
    const input = maps();
    filterMapsToTaskIds(input, new Set(["1.1.5"]));
    expect(input).toEqual(maps());
  });
});

describe("progress rules — hasCompletionsOutsideRequest", () => {
  it("true when a completion sits outside the requested set", () => {
    const maps: ProgressCompletionMaps = {
      done: {},
      doneAt: {},
      doneByTask: { "1.1.5": true, "3.1.1": true },
      doneAtByTask: {},
    };
    expect(hasCompletionsOutsideRequest(maps, new Set(["1.1.5"]))).toBe(true);
    expect(hasCompletionsOutsideRequest(maps, new Set(["1.1.5", "3.1.1"]))).toBe(false);
  });

  it("a `false` is NOT a completion — an UN-done task must not read as 'moved past'", () => {
    const maps: ProgressCompletionMaps = {
      done: { "1.2#4": false },
      doneAt: {},
      doneByTask: { "3.1.1": false },
      doneAtByTask: {},
    };
    expect(hasCompletionsOutsideRequest(maps, new Set(["1.1.5"]))).toBe(false);
  });

  it("a BARE stamp outside the set does NOT count — the client's union rule needs the boolean", () => {
    // `{done:{"1.2#4":false}, doneAt:{"1.2#4":10}}` must not read as "moved
    // past": the FP client's union rule is explicit that a timestamp without
    // its `done: true` never mints a completion.
    const bareStamp: ProgressCompletionMaps = {
      done: { "1.2#4": false },
      doneAt: { "1.2#4": 10 },
      doneByTask: {},
      doneAtByTask: {},
    };
    expect(hasCompletionsOutsideRequest(bareStamp, new Set(["1.1.5"]))).toBe(false);

    // The same key WITH its boolean does count.
    const paired: ProgressCompletionMaps = {
      done: { "1.2#4": true },
      doneAt: { "1.2#4": 10 },
      doneByTask: {},
      doneAtByTask: {},
    };
    expect(hasCompletionsOutsideRequest(paired, new Set(["1.1.5"]))).toBe(true);
    expect(hasCompletionsOutsideRequest(paired, new Set(["1.2#4"]))).toBe(false);
  });

  it("a record with nothing at all is false", () => {
    expect(hasCompletionsOutsideRequest({ done: {}, doneByTask: {} }, new Set(["1.1.5"]))).toBe(
      false
    );
  });

  it("takes just the two BOOLEAN maps, so a business can be asked the same question", () => {
    // A Business has no legacy maps; passing an empty `done` beside its
    // `doneByTask` is the whole adaptation.
    expect(
      hasCompletionsOutsideRequest({ done: {}, doneByTask: { "4.2.1": true } }, new Set(["4.1.1"]))
    ).toBe(true);
  });
});

/* ------------------------------------------------------------- shapeProgress */

describe("progress rules — shapeProgress happy path", () => {
  it("joins children → profiles → saves into the wire shape", () => {
    const children = [
      child({ id: "c-1", fp_username: "alex.fp" }),
      child({ id: "c-2", fp_username: "sam.fp" }),
    ];
    const profiles = [
      { id: "p-1", child_id: "c-1" },
      { id: "p-2", child_id: "c-2" },
    ];
    const saves = [
      { profile_id: "p-1", doc: wellFormedDoc },
      { profile_id: "p-2", doc: doc({ ideas: [{ id: "idea-2", fields: { oneLiner: "Slime shop" } }] }) },
    ];

    expect(shapeProgress(children, profiles, saves, ASK_ALL)).toEqual([
      {
        username: "alex.fp",
        truncated: false,
        docUnreadable: false,
        ideas: [
          {
            index: 0,
            id: "idea-1",
            done: {},
            doneAt: {},
            doneByTask: { "1.1.1": true, "1.1.2": true },
            doneAtByTask: { "1.1.1": 1_754_000_000_000, "1.1.2": 1_754_100_000_000 },
            lastCompletionAt: 1_754_100_000_000,
            recencyClamped: false,
            hasCompletionsOutsideRequest: false,
          },
        ],
        businesses: [
          {
            id: "biz-1",
            ideaId: "idea-1",
            archived: false,
            doneByTask: { "4.1.1": true },
            doneAtByTask: { "4.1.1": 1_754_300_000_000 },
            lastCompletionAt: 1_754_300_000_000,
            recencyClamped: false,
            hasCompletionsOutsideRequest: false,
          },
        ],
      },
      {
        username: "sam.fp",
        truncated: false,
        docUnreadable: false,
        ideas: [
          {
            index: 0,
            id: "idea-2",
            done: {},
            doneAt: {},
            doneByTask: {},
            doneAtByTask: {},
            lastCompletionAt: null,
            recencyClamped: false,
            hasCompletionsOutsideRequest: false,
          },
        ],
        businesses: [],
      },
    ]);
  });

  it("empty children input → empty array", () => {
    expect(shapeProgress([], [], [], ASK_ALL)).toEqual([]);
  });

  it("skips a child with no fp_username (the fail-closed half of the query filter)", () => {
    const rows = shapeProgress(
      [child({ id: "c-1", fp_username: null }), child({ id: "c-2", fp_username: "" }), child({ id: "c-3" })],
      [],
      [],
      ASK_ALL
    );
    expect(rows.map((r) => r.username)).toEqual(["alex.fp"]);
  });

  it("passes the username through untrimmed and uncased — it is an identity value", () => {
    // Whitespace ON PURPOSE: with a clean fixture, adding a `.trim()` to the
    // shaper passes. The client matches this value against a login handle, so a
    // helpfully-repaired username is a lookup miss, not a tidier string.
    for (const raw of [" alex.fp ", "Alex.FP", "alex.fp\t"]) {
      expect(shapeProgress([child({ fp_username: raw })], [], [], ASK_ALL)[0]!.username).toBe(raw);
    }
  });

  it("first row wins on a duplicate profile or save (unreachable per schema; intent pinned)", () => {
    const profiles = [
      { id: "p-first", child_id: "c-1" },
      { id: "p-second", child_id: "c-1" },
    ];
    const saves = [
      { profile_id: "p-first", doc: wellFormedDoc },
      { profile_id: "p-first", doc: doc({ ideas: [] }) },
      { profile_id: "p-second", doc: doc({ ideas: [] }) },
    ];
    const rows = shapeProgress([child()], profiles, saves, ASK_ALL);
    expect(rows[0]!.ideas.map((i) => i.id)).toEqual(["idea-1"]);
  });
});

/* ------------------------------------------------- shapeProgress: id filter */

/** One child, one save doc, one requested id list → that child's ideas. */
const ideasFor = (ideaDoc: Record<string, unknown>, ids: readonly string[]) =>
  shapeProgress(
    [child({ id: "c-1" })],
    [{ id: "p-1", child_id: "c-1" }],
    [{ profile_id: "p-1", doc: doc(ideaDoc) }],
    ids
  )[0]!.ideas;

describe("progress rules — shapeProgress filters maps to the requested task ids", () => {
  /** Three criteria of stamped work, ascending in time. */
  const threeCriteria = {
    ideas: [
      {
        id: "idea-1",
        doneByTask: {
          "1.1.4": true,
          "1.1.5": true,
          "1.2.1": true,
          "1.2.2": true,
          "1.3.1": true,
        },
        doneAtByTask: {
          "1.1.4": 1_000,
          "1.1.5": 2_000,
          "1.2.1": 3_000,
          "1.2.2": 4_000,
          "1.3.1": 5_000,
        },
      },
    ],
  };

  it("returns EXACTLY the requested ids — including the predecessor from the PRECEDING criterion", () => {
    const [idea] = ideasFor(threeCriteria, ASKED);
    expect(idea!.doneByTask).toEqual({ "1.1.5": true, "1.2.1": true, "1.2.2": true });
    expect(idea!.doneAtByTask).toEqual({ "1.1.5": 2_000, "1.2.1": 3_000, "1.2.2": 4_000 });
    // Every other key — the earlier 1.1.4 and the later 1.3.1 — is gone.
    expect(Object.keys(idea!.doneByTask)).not.toContain("1.1.4");
    expect(Object.keys(idea!.doneByTask)).not.toContain("1.3.1");
  });

  it("SOUNDNESS REGRESSION: an OUT-OF-ORDER stamp still yields the requested predecessor's OWN stamp", () => {
    // The fixture the replaced design would get wrong. `markTaskDone` in the FP
    // client has NO predecessor guard and the save doc is child-writable, so a
    // LATER task can carry an EARLIER stamp than the predecessor — here 1.3.1
    // is stamped later in wall-clock than everything in the requested window
    // while 1.1.4 (outside, earlier in the sequence) carries the HIGHEST stamp
    // of all. The old "highest stamp outside the criterion" heuristic would have
    // named 1.1.4's stamp as the predecessor and computed a nonsense cycle time.
    const outOfOrder = {
      ideas: [
        {
          id: "idea-1",
          doneByTask: { "1.1.4": true, "1.1.5": true, "1.2.1": true, "1.3.1": true },
          doneAtByTask: {
            "1.1.4": 9_000_000, // out of order: the highest stamp in the doc…
            "1.1.5": 2_000, // …but 1.1.5 is the id the client ASKED for
            "1.2.1": 3_000,
            "1.3.1": 1_500,
          },
        },
      ],
    };
    const [idea] = ideasFor(outOfOrder, ASKED);
    // The predecessor's own stamp, not the highest one outside the window.
    expect(idea!.doneAtByTask["1.1.5"]).toBe(2_000);
    expect(idea!.doneAtByTask).toEqual({ "1.1.5": 2_000, "1.2.1": 3_000 });
    // The discriminating assertion: the out-of-window value reaches the wire
    // EXACTLY ONCE, as the recency number, and never as a completion stamp the
    // client could subtract. (Without this the test's assertions would be
    // content-identical to the plain membership test above.)
    expect(idea!.lastCompletionAt).toBe(9_000_000);
    const occurrences = JSON.stringify(idea).split("9000000").length - 1;
    expect(occurrences).toBe(1);
  });

  it("an idea with NO completions in the window is still PRESENT, with empty maps", () => {
    const [idea] = ideasFor(
      { ideas: [{ id: "idea-1", doneByTask: { "3.1.1": true }, doneAtByTask: { "3.1.1": 7_000 } }] },
      ASKED
    );
    expect(idea).toBeDefined();
    expect(idea!.doneByTask).toEqual({});
    expect(idea!.hasCompletionsOutsideRequest).toBe(true);
  });

  it("a legacy `1.1#0` key requested EXPLICITLY is retained raw", () => {
    const [idea] = ideasFor(
      {
        ideas: [
          {
            id: "idea-1",
            done: { "1.1#0": true, "1.1#1": true },
            doneAt: { "1.1#0": 100, "1.1#1": 200 },
          },
        ],
      },
      ["1.1#0"]
    );
    expect(idea!.done).toEqual({ "1.1#0": true });
    expect(idea!.doneAt).toEqual({ "1.1#0": 100 });
  });

  it("business maps are filtered too — no task id the caller did not request", () => {
    const rows = shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [
        {
          profile_id: "p-1",
          doc: doc({
            businesses: [
              {
                id: "b-1",
                doneByTask: { "4.1.1": true, "4.2.1": true },
                doneAtByTask: { "4.1.1": 10, "4.2.1": 20 },
              },
            ],
          }),
        },
      ],
      ["4.1.1"]
    );
    expect(rows[0]!.businesses[0]!.doneByTask).toEqual({ "4.1.1": true });
    expect(rows[0]!.businesses[0]!.doneAtByTask).toEqual({ "4.1.1": 10 });
  });

  it("a request for ids nobody completed yields empty maps, but keeps the row", () => {
    const [idea] = ideasFor(threeCriteria, ASK_UNUSED);
    expect(idea!.doneByTask).toEqual({});
    expect(idea!.doneAtByTask).toEqual({});
    // …the idea itself, its recency and its outside-the-window signal survive,
    // so the client can still place it.
    expect(idea!.lastCompletionAt).toBe(5_000);
    expect(idea!.hasCompletionsOutsideRequest).toBe(true);
  });

  it("an EMPTY request list returns NO CHILDREN — never a plausible-but-false board", () => {
    // Tempting to let [] mean "empty maps", but the result would be actively
    // misleading rather than merely empty: `hasCompletionsOutsideRequest` is
    // computed against that same empty set, so it reads TRUE for every child who
    // ever completed anything, each with a real `lastCompletionAt`. A client
    // applying the documented semantics would draw a confident board saying
    // every child has moved past every requested criterion and all are active.
    expect(
      shapeProgress(
        [child({ id: "c-1" })],
        [{ id: "p-1", child_id: "c-1" }],
        [{ profile_id: "p-1", doc: doc(threeCriteria) }],
        []
      )
    ).toEqual([]);
    // Belt and braces: the parser can never hand shapeProgress an empty list.
    expect(deriveRequestedTaskIds([]).ok).toBe(false);
  });
});

describe("progress rules — lastCompletionAt is computed BEFORE filtering", () => {
  it("an idea whose ONLY recent completion is OUTSIDE the window reports that recency", () => {
    // The load-bearing case for the client's 30-day active/stalled split: this
    // idea is working happily in a LATER criterion, so it must not be reported
    // as long-idle just because the requested window is empty for it.
    const [idea] = ideasFor(
      {
        ideas: [
          {
            id: "idea-1",
            doneByTask: { "1.1.5": true, "3.1.1": true },
            doneAtByTask: { "1.1.5": 1_000, "3.1.1": 9_999_999 },
          },
        ],
      },
      ["1.1.5"]
    );
    expect(idea!.doneAtByTask).toEqual({ "1.1.5": 1_000 });
    // NOT 1_000 — that is the number a filter-first implementation would give,
    // and it would misread this idea as stalled.
    expect(idea!.lastCompletionAt).toBe(9_999_999);
  });

  it("a doc whose stamps are ENTIRELY outside the request still reports a real recency", () => {
    const [idea] = ideasFor(
      { ideas: [{ id: "idea-1", doneAtByTask: { "5.5.5": 4_242 } }] },
      ["1.1.1"]
    );
    expect(idea!.doneAtByTask).toEqual({});
    expect(idea!.lastCompletionAt).toBe(4_242);
  });

  it("takes the max across BOTH the legacy and the stable timestamp maps", () => {
    const [idea] = ideasFor(
      { ideas: [{ id: "i", doneAt: { "1.1#0": 8_000 }, doneAtByTask: { "1.1.1": 3_000 } }] },
      ASK_UNUSED
    );
    expect(idea!.lastCompletionAt).toBe(8_000);
  });

  it("is null for an idea with no stamps at all, and for a malformed placeholder", () => {
    const ideas = ideasFor({ ideas: [{ id: "i" }, "MALFORMED"] }, ASK_UNUSED);
    expect(ideas[0]!.lastCompletionAt).toBeNull();
    expect(ideas[1]!.lastCompletionAt).toBeNull();
  });

  it("ignores stamps the narrowing already DROPPED — it can never report an unrenderable date", () => {
    const [idea] = ideasFor(
      {
        ideas: [
          {
            id: "i",
            doneAtByTask: { ok: 1_000, past: PROGRESS_MAX_TIMESTAMP_MS + 1, absurd: 1e308 },
          },
        ],
      },
      ASK_UNUSED
    );
    expect(idea!.lastCompletionAt).toBe(1_000);
    expect(() => new Date(idea!.lastCompletionAt!).toISOString()).not.toThrow();
  });
});

describe("progress rules — shapeProgress missing and unreadable rows", () => {
  it("a child with a profile but NO save row is present as 'never started', not unreadable", () => {
    const rows = shapeProgress([child()], [{ id: "p-1", child_id: "c-1" }], [], ASK_ALL);
    expect(rows).toEqual([
      { username: "alex.fp", truncated: false, docUnreadable: false, ideas: [], businesses: [] },
    ]);
  });

  it("a child with NO profile row at all is still present (never-signed-in kid)", () => {
    const rows = shapeProgress([child()], [], [{ profile_id: "p-1", doc: wellFormedDoc }], ASK_ALL);
    expect(rows[0]).toEqual({
      username: "alex.fp",
      truncated: false,
      docUnreadable: false,
      ideas: [],
      businesses: [],
    });
  });

  it("a save row whose doc is unreadable is flagged docUnreadable — NOT confused with never-started", () => {
    const profiles = [{ id: "p-1", child_id: "c-1" }];
    for (const bad of [null, undefined, "a string", 7, [], { ideas: [] } /* no docVersion */]) {
      const rows = shapeProgress([child()], profiles, [{ profile_id: "p-1", doc: bad }], ASK_ALL);
      expect(rows[0]!.docUnreadable, JSON.stringify(bad ?? null)).toBe(true);
      expect(rows[0]!.ideas).toEqual([]);
      expect(rows[0]!.businesses).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------- the doc walk */

describe("progress rules — walkSaveDoc: docVersion gate", () => {
  it("mirrors the client: a version this build does not know yields NOTHING, flagged", () => {
    // The FP client's fromSaveDoc refuses any other docVersion and boots the
    // kid into an EMPTY game. Reading it anyway would show staff full progress
    // for a child staring at a blank factory floor.
    for (const v of [2, 0, "1", null, undefined]) {
      const walked = walkSaveDoc({ docVersion: v, ideas: [{ id: "x", doneByTask: { "1.1.1": true } }] });
      expect(walked, JSON.stringify(v ?? null)).toEqual({
        ideas: [],
        businesses: [],
        truncated: false,
        docUnreadable: true,
      });
    }
  });

  it("the supported version reads normally and is NOT flagged", () => {
    expect(PROGRESS_DOC_VERSION).toBe(1);
    const walked = walkSaveDoc(doc({ ideas: [{ id: "x" }] }));
    expect(walked.docUnreadable).toBe(false);
    expect(walked.ideas).toHaveLength(1);
  });

  it("a doc that is not an object at all is unreadable, never a throw", () => {
    for (const bad of [null, undefined, 0, "", "a string", [], true, Number.NaN]) {
      expect(walkSaveDoc(bad), JSON.stringify(bad ?? null)).toEqual({
        ideas: [],
        businesses: [],
        truncated: false,
        docUnreadable: true,
      });
    }
  });
});

describe("progress rules — walkSaveDoc: legacy maps", () => {
  it("an idea with ONLY legacy done/doneAt passes the maps through RAW, keys untouched", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "idea-1",
            fields: { productName: "Lemonade" },
            done: { "1.1#0": true, "1.1#1": true, "1.2#4": false },
            doneAt: { "1.1#0": 1_700_000_000_000, "1.1#1": 1_700_000_001_000 },
          },
        ],
      })
    );
    expect(walked.ideas).toEqual([
      {
        index: 0,
        id: "idea-1",
        // The `1.2#4: false` is GONE: it is not a completion, and letting one
        // occupy entry-cap budget was exploitable (PROGRESS_MAP_ENTRIES_CAP).
        done: { "1.1#0": true, "1.1#1": true },
        doneAt: { "1.1#0": 1_700_000_000_000, "1.1#1": 1_700_000_001_000 },
        doneByTask: {},
        doneAtByTask: {},
        lastCompletionAt: 1_700_000_001_000,
        recencyClamped: false,
      },
    ]);
  });
});

describe("progress rules — walkSaveDoc: the idea label is never read", () => {
  // The label derivation LEFT the module in the 2026-08-05 redesign: it is
  // child-authored free text, so shipping it to a staff screen bought a
  // moderation surface and an amplification vector for zero flow value. These
  // are the surviving halves of the old label tests — what the walk must now
  // NOT do with `fields`.
  const ideaFrom = (idea: unknown) => walkSaveDoc(doc({ ideas: [idea] })).ideas[0]!;

  it("an idea carrying a product name emits NO label field at all", () => {
    const walked = ideaFrom({
      id: "i",
      fields: { productName: "KID-TYPED-NAME", oneLiner: "KID-TYPED-LINE" },
    });
    expect(Object.keys(walked).sort()).toEqual([
      "doneAt",
      "doneAtByTask",
      "doneByTask",
      "done",
      "id",
      "index",
      "lastCompletionAt",
      "recencyClamped",
    ].sort());
    expect(JSON.stringify(walked)).not.toContain("KID-TYPED");
  });

  it("a HOSTILE `fields` object cannot flag truncation or reach the output", () => {
    // The old label cap was the only reader of `fields`; with it gone, a
    // megabyte of product name is simply never touched.
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "i", fields: { productName: "x".repeat(50_000) } }] })
    );
    expect(walked.truncated).toBe(false);
    expect(JSON.stringify(walked).length).toBeLessThan(500);
  });

});

describe("progress rules — walkSaveDoc: fail-closed narrowing", () => {
  it("doc.ideas that is not an array is skipped entirely", () => {
    expect(walkSaveDoc(doc({ ideas: "nope" })).ideas).toEqual([]);
    expect(walkSaveDoc(doc({ ideas: { "0": {} } })).ideas).toEqual([]);
    expect(walkSaveDoc(doc({ ideas: 5 })).ideas).toEqual([]);
  });

  it("wrong-typed map values are filtered out, never coerced and never thrown", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "idea-1",
            done: { good: true, alsoGood: false, str: "true", num: 1, nil: null, obj: {} },
            doneAt: {
              good: 1_700_000_000_000,
              zero: 0,
              str: "1700000000000",
              neg: -1,
              nan: Number.NaN,
              inf: Number.POSITIVE_INFINITY,
              nil: null,
              arr: [1],
            },
            doneByTask: { "1.1.1": true, bad: "yes" },
            doneAtByTask: { "1.1.1": 1_700_000_000_000, bad: {} },
          },
        ],
      })
    );
    // `alsoGood: false` is dropped alongside the wrong-typed values: absent and
    // false are the same thing to every consumer.
    expect(walked.ideas[0]!.done).toEqual({ good: true });
    expect(walked.ideas[0]!.doneAt).toEqual({ good: 1_700_000_000_000, zero: 0 });
    expect(walked.ideas[0]!.doneByTask).toEqual({ "1.1.1": true });
    expect(walked.ideas[0]!.doneAtByTask).toEqual({ "1.1.1": 1_700_000_000_000 });
  });

  it("timestamps outside the representable Date range are DROPPED (far-future ones are clamped)", () => {
    // new Date(1e308).toISOString() throws RangeError, and a max-of-stamps
    // recency would make the child look permanently fresh — quietly removing
    // them from the stuck list.
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "i",
            doneAtByTask: {
              ok: 1_700_000_000_000,
              zero: 0,
              atCap: PROGRESS_MAX_TIMESTAMP_MS,
              past: PROGRESS_MAX_TIMESTAMP_MS + 1,
              huge: 1e16,
              absurd: 1e308,
            },
          },
        ],
      })
    );
    expect(walked.ideas[0]!.doneAtByTask).toEqual({
      ok: 1_700_000_000_000,
      zero: 0,
      // Inside the Date range but far in the future: CLAMPED to the walk clock
      // rather than passed through or dropped (see the clamp tests below).
      atCap: NOW_MS,
    });
    // Every surviving stamp is renderable.
    for (const v of Object.values(walked.ideas[0]!.doneAtByTask)) {
      expect(() => new Date(v).toISOString()).not.toThrow();
    }
  });

  it("maps that are not objects degrade to {}", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "i", done: "x", doneAt: [1, 2], doneByTask: null, doneAtByTask: 7 }] })
    );
    expect(walked.ideas[0]).toEqual({
      index: 0,
      id: "i",
      done: {},
      doneAt: {},
      doneByTask: {},
      doneAtByTask: {},
      lastCompletionAt: null,
      recencyClamped: false,
    });
  });

  it("a non-string / empty idea id reads as null, never a coerced value", () => {
    const walked = walkSaveDoc(doc({ ideas: [{ id: 7 }, { id: "" }, {}] }));
    expect(walked.ideas.map((i) => i.id)).toEqual([null, null, null]);
  });

  it("adversarial input degrades to an EXACT known shape (no throw, no surprises)", () => {
    // JSON.parse rather than a literal: a literal `__proto__` key in an object
    // literal sets the prototype instead of creating an own property, so only
    // the parsed form reproduces what a hostile jsonb doc actually looks like.
    const hostile = JSON.parse(
      `{"docVersion":1,
        "ideas":[{"id":"i","fields":{"productName":{"deep":{"deeper":[1,2,3]}}},
                  "done":{"__proto__":true,"hasOwnProperty":true,"toString":true,
                          "constructor":true,"valueOf":true,"real":true},
                  "doneAtByTask":{"__proto__":1,"isPrototypeOf":2,"real":3}}],
        "businesses":[{"id":"b","doneByTask":{"__proto__":true,"real":true}}]}`
    ) as unknown;
    const walked = walkSaveDoc(hostile);
    expect(walked).toEqual({
      truncated: false,
      docUnreadable: false,
      ideas: [
        {
          index: 0,
          id: "i",
          done: { real: true },
          doneAt: {},
          doneByTask: {},
          doneAtByTask: { real: 3 },
          lastCompletionAt: 3,
          recencyClamped: false,
        },
      ],
      businesses: [
        {
          id: "b",
          ideaId: null,
          archived: false,
          doneByTask: { real: true },
          doneAtByTask: {},
          lastCompletionAt: null,
          recencyClamped: false,
        },
      ],
    });
  });
});

describe("progress rules — walkSaveDoc: prototype-shadowing keys", () => {
  const hostileMap = (mapKey: "done" | "doneAt" | "doneByTask" | "doneAtByTask") => {
    const v = mapKey === "doneAt" || mapKey === "doneAtByTask" ? "5" : "true";
    return JSON.parse(
      `{"docVersion":1,"ideas":[{"id":"i","${mapKey}":{"__proto__":${v},"hasOwnProperty":${v},"toString":${v},"valueOf":${v},"constructor":${v},"1.1.1":${v}}}]}`
    ) as unknown;
  };

  for (const mapKey of ["done", "doneAt", "doneByTask", "doneAtByTask"] as const) {
    it(`${mapKey}: shadowing keys are dropped, the real key survives`, () => {
      const walked = walkSaveDoc(hostileMap(mapKey));
      const map = walked.ideas[0]![mapKey] as Record<string, unknown>;
      expect(Object.keys(map)).toEqual(["1.1.1"]);
    });
  }

  it("the resulting map is safe under BOTH hasOwnProperty and Object.hasOwn", () => {
    // The whole point: a consumer calling map.hasOwnProperty(taskId) must not
    // get a TypeError, which in React blanks the entire cohort table.
    const map = walkSaveDoc(hostileMap("doneByTask")).ideas[0]!.doneByTask;
    // The naive consumer call, verbatim — this is the one that TypeErrors when
    // a shadowing key survives.
    expect(() => map.hasOwnProperty("1.1.1")).not.toThrow();
    expect(map.hasOwnProperty("1.1.1")).toBe(true);
    expect(typeof map.hasOwnProperty).toBe("function");
    expect(Object.hasOwn(map, "1.1.1")).toBe(true);
    expect(Object.hasOwn(map, "hasOwnProperty")).toBe(false);
  });

  it("Object.prototype is never polluted, and the map keeps a normal prototype", () => {
    walkSaveDoc(hostileMap("doneByTask"));
    walkSaveDoc(hostileMap("doneAtByTask"));
    expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
    expect(Object.getPrototypeOf(walkSaveDoc(hostileMap("done")).ideas[0]!.done)).toBe(Object.prototype);
  });

  it("business maps get the same hygiene", () => {
    const walked = walkSaveDoc(
      JSON.parse(
        '{"docVersion":1,"businesses":[{"id":"b","doneByTask":{"hasOwnProperty":true,"4.1.1":true},"doneAtByTask":{"toString":1,"4.1.1":9}}]}'
      ) as unknown
    );
    expect(walked.businesses[0]!.doneByTask).toEqual({ "4.1.1": true });
    expect(walked.businesses[0]!.doneAtByTask).toEqual({ "4.1.1": 9 });
  });
});

describe("progress rules — walkSaveDoc: ORIGINAL idea indices", () => {
  it("a malformed idea in the MIDDLE becomes a PLACEHOLDER at its ORIGINAL index", () => {
    // The highest-value invariant in this module: the client mints
    // `legacy-idea-{index}` for id-less ideas and must reproduce the ids the
    // kid's own client persisted. The client COERCES a malformed entry into a
    // real empty idea (.map(coerceIdea)), so the server emits a placeholder
    // rather than a hole — a compacted index space would mint different ids and
    // break Business.ideaId links.
    const walked = walkSaveDoc(
      doc({
        ideas: [
          { id: "first", doneAtByTask: { "1.1.1": 1 } },
          "MALFORMED",
          { id: "third", doneAtByTask: { "1.1.1": 3 } },
        ],
      })
    );
    expect(walked.ideas.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(walked.ideas.map((i) => i.id)).toEqual(["first", null, "third"]);
    expect(walked.ideas[1]).toEqual({
      index: 1,
      id: null,
      done: {},
      doneAt: {},
      doneByTask: {},
      doneAtByTask: {},
      lastCompletionAt: null,
      recencyClamped: false,
    });
  });

  it("a business linking to a PLACEHOLDER's minted legacy id still resolves", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "real" }, 42], businesses: [{ id: "b", ideaId: "legacy-idea-1" }] })
    );
    // The client mints `legacy-idea-{index}` for every id-less idea; the
    // placeholder at index 1 is exactly the row that id belongs to.
    const placeholder = walked.ideas.find((i) => i.id === null);
    expect(placeholder!.index).toBe(1);
    expect(`legacy-idea-${placeholder!.index}`).toBe(walked.businesses[0]!.ideaId);
  });

  it("multiple malformed entries keep every entry's absolute position", () => {
    const walked = walkSaveDoc(doc({ ideas: [1, { id: "a" }, "x", null, { id: "b" }, [], { id: "c" }] }));
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      [null, 0],
      ["a", 1],
      [null, 2],
      [null, 3],
      ["b", 4],
      [null, 5],
      ["c", 6],
    ]);
  });

  it("SPARSE array holes are skipped (matching the client's .map), indices preserved", () => {
    // jsonb arrays have no holes, so this fixture is not production-shaped — and
    // it is nonetheless the ONLY test that can catch `index` being replaced by
    // the OUTPUT POSITION. In every DENSE array the walk pushes exactly one
    // entry per slot (a malformed entry becomes a placeholder, never a hole), so
    // position and index coincide for every doc jsonb can hold. Do not delete
    // this test as unrealistic: it is the sole discriminator for the invariant,
    // and it cross-checks id against index so a mutant cannot pass by keeping
    // the numbers plausible.
    const sparse: unknown[] = [];
    sparse[2] = { id: "a" };
    sparse[5] = { id: "b" };
    const walked = walkSaveDoc(doc({ ideas: sparse }));
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      ["a", 2],
      ["b", 5],
    ]);
    expect(walked.ideas.map((i) => i.index)).not.toEqual([0, 1]);
  });

  it("index tracks the DOC slot, not the output position, right up to the cap", () => {
    // Production-shaped (dense) and cap-crossing: malformed entries scattered
    // through the array, every surviving entry cross-checked id-to-index so a
    // renumbering mutant cannot survive by producing plausible integers.
    const ideas: unknown[] = [];
    for (let i = 0; i < PROGRESS_IDEAS_CAP + 20; i++) {
      ideas.push(i % 3 === 0 ? "MALFORMED" : { id: `slot-${i}` });
    }
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(true);
    for (const idea of walked.ideas) {
      expect(idea.id, `index ${idea.index}`).toBe(
        idea.index % 3 === 0 ? null : `slot-${idea.index}`
      );
    }
    expect(walked.ideas.at(-1)!.index).toBe(PROGRESS_IDEAS_CAP - 1);
  });

  it("duplicate ids are BOTH kept, distinguished by index (never merged or dropped)", () => {
    const walked = walkSaveDoc(doc({ ideas: [{ id: "dup" }, { id: "dup" }] }));
    expect(walked.ideas.map((i) => i.index)).toEqual([0, 1]);
  });
});

describe("progress rules — walkSaveDoc: businesses", () => {
  it("a business without ideaId is INCLUDED with ideaId null", () => {
    const walked = walkSaveDoc(doc({ businesses: [{ id: "biz-1", doneByTask: { "4.1.1": true } }] }));
    expect(walked.businesses).toEqual([
      {
        id: "biz-1",
        ideaId: null,
        archived: false,
        doneByTask: { "4.1.1": true },
        doneAtByTask: {},
        lastCompletionAt: null,
        recencyClamped: false,
      },
    ]);
  });

  it("a DANGLING ideaId is preserved UNRESOLVED — the client handles the lookup miss", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "idea-1" }], businesses: [{ id: "biz-1", ideaId: "idea-gone" }] })
    );
    expect(walked.businesses[0]!.ideaId).toBe("idea-gone");
  });

  it("non-string / empty ideaId reads as null", () => {
    const walked = walkSaveDoc(
      doc({ businesses: [{ id: "b1", ideaId: 7 }, { id: "b2", ideaId: "" }, { id: "b3", ideaId: null }] })
    );
    expect(walked.businesses.map((b) => b.ideaId)).toEqual([null, null, null]);
  });

  it("archived is narrowed to an EXPLICIT true — nothing else is truthy enough", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          { id: "a", archived: true },
          { id: "b", archived: false },
          { id: "c" },
          { id: "d", archived: "true" },
          { id: "e", archived: 1 },
        ],
      })
    );
    expect(walked.businesses.map((b) => b.archived)).toEqual([true, false, false, false, false]);
  });

  it("a DUPLICATE business id keeps the FIRST occurrence — a later empty twin cannot zero progress", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          { id: "b1", ideaId: "i-1", doneByTask: { "4.1.1": true }, doneAtByTask: { "4.1.1": 5 } },
          { id: "b1" },
        ],
      })
    );
    expect(walked.businesses).toEqual([
      {
        id: "b1",
        ideaId: "i-1",
        archived: false,
        doneByTask: { "4.1.1": true },
        doneAtByTask: { "4.1.1": 5 },
        lastCompletionAt: 5,
        recencyClamped: false,
      },
    ]);
  });

  it("businesses that is not an array, or an entry that is not an object, is skipped", () => {
    expect(walkSaveDoc(doc({ businesses: "nope" })).businesses).toEqual([]);
    expect(walkSaveDoc(doc({ businesses: [null, 1, "x", []] })).businesses).toEqual([]);
  });

  it("an entry with no usable id is dropped (the client keys rows by id)", () => {
    const walked = walkSaveDoc(doc({ businesses: [{ ideaId: "idea-1" }, { id: "" }, { id: "keep" }] }));
    expect(walked.businesses.map((b) => b.id)).toEqual(["keep"]);
  });

  it("business map values are narrowed exactly like the idea maps", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          {
            id: "b",
            doneByTask: { ok: true, bad: "true" },
            doneAtByTask: { ok: 5, bad: -5, worse: "5", huge: 1e16 },
          },
        ],
      })
    );
    expect(walked.businesses[0]!.doneByTask).toEqual({ ok: true });
    expect(walked.businesses[0]!.doneAtByTask).toEqual({ ok: 5 });
  });
});

/* ------------------------------------------------------------------- caps */

describe("progress rules — output caps (the amplification fuse)", () => {
  it("pins every cap constant", () => {
    expect(PROGRESS_IDEAS_CAP).toBe(50);
    expect(PROGRESS_BUSINESSES_CAP).toBe(50);
    expect(PROGRESS_MAP_ENTRIES_CAP).toBe(500);
    expect(PROGRESS_MAP_KEY_MAX_CHARS).toBe(64);
    expect(PROGRESS_MAX_TIMESTAMP_MS).toBe(8.64e15);
  });

  it("caps ideas and FLAGS the child — the first N entries, original indices intact", () => {
    const ideas = Array.from({ length: PROGRESS_IDEAS_CAP + 25 }, (_, i) => ({ id: `i-${i}` }));
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(true);
    expect(walked.ideas.map((i) => i.index)).toEqual(
      Array.from({ length: PROGRESS_IDEAS_CAP }, (_, i) => i)
    );
    expect(walked.ideas.at(-1)!.id).toBe(`i-${PROGRESS_IDEAS_CAP - 1}`);
  });

  it("truncation does NOT renumber: malformed entries before the cap keep the index space honest", () => {
    // Leading malformed entries become placeholders, so slot N still reports
    // index N — the client's legacy-id minting stays aligned.
    const ideas: unknown[] = ["bad", "bad", ...Array.from({ length: 100 }, (_, i) => ({ id: `i-${i}` }))];
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.ideas[0]!.index).toBe(0);
    expect(walked.ideas[2]!.index).toBe(2);
    expect(walked.ideas[2]!.id).toBe("i-0");
    expect(walked.ideas.at(-1)!.index).toBe(PROGRESS_IDEAS_CAP - 1);
  });

  it("exactly at the ideas cap does not flag", () => {
    const ideas = Array.from({ length: PROGRESS_IDEAS_CAP }, (_, i) => ({ id: `i-${i}` }));
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(false);
  });

  it("caps businesses and flags", () => {
    const businesses = Array.from({ length: PROGRESS_BUSINESSES_CAP + 10 }, (_, i) => ({ id: `b-${i}` }));
    const walked = walkSaveDoc(doc({ businesses }));
    expect(walked.businesses).toHaveLength(PROGRESS_BUSINESSES_CAP);
    expect(walked.truncated).toBe(true);
  });

  it("caps map entries per map and flags", () => {
    const big: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) big[`k-${i}`] = true;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: big }] }));
    expect(Object.keys(walked.ideas[0]!.doneByTask)).toHaveLength(PROGRESS_MAP_ENTRIES_CAP);
    expect(walked.truncated).toBe(true);
  });

  it("an OVER-LONG map key is dropped and FLAGS truncation", () => {
    // Without the key cap the per-entry cap is not a bound at all: the doc
    // CHECK measures the COMPRESSED size, so 500 keys of a repeated character
    // padded to kilobytes each fits under it and expands to megabytes here.
    const long = "1.1.1" + "x".repeat(5_000);
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "i",
            done: { [long]: true, "1.1#0": true },
            doneAt: { [long]: 5, "1.1#0": 5 },
            doneByTask: { [long]: true, "1.1.1": true },
            doneAtByTask: { [long]: 5, "1.1.1": 5 },
          },
        ],
      })
    );
    const idea = walked.ideas[0]!;
    expect(Object.keys(idea.done)).toEqual(["1.1#0"]);
    expect(Object.keys(idea.doneAt)).toEqual(["1.1#0"]);
    expect(Object.keys(idea.doneByTask)).toEqual(["1.1.1"]);
    expect(Object.keys(idea.doneAtByTask)).toEqual(["1.1.1"]);
    expect(walked.truncated).toBe(true);
    // Dropped WHOLE, never truncated to a prefix — a truncated key would
    // collide with a real id and silently credit the wrong task.
    expect(JSON.stringify(walked)).not.toContain("xxxx");
  });

  it("a key EXACTLY at the cap survives and does not flag; one char more does not", () => {
    const at = "k".repeat(PROGRESS_MAP_KEY_MAX_CHARS);
    const over = "k".repeat(PROGRESS_MAP_KEY_MAX_CHARS + 1);
    const atWalk = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: { [at]: true } }] }));
    expect(Object.keys(atWalk.ideas[0]!.doneByTask)).toEqual([at]);
    expect(atWalk.truncated).toBe(false);

    const overWalk = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: { [over]: true } }] }));
    expect(overWalk.ideas[0]!.doneByTask).toEqual({});
    expect(overWalk.truncated).toBe(true);
  });

  it("the key cap applies to BUSINESS maps too", () => {
    const long = "b".repeat(PROGRESS_MAP_KEY_MAX_CHARS + 1);
    const walked = walkSaveDoc(
      doc({
        businesses: [
          { id: "b", doneByTask: { [long]: true, "4.1.1": true }, doneAtByTask: { [long]: 9 } },
        ],
      })
    );
    expect(walked.businesses[0]!.doneByTask).toEqual({ "4.1.1": true });
    expect(walked.businesses[0]!.doneAtByTask).toEqual({});
    expect(walked.truncated).toBe(true);
  });

  it("an over-long key never contributes to lastCompletionAt either", () => {
    const long = "z".repeat(PROGRESS_MAP_KEY_MAX_CHARS + 1);
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "i", doneAtByTask: { [long]: 9_000_000, "1.1.1": 7 } }] })
    );
    expect(walked.ideas[0]!.lastCompletionAt).toBe(7);
  });

  it("the key cap bounds the padded-key amplification a compressed doc can smuggle", () => {
    const big: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP; i++) big[`${i}-${"p".repeat(2_000)}`] = true;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: big }] }));
    expect(walked.ideas[0]!.doneByTask).toEqual({});
    expect(walked.truncated).toBe(true);
    expect(JSON.stringify(walked).length).toBeLessThan(1_000);
  });

  it("the 31x amplification case is bounded: a huge all-{} ideas array yields a small payload", () => {
    const walked = walkSaveDoc(doc({ ideas: Array.from({ length: 20_000 }, () => ({})) }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(true);
    expect(JSON.stringify(walked).length).toBeLessThan(20_000);
  });

  it("shapeProgress surfaces truncation on the affected child only", () => {
    const children = [child({ id: "c-1", fp_username: "big" }), child({ id: "c-2", fp_username: "small" })];
    const profiles = [
      { id: "p-1", child_id: "c-1" },
      { id: "p-2", child_id: "c-2" },
    ];
    const saves = [
      { profile_id: "p-1", doc: doc({ ideas: Array.from({ length: 200 }, () => ({})) }) },
      { profile_id: "p-2", doc: wellFormedDoc },
    ];
    const rows = shapeProgress(children, profiles, saves, ASK_ALL);
    expect(rows.map((r) => [r.username, r.truncated])).toEqual([
      ["big", true],
      ["small", false],
    ]);
  });

  it("a walk that hits no cap reports truncated false (the EMPTY_WALK baseline)", () => {
    expect(walkSaveDoc(doc({}))).toEqual(EMPTY_WALK);
  });
});

/* --------------------------------------------- future stamps: clamp, not drop */

describe("progress rules — future-dated stamps are CLAMPED to the walk clock", () => {
  const stampsOf = (values: Record<string, number>, now: Date = NOW) =>
    walkSaveDoc(doc({ ideas: [{ id: "i", doneAtByTask: values }] }), now).ideas[0]!;

  it("pins the tolerance constant", () => {
    expect(PROGRESS_FUTURE_STAMP_TOLERANCE_MS).toBe(5 * 60_000);
  });

  it("ordinary device skew passes through UNTOUCHED", () => {
    // Stamps are written by the child's device; a few minutes of drift is
    // normal and must not be rewritten.
    const skewed = NOW_MS + PROGRESS_FUTURE_STAMP_TOLERANCE_MS;
    const idea = stampsOf({ past: NOW_MS - 1_000, atTolerance: skewed });
    expect(idea.doneAtByTask).toEqual({ past: NOW_MS - 1_000, atTolerance: skewed });
    expect(idea.lastCompletionAt).toBe(skewed);
  });

  it("one millisecond past the tolerance is clamped to `now`", () => {
    const idea = stampsOf({ future: NOW_MS + PROGRESS_FUTURE_STAMP_TOLERANCE_MS + 1 });
    expect(idea.doneAtByTask).toEqual({ future: NOW_MS });
    expect(idea.lastCompletionAt).toBe(NOW_MS);
  });

  it("THE ATTACK: a stamp at the Date-range ceiling cannot make a child fresh forever", () => {
    // 8.64e15 clears the absurd-value guard (it IS representable), so without
    // the clamp it becomes a permanent `lastCompletionAt`: the child is never
    // active, never stalled, and appears in NO bucket on a board whose entire
    // job is noticing who has stopped. A tablet with a forward-set clock does
    // this by accident.
    const idea = stampsOf({ "9.9.9": PROGRESS_MAX_TIMESTAMP_MS });
    expect(idea.lastCompletionAt).toBe(NOW_MS);
    expect(idea.lastCompletionAt).not.toBe(PROGRESS_MAX_TIMESTAMP_MS);
  });

  it("clamped, NOT dropped — a forward-clocked child still reads as just-active", () => {
    // Dropping would be the other tempting fix and is worse: it would make a
    // legitimately forward-clocked child read as never-active.
    const idea = stampsOf({ future: NOW_MS + 86_400_000 });
    expect(Object.keys(idea.doneAtByTask)).toEqual(["future"]);
    expect(idea.lastCompletionAt).not.toBeNull();
  });

  it("THE CLAMP ALONE DOES NOT FIX IT — recencyClamped is the half that does", () => {
    // The clamp rewrites the RESPONSE, never the stored row. So the same
    // forward-dated stamp clamps to whatever `now` each request happens to
    // carry, and `lastCompletionAt` reads "just now" on every request, forever:
    // permanently active, never stalled, invisible in the one column that
    // matters. The docstring used to claim the clamp was "self-correcting as
    // soon as the next real stamp lands", which never fires — a forward-clocked
    // device writes every later stamp in the future too, and an abandoned child
    // writes none.
    const stamp = PROGRESS_MAX_TIMESTAMP_MS;
    const first = stampsOf({ "9.9.9": stamp }, NOW);
    const weekLater = new Date(NOW_MS + 7 * 86_400_000);
    const second = stampsOf({ "9.9.9": stamp }, weekLater);

    // The defect itself, pinned: recency regenerates with no new activity.
    expect(second.lastCompletionAt).toBeGreaterThan(first.lastCompletionAt!);
    // The mitigation: both responses declare the number synthetic, so a client
    // applying the documented semantics withholds "active" rather than crediting
    // an idea nobody has touched.
    expect(first.recencyClamped).toBe(true);
    expect(second.recencyClamped).toBe(true);
  });

  it("recencyClamped is FALSE for ordinary and merely-skewed stamps", () => {
    expect(stampsOf({ past: NOW_MS - 1_000 }).recencyClamped).toBe(false);
    // At the tolerance, not past it: untouched, so not flagged.
    expect(
      stampsOf({ skew: NOW_MS + PROGRESS_FUTURE_STAMP_TOLERANCE_MS }).recencyClamped
    ).toBe(false);
    // An absurd value is DROPPED, not clamped — a different mechanism, and it
    // must not borrow this flag.
    expect(stampsOf({ absurd: PROGRESS_MAX_TIMESTAMP_MS + 1 }).recencyClamped).toBe(false);
  });

  it("a business carries its OWN recencyClamped, from its own stamps", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [{ id: "i", doneAtByTask: { "1.1.1": NOW_MS - 1_000 } }],
        businesses: [{ id: "b", doneAtByTask: { "4.1.1": PROGRESS_MAX_TIMESTAMP_MS } }],
      })
    );
    expect(walked.ideas[0]!.recencyClamped).toBe(false);
    expect(walked.businesses[0]!.recencyClamped).toBe(true);
  });

  it("a clamp is a repair, not a loss — it does not flag truncation", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "i", doneAtByTask: { future: NOW_MS + 86_400_000 } }] })
    );
    expect(walked.truncated).toBe(false);
  });

  it("the clamp ceiling is the caller's clock, threaded through shapeProgress", () => {
    const later = new Date(NOW_MS + 30 * 86_400_000);
    const stamp = NOW_MS + 86_400_000; // future for NOW, past for `later`
    const build = (now: Date) =>
      shapeProgress(
        [child({ id: "c-1" })],
        [{ id: "p-1", child_id: "c-1" }],
        [{ profile_id: "p-1", doc: doc({ ideas: [{ id: "i", doneAtByTask: { "1.1.1": stamp } }] }) }],
        ["1.1.1"],
        now
      )[0]!.ideas[0]!;
    expect(build(NOW).doneAtByTask).toEqual({ "1.1.1": NOW_MS });
    expect(build(later).doneAtByTask).toEqual({ "1.1.1": stamp });
  });

  it("clamps business stamps too", () => {
    const walked = walkSaveDoc(
      doc({ businesses: [{ id: "b", doneAtByTask: { "4.1.1": PROGRESS_MAX_TIMESTAMP_MS } }] })
    );
    expect(walked.businesses[0]!.doneAtByTask).toEqual({ "4.1.1": NOW_MS });
    expect(walked.businesses[0]!.lastCompletionAt).toBe(NOW_MS);
  });
});

/* ------------------------------------------------- child-authored id lengths */

describe("progress rules — child-authored ids are length-bounded", () => {
  it("pins the constant", () => {
    expect(PROGRESS_ID_MAX_CHARS).toBe(64);
    // A UUID and a minted `legacy-idea-{n}` both fit comfortably.
    expect("11111111-2222-3333-4444-555555555555".length).toBeLessThanOrEqual(
      PROGRESS_ID_MAX_CHARS
    );
  });

  it("THE ATTACK: 50 ideas + 50 businesses with enormous ids stay bounded", () => {
    // These are NOT map keys, so PROGRESS_MAP_KEY_MAX_CHARS misses them, and
    // since `label` left the wire they are the dominant payload term. Such a doc
    // compresses far under the 256KiB pg_column_size CHECK.
    const huge = "z".repeat(400_000);
    const walked = walkSaveDoc(
      doc({
        ideas: Array.from({ length: PROGRESS_IDEAS_CAP }, () => ({ id: huge })),
        businesses: Array.from({ length: PROGRESS_BUSINESSES_CAP }, () => ({ id: huge })),
      })
    );
    expect(JSON.stringify(walked).length).toBeLessThan(20_000);
    expect(walked.truncated).toBe(true);
  });

  it("an over-long IDEA id is SKIPPED (null), never truncated, and the index survives", () => {
    // Never sliced: a truncated id would collide with another and the client's
    // `legacy-idea-{index}` minting / Business.ideaId links would mis-resolve.
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "keep" }, { id: "x".repeat(PROGRESS_ID_MAX_CHARS + 1) }] })
    );
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      ["keep", 0],
      [null, 1],
    ]);
    expect(walked.truncated).toBe(true);
    expect(JSON.stringify(walked)).not.toContain("xxxx");
  });

  it("an id EXACTLY at the cap survives and does not flag", () => {
    const at = "y".repeat(PROGRESS_ID_MAX_CHARS);
    const walked = walkSaveDoc(doc({ ideas: [{ id: at }] }));
    expect(walked.ideas[0]!.id).toBe(at);
    expect(walked.truncated).toBe(false);
  });

  it("an over-long BUSINESS id drops the whole entry (a business is keyed by id)", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [{ id: "b".repeat(PROGRESS_ID_MAX_CHARS + 1) }, { id: "keep" }],
      })
    );
    expect(walked.businesses.map((b) => b.id)).toEqual(["keep"]);
    expect(walked.truncated).toBe(true);
  });

  it("an over-long ideaId reads as null — the business survives, unlinked", () => {
    const walked = walkSaveDoc(
      doc({ businesses: [{ id: "b", ideaId: "i".repeat(PROGRESS_ID_MAX_CHARS + 1) }] })
    );
    expect(walked.businesses[0]!.ideaId).toBeNull();
    expect(walked.businesses[0]!.id).toBe("b");
    expect(walked.truncated).toBe(true);
  });
});

/* ------------------------------------------ businesses carry their own flow */

describe("progress rules — a business is its own flow unit", () => {
  // Phase 4-5 completions write ONLY to the business maps: `markTaskDone` in
  // the FP client branches on grow/scale and returns after writing them, never
  // touching the idea's. This fixture is the one that would have caught reading
  // recency off the idea alone.
  const OLD = NOW_MS - 90 * 86_400_000; // the child's last Validate stamp
  const FRESH = NOW_MS - 2 * 86_400_000; // …but they did Grow work this week
  const growingChild = doc({
    ideas: [{ id: "idea-1", doneByTask: { "3.5.5": true }, doneAtByTask: { "3.5.5": OLD } }],
    businesses: [
      {
        id: "b-1",
        ideaId: "idea-1",
        doneByTask: { "4.1.1": true, "4.2.1": true },
        doneAtByTask: { "4.1.1": FRESH - 86_400_000, "4.2.1": FRESH },
      },
    ],
  });

  const rowsFor = (ids: readonly string[]) =>
    shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [{ profile_id: "p-1", doc: growingChild }],
      ids
    )[0]!;

  it("the BUSINESS reports the fresh recency the idea cannot", () => {
    const row = rowsFor(["4.1.1", "4.2.1"]);
    // Read the idea alone and this daily-active child looks 90 days stalled —
    // and the whole Grow/Scale half of the board reads permanently 100% stalled.
    expect(row.ideas[0]!.lastCompletionAt).toBe(OLD);
    expect(row.businesses[0]!.lastCompletionAt).toBe(FRESH);
  });

  it("the business recency is computed PRE-filter, like the idea's", () => {
    const row = rowsFor(["4.1.1"]);
    expect(row.businesses[0]!.doneAtByTask).toEqual({ "4.1.1": FRESH - 86_400_000 });
    expect(row.businesses[0]!.lastCompletionAt).toBe(FRESH);
  });

  it("the business answers hasCompletionsOutsideRequest for itself", () => {
    expect(rowsFor(["4.1.1"]).businesses[0]!.hasCompletionsOutsideRequest).toBe(true);
    expect(rowsFor(["4.1.1", "4.2.1"]).businesses[0]!.hasCompletionsOutsideRequest).toBe(false);
  });

  it("an IDEA-LESS business still has a recency — it is a flow unit on its own", () => {
    const row = shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [
        {
          profile_id: "p-1",
          doc: doc({
            businesses: [
              { id: "b-1", doneByTask: { "4.1.1": true }, doneAtByTask: { "4.1.1": FRESH } },
            ],
          }),
        },
      ],
      ["4.1.1"]
    )[0]!;
    expect(row.businesses[0]!.ideaId).toBeNull();
    expect(row.businesses[0]!.lastCompletionAt).toBe(FRESH);
  });
});

/* ----------------------------------------- the entry cap counts COMPLETIONS */

describe("progress rules — the entry cap counts completions, not entries", () => {
  it("THE ATTACK: junk `false` keys written FIRST cannot starve the real completions", () => {
    // JSON preserves insertion order, so 500 `false` keys placed before the real
    // work would exhaust the cap first: the filtered maps come back empty and
    // `hasCompletionsOutsideRequest` false, so the child reads as "never reached
    // this criterion" while their own client shows full progress.
    const padded: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) padded[`junk-${i}`] = false;
    padded["1.1.1"] = true;
    padded["1.1.2"] = true;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: padded }] }));
    expect(walked.ideas[0]!.doneByTask).toEqual({ "1.1.1": true, "1.1.2": true });
    expect(walked.truncated).toBe(false);
  });

  it("the same child, shaped: the real completions are visible and countable", () => {
    const padded: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) padded[`junk-${i}`] = false;
    padded["1.1.5"] = true;
    padded["3.1.1"] = true;
    const row = shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [{ profile_id: "p-1", doc: doc({ ideas: [{ id: "i", doneByTask: padded }] }) }],
      ["1.1.5"]
    )[0]!;
    expect(row.ideas[0]!.doneByTask).toEqual({ "1.1.5": true });
    expect(row.ideas[0]!.hasCompletionsOutsideRequest).toBe(true);
  });

  it("NUMERIC junk keys cannot push a real task id past the entry cap", () => {
    // The second half of the entry-cap exploit, and the one the `false` fix
    // missed. ECMAScript enumerates ARRAY-INDEX-LIKE keys FIRST, ascending,
    // whatever order they were written in — so a doc can park the real id at
    // position 500 without depending on insertion order at all. The values are
    // `true`, so the false-filter never sees them. Left open, the child ships
    // `doneByTask:{}` with `hasCompletionsOutsideRequest:false` and reads as
    // "never reached this criterion" while their own client shows full progress.
    const hostile: Record<string, boolean> = { "1.2.3": true };
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) hostile[String(i)] = true;
    // The premise: JS really does hand back the numeric keys first.
    expect(Object.keys(hostile)[0]).toBe("0");

    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: hostile }] }));
    expect(walked.ideas[0]!.doneByTask).toEqual({ "1.2.3": true });
  });

  it("drops array-index-like keys but keeps look-alikes that are ordinary strings", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "i",
            // "7" is an array index; the rest are not (their canonical
            // spellings differ), so they stay ordinary string keys.
            doneByTask: { "7": true, "07": true, "1.0": true, "-1": true, "1.2.3": true },
          },
        ],
      })
    );
    expect(Object.keys(walked.ideas[0]!.doneByTask).sort()).toEqual(
      ["-1", "07", "1.0", "1.2.3"].sort()
    );
  });

  it("the SCAN is bounded too, not just the output", () => {
    // The entry cap bounds what reaches the wire; nothing bounded what walking
    // costs, and narrowTimestampMap deliberately scans PAST the cap to compute
    // recency. A million-key map is cheap to store (the doc CHECK measures the
    // COMPRESSED datum) and expensive to walk, for every child, every refresh.
    const huge: Record<string, number> = {};
    for (let i = 0; i < PROGRESS_MAP_SCAN_CAP + 500; i++) huge[`k-${i}`] = 1_000 + i;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneAtByTask: huge }] }));
    expect(walked.truncated).toBe(true);
    // Recency covers everything SCANNED, and stops where the scan stopped —
    // stated so the bound is understood as a deliberate loss, not a bug.
    expect(walked.ideas[0]!.lastCompletionAt).toBe(1_000 + PROGRESS_MAP_SCAN_CAP - 1);
  });

  it("500 REAL completions still cap and flag", () => {
    const big: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) big[`k-${i}`] = true;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: big }] }));
    expect(Object.keys(walked.ideas[0]!.doneByTask)).toHaveLength(PROGRESS_MAP_ENTRIES_CAP);
    expect(walked.truncated).toBe(true);
  });

  it("lastCompletionAt SURVIVES entry-cap truncation", () => {
    // The newest stamps sit past entry 500 in key order. Computing recency over
    // the cap-truncated survivors would report a months-old date and drop the
    // child into the stalled column while they are working today.
    const stamps: Record<string, number> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) stamps[`k-${i}`] = 1_000 + i;
    const newest = 1_000 + PROGRESS_MAP_ENTRIES_CAP + 99;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneAtByTask: stamps }] }));
    expect(Object.keys(walked.ideas[0]!.doneAtByTask)).toHaveLength(PROGRESS_MAP_ENTRIES_CAP);
    expect(walked.truncated).toBe(true);
    expect(walked.ideas[0]!.lastCompletionAt).toBe(newest);
    // …and the newest stamp is genuinely NOT in the emitted map, so the
    // assertion above cannot be satisfied by the survivors.
    expect(walked.ideas[0]!.doneAtByTask[`k-${PROGRESS_MAP_ENTRIES_CAP + 99}`]).toBeUndefined();
  });
});

/* ------------------------------------- untimestamped completions (semantics) */

describe("progress rules — an untimestamped completion", () => {
  it("counts as a completion but carries NO recency, and the pair is distinguishable", () => {
    // Pre-timestamp play: `done: true` with no stamp. It COUNTS toward
    // throughput and the next-incomplete walk, but it can contribute no cycle
    // time. The client must read null-recency-WITH-completions as STALLED (the
    // plan's rule), not as "unknown" and not as active — an idea that has moved
    // but cannot say when has, by definition, no evidence of recent movement.
    const rows = shapeProgress(
      [child({ id: "c-1" })],
      [{ id: "p-1", child_id: "c-1" }],
      [
        {
          profile_id: "p-1",
          doc: doc({
            ideas: [
              { id: "untimestamped", doneByTask: { "1.1.5": true } },
              { id: "brand-new" },
            ],
          }),
        },
      ],
      ["1.1.5"]
    );
    const [untimestamped, brandNew] = rows[0]!.ideas;
    expect(untimestamped!.lastCompletionAt).toBeNull();
    expect(brandNew!.lastCompletionAt).toBeNull();
    // The maps are what tell the two apart — the recency alone does not.
    expect(untimestamped!.doneByTask).toEqual({ "1.1.5": true });
    expect(brandNew!.doneByTask).toEqual({});
  });

  it("an untimestamped completion OUTSIDE the request still sets the outside flag", () => {
    const [idea] = ideasFor({ ideas: [{ id: "i", doneByTask: { "3.1.1": true } }] }, ["1.1.5"]);
    expect(idea!.lastCompletionAt).toBeNull();
    expect(idea!.hasCompletionsOutsideRequest).toBe(true);
  });
});

/* ------------------------- the outside-flag is computed on UNFILTERED maps */

describe("progress rules — hasCompletionsOutsideRequest, end to end", () => {
  const bothSides = {
    ideas: [
      {
        id: "i",
        doneByTask: { "1.1.5": true, "3.1.1": true },
        doneAtByTask: { "1.1.5": 1_000, "3.1.1": 2_000 },
      },
    ],
  };

  it("is TRUE through shapeProgress when work sits outside the window", () => {
    // A refactor that filtered the maps BEFORE computing this would return
    // false here and stay green on the helper's own unit tests.
    const [idea] = ideasFor(bothSides, ["1.1.5"]);
    expect(idea!.doneByTask).toEqual({ "1.1.5": true });
    expect(idea!.hasCompletionsOutsideRequest).toBe(true);
  });

  it("is FALSE once the window covers everything the idea has done", () => {
    const [idea] = ideasFor(bothSides, ["1.1.5", "3.1.1"]);
    expect(idea!.hasCompletionsOutsideRequest).toBe(false);
  });
});

/* -------------------------------------------------------------- module purity */

describe("progress rules — module purity", () => {
  it("imports nothing from next or @supabase, and no server-only side-effect import", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "app/api/fp/progress/progress-rules.ts"),
      "utf8"
    );
    // BOTH forms: `from "x"` misses a bare side-effect `import "x"` — including
    // `import "server-only"`, the very specifier this test asserts against.
    const imports = [...src.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec.startsWith("next"), spec).toBe(false);
      expect(spec.startsWith("@supabase"), spec).toBe(false);
      expect(spec === "server-only", spec).toBe(false);
    }
    expect(imports.length).toBeGreaterThan(0);
  });
});
