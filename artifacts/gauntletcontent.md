# The Gauntlet Content Taxonomy — Pre-Algebra to AP Calculus BC, rated for boss-battle speed

**What this is:** the single, self-contained map of every drillable math skill from Pre-Algebra through AP Calculus BC, each rated for Gauntlet-friendliness (High/Medium/Low total response time for a fluent student), with sample questions, input-format requirements, kernel cross-references, and a prioritized "build this first" list. **Who consumes it:** the future content-expansion engineering cycle — roadmap item **G2** (Pathway system, `artifacts/roadmap.md`) is explicitly blocked on this document. **What it is not:** a code change. Nothing in this document alters the game as it runs today; every input format, submit model, and rendering capability beyond the current engine is a **PROPOSAL**, labeled as such. The engine contract below describes today's shipped behavior with code pointers; everything else is a spec for work not yet scheduled.

---

## How to read this document

**Ratings are total response time** — thinking time *plus* answer-entry time — for a *fluent* student (one who has already automatized the skill). An answer that is fast to think but slow to enter rates down.

| Tier | Total response time | What it means |
|---|---|---|
| **High** | ≈ ≤3s | Pure recall or one mental step |
| **Medium** | ≈ 3–8s | One mental transformation, no paper |
| **Low** | Inherently multi-step at any speed | Never Gauntlet-hosted directly; mined for fast kernels instead |

**Format-selection preference order.** When a skill could be asked several ways, entries prefer (earlier = better for game feel):

1. `single-number`
2. `fraction` / `decimal` — used where the mathematically natural answer is non-integer, never to dodge a harder format
3. `two-numbers`
4. `short-expression`
5. `multiple-choice` (last resort: MC leaks answer candidates and caps difficulty)

**½ vs 0.5 rule:** for values expressible as either a fraction or a decimal, the *curriculum-natural* form wins (probability of a coin flip is ½; a percent-to-decimal conversion is 0.35), and the entry states which format it chose. One entry, one format — never "either accepted".

**Current-engine definition.** An entry is *current-engine* if and only if its answer is a **single integer** — negative allowed in principle, the judge grades any digits-and-minus string (see the engine contract's touch-minus-key caveat) — **or multiple choice**. Decimal and fraction answers are *never* current-engine, even though they are "single numbers": the input strip regex deletes `.` and `/` before judging. Everything else needs proposed input work.

**Entry grammar.** Every rated entry uses this exact record shape:

```text
### <slug> — <Skill name>
Rating: <High|Medium|Low> · Format: <format-id> [· Render: <render-flag>] [· Surface-sensitive]
Why: <one-line rationale referencing the tier definition>
Sample: <prompt> → <answer> · Rule: <rule-id> · Params: <parameter-range note>
Kernels: [<slug>, <slug>]
```

Rules of the grammar:

- **`Rating:` line is a machine-parseable invariant.** It always begins with the fixed prefix `Rating:` followed by exactly one of `High`, `Medium`, `Low`, then ` · Format: <format-id>` (format ids from the Input-format legend). Scripts count on this.
- **`Render:` flag is optional and default-omitted.** Omitted means the prompt is a plain text string the current engine can already display. The only permitted values are `unicode-inline` (renderable with Unicode alone, e.g. `x² + 19x + 84`), `needs-math-render` (stacked fractions, radicals with vinculum, integrals — needs a math renderer), and `needs-figure` (needs a drawn figure, as triangle congruence does today). Only exceptions are written out.
- **`Surface-sensitive` marker (optional).** Present when the entry's tier would flip if the format's assumed entry time were off by roughly 2×. These entries are the finite re-rating worklist for the future input-work cycle if the shipped input surface diverges from the assumptions below.
- **`Why:` line** — one sentence tying the rating to the tier definition.
- **`Sample:` line** — a concrete prompt and answer, the accepted-answer `Rule:` id (from the Accepted-answer rule legend), and a `Params:` parameter-range note bounding the values a generator should produce.
- **`Kernels:` line is a machine-parseable invariant.** Either a bracketed slug list `Kernels: [prealg.percent-to-decimal, fk.times-tables]` — or, verbatim, the sentence `Kernels: No drillable kernel beyond entries already listed` (optionally followed by a parenthetical `(see <slug>…)` pointer). "No drillable kernel" is a recorded judgment, never a silent omission.
- **Low entries** carry only `Rating: Low`, `Why:`, and `Kernels:` — no Format, Render, Surface-sensitive, or Sample. Their job is kernel extraction, not hosting.
- **Cross-reference rows** (for topics canonically owned by an earlier course) are one-liners: `**<topic>** → see <canonical-slug> (owned by <course>)`.

**Conditional-rating disclaimer, stated plainly:** ratings for `short-expression`, `fraction`, `two-numbers`, `decimal`, and `true-false` entries are **conditional on building the assumed input surfaces** described in the Input-format legend. None of those surfaces exist today. The eight existing game topics are rated under the *same* assumed surfaces (not observed current behavior) so that calibration anchors and later entries share one time model.

---

## Engine contract (verified 2026-07-10)

Everything in this section describes shipped behavior, verified against the repository on 2026-07-10. Anything not listed here — and every format in the legend other than `single-number` (integer) and `multiple-choice` — is a **PROPOSAL**.

- **Answers are strings, judged by strict string equality.** `Problem.answer` is always a string (`app/gauntlet/game/problems.ts:45-54`). Numeric judging is `clean === problem.answer` (`app/gauntlet/components/Battle.tsx:178`; identical duplicated logic in `app/gauntlet/components/Trial.tsx:105-107`); choice judging is `c === problem.answer` (`Battle.tsx:186`, `Trial.tsx:174`). There is no numeric parsing, tolerance, or normalization layer beyond the strip below.
- **Numeric input strips everything but digits and minus.** `const clean = v.replace(/[^0-9-]/g, "")` (`Battle.tsx:175`, `Trial.tsx:103`). Decimal points, slashes, spaces, and letters are silently deleted before judging — which is why fractions and decimals are never current-engine.
- **Length-based auto-judge, no submit action.** The instant the cleaned input's length reaches the answer's length, the problem is judged (`Battle.tsx:177-180`, `Trial.tsx:105-108`). There is no Enter key, no submit button. A same-length wrong answer is judged **irrevocably on the final keystroke** — backspace exists only *before* the length is reached. A wrong answer shorter than the true answer is never judged at all; the input just waits.
- **Input kinds today are `numeric | choice`, nothing else** (`app/gauntlet/game/problems.ts:51`). Choice renders 2–5 tap buttons (`Battle.tsx:354-369`).
- **There is NO custom on-screen keypad.** Numeric input is a plain `<input inputMode="numeric">` (`Battle.tsx:342-352`, `Trial.tsx:157-166`); touch devices get whatever the OS keyboard provides. The origin brainstorm's reference to a "shipped numeric keypad" was factually wrong and is corrected here. **Negative-answer touch caveat:** the judge happily grades a leading `-` (the strip regex admits it), but iOS `inputMode="numeric"` keyboards may expose **no minus key**, so negative-answer entries carry touch-entry risk until a game-rendered pad (PROPOSAL) exists.
- **All current generator answers are positive integers.** Every generator in `app/gauntlet/game/problems.ts:81-201` (mul, div, add, sub, gcd, lcm, denom) emits a positive-integer answer string; congruence is choice. The `-` in the strip regex is currently never exercised.
- **Prompts are plain strings; the only bespoke figure is the triangle SVG.** Prompts render as text (`Battle.tsx:326-334`); triangle-congruence problems carry a `triangle` field (`problems.ts:53`) drawn by `TriangleFigure` (`Battle.tsx:321-325`). This is why the `Render:` flag exists: input format alone does not determine buildability.
- **Per-fact stable `key` convention — future generators must keep it.** Every problem carries a stable fact identity, e.g. `mul:7×8`, commutative-normalized so `7×8` and `8×7` share one key (`problems.ts:46-48`, minted at `problems.ts:83`). The adaptive weak-fact trainer depends on it: facts with >20% miss rate or >5000ms average are flagged weak (`app/gauntlet/GauntletGame.tsx:90-93`) and re-served ~35% of the time via `problemFromKey` (`problems.ts:217-266`). **PROPOSAL-facing rule:** future generators whose skill is a finite fact family should enumerate keys the same way (stable, order-normalized, reconstructible), or the trainer cannot track them.
- **Game timing economy — independent support for the tier lines.** Damage speed bonus decays to zero over 6000ms with par at 4000ms (`SPEED_WINDOW_MS`, `PAR_MS`, `Battle.tsx:14-16`; damage math `Battle.tsx:136-138`); the weak-fact threshold sits at 5000ms average (`GauntletGame.tsx:93`). A High (≤3s) answer reliably earns speed bonus; a Medium (3–8s) answer straddles par; anything inherently slower than ~8s fights the game economy itself — which is exactly why Low topics are not hosted.

---

## Input-format legend

Seven formats. For each: the **assumed input surface** (a hypothetical game-rendered pad — **explicitly a PROPOSAL, not precedent**; nothing below exists except the plain numeric input and MC buttons), a decomposable **entry-time model**, the **submit model**, **allowed characters**, **normalization** steps, and accept/reject examples. **No per-entry overrides are allowed:** engineering builds one input pipeline and one submit model per format, and entries may only select an accepted-answer rule id from the legend. If an entry seems to need different input behavior, the entry is wrong or the legend needs a new format — never a footnote.

**Shared entry-time model.** All formats assume a large-target game-rendered pad and a fluent student at **~250ms per tap** (digits, operators, Enter — each one tap). Entry time = taps × 250ms, + one Enter tap where the format is variable-length. This is the decomposable assumption the `Surface-sensitive` marker is measured against: if a shipped surface makes some token class ~2× slower (e.g. a shift-layer for parentheses), every Surface-sensitive entry gets re-rated; nothing else does.

**Shared submit model.** Variable-length formats are **Enter-to-submit** (PROPOSAL). The single exception is today's shipped behavior: fixed-length `single-number` integer entry keeps the **length-based auto-judge** (no Enter — see engine contract), and `multiple-choice` / `true-false` judge on tap. Documented here once; entries never restate it.

### `single-number` — single integer

- **Surface (current + PROPOSAL):** today, plain `<input inputMode="numeric">`; proposed, a game-rendered 3×4 pad — digits 0–9, minus, backspace. The proposed pad closes the iOS minus-key gap.
- **Entry time:** digits × 250ms (2-digit answer ≈ 0.5s). No Enter — auto-judge at answer length.
- **Allowed characters:** `0-9`, leading `-`.
- **Normalization (PROPOSAL — the current engine does none of this):** strip non-digits except leading minus; strip leading zeros (`007` → `7`, lone `0` kept); `-0` → `0`.
- **Accept/reject (answer `56`):** `56` ✓ · `056` ✓ after normalization (unreachable under auto-judge, kept for spec completeness) · `65` ✗.

### `two-numbers` — an ordered or unordered pair of integers

- **Surface (PROPOSAL):** digit pad + minus + a **separator key** (rendered `,`) + backspace + Enter. UI shows two slots filling left to right.
- **Entry time:** digits × 250ms + 250ms separator + 250ms Enter (two 1-digit values ≈ 1.0s).
- **Allowed characters:** `0-9`, `-`, one `,`.
- **Normalization:** split on comma; each side normalized as `single-number`; pair ordering handled by the rule (`pair-unordered` vs `pair-ordered`), never by the input surface.
- **Accept/reject (answer `7, 12` under `pair-unordered`):** `7,12` ✓ · `12,7` ✓ · `7,21` ✗. Under `pair-ordered` (answer `(3, -2)` as `3,-2`): `3,-2` ✓ · `-2,3` ✗.

### `multiple-choice` — tap one of 2–5 options

- **Surface (current):** tap buttons, shipped today (`Battle.tsx:354-369`).
- **Entry time:** 1 tap ≈ 250ms; scanning the options is thinking time and must be counted in the entry's rating (5 dense options ≈ +1–2s of scan).
- **Allowed characters / normalization:** none — tap identity is the answer.
- **Accept/reject:** tapped option string equals `answer` ✓; anything else ✗. Distractor design is generator work, but entries must not depend on more than 5 options.

### `short-expression` — a short symbolic expression

- **Surface (PROPOSAL):** two-row pad — digits 0–9 on one row; token row with the entry's variable(s), `+ − × ^ ( ) /`, backspace; Enter. No general keyboard, ever: the token row is generated from the answer's alphabet.
- **Entry time:** every token (digit, variable, operator, parenthesis) = 1 tap × 250ms + Enter. `(x+3)(x+4)` = 12 tokens ≈ 3.25s of pure entry — which is why most expression entries carry `Surface-sensitive` and why this format is late in the preference order.
- **Allowed characters:** digits, the entry's declared variables, `+ - × ^ ( ) /`.
- **Normalization:** delete all whitespace; canonicalize `*` and `×` to one internal product token; implicit multiplication (`2x`, `)(`) equals explicit; then apply the entry's rule (`expr-commutative-ws` or `factored-commutative-ws`).
- **Accept/reject (answer `(x+3)(x+4)` under `factored-commutative-ws`):** `(x+4)(x+3)` ✓ · `( x + 3 )( x + 4 )` ✓ · `x²+7x+12` ✗ (algebraically equal, wrong form — the skill being drilled *is* the form).

### `true-false` — binary judgment

- **Surface (PROPOSAL):** two large buttons, `TRUE` / `FALSE`. Judged on tap, like MC.
- **Entry time:** 1 tap ≈ 250ms.
- **Allowed characters / normalization:** none.
- **Accept/reject (answer `true`):** tap TRUE ✓ · tap FALSE ✗.
- **Design caution (binding on entries):** 50% guess rate means true-false entries must come in balanced generated families, and the format is only chosen when the drillable skill genuinely *is* a verification judgment (e.g. "Is 51 prime?" — no; that's `single-number`-able as "smallest prime factor of 51"; use TF only where no numeric restatement exists).

### `fraction` — a rational answer entered as a/b

- **Surface (PROPOSAL):** digit pad + minus + a **fraction-bar key** (rendered `/`) + backspace + Enter. UI shows numerator/denominator slots.
- **Entry time:** digits × 250ms + 250ms bar + 250ms Enter (1-digit/1-digit fraction ≈ 1.0s).
- **Allowed characters:** `0-9`, `-`, one `/`.
- **Normalization:** split on `/`; sign moved to numerator (`1/-2` → `-1/2`); denominator must be a positive integer after the move; then the entry's rule decides equivalence (`frac-lowest-terms` vs `frac-any-equivalent`). Integer-valued answers to fraction-format entries must still be entered as the format demands the rule states (e.g. `4/2` vs `2` — governed by the rule, see legend).
- **Accept/reject (answer `2/3` under `frac-lowest-terms`):** `2/3` ✓ · `4/6` ✗ (not lowest terms) · `0.67` ✗ (wrong format). Under `frac-any-equivalent`: `4/6` ✓.

### `decimal` — a decimal answer

- **Surface (PROPOSAL):** digit pad + minus + decimal-point key + backspace + Enter.
- **Entry time:** digits × 250ms + 250ms point + 250ms Enter (`0.35` ≈ 1.25s).
- **Allowed characters:** `0-9`, `-`, one `.`.
- **Normalization:** strip trailing zeros after the point (`0.350` → `0.35`); leading zero before the point optional (`.35` = `0.35`); `-0.0` → `0`; then `dec-exact` applies.
- **Accept/reject (answer `0.35`):** `0.35` ✓ · `.35` ✓ · `0.350` ✓ · `0.4` ✗ (no tolerance — `dec-exact` means exact value).

---

## Accepted-answer rule legend

The closed set of named accepted-answer rules. **Entries must cite exactly one rule id from this table — free-prose acceptance criteria are forbidden.** This legend *is* the spec for the future answer-normalization layer: each rule below is one comparison function engineering builds once. Adding a rule means editing this table, never an entry footnote.

| Rule id | Formats | Semantics | Accept / Reject example |
|---|---|---|---|
| `int-exact` | single-number | Normalized integer string equality. One canonical value; no tolerance. | ans `56`: `56` ✓ · `55` ✗ |
| `pair-unordered` | two-numbers | Both integers must match the answer pair **in either order**; each side `int-exact`. | ans `{7, 12}`: `12,7` ✓ · `7,11` ✗ |
| `pair-ordered` | two-numbers | Integers must match **in the stated order** (coordinates, quotient-then-remainder); each side `int-exact`. | ans `(3, -2)`: `3,-2` ✓ · `-2,3` ✗ |
| `frac-lowest-terms` | fraction | Value-equal AND numerator/denominator in lowest terms with positive denominator; integer values must be entered over 1 only if the entry's sample says so, otherwise a bare lowest-terms fraction is the only form. | ans `2/3`: `2/3` ✓ · `4/6` ✗ |
| `frac-any-equivalent` | fraction | Any a/b with positive denominator that is value-equal to the answer. | ans `1/2`: `3/6` ✓ · `2/3` ✗ |
| `dec-exact` | decimal | Exact decimal value after normalization (trailing/leading-zero insensitive). No rounding tolerance — entries must have terminating, canonical answers. | ans `0.35`: `.350` ✓ · `0.349` ✗ |
| `expr-commutative-ws` | short-expression | Whitespace-insensitive token match with **top-level commutative reordering** of addition terms and multiplication factors allowed. No other algebraic rewrite: no distribution, no simplification — an unsimplified equivalent is wrong. | ans `2x+7`: `7+2x` ✓ · `x+x+7` ✗ |
| `factored-commutative-ws` | short-expression | For products of parenthesized factors: factor order and whitespace insensitive; **inside** each factor, `expr-commutative-ws` applies; the expanded form is wrong. | ans `(x+3)(x+4)`: `(x+4)(x+3)` ✓ · `x²+7x+12` ✗ |
| `tf` | true-false | Tapped value equals the answer. | ans `true`: TRUE ✓ · FALSE ✗ |
| `mc` | multiple-choice | Tapped option string equals the answer string (today's shipped choice judge). | ans `SAS`: tap `SAS` ✓ · tap `SSS` ✗ |

Ten rules, closed set. Format ↔ rule compatibility is fixed by the Formats column; an entry citing an incompatible pair fails the Unit 9 audit mechanically.

---

## In-degree & citation rules

**In-degree** of a kernel = **count of distinct citing entry slugs**. All citation kinds are equal: a Low topic naming a kernel counts exactly the same as a High/Medium entry declaring it a prerequisite. Two columns are computed:

- **Primary (Foundational → Algebra 2):** count only citing entries whose **own section** is Foundational kernels through Algebra 2. This is the ranking column for the "Build this first" section.
- **Full-range (secondary):** count citing entries from all sections, Foundational through BC-only.

**Citation norm (binding):** High/Medium entries **must** declare prerequisite kernels whenever a registered kernel is a genuine prerequisite of the skill — "may" is not the standard, because in-degree has to measure dependency weight, not authoring salience. The Unit 9 consistency pass spot-checks citation *completeness* ("what kernels should this entry cite?") on a sample, not just citation resolution.

**Registry mediation:** citations may only use slugs that exist in the kernel registry; a kernel is registered at its first citation. Synonyms are prevented at citation time (check the registry before minting), never repaired later.

**Canonical ownership — first-course-owns.** A topic appearing in multiple course checklists (exact trig values, factoring) gets **one** canonical entry in the *earliest* course section. Later course sections satisfy their checklist sweep with a one-line **cross-reference row** pointing at the canonical slug. In-degree accrues **only** to the canonical entry — cross-reference rows neither cite nor collect citations.

**Slug convention.** `<prefix>.<kebab-skill-name>`, e.g. `alg1.factor-pairs-sum-product`. Prefixes:

| Prefix | Section |
|---|---|
| `fk` | Foundational kernels (sub-Pre-Algebra) |
| `prealg` | Pre-Algebra |
| `alg1` | Algebra 1 |
| `geo` | Geometry |
| `alg2` | Algebra 2 |
| `trig` | Trigonometry / Precalculus (joint) |
| `calcab` | AP Calculus AB |
| `calcbc` | BC-only |

- **Slugs are immutable once minted.** No renames, ever — citations and in-degree depend on it.
- **The prefix records the MINTING section, not a correctness claim about canonical level.** If a later course pass reveals an entry's true canonical home (e.g. an OpenStax-merged topic minted under `alg1.` that is really Pre-Algebra grain), the registry's **canonical-home note** is annotated — the slug is never renamed — and cross-references and in-degree follow the registry, not the prefix. Mis-homing is a recorded correction, not a contradiction.
- **Later course passes may add entries to *earlier* course sections** when a first citation demands a course-grain kernel the earlier sweep didn't surface — via the registry, with a source note (`added during <course> pass`). Safe because slugs are additive and in-degree is not computed until the consistency pass.

---

## Kernel registry

Live registry of every kernel slug in the document. Maintained continuously from the first authoring pass; citations may only use slugs listed here. In-degree columns are computed in the final consistency pass (blank until then).

| Slug | One-line definition | Owning entry | Canonical-home note | In-degree (primary) | In-degree (full) |
|---|---|---|---|---|---|
| fk.times-tables | Single-fact multiplication recall (factor families through 12) | self — calibration anchor | authored in calibration section; Foundational pass absorbs | | |
| fk.division-facts | Division facts as times-table inverses | self — calibration anchor | authored in calibration section; Foundational pass absorbs | | |
| fk.addition-facts | Addition facts and fluent mental addition (sums ≤ 50) | self — calibration anchor | authored in calibration section; Foundational pass absorbs | | |
| fk.subtraction-facts | Subtraction facts and fluent mental subtraction (within 50) | self — calibration anchor | authored in calibration section; Foundational pass absorbs | | |
| prealg.gcd-two-numbers | GCD of two small composite numbers | self — calibration anchor | authored in calibration section; Pre-Algebra pass absorbs | | |
| prealg.lcm-two-numbers | LCM of two small numbers | self — calibration anchor | authored in calibration section; Pre-Algebra pass absorbs | | |
| prealg.common-denominator | Least common denominator of two fractions | self — calibration anchor | authored in calibration section; Pre-Algebra pass absorbs | | |
| geo.triangle-congruence-criteria | Match a marked triangle pair to SSS/SAS/ASA/AAS/insufficient | self — calibration anchor | minted during calibration; Geometry pass absorbs | | |
| prealg.percent-to-decimal | Convert an integer percent to a decimal | self — Pre-Algebra pinned stub | — | | |
| prealg.simplify-fraction | Reduce a fraction to lowest terms | self — Pre-Algebra pinned stub | — | | |
| prealg.fraction-add-unlike | Add two unlike-denominator fractions | self — Pre-Algebra pinned stub | — | | |
| prealg.multiply-decimals | Multiply two one-place decimals | self — Pre-Algebra pinned stub | — | | |
| prealg.divisibility-rule-check | Verify divisibility via digit-sum / last-digit rules | self — Pre-Algebra pinned stub | — | | |
| prealg.compare-fractions | Verify a fraction inequality by cross-multiplication | self — Pre-Algebra pinned stub | — | | |
| alg1.factor-pairs-sum-product | Recover two numbers from their sum and product | self — Algebra 1 pinned stub | — | | |
| alg1.read-slope-intercept | Read m and b off slope-intercept form | self — Algebra 1 pinned stub | — | | |
| alg1.distribute-linear | Distribute a constant over a binomial | self — Algebra 1 pinned stub | — | | |
| alg1.factor-simple-quadratic | Factor a monic quadratic into two binomials | self — Algebra 1 pinned stub | — | | |
| alg1.solve-quadratic-by-factoring | Solve a monic quadratic by factoring (Low; kernel source) | self — Algebra 1 pinned stub | — | | |

---

## Completeness checklists (snapshots)

The auditable completeness checklists every course section is swept against. Snapshotted here (not linked) so the audit survives upstream reorganization; the snapshot, not the live site, is the checklist of record. All lists captured live **2026-07-10**.

### Khan Academy course unit lists (primary checklists)

Source: khanacademy.org course pages, as of 2026-07-10. Common-Core-derived unit-level outlines without standard codes.

**Pre-Algebra** (khanacademy.org/math/pre-algebra, 15 units): 1 Factors and multiples; 2 Patterns; 3 Ratios and rates; 4 Percentages; 5 Exponents intro and order of operations; 6 Variables & expressions; 7 Equations & inequalities introduction; 8 Percent & rational number word problems; 9 Proportional relationships; 10 One-step and two-step equations & inequalities; 11 Roots, exponents, & scientific notation; 12 Multi-step equations; 13 Two-variable equations; 14 Functions and linear models; 15 Systems of equations

**Algebra 1** (khanacademy.org/math/algebra; sweep units 1–15, units 16–17 are non-content): 1 Algebra foundations; 2 Solving equations & inequalities; 3 Working with units; 4 Linear equations & graphs; 5 Forms of linear equations; 6 Systems of equations; 7 Inequalities (systems & graphs); 8 Functions; 9 Sequences; 10 Absolute value & piecewise functions; 11 Exponents & radicals; 12 Exponential growth & decay; 13 Quadratics: Multiplying & factoring; 14 Quadratic functions & equations; 15 Irrational numbers

**Geometry** (khanacademy.org/math/geometry, 9 units): 1 Performing transformations; 2 Transformation properties and proofs; 3 Congruence; 4 Similarity; 5 Right triangles & trigonometry; 6 Analytic geometry; 7 Conic sections; 8 Circles; 9 Solid geometry

**Algebra 2** (khanacademy.org/math/algebra2, 12 units): 1 Polynomial arithmetic; 2 Complex numbers; 3 Polynomial factorization; 4 Polynomial division; 5 Polynomial graphs; 6 Rational exponents and radicals; 7 Exponential models; 8 Logarithms; 9 Transformations of functions; 10 Equations; 11 Trigonometry; 12 Modeling

**Trigonometry** (khanacademy.org/math/trigonometry, 4 units): 1 Right triangles & trigonometry; 2 Trigonometric functions; 3 Non-right triangles & trigonometry; 4 Trigonometric equations and identities

**Precalculus** (khanacademy.org/math/precalculus, 10 units): 1 Composite and inverse functions; 2 Trigonometry; 3 Complex numbers; 4 Rational functions; 5 Conic sections; 6 Vectors; 7 Matrices; 8 Probability and combinatorics; 9 Series; 10 Limits and continuity

The Trig/Precalc section sweeps both courses jointly with dedup (KA Precalc Unit 2 assumes the standalone Trigonometry course's foundations).

### OpenStax 2e tables of contents (per-course cross-check)

Source: openstax.org book details pages, as of 2026-07-10. Cross-check only — the checklist of record is Khan Academy; OpenStax catches KA course-boundary gaps.

**Prealgebra 2e**: 1 Whole Numbers; 2 The Language of Algebra; 3 Integers; 4 Fractions; 5 Decimals; 6 Percents; 7 The Properties of Real Numbers; 8 Solving Linear Equations; 9 Math Models and Geometry; 10 Polynomials; 11 Graphs

**Elementary Algebra 2e**: 1 Foundations; 2 Solving Linear Equations and Inequalities; 3 Math Models; 4 Graphs; 5 Systems of Linear Equations; 6 Polynomials; 7 Factoring; 8 Rational Expressions and Equations; 9 Roots and Radicals; 10 Quadratic Equations

**Intermediate Algebra 2e**: 1 Foundations; 2 Solving Linear Equations; 3 Graphs and Functions; 4 Systems of Linear Equations; 5 Polynomials and Polynomial Functions; 6 Factoring; 7 Rational Expressions and Functions; 8 Roots and Radicals; 9 Quadratic Equations and Functions; 10 Exponential and Logarithmic Functions; 11 Conics; 12 Sequences, Series and Binomial Theorem

**Algebra and Trigonometry 2e**: 1 Prerequisites; 2 Equations and Inequalities; 3 Functions; 4 Linear Functions; 5 Polynomial and Rational Functions; 6 Exponential and Logarithmic Functions; 7 The Unit Circle: Sine and Cosine Functions; 8 Periodic Functions; 9 Trigonometric Identities and Equations; 10 Further Applications of Trigonometry; 11 Systems of Equations and Inequalities; 12 Analytic Geometry; 13 Sequences, Probability, and Counting Theory

**Precalculus 2e**: 1 Functions; 2 Linear Functions; 3 Polynomial and Rational Functions; 4 Exponential and Logarithmic Functions; 5 Trigonometric Functions; 6 Periodic Functions; 7 Trigonometric Identities and Equations; 8 Further Applications of Trigonometry; 9 Systems of Equations and Inequalities; 10 Analytic Geometry; 11 Sequences, Probability, and Counting Theory; 12 Introduction to Calculus

Known KA gaps the cross-check must catch: Algebra 1 — one-variable statistics/scatterplots; Algebra 2 — sequences/series and probability; Geometry — constructions and logic/proof-writing.

### AP Calculus CED units (calculus checklist)

Source: AP Calculus AB/BC Course and Exam Description, College Board (apcentral.collegeboard.org), as of 2026-07-10.

AB = Units 1–8; BC = Units 1–10: 1 Limits and Continuity; 2 Differentiation: Definition and Fundamental Properties; 3 Differentiation: Composite, Implicit, and Inverse Functions; 4 Contextual Applications of Differentiation; 5 Analytical Applications of Differentiation; 6 Integration and Accumulation of Change; 7 Differential Equations; 8 Applications of Integration; 9 Parametric Equations, Polar Coordinates, and Vector-Valued Functions (BC only); 10 Infinite Sequences and Series (BC only)

---

## Calibration anchors & pinned reference set

The eight existing game topics rated as worked examples of the tier definitions, plus eleven pinned reference entries covering the tier × format cells the anchors miss. **This set is the recalibration standard:** the Unit 9 consistency pass compares every later entry's rating against these pinned examples and adjusts outliers with a note — a later entry claiming High must be plausibly as fast as the High pins below; anything slower than the Medium pins is Low.

**Where these entries live.** The eight anchor entries are authored in this section (they are the document's worked examples and must be readable before any course section); each is a Foundational/early entry whose owning course pass absorbs it in place — the Foundational-kernels pass absorbs the four `fk.` anchors, the Pre-Algebra pass the three `prealg.` anchors, and the Geometry pass `geo.triangle-congruence-criteria`. The eleven reference entries live as **pinned stubs inside their proper course sections** (Pre-Algebra and Algebra 1) and are pinned here by slug in the calibration table, never duplicated.

**Surface assumptions vs. observed behavior (anchors).** Per the conditional-rating rule, anchors are rated under the Input-format legend's *assumed* surfaces, not observed current behavior — but for `single-number` and `multiple-choice` the assumed model and the shipped engine coincide (length-based auto-judge with no Enter; tap-to-answer), and the proposed game pad shares the OS keyboard's ~250ms-per-tap time model, so these eight ratings double as observations of the live game. The one behavioral divergence — the proposed leading-zero normalization for `single-number` — is unreachable under auto-judge and rating-neutral. New-format entries (everything in the reference set except the MC-adjacent `true-false`) have **no** shipped counterpart: those ratings are conditional on the assumed Enter-to-submit surfaces.

**The eight anchors** — every entry below is generated by `app/gauntlet/game/problems.ts` today; `Params:` notes quote the actual `R`-table bounds per band (g34 / g56 / g78). Each anchor ends with an *Anchor rationale* line stating which tier boundary it is the worked example for.

### fk.times-tables — Multiplication facts

Rating: High · Format: single-number
Why: Pure single-fact recall — the tier definition's "pure recall" case verbatim; ~1s think + ≤0.75s entry.
Sample: 7 × 8 → 56 · Rule: int-exact · Params: both factors uniform in `R.mul` — g34 [2,6] / g56 [2,10] / g78 [2,12]; products ≤ 144 (answers 1–3 digits). Per-fact keys are commutative-normalized (`mul:7×8`).
Kernels: No drillable kernel beyond entries already listed
*Anchor rationale:* pins the **High interior** — the fastest fact family the game hosts; every later "pure recall" claim is measured against this.

### fk.division-facts — Division facts (times-table inverses)

Rating: High · Format: single-number
Why: One inverse-table lookup, no transformation — still the tier definition's "pure recall".
Sample: 56 ÷ 8 → 7 · Rule: int-exact · Params: divisor and quotient each drawn from `R.mul` — g34 [2,6] / g56 [2,10] / g78 [2,12]; the dividend is their product (≤ 36 / 100 / 144), so division is always exact and answers are 1–2 digit positive integers.
Kernels: [fk.times-tables]
*Anchor rationale:* pins **High via inverse recall** — shows that reaching a fact through its inverse lookup does not drop a tier.

### fk.addition-facts — Addition facts and mental two-digit addition

Rating: High · Format: single-number
Why: Single-digit sums are pure recall; top-band two-digit sums are one fluent mental step still inside ≈ ≤3s.
Sample: 9 + 7 → 16 · Rule: int-exact · Params: sums capped at `R.addMax` — g34 12 / g56 20 / g78 50; first addend ∈ [2, max−2], second ∈ [2, max−first], so both addends ≥ 2 and the sum never exceeds the band cap.
Kernels: No drillable kernel beyond entries already listed
*Anchor rationale:* pins **High's upper edge** — g78 sums near 50 (e.g. 27 + 19) are the slowest additions still rated High.

### fk.subtraction-facts — Subtraction facts and mental two-digit subtraction

Rating: High · Format: single-number
Why: Fact-family recall at small bands; g78 borrowing cases (e.g. 43 − 17) are one fluent mental step that stays ≈ ≤3s.
Sample: 14 − 6 → 8 · Rule: int-exact · Params: minuend ∈ [4, `R.addMax`] (g34 12 / g56 20 / g78 50), subtrahend ∈ [1, minuend−1]; all answers are positive integers — the current game never emits a negative.
Kernels: [fk.addition-facts]
*Anchor rationale:* pins the **High→Medium boundary from above** — the top-band borrowing cases are the reference for "still High, barely"; anything slower than these must claim Medium.

### prealg.gcd-two-numbers — Greatest common divisor of two small numbers

Rating: Medium · Format: single-number
Why: One mental transformation — extracting the common-factor structure of two 2-digit numbers — squarely the tier definition's 3–8s case.
Sample: GCD(36, 24) → 12 · Rule: int-exact · Params: built as seed × multiplier — seed g from `R.gcdFactors` (g34 {2,3,4,5} / g56 {2…7} / g78 {2…9}), one operand g·{2…5}, the other g·{2…6} (g·7 on collision), larger printed first; operands ≤ 63 (g78). Note: the true GCD can exceed the seed when the multipliers share a factor (36 = 6·6, 24 = 6·4 → GCD 12, not 6) — the answer is gcd(a, b), not the seed.
Kernels: [fk.times-tables, fk.division-facts]
*Anchor rationale:* pins the **Medium floor** — the smallest genuine one-transformation skill the game currently hosts; anything faster than this should claim High.

### prealg.lcm-two-numbers — Least common multiple of two small numbers

Rating: Medium · Format: single-number
Why: One transformation — run up the multiples of the larger operand until the smaller divides — 3–8s for a fluent student at band values.
Sample: LCM(8, 12) → 24 · Rule: int-exact · Params: two distinct picks from `R.lcmPool` — g34 {2,3,4,5,6} / g56 {2,3,4,5,6,8,10} / g78 {2,3,4,5,6,8,9,10,12}, smaller printed first; answers capped at `R.lcmCap` 40 / 90 / 144 (pairs over the cap are regenerated).
Kernels: [fk.times-tables]
*Anchor rationale:* pins the **Medium interior** — the canonical "one mental transformation" worked example.

### prealg.common-denominator — Least common denominator of two fractions

Rating: Medium · Format: single-number
Why: Identical computation to prealg.lcm-two-numbers plus a longer prompt to parse — total response time counts the reading, keeping it Medium with less headroom.
Sample: Least common denominator of 1/4 and 5/6 → 12 · Rule: int-exact · Params: denominators are two distinct picks from `R.lcmPool` with LCM ≤ `R.lcmCap` (same pools and caps as LCM: 40 / 90 / 144); numerators ∈ [1, denominator−1] are decorative — the answer is the LCM of the denominators.
Kernels: [prealg.lcm-two-numbers]
*Anchor rationale:* pins **prompt-reading overhead** — the worked example that a wordier prompt spends tier budget without changing the math.

### geo.triangle-congruence-criteria — Which congruence criterion applies

Rating: Medium · Format: multiple-choice · Render: needs-figure
Why: One judgment — read the tick/angle marks off the figure and match a memorized criterion — plus 5-option scan time, landing mid-Medium.
Sample: [marked triangle pair] Which criterion proves these triangles congruent? → SAS · Rule: mc · Params: answer uniform over the fixed 5 options {SSS, SAS, ASA, AAS, Not enough info}; mark placement rotates through 3 offsets; figure sides are display-only px values in [60,90] / [70,100] / [80,110] with rotations ±25° (second triangle +{0, 90, 180}°); no band scaling.
Kernels: No drillable kernel beyond entries already listed
*Anchor rationale:* pins **Medium × multiple-choice** — the worked example that option-scan and figure-reading time count as thinking time.
*Slug note:* minted with the `geo.` prefix now (congruence criteria are Geometry grain); the Geometry pass absorbs this anchor into its section as the canonical entry.

**The pinned reference set** — eleven entries covering the tier × format cells the anchors miss: the Medium and Low tiers get non-single-number worked examples, and each of `two-numbers`, `short-expression`, `fraction`, `decimal`, and `true-false` gets at least one pin (`single-number` and `multiple-choice` are covered by anchors). Each is a real drillable skill authored as a pinned stub in its proper course section — see the Pre-Algebra and Algebra 1 sections — and pinned here by slug only.

**Calibration table** — the full pinned set. Unit 9's recalibration compares all later entries against this table: same tier ⇒ comparable total response time; every format's first later entry is checked against its format pins here.

| Pinned slug | Tier | Format · Rule | What it pins |
|---|---|---|---|
| fk.times-tables | High | single-number · int-exact | High interior — pure-recall baseline |
| fk.division-facts | High | single-number · int-exact | High via inverse recall |
| fk.addition-facts | High | single-number · int-exact | High upper edge (top-band 2-digit sums) |
| fk.subtraction-facts | High | single-number · int-exact | High→Medium boundary from above (borrowing cases) |
| prealg.gcd-two-numbers | Medium | single-number · int-exact | Medium floor — smallest genuine transformation |
| prealg.lcm-two-numbers | Medium | single-number · int-exact | Medium interior — canonical one-transformation case |
| prealg.common-denominator | Medium | single-number · int-exact | Prompt-reading overhead counts toward the tier |
| geo.triangle-congruence-criteria | Medium | multiple-choice · mc | Medium × MC — option-scan and figure time count |
| prealg.percent-to-decimal | High | decimal · dec-exact | High × decimal — entry-dominated High (Surface-sensitive) |
| prealg.simplify-fraction | High | fraction · frac-lowest-terms | High × fraction boundary (Surface-sensitive) |
| prealg.fraction-add-unlike | Medium | fraction · frac-lowest-terms | Medium × fraction — chained transformation held mentally |
| prealg.multiply-decimals | Medium | decimal · dec-exact | Medium floor × decimal |
| prealg.divisibility-rule-check | High | true-false · tf | High × true-false — rule verification, one tap |
| prealg.compare-fractions | Medium | true-false · tf | Medium × true-false — binary judgment needing a transformation |
| alg1.factor-pairs-sum-product | Medium | two-numbers · pair-unordered | Medium × two-numbers (unordered pair) |
| alg1.read-slope-intercept | High | two-numbers · pair-ordered | High × two-numbers (ordered pair; Surface-sensitive) |
| alg1.distribute-linear | High | short-expression · expr-commutative-ws | High × short-expression — tiny token count (Surface-sensitive) |
| alg1.factor-simple-quadratic | Medium | short-expression · factored-commutative-ws | Medium ceiling × short-expression — flips Low at 2× entry time (Surface-sensitive) |
| alg1.solve-quadratic-by-factoring | Low | — | The Low worked example — inherently multi-step, mined for kernels |

Coverage check: every format in the legend has at least one pin (single-number ×7, multiple-choice ×1, decimal ×2, fraction ×2, true-false ×2, two-numbers ×2, short-expression ×2) and every tier has at least one pin (High ×9, Medium ×9, Low ×1). Rule coverage: 9 of the 10 accepted-answer rules have a pinned exemplar; `frac-any-equivalent` does not — the first course entry citing it is calibrated against the two fraction pins.

---

## Foundational kernels

Sub-Pre-Algebra skills (`fk.` slugs) that course entries cite as prerequisites — times tables, integer operations, fraction sense. Seeded during the Pre-Algebra pass; grows strictly via registry-mediated additions. *Authored in a later pass.*

---

## Pre-Algebra

Swept against the KA Pre-Algebra checklist (15 units) with the Prealgebra 2e cross-check; includes the course's checklist-disposition table. *Authored in a later pass.*

**Stub — pinned reference entries.** The six entries below were authored during calibration; this course's pass absorbs this stub in place (the entries stay, the stub framing goes).

### prealg.percent-to-decimal — Percent → decimal conversion

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: High · Format: decimal · Surface-sensitive
Why: Pure rule recall (shift the point two places) — ~0.5s think + ~1.25s entry on the assumed decimal pad; entry is most of the budget, so a 2× slower surface would tip it to Medium.
Sample: Write 35% as a decimal → 0.35 · Rule: dec-exact · Params: integer percents ∈ [1, 150]; answers normalize to at most 2 decimal places under dec-exact.
Kernels: No drillable kernel beyond entries already listed

### prealg.simplify-fraction — Reduce a fraction to lowest terms

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: High · Format: fraction · Surface-sensitive
Why: Fluent students recognize the common factor on sight — one step, ~1.5s think + ~1s entry on the assumed fraction pad; sits at the High boundary and flips to Medium if entry runs 2× slow.
Sample: Write 6/8 in lowest terms → 3/4 · Rule: frac-lowest-terms · Params: built as (a·g)/(b·g) with gcd(a, b) = 1, a, b ∈ [1, 9], g ∈ [2, 6]; given denominators ≤ 54.
Kernels: [fk.times-tables, fk.division-facts]

### prealg.fraction-add-unlike — Add two fractions with unlike denominators

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Medium · Format: fraction
Why: One chained transformation held mentally — find the LCD, rescale, add, reduce — ~4–6s total, safely inside the 3–8s tier.
Sample: 1/2 + 1/3 → 5/6 · Rule: frac-lowest-terms · Params: distinct denominators from {2, 3, 4, 5, 6, 8, 10, 12} with LCD ≤ 24; answers in lowest terms, improper allowed (1/2 + 2/3 → 7/6).
Kernels: [prealg.common-denominator, fk.addition-facts, fk.times-tables]

### prealg.multiply-decimals — Multiply two one-place decimals

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Medium · Format: decimal
Why: One transformation — times-table product plus a decimal-place count — landing at the Medium floor (~3–4s total).
Sample: 0.3 × 0.4 → 0.12 · Rule: dec-exact · Params: both factors are tenths in [0.2, 0.9]; digit products that are multiples of 10 (e.g. 0.2 × 0.5) are excluded so the place count is always exercised and dec-exact normalization never hides a trailing zero.
Kernels: [fk.times-tables]

### prealg.divisibility-rule-check — Divisibility-rule verification

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: High · Format: true-false
Why: One rule application (digit sum or last-digit test) plus a single tap ≈ 2s total; true-false is legitimate here because the drillable skill IS the rule-based verification — the numeric restatement ("remainder of 51 ÷ 3") drills slower long division instead of the rule.
Sample: True or false: 51 is divisible by 3 → true · Rule: tf · Params: divisors ∈ {2, 3, 4, 5, 6, 9, 10}; dividends 2–3 digits; families generated balanced 50/50 true/false with near-miss false cases (remainder 1–2).
Kernels: [fk.addition-facts, fk.division-facts]

### prealg.compare-fractions — Verify a fraction inequality

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Medium · Format: true-false
Why: One transformation — cross-multiply and compare — ~3–5s; the judgment is genuinely binary (verify a claimed inequality), which is what true-false is for.
Sample: True or false: 3/5 > 2/3 → false · Rule: tf · Params: denominators ≤ 12; values distinct but within ~1/6 of each other so cross-multiplication is genuinely required; families balanced 50/50 true/false.
Kernels: [fk.times-tables]

---

## Algebra 1

Swept against KA Algebra 1 units 1–15 with the Elementary Algebra 2e cross-check (must catch the KA statistics gap). *Authored in a later pass.*

**Stub — pinned reference entries.** The five entries below were authored during calibration; this course's pass absorbs this stub in place (the entries stay, the stub framing goes).

### alg1.factor-pairs-sum-product — Two numbers from their sum and product

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Medium · Format: two-numbers
Why: One mental search through a factor-pair family — the core inner move of factoring — ~3–6s think + ~1.25s entry on the assumed two-number pad.
Sample: Two numbers with sum 7 and product 12 → 3, 4 · Rule: pair-unordered · Params: pinned (all-positive) version: pair members ∈ [2, 12], so sums ≤ 24 and products ≤ 144; sign variants (negative pairs) are authored in the full Algebra 1 pass.
Kernels: [fk.times-tables, fk.addition-facts]

### alg1.read-slope-intercept — Read slope and y-intercept from y = mx + b

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: High · Format: two-numbers · Surface-sensitive
Why: Pure read-off, no transformation — ~1s think + ~1.25s entry; entry dominates the High budget, hence the marker.
Sample: y = 3x − 2 — slope, then y-intercept → 3, -2 · Rule: pair-ordered · Params: m and b nonzero integers ∈ [−9, 9]; negative answers carry the engine contract's touch-minus-key caveat until the proposed pad exists.
Kernels: No drillable kernel beyond entries already listed

### alg1.distribute-linear — Distribute a constant over a binomial

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: High · Format: short-expression · Surface-sensitive
Why: One mental step (two times-table products) with a 5-token answer ≈ 1.5s entry — the worked proof that short-expression CAN be High when the token count is tiny; flips to Medium at 2× entry time.
Sample: Expand 3(x + 4) → 3x+12 · Rule: expr-commutative-ws · Params: outer constant ∈ [2, 9]; binomial x ± c with c ∈ [1, 9]; answer alphabet {digits, x, +, −}.
Kernels: [fk.times-tables]

### alg1.factor-simple-quadratic — Factor a monic quadratic

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One transformation (the sum-product search) but a 12-token answer ≈ 3.25s of pure entry — ~5–8s total, at Medium's ceiling; flips to Low at 2× entry time, hence the marker.
Sample: Factor: x² + 7x + 12 → (x+3)(x+4) · Rule: factored-commutative-ws · Params: monic x² + bx + c with both roots ∈ [1, 9] in the pinned version (b ≤ 18, c ≤ 81); sign variants in the full Algebra 1 pass.
Kernels: [alg1.factor-pairs-sum-product]

### alg1.solve-quadratic-by-factoring — Solve x² + bx + c = 0 by factoring

*(pinned reference entry — this course's pass absorbs this stub)*
Rating: Low
Why: Inherently multi-step at any speed — factor, apply the zero-product property, read off both roots — the tier definition's Low case even for a fluent student.
Kernels: [alg1.factor-simple-quadratic, alg1.factor-pairs-sum-product]

---

## Geometry

Swept against the KA Geometry checklist (9 units); cross-check must catch constructions and logic/proof-writing. Expected high share of Low entries with rich kernel extraction. *Authored in a later pass.*

---

## Algebra 2

Swept against the KA Algebra 2 checklist (12 units); cross-check must catch sequences/series and probability. Closes the primary in-degree window. *Authored in a later pass.*

---

## Trigonometry / Precalculus

Joint sweep of both KA courses (Trigonometry 4 units + Precalculus 10 units), deduplicated between themselves and against earlier canonical owners; Algebra & Trigonometry 2e / Precalculus 2e cross-check. *Authored in a later pass.*

---

## AP Calculus AB

Swept against CED Units 1–8. Expected strongest Low→kernel extraction (derivative/antiderivative fact families, exact trig values). *Authored in a later pass.*

---

## BC-only

Swept against CED Units 9–10 (parametric/polar/vector-valued; infinite sequences and series). *Authored in a later pass.*

---

## Build this first

The prioritized top picks: ~20–30 topics ranked by primary (Foundational→Algebra 2) kernel in-degree with the full-range column secondary; each flagged current-engine or needs-input-type-X with MC-fallback status and render flag; includes the zero-engine-work starter subset and the post-Algebra-2 forward inventory. *Authored in a later pass.*
