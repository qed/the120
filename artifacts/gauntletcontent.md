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

Live registry of every kernel slug in the document. Maintained continuously from the first authoring pass; citations may only use slugs listed here. In-degree columns are computed in the final consistency pass (blank until then). *Currently empty — populated by the authoring passes.*

| Slug | One-line definition | Owning entry | Canonical-home note | In-degree (primary) | In-degree (full) |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

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

The eight existing game topics rated as worked examples of the tier definitions, plus ~10 pinned reference entries covering the tier × format cells the anchors miss. The recalibration standard for the final consistency pass. *Authored in a later pass.*

---

## Foundational kernels

Sub-Pre-Algebra skills (`fk.` slugs) that course entries cite as prerequisites — times tables, integer operations, fraction sense. Seeded during the Pre-Algebra pass; grows strictly via registry-mediated additions. *Authored in a later pass.*

---

## Pre-Algebra

Swept against the KA Pre-Algebra checklist (15 units) with the Prealgebra 2e cross-check; includes the course's checklist-disposition table. *Authored in a later pass.*

---

## Algebra 1

Swept against KA Algebra 1 units 1–15 with the Elementary Algebra 2e cross-check (must catch the KA statistics gap). *Authored in a later pass.*

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
