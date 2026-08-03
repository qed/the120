import { describe, expect, it } from "vitest";
import {
  FEEDBACK_BANDS,
  FEEDBACK_BODY_MAX_CHARS,
  FEEDBACK_DAILY_CAP,
  FEEDBACK_TASK_ID_MAX_CHARS,
  isValidFeedbackBand,
  isValidFeedbackBody,
  isValidFeedbackTaskId,
} from "../fp-task-feedback-rules";

describe("fp-task-feedback rules — task_id", () => {
  it("accepts the brief's task-number shape", () => {
    for (const id of ["1.1.1", "1.2.5", "5.5.5", "12.3.4", "2.3.6"]) {
      expect(isValidFeedbackTaskId(id), id).toBe(true);
    }
  });

  it("rejects everything that is not exactly three integer components", () => {
    for (const id of [
      "", // empty
      "1", // one component
      "1.1", // two components
      "1.1.1.1", // four components
      "a.1.1", // non-digit
      "1.1.a",
      "1..1", // empty component
      ".1.1", // leading dot
      "1.1.", // trailing dot
      "1.1.1 ", // trailing space
      " 1.1.1",
      "1.1.-1", // sign
      "1.1.1\n2.2.2", // no multiline sneak ($ must not match mid-string)
    ]) {
      expect(isValidFeedbackTaskId(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("enforces the length bound", () => {
    const atBound = "12345.12345.1234"; // 16 chars
    expect(atBound).toHaveLength(FEEDBACK_TASK_ID_MAX_CHARS);
    expect(isValidFeedbackTaskId(atBound)).toBe(true);
    expect(isValidFeedbackTaskId("12345.12345.12345")).toBe(false);
  });
});

describe("fp-task-feedback rules — band", () => {
  it("accepts exactly the four bands", () => {
    expect(FEEDBACK_BANDS).toEqual(["g3_5", "g6_8", "g9_12", "unknown"]);
    for (const band of FEEDBACK_BANDS) {
      expect(isValidFeedbackBand(band)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const band of ["", "g3-5", "G3_5", "g6_8 ", "all", "null"]) {
      expect(isValidFeedbackBand(band), band).toBe(false);
    }
  });
});

describe("fp-task-feedback rules — body", () => {
  it("EMPTY body is valid — a tap with no words is stuck signal", () => {
    expect(isValidFeedbackBody("")).toBe(true);
  });

  it("accepts up to the cap, refuses one past it", () => {
    expect(isValidFeedbackBody("x".repeat(FEEDBACK_BODY_MAX_CHARS))).toBe(true);
    expect(isValidFeedbackBody("x".repeat(FEEDBACK_BODY_MAX_CHARS + 1))).toBe(false);
  });
});

describe("fp-task-feedback rules — daily cap", () => {
  it("is the documented 50/day bound", () => {
    expect(FEEDBACK_DAILY_CAP).toBe(50);
  });
});
