import { describe, expect, it } from "vitest";
import { REVIEW_STATUSES, type ReviewStatus } from "../lib/constants";
import { queueCounts } from "../lib/reviews-rules";

const items = (...statuses: ReviewStatus[]) => statuses.map((reviewStatus) => ({ reviewStatus }));

describe("queueCounts (R14 needs-review badge + per-stage chip counts)", () => {
  it("needsReview counts exactly the deposit-gated statuses (post-draft, pre-offered)", () => {
    const { needsReview } = queueCounts(
      items("submitted", "in_review", "invited", "offered", "member", "draft")
    );
    expect(needsReview).toBe(3);
  });

  it("offered and member are excluded — they can already reserve", () => {
    expect(queueCounts(items("offered", "member")).needsReview).toBe(0);
  });

  it("an empty queue yields zero everywhere (badge hides)", () => {
    const { needsReview, byStage } = queueCounts([]);
    expect(needsReview).toBe(0);
    for (const s of REVIEW_STATUSES) expect(byStage[s], s).toBe(0);
  });

  it("byStage counts sum to the total item count", () => {
    const all = items("submitted", "submitted", "in_review", "offered", "member", "invited");
    const { byStage } = queueCounts(all);
    const total = REVIEW_STATUSES.reduce((sum, s) => sum + byStage[s], 0);
    expect(total).toBe(all.length);
    expect(byStage.submitted).toBe(2);
    expect(byStage.in_review).toBe(1);
  });
});
