---
date: 2026-07-10
topic: gauntlet-content-taxonomy
---

# Gauntlet Content Taxonomy (`artifacts/gauntletcontent.md`)

## Problem Frame

The Gauntlet (`/gauntlet`) is a speed-based FastMath boss battle: correct answers do damage scaled by speed and streak, so every question must be answerable by a fluent student in a few seconds of total response time — thinking plus answer entry. Today the game covers eight elementary topics (×, ÷, +, −, GCD, LCM, common denominator, triangle congruence — see `app/gauntlet/game/problems.ts`).

The product thesis is that from Pre-Algebra through AP Calculus BC, a large set of **building-block skills** (e.g., seeing that 7 and 12 are the pair summing to 19 and multiplying to 84 in `x² + 19x + 84`) can be drilled to automaticity, lightening the cognitive load of the slow, multi-step problems (e.g., cosine law) that Gauntlet will never host. There is currently no map of which skills across this range are drillable at Gauntlet speed. Without it, content expansion is ad hoc.

The deliverable is a research/taxonomy document — `artifacts/gauntletcontent.md` — that a future engineering cycle uses to add content to the game. No game code changes in this cycle.

## Requirements

**Coverage and organization**
- R1. Cover the full range Pre-Algebra through AP Calculus BC, organized by standard course sequence: Pre-Algebra → Algebra 1 → Geometry → Algebra 2 → Trigonometry/Precalculus → AP Calculus AB → BC-only topics. A **Foundational kernels** section precedes Pre-Algebra to host sub-Pre-Algebra skills referenced as kernels by later entries. Each course section is swept against a named completeness checklist — the AP Calculus AB/BC Course and Exam Description units for the calculus sections, a stated standard course outline for Pre-Algebra through Precalculus — and notes its source, so "nothing dropped" is auditable.
- R2. Enumerate unit-incremental topics at fine granularity — on the order of hundreds of entries, each a single skill or fact family (the grain of one drillable thing), not chapter-level units. Every entry carries a stable slug ID (e.g., `alg1.factor-pairs-sum-product`); kernel citations under R6 reference slugs, not prose names, so kernel in-degree is mechanically countable and the completeness sweep auditable.
- R3. Each topic entry carries: a Gauntlet-friendliness rating (**High / Medium / Low**), a one-line rationale, and — for High and Medium topics — one sample question with its answer, the input format it requires, and a one-line parameter-range note (e.g., "coefficients 2–12, factor pairs with roots ≤ 12") so a generator's bounds aren't invented later.

**Rating semantics**
- R4. The rating measures **total response time** for a fluent student — thinking plus answer entry under the sample's input format (no paper, no multi-step derivation). Operational tiers: **High** ≈ recall or a single mental step, roughly ≤3s total; **Medium** ≈ one mental transformation, roughly 3–8s total, still no paper; **Low** = inherently multi-step at any speed. A topic whose thinking is instant but whose required input is slow to enter (e.g., a long typed expression) rates down accordingly. Timings assume the game's touch-first input surfaces (format-specific on-screen pads, like the shipped numeric keypad), not a physical keyboard. The eight existing game topics are rated first, as worked examples of the tier definitions, and serve as calibration anchors for all later ratings.
- R5. Ratings assume an **expanded lightweight input set** the game could cheaply support: single number, two numbers (e.g. "7, 12"), multiple choice, short expression (e.g. "(x+7)(x+12)", "2x"), and true/false. Each High/Medium sample states which of these it needs, so the document doubles as a map of which new input types unlock which content. Format-selection rule: each topic is rated under the most production-like lightweight format that fits it (single number → two numbers → short expression → multiple choice, in that order of preference); MC is a topic's native format only when the real skill is genuinely discriminative (e.g., naming the congruence criterion) — an MC rendering of a production skill is a degraded fallback, never the basis for its rating. (Today's engine supports single-numeric and multiple-choice only — new formats are proposals, not existing capability.) Any sample using the two-number or short-expression format must also state its accepted-answer rule (e.g., "pair, order-insensitive"; "factored form, factors in either order, whitespace ignored") — the engine checks answers by exact string match, so without the rule the sample does not actually fix the answer shape. Note the current numeric input auto-judges the instant input length reaches the answer's length (no submit action) and strips everything but digits and minus; variable-length typed formats can't auto-judge that way, so each new format assumes an explicit Enter-to-submit model unless its entry states otherwise, entry-time estimates include the submit keystroke, and accepted-answer rules are the spec for the normalization layer submission implies.

**Low-topic treatment (fast-kernel extraction)**
- R6. Low-rated topics are still listed (rating + one-line reason why they're too slow), and each one explicitly names the fast building-block sub-skills hiding inside it, cross-referencing those kernels' own entries (e.g., cosine law → Low, but "evaluate cos 60° instantly" and "square small integers" are High entries). High and Medium entries may likewise declare their prerequisite kernels by slug, so kernel in-degree reflects true dependency weight rather than just slow-topic membership. Where a Low topic genuinely has no drillable kernel beyond entries already listed elsewhere, the entry says so explicitly — absence is a recorded judgment, not a format violation. Nothing in the curriculum is silently dropped.

**Engineering guidance**
- R7. After the taxonomy, include a prioritized "build this first" section: the ~20–30 highest-leverage topics (e.g., sum-product factor pairs, fraction operations, exact trig values, derivative rules), ranked primarily by **kernel in-degree** — how many other entries, of any rating, cite the skill as a prerequisite kernel. The primary ranking counts citations from Foundational kernels through Algebra 2 (the current audience), with full-range in-degree shown as a secondary column so thesis-wide leverage stays visible; ties broken by author judgment, with a one-line justification each. Each pick is flagged **current-engine** or **needs input type X**, and the section calls out the zero-engine-work starter subset. "Current-engine" means precisely what today's engine grades: a single integer answer (optionally negative — the input strips all other characters) or multiple choice; a decimal or fractional answer is *not* current-engine even though it's a "single number". Picks flagged **needs input type X** also note whether an MC fallback is acceptable or the pick is **no-MC-fallback** (production practice is the point), so eng knows which picks are truly gated on new input work.
- R8. The document lives at `artifacts/gauntletcontent.md`, single file, and is written so the future eng cycle can act on it directly (self-contained; no reading of this requirements doc required).

## Success Criteria

- A reader can pick any unit-level topic from the named course checklists (Pre-Algebra to Calc BC) and find it — either as a rated entry or as a named kernel under a Low entry.
- Engineering can select a topic from the doc and implement its generator without inventing *product* behavior: the sample plus parameter-range note fix the question shape, answer shape, accepted-answer rule, input format, and value bounds. (Difficulty curves and edge-case handling remain engineering judgment, as with the existing generators.)
- The top-picks section gives a defensible next-content roadmap without further product input.
- Topic count lands in the intended "hundreds" range, at drillable-skill granularity.

## Scope Boundaries

- **No game code changes** — no new generators, topics, input types, or UI in this cycle. The doc informs a future cycle.
- **No band/level design** — mapping topics to the game's grade bands, unlock order, boss assignment, or difficulty curves is future work (the top-picks ranking is leverage-based, not sequencing design).
- **Not a lesson plan** — no teaching content, worked explanations, or pedagogy beyond the sample Q&A.
- **Curriculum anchor is the US/AP sequence** (per the request "Pre-Algebra … AP Calculus BC"); no Ontario/Common Core standard-code cross-referencing.
- Arithmetic below Pre-Algebra (already in the game) is out of scope except where it appears as a kernel of a listed topic.

## Key Decisions

- **Expanded lightweight input set (not current-engine-only, not unconstrained)**: rates content on its merits while still telling eng exactly which cheap input types unlock which topics. Current-engine-only would force great drills (factoring, derivatives) into multiple choice; no constraint would leave eng without buildability guidance.
- **Extract the fast kernel from Low topics**: the product thesis is precisely that slow topics contain fast sub-skills; dropping Low topics or rating-and-moving-on would lose the most valuable mapping in the document.
- **Include a prioritized top-picks section**: cheap to add, converts a catalog into an actionable roadmap for the future eng cycle.
- **Single file in `artifacts/`**: matches how the project stores planning artifacts (`artifacts/roadmap.md`); user specified the location and filename.
- **Uniform full treatment across all courses** (decided at review, 2026-07-10): every High/Medium topic from Pre-Algebra through BC carries the complete spec (sample, parameter range, accepted-answer rule). Depth-tiering by audience (full spec only through Algebra 2) was considered and rejected — the document should be future-proof and self-contained when the game courts older students.
- **Full-range coverage is a thesis map, not an audience claim**: the shipped game targets grade 3–8 bands with a young presentation, so near-term build value concentrates in Pre-Algebra through Algebra 2; the Trig/Precalc and Calculus sections are forward inventory for older students the game hasn't yet courted. Coverage depth should not be read as build priority — R7's ranking carries priority.

## Outstanding Questions

### Deferred to Planning
- [Affects R2][Technical] Section chunking strategy for authoring a document this size (hundreds of entries) in one file while keeping quality uniform — likely authored course-by-course, with a final consistency pass calibrating ratings against R4's tier definitions and reconciling duplicate kernel slugs (merging synonyms, recomputing in-degree) before R7's ranking is finalized.
- [Affects R1][Needs research] Which standard course outline to adopt as the completeness checklist for Pre-Algebra through Precalculus (the AP CED covers the calculus sections).

## Next Steps

-> `/ce:plan` for structured implementation planning — or generate `artifacts/gauntletcontent.md` directly, since the deliverable is a document rather than code.
