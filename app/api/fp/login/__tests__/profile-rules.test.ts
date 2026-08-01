import { describe, expect, it } from "vitest";
import {
  classifyInsertConflict,
  deriveHandle,
  deriveHandleWithSuffix,
  HANDLE_PATTERN,
} from "../profile-rules";

const HANDLE_SHAPE = /^[a-z0-9]{1,30}$/; // the DB check constraint, verbatim

/* ------------------------------------------------------- sequential handles */

describe("deriveHandle", () => {
  it("derives a lowercase alphanumeric handle from the first name", () => {
    expect(deriveHandle("Maya", 0)).toBe("maya");
    expect(deriveHandle("Zoë", 0)).toBe("zoe");
    expect(deriveHandle("Mary Jane", 0)).toBe("maryjane");
  });

  it("collision retries produce valid, distinct handles", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const handle = deriveHandle("Maya", attempt);
      expect(handle).toMatch(HANDLE_SHAPE);
      expect(seen.has(handle)).toBe(false);
      seen.add(handle);
    }
    expect(deriveHandle("Maya", 1)).toBe("maya2");
  });

  it("satisfies the DB constraint even for hostile or long names", () => {
    for (const name of ["", "!!!", "尚美", "x".repeat(60), " A "]) {
      for (const attempt of [0, 1, 4]) {
        expect(deriveHandle(name, attempt)).toMatch(HANDLE_SHAPE);
      }
    }
    // Long base + suffix still fits inside the 30-char cap and stays distinct.
    expect(deriveHandle("x".repeat(60), 0)).not.toBe(deriveHandle("x".repeat(60), 1));
  });

  it("exports HANDLE_PATTERN matching the DB check constraint verbatim", () => {
    expect(HANDLE_PATTERN.source).toBe(HANDLE_SHAPE.source);
  });
});

/* ---------------------------------------------------- random-suffix fallback */

describe("deriveHandleWithSuffix", () => {
  it("appends the caller-minted suffix to the folded base", () => {
    expect(deriveHandleWithSuffix("Maya", "9f3a")).toBe("maya9f3a");
    expect(deriveHandleWithSuffix("Mary Jane", "0c1")).toBe("maryjane0c1");
  });

  it("truncates the base so base+suffix always satisfies HANDLE_PATTERN", () => {
    const handle = deriveHandleWithSuffix("x".repeat(60), "abcd");
    expect(handle).toMatch(HANDLE_SHAPE);
    expect(handle).toHaveLength(30);
    expect(handle.endsWith("abcd")).toBe(true);
  });

  it("still yields a valid handle for a name with no usable characters", () => {
    expect(deriveHandleWithSuffix("!!!", "abcd")).toBe("playerabcd");
    expect(deriveHandleWithSuffix("!!!", "abcd")).toMatch(HANDLE_SHAPE);
  });

  it("stays pure — identical inputs give identical output, distinct suffixes differ", () => {
    expect(deriveHandleWithSuffix("Maya", "abcd")).toBe(deriveHandleWithSuffix("Maya", "abcd"));
    expect(deriveHandleWithSuffix("Maya", "abcd")).not.toBe(
      deriveHandleWithSuffix("Maya", "efgh")
    );
  });
});

/* ---------------------------------------------------- 23505 classification */

describe("classifyInsertConflict", () => {
  it("classifies a handle-unique violation as retryable", () => {
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_handle_key"'
      )
    ).toBe("handle");
  });

  it("classifies user_id / child_id violations as adopt-the-existing-row", () => {
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_user_id_key"'
      )
    ).toBe("identity");
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_child_id_key"'
      )
    ).toBe("identity");
  });

  it("returns unknown for anything else — the caller must fail, not guess", () => {
    expect(classifyInsertConflict("some other error")).toBe("unknown");
  });
});
