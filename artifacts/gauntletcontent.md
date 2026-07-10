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
- **Normalization:** split on `/`; sign moved to numerator (`1/-2` → `-1/2`); denominator must be a positive integer after the move; then the entry's rule decides equivalence (`frac-lowest-terms` vs `frac-any-equivalent`). Integer-valued answers to fraction-format entries are still entered on the fraction surface; which written form the judge accepts (e.g. `4/2` vs `2`) is governed by the entry's rule — see the Accepted-answer rule legend.
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

**What counts as a citation (clarified during the Unit 9 computation):** exactly the slugs inside a bracketed `Kernels:` list — nothing else. Cross-reference rows, the parenthetical `(see …)` pointer after a "no drillable kernel" sentence, registry annotations, and disposition-table mentions are **not** citations and contribute nothing to in-degree.

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

Live registry of every kernel slug in the document. Maintained continuously from the first authoring pass; citations may only use slugs listed here. In-degree columns were computed in the Unit 9 consistency pass per the In-degree & citation rules (both columns filled below; method and top-10 spot-recount recorded in the Unit 9 changelog).

| Slug | One-line definition | Owning entry | Canonical-home note | In-degree (primary) | In-degree (full) |
|---|---|---|---|---|---|
| fk.times-tables | Single-fact multiplication recall (factor families through 12) | self — calibration anchor | authored in calibration section; absorbed by Foundational kernels via cross-reference (the Pre-Algebra pass — the same pass seeded the Foundational kernels section) | 49 | 58 |
| fk.division-facts | Division facts as times-table inverses | self — calibration anchor | authored in calibration section; absorbed by Foundational kernels via cross-reference (the Pre-Algebra pass — the same pass seeded the Foundational kernels section) | 23 | 28 |
| fk.addition-facts | Addition facts and fluent mental addition (sums ≤ 50) | self — calibration anchor | authored in calibration section; absorbed by Foundational kernels via cross-reference (the Pre-Algebra pass — the same pass seeded the Foundational kernels section) | 25 | 27 |
| fk.subtraction-facts | Subtraction facts and fluent mental subtraction (within 50) | self — calibration anchor | authored in calibration section; absorbed by Foundational kernels via cross-reference (the Pre-Algebra pass — the same pass seeded the Foundational kernels section) | 15 | 21 |
| prealg.gcd-two-numbers | GCD of two small composite numbers | self — calibration anchor | authored in calibration section; absorbed by Pre-Algebra via cross-reference (Pre-Algebra pass) | 2 | 2 |
| prealg.lcm-two-numbers | LCM of two small numbers | self — calibration anchor | authored in calibration section; absorbed by Pre-Algebra via cross-reference (Pre-Algebra pass) | 1 | 1 |
| prealg.common-denominator | Least common denominator of two fractions | self — calibration anchor | authored in calibration section; absorbed by Pre-Algebra via cross-reference (Pre-Algebra pass) | 1 | 1 |
| geo.triangle-congruence-criteria | Match a marked triangle pair to SSS/SAS/ASA/AAS/insufficient | self — calibration anchor | authored in calibration section; absorbed by Geometry via cross-reference (Geometry pass) | 3 | 4 |
| prealg.percent-to-decimal | Convert an integer percent to a decimal | self — Pre-Algebra section (pinned calibration entry) | — | 0 | 0 |
| prealg.simplify-fraction | Reduce a fraction to lowest terms | self — Pre-Algebra section (pinned calibration entry) | — | 14 | 19 |
| prealg.fraction-add-unlike | Add two unlike-denominator fractions | self — Pre-Algebra section (pinned calibration entry) | — | 2 | 2 |
| prealg.multiply-decimals | Multiply two one-place decimals | self — Pre-Algebra section (pinned calibration entry) | — | 0 | 0 |
| prealg.divisibility-rule-check | Verify divisibility via digit-sum / last-digit rules | self — Pre-Algebra section (pinned calibration entry) | — | 1 | 1 |
| prealg.compare-fractions | Verify a fraction inequality by cross-multiplication | self — Pre-Algebra section (pinned calibration entry) | — | 0 | 0 |
| alg1.factor-pairs-sum-product | Recover two numbers from their sum and product | self — Algebra 1 (KA 13, pinned calibration entry) | — | 4 | 4 |
| alg1.read-slope-intercept | Read m and b off slope-intercept form | self — Algebra 1 (KA 5, pinned calibration entry) | canonical here per first-course-owns (minted in the Algebra 1 calibration stub); Pre-Algebra (KA 14) cross-references here (noted in the Unit 9 consistency pass) | 3 | 3 |
| alg1.distribute-linear | Distribute a constant over a binomial | self — Algebra 1 (KA 1, pinned calibration entry) | canonical home: **Pre-Algebra** (KA Pre-Algebra units 6/12 exercise it first — recorded during the Pre-Algebra pass); slug immutable, minted in Algebra 1 during calibration; Pre-Algebra carries the cross-reference row | 3 | 4 |
| alg1.factor-simple-quadratic | Factor a monic quadratic into two binomials | self — Algebra 1 (KA 13, pinned calibration entry) | first-course-owns: Algebra 2 (KA 3) cross-references here (noted in the Unit 9 consistency pass) | 3 | 5 |
| alg1.solve-quadratic-by-factoring | Solve a monic quadratic by factoring (Low; kernel source) | self — Algebra 1 (KA 14, pinned calibration entry) | — | 0 | 1 |
| fk.place-value | Identify the digit in a named place | self — Foundational kernels | — | 6 | 6 |
| fk.integer-add-sub | Signed integer addition and subtraction | self — Foundational kernels | — | 19 | 26 |
| fk.integer-mul-div | Sign rules for integer products and quotients | self — Foundational kernels | — | 13 | 17 |
| fk.doubling-halving | Double or halve a number fluently | self — Foundational kernels | — | 14 | 15 |
| fk.two-digit-times-one-digit | 2-digit × 1-digit mental multiplication | self — Foundational kernels | — | 6 | 6 |
| fk.perfect-squares | Perfect-square recall through 15² | self — Foundational kernels | — | 23 | 28 |
| fk.perfect-cubes | Perfect-cube recall through 6³ | self — Foundational kernels | — | 6 | 6 |
| fk.powers-of-ten | Multiply/divide by a power of ten (place shift) | self — Foundational kernels | — | 7 | 7 |
| fk.fraction-of-number | Fraction of a whole number | self — Foundational kernels | — | 7 | 7 |
| prealg.smallest-prime-factor | Smallest prime factor of a 2-digit composite | self — Pre-Algebra (KA 1) | — | 1 | 1 |
| prealg.prime-factorization | Full prime factorization (Low; kernel source) | self — Pre-Algebra (KA 1) | — | 0 | 0 |
| prealg.next-term-arithmetic | Next term of an arithmetic pattern | self — Pre-Algebra (KA 2) | first-course-owns: Algebra 1 (KA 9) and Algebra 2 (sequences/series merge block) cross-reference here (noted in the Unit 9 consistency pass) | 0 | 0 |
| prealg.simplify-ratio | Simplify a ratio to lowest terms | self — Pre-Algebra (KA 3) | — | 1 | 1 |
| prealg.unit-rate | Unit rate from a quantity pair | self — Pre-Algebra (KA 3) | — | 1 | 1 |
| prealg.solve-proportion | Missing value in a proportion / equivalent fractions | self — Pre-Algebra (KA 3) | also satisfies KA 9 and OpenStax ch. 4 equivalent-fractions rows; first-course-owns: Geometry (KA 4) cross-references here (noted in the Unit 9 consistency pass) | 4 | 5 |
| prealg.decimal-to-percent | Convert a decimal to a percent | self — Pre-Algebra (KA 4) | — | 1 | 1 |
| prealg.percent-to-fraction | Percent → fraction in lowest terms | self — Pre-Algebra (KA 4) | — | 0 | 0 |
| prealg.fraction-to-percent | Fraction → percent | self — Pre-Algebra (KA 4) | — | 1 | 1 |
| prealg.percent-of-number | Percent of a number (benchmark percents) | self — Pre-Algebra (KA 4) | — | 1 | 1 |
| prealg.find-whole-from-percent | Find the whole from a part and percent | self — Pre-Algebra (KA 4) | — | 0 | 0 |
| prealg.find-percent-from-pair | What percent is a of b | self — Pre-Algebra (KA 4) | — | 1 | 1 |
| prealg.percent-change | Percent increase or decrease | self — Pre-Algebra (KA 4) | — | 0 | 0 |
| prealg.evaluate-exponent | Evaluate a small power | self — Pre-Algebra (KA 5) | — | 8 | 12 |
| prealg.order-of-operations | Two-operation order of operations | self — Pre-Algebra (KA 5) | — | 0 | 0 |
| prealg.evaluate-expression | Evaluate a one-variable expression | self — Pre-Algebra (KA 6) | first-course-owns: Algebra 1 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 10 | 17 |
| prealg.combine-like-terms | Combine like terms in one variable | self — Pre-Algebra (KA 6) | first-course-owns: Algebra 1 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 4 | 6 |
| prealg.solve-one-step-equation | Solve a one-step equation | self — Pre-Algebra (KA 7) | first-course-owns: Algebra 1 (KA 2) cross-references here (noted in the Unit 9 consistency pass) | 6 | 8 |
| prealg.check-solution | Check a candidate solution of a linear equation | self — Pre-Algebra (KA 7) | — | 2 | 2 |
| prealg.absolute-value | Absolute value of an integer | self — Pre-Algebra (KA 8) | first-course-owns: Algebra 1 (KA 10) cross-references here (noted in the Unit 9 consistency pass) | 2 | 3 |
| prealg.constant-of-proportionality | Constant of proportionality from a pair | self — Pre-Algebra (KA 9) | — | 0 | 0 |
| prealg.solve-two-step-equation | Solve a two-step equation | self — Pre-Algebra (KA 10) | first-course-owns: Algebra 1 (KA 2) cross-references here (noted in the Unit 9 consistency pass) | 7 | 9 |
| prealg.solve-one-step-inequality | Solve a one-step inequality (boundary + direction) | self — Pre-Algebra (KA 10) | first-course-owns: Algebra 1 (KA 2) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| prealg.square-root | Square root of a perfect square | self — Pre-Algebra (KA 11) | first-course-owns: Algebra 1 (KA 11) cross-references here (noted in the Unit 9 consistency pass) | 11 | 15 |
| prealg.cube-root | Cube root of a perfect cube | self — Pre-Algebra (KA 11) | first-course-owns: Algebra 1 (KA 11) cross-references here (noted in the Unit 9 consistency pass) | 3 | 3 |
| prealg.root-between-integers | Bracket a square root between consecutive integers | self — Pre-Algebra (KA 11) | first-course-owns: Algebra 1 (KA 11) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| prealg.exponent-product-rule | Product rule for exponents (add exponents) | self — Pre-Algebra (KA 11) | first-course-owns: Algebra 1 (KA 11) cross-references here (noted in the Unit 9 consistency pass) | 4 | 4 |
| prealg.negative-exponent | Negative exponent as a unit fraction | self — Pre-Algebra (KA 11) | first-course-owns: Algebra 1 (KA 11) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| prealg.scientific-to-standard | Scientific notation → standard form | self — Pre-Algebra (KA 11) | — | 0 | 0 |
| prealg.scientific-notation-exponent | Exponent when a value is written in scientific notation | self — Pre-Algebra (KA 11) | — | 0 | 0 |
| prealg.solve-multi-step-equation | Solve a multi-step equation (Low; kernel source) | self — Pre-Algebra (KA 12) | first-course-owns: Algebra 1 (KA 2) cross-references here (noted in the Unit 9 consistency pass) | 2 | 2 |
| prealg.check-point-solution | Check a point against a two-variable equation | self — Pre-Algebra (KA 13) | — | 2 | 2 |
| prealg.check-system-solution | Check a candidate solution of a 2×2 system | self — Pre-Algebra (KA 15) | first-course-owns: Algebra 1 (KA 6) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| prealg.solve-2x2-system | Solve a 2×2 linear system (Low; kernel source) | self — Pre-Algebra (KA 15) | first-course-owns: Algebra 1 unit 6 cross-references here (recorded during the Algebra 1 pass); Trig/Precalc (KA Precalc 7) also cross-references here (noted in the Unit 9 consistency pass) | 0 | 1 |
| prealg.fraction-multiply | Multiply two fractions | self — Pre-Algebra (OpenStax merge, ch. 4) | — | 2 | 3 |
| prealg.fraction-divide | Divide two fractions | self — Pre-Algebra (OpenStax merge, ch. 4) | — | 1 | 4 |
| prealg.mixed-to-improper | Mixed number → improper fraction | self — Pre-Algebra (OpenStax merge, ch. 4) | — | 0 | 0 |
| prealg.decimal-add-sub | Add or subtract decimals | self — Pre-Algebra (OpenStax merge, ch. 5) | — | 0 | 0 |
| prealg.fraction-to-decimal | Fraction → terminating decimal | self — Pre-Algebra (OpenStax merge, ch. 5) | — | 0 | 0 |
| prealg.decimal-to-fraction | Decimal → fraction in lowest terms | self — Pre-Algebra (OpenStax merge, ch. 5) | — | 0 | 0 |
| prealg.round-to-place | Round to a named place (whole or decimal) | self — Pre-Algebra (OpenStax merge, chs. 1 & 5) | — | 0 | 0 |
| prealg.identify-property | Name the illustrated arithmetic property | self — Pre-Algebra (OpenStax merge, ch. 7) | — | 0 | 0 |
| prealg.perimeter-rectangle | Perimeter of a rectangle | self — Pre-Algebra (OpenStax merge, ch. 9) | — | 1 | 1 |
| prealg.area-triangle | Area of a triangle | self — Pre-Algebra (OpenStax merge, ch. 9) | — | 2 | 3 |
| prealg.circle-area-pi | Circle area as a coefficient of π | self — Pre-Algebra (OpenStax merge, ch. 9) | first-course-owns: Geometry (KA 8) cross-references here (noted in the Unit 9 consistency pass) | 3 | 5 |
| prealg.pythagorean-hypotenuse | Pythagorean triple recall (hypotenuse or leg) | self — Pre-Algebra (OpenStax merge, ch. 9) | first-course-owns: Geometry unit 5 cross-references here (recorded during the Geometry pass); Trig/Precalc (KA Trig 1) also cross-references here (noted in the Unit 9 consistency pass) | 6 | 8 |
| prealg.identify-quadrant | Quadrant of a coordinate point | self — Pre-Algebra (OpenStax merge, ch. 11) | — | 1 | 3 |
| fk.unit-conversion-facts | Recall a measurement conversion factor | self — Foundational kernels (added during Algebra 1 pass) | — | 1 | 1 |
| alg1.combine-like-terms-multivar | Combine like terms across multiple variables | self — Algebra 1 (KA 1) | first-course-owns: Algebra 2 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| alg1.solve-equation-both-sides | Solve ax = bx + c (variables on both sides) | self — Algebra 1 (KA 2) | — | 0 | 1 |
| alg1.rearrange-formula-one-step | Solve a one-step formula for a variable | self — Algebra 1 (KA 2) | — | 1 | 2 |
| alg1.unit-convert-one-step | One-step unit conversion | self — Algebra 1 (KA 3) | — | 0 | 0 |
| alg1.slope-two-points | Slope from two points | self — Algebra 1 (KA 4) | first-course-owns: Geometry (KA 6) cross-references here (noted in the Unit 9 consistency pass) | 4 | 5 |
| alg1.intercept-from-equation | Axis intercept from standard form | self — Algebra 1 (KA 4) | — | 1 | 2 |
| alg1.graph-line-from-equation | Graph a line from its equation (Low; kernel source) | self — Algebra 1 (KA 4) | — | 0 | 0 |
| alg1.read-point-slope | Read the anchor point off point-slope form | self — Algebra 1 (KA 5) | — | 0 | 0 |
| alg1.slope-from-standard-form | Slope from standard form (m = −A/B) | self — Algebra 1 (KA 5) | — | 0 | 0 |
| alg1.write-line-equation | Write the equation of a line (Low; kernel source) | self — Algebra 1 (KA 5) | first-course-owns: Geometry (KA 6) cross-references here (noted in the Unit 9 consistency pass) | 0 | 2 |
| alg1.system-solution-count | Number of solutions of a 2×2 system | self — Algebra 1 (KA 6) | — | 0 | 0 |
| alg1.check-inequality-solution | Check a point against a two-variable inequality | self — Algebra 1 (KA 7) | — | 0 | 0 |
| alg1.evaluate-function | Evaluate f(x) in function notation | self — Algebra 1 (KA 8) | — | 4 | 11 |
| alg1.is-function-pairs | Judge whether a set of ordered pairs is a function | self — Algebra 1 (KA 8) | — | 0 | 0 |
| alg1.next-term-geometric | Next term of a geometric sequence | self — Algebra 1 (KA 9) | first-course-owns: Algebra 2 (sequences/series merge block) cross-references here (noted in the Unit 9 consistency pass) | 1 | 2 |
| alg1.arithmetic-nth-term | nth term of an arithmetic sequence | self — Algebra 1 (KA 9) | first-course-owns: Algebra 2 (sequences/series merge block) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.geometric-nth-term | nth term of a geometric sequence | self — Algebra 1 (KA 9) | first-course-owns: Algebra 2 (sequences/series merge block) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| alg1.evaluate-absolute-expression | Evaluate an absolute-value expression | self — Algebra 1 (KA 10) | — | 0 | 0 |
| alg1.solve-absolute-value-equation | Solve an absolute-value equation (both solutions) | self — Algebra 1 (KA 10) | — | 0 | 0 |
| alg1.evaluate-piecewise | Evaluate a piecewise function | self — Algebra 1 (KA 10) | — | 0 | 1 |
| alg1.exponent-power-rule | Power-of-a-power rule (multiply exponents) | self — Algebra 1 (KA 11) | — | 1 | 1 |
| alg1.exponent-quotient-rule | Quotient rule for exponents (subtract exponents) | self — Algebra 1 (KA 11) | — | 1 | 1 |
| alg1.simplify-radical | Simplify a square root to a√b | self — Algebra 1 (KA 11) | first-course-owns: Algebra 2 (KA 6) cross-references here (noted in the Unit 9 consistency pass) | 3 | 3 |
| alg1.evaluate-exponential | Evaluate an exponential expression a·bˣ | self — Algebra 1 (KA 12) | first-course-owns: Algebra 2 (KA 7) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.growth-or-decay | Classify growth vs decay from the base | self — Algebra 1 (KA 12) | first-course-owns: Algebra 2 (KA 7) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.growth-factor-to-rate | Percent rate from a growth/decay factor | self — Algebra 1 (KA 12) | first-course-owns: Algebra 2 (KA 7) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.multiply-binomials | Multiply two binomials | self — Algebra 1 (KA 13) | first-course-owns: Algebra 2 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 6 | 6 |
| alg1.factor-gcf | Factor out the greatest common factor | self — Algebra 1 (KA 13) | first-course-owns: Algebra 2 (KA 3) cross-references here (noted in the Unit 9 consistency pass) | 3 | 3 |
| alg1.factor-difference-of-squares | Factor a difference of squares | self — Algebra 1 (KA 13) | first-course-owns: Algebra 2 (KA 3) cross-references here (noted in the Unit 9 consistency pass) | 0 | 1 |
| alg1.factor-perfect-square-trinomial | Recognize a perfect-square trinomial | self — Algebra 1 (KA 13) | first-course-owns: Algebra 2 (KA 3) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| alg1.factor-nonmonic-quadratic | Factor a non-monic quadratic (Low; kernel source) | self — Algebra 1 (KA 13) | first-course-owns: Algebra 2 (KA 3) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.roots-from-factored-form | Roots from factored form (zero-product read-off) | self — Algebra 1 (KA 14) | first-course-owns: Algebra 2 (KA 5) cross-references here (noted in the Unit 9 consistency pass) | 2 | 4 |
| alg1.vertex-from-vertex-form | Vertex from vertex form | self — Algebra 1 (KA 14) | — | 2 | 2 |
| alg1.axis-of-symmetry | Axis of symmetry from standard form | self — Algebra 1 (KA 14) | — | 0 | 1 |
| alg1.discriminant-root-count | Count real solutions via the discriminant | self — Algebra 1 (KA 14) | — | 2 | 2 |
| alg1.solve-x-squared-equals-k | Solve x² = k (both solutions) | self — Algebra 1 (KA 14) | — | 1 | 1 |
| alg1.solve-by-quadratic-formula | Solve via the quadratic formula (Low; kernel source) | self — Algebra 1 (KA 14) | — | 1 | 1 |
| alg1.complete-the-square | Complete the square (Low; kernel source) | self — Algebra 1 (KA 14) | — | 1 | 1 |
| alg1.classify-rational-irrational | Classify a number as rational or irrational | self — Algebra 1 (KA 15) | — | 1 | 1 |
| alg1.rational-irrational-operations | Closure judgments for rational/irrational sums and products | self — Algebra 1 (KA 15) | — | 0 | 0 |
| alg1.linear-word-problem | Translate-and-solve linear word problems (Low; kernel source) | self — Algebra 1 (OpenStax merge, ch. 3) | — | 0 | 0 |
| alg1.polynomial-degree | Degree of a polynomial | self — Algebra 1 (OpenStax merge, ch. 6) | first-course-owns: Algebra 2 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 1 | 2 |
| alg1.multiply-monomials | Multiply two monomials | self — Algebra 1 (OpenStax merge, ch. 6) | first-course-owns: Algebra 2 (KA 1) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg1.simplify-monomial-quotient | Divide two monomials | self — Algebra 1 (OpenStax merge, ch. 8) | — | 3 | 3 |
| alg1.simplify-rational-expression | Simplify a rational expression (Low; kernel source) | self — Algebra 1 (OpenStax merge, ch. 8) | first-course-owns: Trig/Precalc (KA Precalc 4) cross-references here (noted in the Unit 9 consistency pass) | 1 | 3 |
| alg1.multiply-square-roots | Multiply square roots to an integer | self — Algebra 1 (OpenStax merge, ch. 9) | first-course-owns: Algebra 2 (KA 6) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| geo.translate-point | Translate a point by a vector | self — Geometry (KA 1) | — | 1 | 2 |
| geo.reflect-point | Reflect a point across an axis | self — Geometry (KA 1) | — | 1 | 1 |
| geo.rotate-point | Rotate a point about the origin (90°/180°/270°) | self — Geometry (KA 1) | — | 1 | 1 |
| geo.dilate-point | Dilate a point from the origin | self — Geometry (KA 1) | first-course-owns: Trig/Precalc (KA Precalc 6) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| geo.is-rigid-motion | Classify a transformation as rigid or not | self — Geometry (KA 2) | — | 0 | 0 |
| geo.compose-transformations | Compose transformations in sequence (Low; kernel source) | self — Geometry (KA 2) | — | 0 | 0 |
| geo.vertical-angle-read | Vertical angles are equal (read-off) | self — Geometry (KA 3) | — | 3 | 3 |
| geo.supplement-complement | Supplement or complement of an angle | self — Geometry (KA 3) | — | 3 | 3 |
| geo.transversal-angle | Angle from parallel lines cut by a transversal | self — Geometry (KA 3) | — | 1 | 1 |
| geo.triangle-angle-sum | Third angle of a triangle | self — Geometry (KA 3) | — | 2 | 3 |
| geo.exterior-angle | Exterior angle of a triangle | self — Geometry (KA 3) | — | 0 | 0 |
| geo.polygon-angle-sum | Interior angle sum of an n-gon | self — Geometry (KA 3) | — | 0 | 0 |
| geo.isosceles-base-angles | Isosceles triangle angle relations | self — Geometry (KA 3) | — | 1 | 1 |
| geo.corresponding-parts | Corresponding parts of congruent triangles | self — Geometry (KA 3) | — | 2 | 2 |
| geo.congruence-proof | Prove two triangles congruent (Low; kernel source) | self — Geometry (KA 3) | — | 0 | 0 |
| geo.similarity-criteria | Match a marked pair to a similarity criterion | self — Geometry (KA 4) | — | 1 | 1 |
| geo.scale-factor | Scale factor between similar figures | self — Geometry (KA 4) | — | 0 | 0 |
| geo.area-scale-factor | Area ratio from a length scale factor | self — Geometry (KA 4) | — | 1 | 1 |
| geo.similarity-proof | Prove two triangles similar (Low; kernel source) | self — Geometry (KA 4) | — | 0 | 0 |
| geo.pythagorean-verify | Verify a right triangle via a² + b² = c² | self — Geometry (KA 5) | — | 1 | 1 |
| geo.special-right-triangle | 45-45-90 / 30-60-90 side-ratio application | self — Geometry (KA 5) | first-course-owns: Trig/Precalc (KA Trig 1) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| geo.trig-ratio-definition | Read sin/cos/tan off a labeled right triangle | self — Geometry (KA 5) | first-course-owns: Algebra 2 unit 11 cross-references here (recorded during the Algebra 2 pass); Trig/Precalc cross-references here (satisfied in the Trig/Precalc pass) | 3 | 5 |
| geo.exact-trig-values | Exact trig values at special angles | self — Geometry (KA 5) | first-course-owns: canonical here; Algebra 2 unit 11 cross-references here (recorded during the Algebra 2 pass); Trig/Precalc cross-references here (satisfied in the Trig/Precalc pass); the calculus sections cross-reference here (satisfied in the Calculus AB pass) | 1 | 10 |
| geo.trig-cofunction | Cofunction complement (sin θ = cos(90° − θ)) | self — Geometry (KA 5) | first-course-owns: Trig/Precalc (KA Trig 1) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| geo.solve-right-triangle | Solve a right triangle with trig (Low; kernel source) | self — Geometry (KA 5) | first-course-owns: Trig/Precalc (KA Trig 1) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| geo.distance-formula | Distance between two points | self — Geometry (KA 6) | first-course-owns: Trig/Precalc (KA Precalc 3) cross-references here (noted in the Unit 9 consistency pass) | 1 | 2 |
| geo.midpoint-formula | Midpoint of a segment | self — Geometry (KA 6) | first-course-owns: Trig/Precalc (KA Precalc 3) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| geo.perpendicular-slope | Negative-reciprocal slope of a perpendicular line | self — Geometry (KA 6) | — | 1 | 1 |
| geo.coordinate-geometry-proof | Verify figure properties on coordinates (Low; kernel source) | self — Geometry (KA 6) | — | 0 | 0 |
| geo.circle-equation-read | Center from a circle's standard form | self — Geometry (KA 7) | first-course-owns: Trig/Precalc (KA Precalc 5) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| geo.circle-radius-read | Radius from a circle's standard form | self — Geometry (KA 7) | first-course-owns: Trig/Precalc (KA Precalc 5) cross-references here (noted in the Unit 9 consistency pass) | 1 | 1 |
| geo.circle-general-to-standard | Circle center/radius from general form (Low; kernel source) | self — Geometry (KA 7) | first-course-owns: Trig/Precalc (KA Precalc 5) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| geo.parabola-focus-directrix | Focus and directrix of a parabola (Low; kernel source) | self — Geometry (KA 7) | first-course-owns: Trig/Precalc (KA Precalc 5) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| geo.central-inscribed-angle | Central and inscribed angle measures | self — Geometry (KA 8) | — | 0 | 0 |
| geo.arc-length-fraction | Arc length as a π-coefficient | self — Geometry (KA 8) | — | 0 | 0 |
| geo.sector-area-fraction | Sector area as a π-coefficient | self — Geometry (KA 8) | — | 0 | 0 |
| geo.tangent-radius-problem | Tangent-segment problems (Low; kernel source) | self — Geometry (KA 8) | — | 0 | 0 |
| geo.volume-box | Volume of a rectangular box / prism | self — Geometry (KA 9) | — | 0 | 0 |
| geo.volume-cylinder-pi | Cylinder volume as a π-coefficient | self — Geometry (KA 9) | — | 1 | 1 |
| geo.volume-cone-pi | Cone volume as a π-coefficient | self — Geometry (KA 9) | — | 0 | 0 |
| geo.volume-sphere-pi | Sphere volume as a π-coefficient | self — Geometry (KA 9) | — | 0 | 0 |
| geo.volume-scale-factor | Volume ratio from a length scale factor | self — Geometry (KA 9) | — | 0 | 0 |
| geo.cross-section-id | Identify a solid's cross-section | self — Geometry (KA 9) | — | 0 | 0 |
| geo.surface-area | Surface area of a solid (Low; kernel source) | self — Geometry (KA 9) | — | 0 | 0 |
| geo.conditional-forms | Converse/inverse/contrapositive identification | self — Geometry (gap merge — logic/proof-writing) | — | 1 | 1 |
| geo.two-column-proof | Write a two-column proof (Low; kernel source) | self — Geometry (gap merge — logic/proof-writing) | — | 0 | 0 |
| alg2.add-polynomials | Add or subtract two polynomials | self — Algebra 2 (KA 1) | — | 1 | 3 |
| alg2.expand-binomial-square | Expand a squared binomial | self — Algebra 2 (KA 1) | — | 0 | 2 |
| alg2.expand-conjugate-product | Expand (a + b)(a − b) to a difference of squares | self — Algebra 2 (KA 1) | — | 0 | 1 |
| alg2.imaginary-powers | Powers of i (mod-4 cycle recall) | self — Algebra 2 (KA 2) | first-course-owns: Trig/Precalc (KA Precalc unit 3) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.simplify-sqrt-negative | Square root of a negative number in i-form | self — Algebra 2 (KA 2) | first-course-owns: Trig/Precalc (KA Precalc unit 3) cross-references here (satisfied in the Trig/Precalc pass) | 1 | 1 |
| alg2.add-subtract-complex | Add or subtract complex numbers | self — Algebra 2 (KA 2) | first-course-owns: Trig/Precalc (KA Precalc unit 3) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.complex-conjugate | Conjugate of a complex number | self — Algebra 2 (KA 2) | first-course-owns: Trig/Precalc (KA Precalc unit 3) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 1 |
| alg2.multiply-complex | Multiply two complex numbers | self — Algebra 2 (KA 2) | first-course-owns: Trig/Precalc (KA Precalc unit 3) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 1 |
| alg2.solve-quadratic-complex | Solve a quadratic with complex solutions (Low; kernel source) | self — Algebra 2 (KA 2) | — | 0 | 0 |
| alg2.sum-diff-cubes-pattern | Sum/difference-of-cubes pattern slot | self — Algebra 2 (KA 3) | — | 0 | 0 |
| alg2.factor-by-grouping | Factor a four-term polynomial by grouping (Low; kernel source) | self — Algebra 2 (KA 3) | — | 0 | 0 |
| alg2.factor-quadratic-form | Factor an expression in quadratic form (Low; kernel source) | self — Algebra 2 (KA 3) | — | 0 | 0 |
| alg2.divide-poly-by-monomial | Divide a polynomial by a monomial | self — Algebra 2 (KA 4) | — | 0 | 0 |
| alg2.remainder-theorem | Remainder via p(a) (remainder theorem) | self — Algebra 2 (KA 4) | — | 2 | 2 |
| alg2.factor-check | Verify (x − a) is a factor (factor theorem) | self — Algebra 2 (KA 4) | — | 0 | 0 |
| alg2.polynomial-long-division | Polynomial long/synthetic division (Low; kernel source) | self — Algebra 2 (KA 4) | — | 0 | 0 |
| alg2.zero-multiplicity | Multiplicity of a zero from factored form | self — Algebra 2 (KA 5) | — | 1 | 1 |
| alg2.multiplicity-cross-touch | Cross vs touch at a zero (multiplicity parity) | self — Algebra 2 (KA 5) | — | 0 | 0 |
| alg2.end-behavior | End behavior from degree and leading coefficient | self — Algebra 2 (KA 5) | — | 0 | 0 |
| alg2.evaluate-rational-exponent | Evaluate a rational-exponent power | self — Algebra 2 (KA 6) | — | 0 | 0 |
| alg2.rational-exponent-product | Product rule with rational exponents | self — Algebra 2 (KA 6) | — | 0 | 0 |
| alg2.simplify-cube-root | Simplify a cube root to a∛b | self — Algebra 2 (KA 6) | — | 0 | 0 |
| alg2.combine-radicals | Add or subtract like radicals | self — Algebra 2 (KA 6) | — | 0 | 0 |
| alg2.exponential-solve-common-base | Solve bˣ = k by power recognition | self — Algebra 2 (KA 7) | — | 2 | 2 |
| alg2.evaluate-log | Evaluate a logarithm | self — Algebra 2 (KA 8) | — | 4 | 4 |
| alg2.log-product-rule | Product rule for logarithms | self — Algebra 2 (KA 8) | — | 0 | 0 |
| alg2.log-power-rule | Power rule for logarithms | self — Algebra 2 (KA 8) | — | 0 | 0 |
| alg2.natural-log-facts | Natural-log special values (ln 1, ln e, ln eᵏ) | self — Algebra 2 (KA 8) | — | 0 | 1 |
| alg2.solve-exponential-equation | Solve an exponential equation with logs (Low; kernel source) | self — Algebra 2 (KA 8) | — | 0 | 0 |
| alg2.function-shift-direction | Shift direction of f(x ± a) ± b | self — Algebra 2 (KA 9) | — | 1 | 2 |
| alg2.function-reflection-rule | Reflection axis of −f(x) / f(−x) | self — Algebra 2 (KA 9) | — | 0 | 0 |
| alg2.function-scale-direction | Stretch vs compression from a·f(x) / f(bx) | self — Algebra 2 (KA 9) | — | 0 | 0 |
| alg2.transformed-point | Track a point through shifts | self — Algebra 2 (KA 9) | — | 0 | 0 |
| alg2.even-odd-classify | Classify a function as even/odd/neither | self — Algebra 2 (KA 9) | — | 0 | 0 |
| alg2.solve-sqrt-equation-simple | Solve √x = k | self — Algebra 2 (KA 10) | — | 1 | 1 |
| alg2.check-extraneous | Extraneous-solution verification | self — Algebra 2 (KA 10) | — | 2 | 2 |
| alg2.solve-radical-equation | Solve a radical equation (Low; kernel source) | self — Algebra 2 (KA 10) | deferred debt from Algebra 1's OS 9 row, paid this pass | 0 | 0 |
| alg2.solve-rational-equation | Solve a rational equation (Low; kernel source) | self — Algebra 2 (KA 10) | deferred debt from Algebra 1's OS 8 row, paid this pass; first-course-owns: Trig/Precalc (KA Precalc 4) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg2.degrees-to-radians | Degrees → radians as kπ | self — Algebra 2 (KA 11) | first-course-owns: Trig/Precalc cross-references here (satisfied in the Trig/Precalc pass) (radians live in both KA trig courses) | 0 | 0 |
| alg2.radians-to-degrees | Radians → degrees | self — Algebra 2 (KA 11) | first-course-owns: Trig/Precalc cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.pythagorean-identity-apply | cos θ from sin θ via sin²θ + cos²θ = 1 | self — Algebra 2 (KA 11) | first-course-owns: Trig/Precalc (KA Trigonometry unit 4) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 3 |
| alg2.trig-sign-by-quadrant | Quadrant from trig-function signs (ASTC) | self — Algebra 2 (KA 11) | first-course-owns: Trig/Precalc (KA Trigonometry unit 2) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 2 |
| alg2.arithmetic-series-sum | Arithmetic series sum with endpoints given | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 9) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.geometric-series-sum | Finite geometric series sum (Low; kernel source) | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 9) cross-references here (satisfied in the Trig/Precalc pass); the BC series section (CED 10) also cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| alg2.infinite-geometric-sum | Infinite geometric series sum a/(1 − r) | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 9) cross-references here (satisfied in the Trig/Precalc pass); the BC series section (CED unit 10) cross-references here (satisfied in the BC pass) | 0 | 0 |
| alg2.evaluate-sigma | Evaluate a 3-term sigma-notation sum | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 9) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.factorial | Factorial recall through 6! | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 2 | 6 |
| alg2.binomial-coefficient | Evaluate C(n, k) at small n | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 1 | 2 |
| alg2.binomial-expansion | Expand a binomial power (Low; kernel source) | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 12 / A&T ch. 13) | first-course-owns: Trig/Precalc cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.simple-probability | Probability of a simple event | self — Algebra 2 (OpenStax merge, A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 2 | 3 |
| alg2.complement-probability | Complement probability 1 − p | self — Algebra 2 (OpenStax merge, A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 1 | 1 |
| alg2.permutation-count | Count ordered arrangements (falling product) | self — Algebra 2 (OpenStax merge, A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 1 |
| alg2.compound-event-probability | Compound-event probability (Low; kernel source) | self — Algebra 2 (OpenStax merge, A&T ch. 13) | first-course-owns: Trig/Precalc (KA Precalc unit 8) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 0 |
| alg2.evaluate-composite | Evaluate f(g(x)) at a point | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 10) | first-course-owns: Trig/Precalc (KA Precalc unit 1) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 4 |
| alg2.inverse-of-linear | Inverse of a linear function | self — Algebra 2 (OpenStax merge, Int. Algebra ch. 10) | first-course-owns: Trig/Precalc (KA Precalc unit 1) cross-references here (satisfied in the Trig/Precalc pass) | 0 | 2 |
| trig.reference-angle | Reference angle of a rotation | self — Trig/Precalc (KA Trig 2) | — | 0 | 4 |
| trig.coterminal-angle | Coterminal angle in [0°, 360°) | self — Trig/Precalc (KA Trig 2) | — | 0 | 0 |
| trig.exact-trig-any-quadrant | Exact trig values beyond Quadrant I | self — Trig/Precalc (KA Trig 2) | — | 0 | 0 |
| trig.reciprocal-trig-value | Evaluate csc/sec/cot at special angles | self — Trig/Precalc (KA Trig 2) | — | 0 | 0 |
| trig.amplitude-from-equation | Amplitude read off a sinusoid's equation | self — Trig/Precalc (KA Trig 2) | — | 0 | 1 |
| trig.midline-from-equation | Midline read off a sinusoid's equation | self — Trig/Precalc (KA Trig 2) | — | 0 | 1 |
| trig.period-from-equation | Period of a sinusoid as kπ | self — Trig/Precalc (KA Trig 2) | — | 0 | 1 |
| trig.evaluate-inverse-trig | Inverse trig at special values | self — Trig/Precalc (KA Trig 2) | — | 0 | 1 |
| trig.graph-sinusoid | Graph a sinusoidal function (Low; kernel source) | self — Trig/Precalc (KA Trig 2) | pays the Algebra 2 KA 11 sinusoid deferral | 0 | 0 |
| trig.triangle-area-sine | Triangle area via ½ab·sin C at special angles | self — Trig/Precalc (KA Trig 3) | — | 0 | 0 |
| trig.choose-triangle-law | Choose law of sines vs cosines from the given configuration | self — Trig/Precalc (KA Trig 3) | — | 0 | 2 |
| trig.law-of-sines-solve | Solve a triangle with the law of sines (Low; kernel source) | self — Trig/Precalc (KA Trig 3) | — | 0 | 0 |
| trig.law-of-cosines-solve | Solve a triangle with the law of cosines (Low; kernel source) | self — Trig/Precalc (KA Trig 3) | — | 0 | 0 |
| trig.tan-from-sin-cos | Tangent via the quotient identity | self — Trig/Precalc (KA Trig 4) | — | 0 | 1 |
| trig.trig-parity | Even/odd identities for sin/cos/tan | self — Trig/Precalc (KA Trig 4) | — | 0 | 1 |
| trig.angle-sum-formula-recall | Angle addition formula recall | self — Trig/Precalc (KA Trig 4) | — | 0 | 2 |
| trig.double-angle-evaluate | Evaluate sin 2θ / cos 2θ from sin θ and cos θ | self — Trig/Precalc (KA Trig 4) | — | 0 | 0 |
| trig.solve-basic-trig-equation | Solve sin/cos/tan θ = special value on [0°, 360°) | self — Trig/Precalc (KA Trig 4) | — | 0 | 1 |
| trig.solve-trig-equation-general | Solve a general trig equation (Low; kernel source) | self — Trig/Precalc (KA Trig 4) | — | 0 | 0 |
| trig.prove-identity | Prove a trigonometric identity (Low; kernel source) | self — Trig/Precalc (KA Trig 4) | — | 0 | 0 |
| trig.compose-functions-expression | Compose two functions symbolically | self — Trig/Precalc (KA Precalc 1) | — | 0 | 0 |
| trig.verify-inverse-pair | Verify two functions are inverses | self — Trig/Precalc (KA Precalc 1) | — | 0 | 0 |
| trig.complex-quadrant | Quadrant of a complex number | self — Trig/Precalc (KA Precalc 3) | — | 0 | 1 |
| trig.complex-modulus | Modulus of a complex number | self — Trig/Precalc (KA Precalc 3) | also owns vector magnitude (KA Precalc 6) and the polar r-computation (A&T ch. 10) — same √(a²+b²) fact family; the BC section (CED 9, speed/magnitude) also cross-references here (noted in the Unit 9 consistency pass) | 0 | 1 |
| trig.complex-divide | Divide two complex numbers (Low; kernel source) | self — Trig/Precalc (KA Precalc 3) | — | 0 | 0 |
| trig.complex-to-polar | Convert a complex number to polar form (Low; kernel source) | self — Trig/Precalc (KA Precalc 3) | — | 0 | 0 |
| trig.vertical-asymptote | Vertical asymptote of a rational function | self — Trig/Precalc (KA Precalc 4) | first-course-owns: Calculus AB (CED 1) cross-references here (noted in the Unit 9 consistency pass) | 0 | 2 |
| trig.horizontal-asymptote | Horizontal asymptote of a rational function | self — Trig/Precalc (KA Precalc 4) | also satisfies the limit-at-infinity rows (KA Precalc 10) — same read; the Calculus AB (CED 1, limits at infinity) and BC (CED 10, sequence limits) rows cross-reference here (recorded in the calculus passes) | 0 | 2 |
| trig.identify-hole | Removable discontinuity from factored form | self — Trig/Precalc (KA Precalc 4) | — | 0 | 2 |
| trig.graph-rational-function | Graph a rational function (Low; kernel source) | self — Trig/Precalc (KA Precalc 4) | — | 0 | 0 |
| trig.ellipse-axes-read | Semi-axis lengths off an ellipse's standard form | self — Trig/Precalc (KA Precalc 5) | pays the Int 11 / A&T 12 ellipse-hyperbola deferral recorded in the Algebra 2 pass | 0 | 0 |
| trig.ellipse-foci-distance | Focal distance of an ellipse | self — Trig/Precalc (KA Precalc 5) | — | 0 | 0 |
| trig.hyperbola-asymptote-slope | Asymptote slope off a hyperbola's standard form | self — Trig/Precalc (KA Precalc 5) | — | 0 | 0 |
| trig.classify-conic | Classify a conic from its equation | self — Trig/Precalc (KA Precalc 5) | — | 0 | 0 |
| trig.vector-add | Add or subtract vectors componentwise | self — Trig/Precalc (KA Precalc 6) | first-course-owns: BC (CED 9) cross-references here (noted in the Unit 9 consistency pass) | 0 | 0 |
| trig.vector-from-points | Vector between two points | self — Trig/Precalc (KA Precalc 6) | — | 0 | 0 |
| trig.vector-direction-angle | Direction angle of a vector (Low; kernel source) | self — Trig/Precalc (KA Precalc 6) | — | 0 | 0 |
| trig.matrix-add-entry | One entry of a matrix sum or difference | self — Trig/Precalc (KA Precalc 7) | — | 0 | 0 |
| trig.matrix-multiply-entry | One entry of a 2×2 matrix product | self — Trig/Precalc (KA Precalc 7) | — | 0 | 0 |
| trig.determinant-2x2 | Determinant of a 2×2 matrix | self — Trig/Precalc (KA Precalc 7) | — | 0 | 1 |
| trig.matrix-product-defined | Judge whether a matrix product is defined | self — Trig/Precalc (KA Precalc 7) | — | 0 | 0 |
| trig.matrix-inverse-2x2 | Inverse of a 2×2 matrix (Low; kernel source) | self — Trig/Precalc (KA Precalc 7) | — | 0 | 0 |
| trig.multiplication-principle | Fundamental counting principle | self — Trig/Precalc (KA Precalc 8) | — | 0 | 1 |
| trig.probability-with-counting | Probability via combinatorial counting (Low; kernel source) | self — Trig/Precalc (KA Precalc 8) | — | 0 | 0 |
| trig.geometric-series-converges | Convergence judgment for a geometric series | self — Trig/Precalc (KA Precalc 9) | first-course-owns: the BC series section (CED unit 10) cross-references here (satisfied in the BC pass) | 0 | 2 |
| trig.limit-by-substitution | Limit by direct substitution | self — Trig/Precalc (KA Precalc 10) | first-course-owns: Calculus AB (CED unit 1) cross-references here (satisfied in the Calculus AB pass) | 0 | 3 |
| trig.limit-removable-factor | Limit of a removable-singularity quotient | self — Trig/Precalc (KA Precalc 10) | first-course-owns: Calculus AB (CED unit 1) cross-references here (satisfied in the Calculus AB pass) | 0 | 0 |
| trig.classify-discontinuity | Classify a discontinuity | self — Trig/Precalc (KA Precalc 10) | first-course-owns: Calculus AB (CED unit 1) cross-references here (satisfied in the Calculus AB pass) | 0 | 0 |
| trig.continuity-at-point | Continuity check at a piecewise seam | self — Trig/Precalc (KA Precalc 10) | first-course-owns: Calculus AB (CED unit 1) cross-references here (satisfied in the Calculus AB pass) | 0 | 1 |
| trig.limit-by-rationalizing | Limit requiring algebraic manipulation (Low; kernel source) | self — Trig/Precalc (KA Precalc 10) | first-course-owns: Calculus AB (CED unit 1) cross-references here (satisfied in the Calculus AB pass) | 0 | 0 |
| trig.polar-to-rectangular | Polar → rectangular coordinates at axis angles | self — Trig/Precalc (OpenStax merge, A&T ch. 10 / Precalc 2e ch. 8) | first-course-owns: the BC section (CED unit 9) cross-references here (satisfied in the BC pass) | 0 | 0 |
| trig.parametric-evaluate | Evaluate a parametric point at t | self — Trig/Precalc (OpenStax merge, A&T ch. 10 / Precalc 2e ch. 8) | first-course-owns: the BC section (CED unit 9) cross-references here (satisfied in the BC pass) | 0 | 0 |
| trig.eliminate-parameter | Eliminate the parameter (Low; kernel source) | self — Trig/Precalc (OpenStax merge, A&T ch. 10 / Precalc 2e ch. 8) | first-course-owns: the BC section (CED unit 9) cross-references here (satisfied in the BC pass) | 0 | 0 |
| calcab.special-trig-limits | Special trig limits (sin(ax)/x family) recall | self — Calculus AB (CED 1) | — | 0 | 0 |
| calcab.ivt-guarantees-zero | IVT sign-change guarantee check | self — Calculus AB (CED 1) | — | 0 | 0 |
| calcab.derivative-power-rule | Power rule d/dx xⁿ = nxⁿ⁻¹ | self — Calculus AB (CED 2) | — | 0 | 9 |
| calcab.derivative-standard-table | Derivative recall for the standard function table | self — Calculus AB (CED 2) | — | 0 | 8 |
| calcab.derivative-at-point | Evaluate f′(a) for a monomial | self — Calculus AB (CED 2) | — | 0 | 6 |
| calcab.differentiate-polynomial | Differentiate a short polynomial termwise | self — Calculus AB (CED 2) | — | 0 | 7 |
| calcab.product-quotient-rule-recall | Product/quotient rule formula recall | self — Calculus AB (CED 2) | — | 0 | 2 |
| calcab.recognize-difference-quotient | Recognize a difference quotient as a table derivative | self — Calculus AB (CED 2) | — | 0 | 0 |
| calcab.apply-product-rule | Differentiate a product (Low; kernel source) | self — Calculus AB (CED 2) | — | 0 | 0 |
| calcab.tangent-line-equation | Equation of a tangent line (Low; kernel source) | self — Calculus AB (CED 2) | — | 0 | 0 |
| calcab.chain-rule-recall | Chain rule formula recall | self — Calculus AB (CED 3) | — | 0 | 5 |
| calcab.chain-rule-linear-inner | Differentiate f(ax) via the chain rule | self — Calculus AB (CED 3) | — | 0 | 2 |
| calcab.derivative-inverse-trig-table | Inverse-trig derivative table recall | self — Calculus AB (CED 3) | — | 0 | 0 |
| calcab.second-derivative-power | Evaluate f″(a) for a monomial | self — Calculus AB (CED 3) | — | 0 | 0 |
| calcab.implicit-differentiation | Implicit differentiation (Low; kernel source) | self — Calculus AB (CED 3) | — | 0 | 1 |
| calcab.derivative-inverse-function-value | Derivative of an inverse function at a value (Low; kernel source) | self — Calculus AB (CED 3) | — | 0 | 0 |
| calcab.velocity-from-position | Velocity from a position polynomial | self — Calculus AB (CED 4) | — | 0 | 0 |
| calcab.indeterminate-form-check | Verify a 0/0 or ∞/∞ indeterminate form | self — Calculus AB (CED 4) | — | 0 | 1 |
| calcab.lhopital-apply | Evaluate a limit by L'Hôpital's rule (Low; kernel source) | self — Calculus AB (CED 4) | — | 0 | 0 |
| calcab.related-rates | Related-rates problems (Low; kernel source) | self — Calculus AB (CED 4) | — | 0 | 0 |
| calcab.linear-approximation | Tangent-line approximation (Low; kernel source) | self — Calculus AB (CED 4) | — | 0 | 0 |
| calcab.derivative-sign-read | Increasing/decreasing from the sign of f′ | self — Calculus AB (CED 5) | — | 0 | 0 |
| calcab.concavity-sign-read | Concavity from the sign of f″ | self — Calculus AB (CED 5) | — | 0 | 2 |
| calcab.second-derivative-test-read | Classify a critical point via the second-derivative test | self — Calculus AB (CED 5) | — | 0 | 1 |
| calcab.critical-point-quadratic | Critical point of a quadratic | self — Calculus AB (CED 5) | — | 0 | 2 |
| calcab.mvt-apply | Find the Mean Value Theorem's c (Low; kernel source) | self — Calculus AB (CED 5) | — | 0 | 0 |
| calcab.find-inflection-points | Find inflection points (Low; kernel source) | self — Calculus AB (CED 5) | — | 0 | 0 |
| calcab.absolute-extrema-closed-interval | Absolute extrema by the candidates test (Low; kernel source) | self — Calculus AB (CED 5) | — | 0 | 0 |
| calcab.optimization | Applied optimization (Low; kernel source) | self — Calculus AB (CED 5) | — | 0 | 0 |
| calcab.antiderivative-power-rule | Antiderivative power rule | self — Calculus AB (CED 6) | — | 0 | 5 |
| calcab.antiderivative-standard-table | Antiderivative recall for the standard table | self — Calculus AB (CED 6) | — | 0 | 4 |
| calcab.ftc-derivative-of-accumulation | Derivative of an accumulation function (FTC part 1) | self — Calculus AB (CED 6) | — | 0 | 0 |
| calcab.definite-integral-power | Evaluate a one-term definite integral (FTC part 2) | self — Calculus AB (CED 6) | — | 0 | 4 |
| calcab.integral-additivity | Definite-integral properties (additivity, reversal, scaling) | self — Calculus AB (CED 6) | — | 0 | 0 |
| calcab.riemann-sum-compute | Compute a Riemann sum (Low; kernel source) | self — Calculus AB (CED 6) | — | 0 | 0 |
| calcab.u-substitution | Integrate by u-substitution (Low; kernel source) | self — Calculus AB (CED 6) | — | 0 | 0 |
| calcab.verify-de-solution | Verify a differential-equation solution | self — Calculus AB (CED 7) | — | 0 | 0 |
| calcab.exponential-de-solution | General solution of y′ = ky | self — Calculus AB (CED 7) | — | 0 | 0 |
| calcab.solve-separable-de | Solve a separable differential equation (Low; kernel source) | self — Calculus AB (CED 7) | — | 0 | 0 |
| calcab.average-value-from-integral | Average value of f from a given integral | self — Calculus AB (CED 8) | — | 0 | 0 |
| calcab.position-from-velocity-simple | Position from velocity and an initial value | self — Calculus AB (CED 8) | — | 0 | 0 |
| calcab.area-between-curves | Area between curves (Low; kernel source) | self — Calculus AB (CED 8) | — | 0 | 0 |
| calcab.volume-disk-washer | Disk/washer volumes of revolution (Low; kernel source) | self — Calculus AB (CED 8) | — | 0 | 0 |
| calcab.volume-cross-sections | Volumes by known cross-sections (Low; kernel source) | self — Calculus AB (CED 8) | — | 0 | 0 |
| calcbc.parametric-slope-formula-recall | Parametric dy/dx formula recall | self — BC-only (CED 9) | — | 0 | 2 |
| calcbc.vector-derivative-evaluate | Componentwise derivative of a vector-valued function at t | self — BC-only (CED 9) | — | 0 | 0 |
| calcbc.polar-area-formula-recall | Polar area formula recall | self — BC-only (CED 9) | — | 0 | 1 |
| calcbc.parametric-slope-at-point | Parametric slope at a point (Low; kernel source) | self — BC-only (CED 9) | — | 0 | 0 |
| calcbc.second-derivative-parametric | Parametric second derivative (Low; kernel source) | self — BC-only (CED 9) | — | 0 | 0 |
| calcbc.polar-area-compute | Compute a polar-region area (Low; kernel source) | self — BC-only (CED 9) | — | 0 | 0 |
| calcbc.p-series-converges | p-series convergence judgment | self — BC-only (CED 10) | — | 0 | 4 |
| calcbc.ratio-test-read | Ratio-test threshold read | self — BC-only (CED 10) | — | 0 | 2 |
| calcbc.nth-term-test | nth-term divergence test | self — BC-only (CED 10) | — | 0 | 2 |
| calcbc.alternating-series-converges | Alternating-series convergence check | self — BC-only (CED 10) | — | 0 | 2 |
| calcbc.choose-convergence-test | Choose the convergence test from series structure | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.absolute-conditional-classify | Absolute vs conditional convergence classification | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.maclaurin-table-recall | Maclaurin series table recall | self — BC-only (CED 10) | — | 0 | 1 |
| calcbc.maclaurin-coefficient | Coefficient of xⁿ in a table Maclaurin series | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.taylor-coefficient-from-derivative | Taylor coefficient from a given derivative value | self — BC-only (CED 10) | — | 0 | 2 |
| calcbc.radius-geometric-form | Radius of convergence of a geometric-form series | self — BC-only (CED 10) | — | 0 | 1 |
| calcbc.interval-of-convergence | Interval of convergence (Low; kernel source) | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.taylor-polynomial-build | Build a Taylor polynomial (Low; kernel source) | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.lagrange-error-bound | Lagrange error bound (Low; kernel source) | self — BC-only (CED 10) | — | 0 | 0 |
| calcbc.parts-formula-recall | Integration-by-parts formula recall | self — BC-only (CED 6 BC scope) | — | 0 | 1 |
| calcbc.integration-by-parts | Integrate by parts (Low; kernel source) | self — BC-only (CED 6 BC scope) | — | 0 | 0 |
| calcbc.partial-fraction-decomposition | Partial-fraction decomposition and integration (Low; kernel source) | self — BC-only (CED 6 BC scope) | — | 0 | 0 |
| calcbc.improper-p-integral-converges | Improper p-integral convergence judgment | self — BC-only (CED 6 BC scope) | — | 0 | 0 |
| calcbc.euler-step | One Euler-method step | self — BC-only (CED 7 BC scope) | — | 0 | 0 |
| calcbc.logistic-limit-read | Carrying capacity off a logistic differential equation | self — BC-only (CED 7 BC scope) | — | 0 | 0 |
| calcbc.arc-length-formula-recall | Arc-length formula recall (function and parametric forms) | self — BC-only (CED 8 BC scope; parametric family serves CED 9) | — | 0 | 0 |

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

Sub-Pre-Algebra skills (`fk.` slugs) that course entries cite as prerequisites — number facts, place value, signed-number arithmetic, fraction sense. Seeded during the Pre-Algebra pass; grows strictly via registry-mediated additions (an `fk.` entry exists **only** because at least one course entry cites it — this section is demand-driven, never a curriculum sweep of elementary arithmetic, which is out of scope except as kernels). Four of these kernels are the calibration anchors; their canonical records live in the calibration section and are absorbed here by reference, not duplicated.

**Anchor cross-references** (canonical records in *Calibration anchors & pinned reference set*):

**fk.times-tables — Multiplication facts** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.
**fk.division-facts — Division facts (times-table inverses)** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.
**fk.addition-facts — Addition facts and mental two-digit addition** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.
**fk.subtraction-facts — Subtraction facts and mental two-digit subtraction** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.

### fk.place-value — Place-value identification

Rating: High · Format: single-number
Why: Pure read-off of a named place — no transformation; ~1–2s think + one or two keystrokes.
Sample: In 3,482, which digit is in the tens place? → 8 · Rule: int-exact · Params: whole numbers 3–5 digits, asked place from ones through thousands; decimal variant asks tenths/hundredths of numbers with ≤ 2 decimal places; answer is always a single digit 0–9.
Kernels: No drillable kernel beyond entries already listed

### fk.integer-add-sub — Signed addition and subtraction

Rating: High · Format: single-number
Why: One sign-aware fact-family step (e.g. −7 + 12 rides the same fact as 12 − 7) — recall-speed for a fluent student, ≤3s.
Sample: −7 + 12 → 5 · Rule: int-exact · Params: operands ∈ [−20, 20], both addition and subtraction prompts, all sign combinations; answers ∈ [−40, 40] — negative answers carry the engine contract's touch-minus-key caveat until the proposed pad exists.
Kernels: [fk.addition-facts, fk.subtraction-facts]

### fk.integer-mul-div — Sign rules for products and quotients

Rating: High · Format: single-number
Why: One times-table fact plus a memorized sign rule — still pure recall, ≤3s.
Sample: (−3) × (−4) → 12 · Rule: int-exact · Params: factors ∈ [−12, 12] excluding 0 and ±1, magnitudes within times-table range; division prompts always exact (dividend = divisor × quotient); negative answers carry the touch-minus-key caveat.
Kernels: [fk.times-tables, fk.division-facts]

### fk.doubling-halving — Double or halve a number

Rating: High · Format: single-number
Why: Single fluent operation drilled to recall (halving 46 is one move, not a division procedure); ≤3s including entry.
Sample: Half of 46 → 23 · Rule: int-exact · Params: doubling: n ∈ [13, 99]; halving: even n ∈ [12, 98] plus round hundreds ≤ 400; answers always positive integers.
Kernels: [fk.addition-facts, fk.division-facts]

### fk.two-digit-times-one-digit — 2-digit × 1-digit mental multiplication

Rating: Medium · Format: single-number
Why: One held-in-head transformation (split, two table facts, recombine: 34 × 6 = 180 + 24) — squarely 3–8s.
Sample: 34 × 6 → 204 · Rule: int-exact · Params: 2-digit factor ∈ [13, 49] excluding multiples of 10, 1-digit factor ∈ [3, 9]; answers ≤ 441 (3 digits).
Kernels: [fk.times-tables, fk.addition-facts]

### fk.perfect-squares — Perfect-square recall

Rating: High · Format: single-number · Render: unicode-inline
Why: Pure fact recall (squares are drilled as a fact family, not computed); ≤3s even at 15².
Sample: 13² → 169 · Rule: int-exact · Params: bases ∈ [2, 15]; answers ≤ 225 (3 digits). Per-fact keys `sq:13` style — no commutative normalization needed.
Kernels: [fk.times-tables]

### fk.perfect-cubes — Perfect-cube recall

Rating: High · Format: single-number · Render: unicode-inline
Why: Small-cube recall is a fact family like squares; bases past 6 drift toward computation, so params cap there to keep the entry pure recall.
Sample: 4³ → 64 · Rule: int-exact · Params: bases ∈ [2, 6] core (answers ≤ 216); optional stretch band bases 7–10 should be flagged as its own key family if used, since those are computed, not recalled.
Kernels: [fk.times-tables]

### fk.powers-of-ten — Multiply or divide by a power of ten

Rating: High · Format: single-number
Why: Pure place-shift rule — no arithmetic content at all; ≤3s.
Sample: 4700 ÷ 100 → 47 · Rule: int-exact · Params: shifts of 1–4 places; operands chosen so the answer is a positive integer (decimal-answer variants live in the Pre-Algebra decimal entries that cite this kernel); answers ≤ 6 digits.
Kernels: [fk.place-value]

### fk.fraction-of-number — Fraction of a whole number

Rating: Medium · Format: single-number
Why: One two-fact transformation (divide by the denominator, multiply by the numerator) held mentally — 3–6s.
Sample: 3/4 of 20 → 15 · Rule: int-exact · Params: denominators ∈ [2, 10], numerators ∈ [1, denominator−1] (unit fractions form the easy sub-band), whole ∈ [6, 60] and divisible by the denominator; answers positive integers ≤ 54.
Kernels: [fk.division-facts, fk.times-tables]

### fk.unit-conversion-facts — Measurement conversion-factor recall

Rating: High · Format: single-number
Why: Pure fact recall of a memorized conversion factor — ≤2s. (added during Algebra 1 pass — first cited by alg1.unit-convert-one-step)
Sample: How many minutes are in one hour? → 60 · Rule: int-exact · Params: factor families: time (60 s/min, 60 min/hr, 24 hr/day, 7 day/wk), metric (10, 100, 1000 place factors), customary length (12 in/ft, 3 ft/yd; 5280 ft/mi as a stretch band); asked as bare factor recall in both directions of phrasing; answers ≤ 5280.
Kernels: No drillable kernel beyond entries already listed

---

## Pre-Algebra

Swept against the KA Pre-Algebra checklist (15 units) with the Prealgebra 2e cross-check; the checklist-disposition table closes the section. Entries are grouped by the KA unit that surfaced them, followed by the OpenStax cross-check merges (KA Pre-Algebra has no fraction-arithmetic or decimal-arithmetic unit — those skills sit in KA's earlier arithmetic course — so the fraction/decimal block below enters via the OpenStax diff). Pre-Algebra is the first course, so nearly every topic here is canonical (first-course-owns); the two exceptions are cross-reference rows to Algebra 1 calibration stubs, annotated in the registry. Six entries carry the `pinned calibration entry` tag — authored during calibration, absorbed here in place; three more Pre-Algebra entries (`prealg.gcd-two-numbers`, `prealg.lcm-two-numbers`, `prealg.common-denominator`) are calibration **anchors** whose canonical records stay in the calibration section and are absorbed by reference where they arise below.

**KA Unit 1 — Factors and multiples.**

**prealg.gcd-two-numbers — Greatest common divisor of two small numbers** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.
**prealg.lcm-two-numbers — Least common multiple of two small numbers** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference.

### prealg.divisibility-rule-check — Divisibility-rule verification · pinned calibration entry

Rating: High · Format: true-false
Why: One rule application (digit sum or last-digit test) plus a single tap ≈ 2s total; true-false is legitimate here because the drillable skill IS the rule-based verification — the numeric restatement ("remainder of 51 ÷ 3") drills slower long division instead of the rule.
Sample: True or false: 51 is divisible by 3 → true · Rule: tf · Params: divisors ∈ {2, 3, 4, 5, 6, 9, 10}; dividends 2–3 digits; families generated balanced 50/50 true/false with near-miss false cases (remainder 1–2).
Kernels: [fk.addition-facts, fk.division-facts]

### prealg.smallest-prime-factor — Smallest prime factor

Rating: High · Format: single-number
Why: One divisibility-rule scan (2? 3? 5? 7?) ending at the first hit — recall-speed for a fluent student, ≤3s; also the legend's canonical numeric restatement of "is N prime?".
Sample: Smallest prime factor of 51 → 3 · Rule: int-exact · Params: n ∈ [10, 99] composite with smallest prime factor ∈ {2, 3, 5, 7}, factors 3/5/7 weighted over the trivial 2; answers one digit.
Kernels: [prealg.divisibility-rule-check, fk.division-facts]

### prealg.prime-factorization — Full prime factorization

Rating: Low
Why: Inherently multi-step at any speed — repeated smallest-factor extraction until 1, with bookkeeping of the accumulated factors.
Kernels: [prealg.smallest-prime-factor, fk.division-facts, fk.times-tables]

**KA Unit 2 — Patterns.**

### prealg.next-term-arithmetic — Next term of an arithmetic pattern

Rating: Medium · Format: single-number
Why: One transformation — spot the common difference, apply it once — 3–5s including the scan of the shown terms.
Sample: Next term: 3, 7, 11, 15, … → 19 · Rule: int-exact · Params: first term ∈ [1, 20], common difference ∈ ±[2, 9], four terms shown; decreasing patterns may cross zero (negative answers carry the touch-minus-key caveat).
Kernels: [fk.addition-facts, fk.subtraction-facts]

**KA Unit 3 — Ratios and rates.**

### prealg.simplify-ratio — Simplify a ratio

Rating: Medium · Format: two-numbers
Why: One transformation — find the common factor and divide it out of both sides — the same move as simplifying a fraction, 3–6s.
Sample: Write 12 : 18 in simplest form (a, b) → 2, 3 · Rule: pair-ordered · Params: built as (a·g) : (b·g) with gcd(a, b) = 1, a, b ∈ [1, 9], g ∈ [2, 8]; given terms ≤ 72.
Kernels: [prealg.gcd-two-numbers, fk.division-facts]

### prealg.unit-rate — Unit rate from a quantity pair

Rating: Medium · Format: single-number
Why: One division held mentally (240 ÷ 4 is a table fact plus a place shift) — 3–6s including prompt parse.
Sample: 240 miles in 4 hours — how many miles per hour? → 60 · Rule: int-exact · Params: divisor ∈ [2, 12], integer answers ∈ [5, 95], totals ≤ 600; contexts rotate (miles/hour, cost/item, pages/minute) but the arithmetic shape is fixed.
Kernels: [fk.division-facts, fk.powers-of-ten]

### prealg.solve-proportion — Missing value in a proportion

Rating: Medium · Format: single-number
Why: One transformation — read the scale factor across the equivalence and apply it — 3–6s; owns the "equivalent fractions, missing value" drill for the whole document.
Sample: 3/4 = x/20 → 15 · Rule: int-exact · Params: base fraction a/b in lowest terms, a, b ∈ [1, 9]; integer scale factor ∈ [2, 9]; all four values ≤ 100; the unknown rotates through all four positions.
Kernels: [fk.times-tables, fk.division-facts]

**KA Unit 4 — Percentages.**

### prealg.percent-to-decimal — Percent → decimal conversion · pinned calibration entry

Rating: High · Format: decimal · Surface-sensitive
Why: Pure rule recall (shift the point two places) — ~0.5s think + ~1.25s entry on the assumed decimal pad; entry is most of the budget, so a 2× slower surface would tip it to Medium.
Sample: Write 35% as a decimal → 0.35 · Rule: dec-exact · Params: integer percents ∈ [1, 150]; answers normalize to at most 2 decimal places under dec-exact.
Kernels: No drillable kernel beyond entries already listed

### prealg.decimal-to-percent — Decimal → percent conversion

Rating: High · Format: single-number
Why: Pure rule recall (shift the point two places the other way); the answer is the percent *number*, so entry is one or two digits — ≤2s total.
Sample: Write 0.07 as a percent (number only) → 7 · Rule: int-exact · Params: decimals with ≤ 2 places in (0, 1.5]; only values with integer percent forms; answers ∈ [1, 150].
Kernels: [fk.powers-of-ten]

### prealg.percent-to-fraction — Percent → fraction in lowest terms

Rating: Medium · Format: fraction
Why: One chained transformation — put the percent over 100 and reduce — 3–6s on the assumed fraction pad.
Sample: Write 40% as a fraction in lowest terms → 2/5 · Rule: frac-lowest-terms · Params: integer percents ∈ [1, 99] with gcd(p, 100) ≥ 4 so genuine reduction is always exercised; lowest-terms denominators ≤ 25.
Kernels: [prealg.simplify-fraction, fk.division-facts]

### prealg.fraction-to-percent — Fraction → percent

Rating: Medium · Format: single-number
Why: One transformation — scale the denominator to 100 (or recall the benchmark) — 3–5s; the answer is the percent number, so entry is cheap.
Sample: Write 3/5 as a percent (number only) → 60 · Rule: int-exact · Params: denominators ∈ {2, 4, 5, 10, 20, 25, 50}, fractions in lowest terms; integer percent answers ∈ [2, 98].
Kernels: [fk.times-tables, fk.powers-of-ten]

### prealg.percent-of-number — Percent of a number

Rating: Medium · Format: single-number
Why: One mental route — 10%-shift or benchmark-fraction — held in the head, 3–7s at the friendly parameter values below.
Sample: 25% of 44 → 11 · Rule: int-exact · Params: percents ∈ {5, 10, 20, 25, 50, 75} ∪ multiples of 10 ≤ 90; wholes ≤ 200 chosen so answers are positive integers ≤ 180.
Kernels: [fk.fraction-of-number, fk.doubling-halving, fk.powers-of-ten]

### prealg.find-whole-from-percent — Find the whole from a part and percent

Rating: Medium · Format: single-number
Why: One inverse transformation (12 is 25% → the whole is 12 × 4) — one benchmark inversion plus one product, 4–7s.
Sample: 12 is 25% of what number? → 48 · Rule: int-exact · Params: percents ∈ {10, 20, 25, 50, 75}; parts chosen so wholes are integers ≤ 200.
Kernels: [fk.times-tables, fk.fraction-of-number]

### prealg.find-percent-from-pair — What percent is a of b

Rating: Medium · Format: single-number
Why: One transformation — reduce the pair to a benchmark fraction and read its percent — 4–7s at benchmark-only params.
Sample: 9 is what percent of 36? (number only) → 25 · Rule: int-exact · Params: part/whole reduces to a fraction with denominator ∈ {2, 4, 5, 10, 20}; wholes ≤ 200; integer percent answers.
Kernels: [prealg.simplify-fraction, prealg.fraction-to-percent]

### prealg.percent-change — Percent increase or decrease

Rating: Medium · Format: single-number
Why: Two quick chained steps (difference, then difference-over-original as a benchmark percent) — sits at Medium's upper half even with friendly numbers; params keep every division a benchmark read.
Sample: A price rises from 40 to 50. Percent increase? (number only) → 25 · Rule: int-exact · Params: originals ∈ [10, 200]; change/original ∈ {5%, 10%, 20%, 25%, 50%, 100%}; increases and decreases balanced; answer is the unsigned percent number (direction lives in the prompt).
Kernels: [fk.subtraction-facts, prealg.find-percent-from-pair]

**KA Unit 5 — Exponents intro and order of operations.**

### prealg.evaluate-exponent — Evaluate a small power

Rating: High · Format: single-number · Render: unicode-inline
Why: Squares and cubes are recall; the fourth-power top band adds one held multiplication — still ≤3s for a fluent student.
Sample: 3⁴ → 81 · Rule: int-exact · Params: base ∈ [2, 10], exponent ∈ [2, 4], values ≤ 1024; exponent-4 cases restricted to bases 2–5.
Kernels: [fk.times-tables, fk.perfect-squares, fk.perfect-cubes, fk.two-digit-times-one-digit]

### prealg.order-of-operations — Two-operation order of operations

Rating: Medium · Format: single-number
Why: One precedence judgment plus two fact-level operations held in sequence — 3–6s.
Sample: 3 + 4 × 2 → 11 · Rule: int-exact · Params: exactly two operations from {+, −, ×} (optionally one parenthesis pair that changes the answer); operands ≤ 12; every intermediate and final value a positive integer ≤ 60.
Kernels: [fk.times-tables, fk.addition-facts, fk.subtraction-facts]

**KA Unit 6 — Variables & expressions.**

### prealg.evaluate-expression — Evaluate a one-variable expression

Rating: Medium · Format: single-number
Why: One substitution plus one or two fact-level operations — 3–6s held mentally.
Sample: 3x + 2 when x = 4 → 14 · Rule: int-exact · Params: forms ax + b, a(x + b), x² + a with a, b ∈ [1, 9], x ∈ [2, 9]; signed band substitutes x ∈ [−9, −2] (negative answers carry the touch-minus-key caveat).
Kernels: [fk.times-tables, fk.addition-facts, fk.integer-mul-div]

### prealg.combine-like-terms — Combine like terms

Rating: High · Format: short-expression · Surface-sensitive
Why: One addition fact wearing algebra clothes; the answer is 2–3 tokens (≤1s entry), so total stays ≤3s — flips to Medium if entry runs 2× slow.
Sample: Simplify 5x + 3x → 8x · Rule: expr-commutative-ws · Params: 2–3 like terms in one variable, coefficients ∈ [1, 12], coefficient sums ≤ 99; answer alphabet {digits, x}; mixed-family variants (unlike terms present) belong to Algebra 1's sweep, not here.
Kernels: [fk.addition-facts]

**Distributive property (expand a(x + b))** → see alg1.distribute-linear (minted in the Algebra 1 calibration stub; canonical home **Pre-Algebra** per the registry note — KA Pre-Algebra units 6 and 12 exercise it first; slug immutable, in-degree follows the registry).

**KA Unit 7 — Equations & inequalities introduction.**

### prealg.solve-one-step-equation — Solve a one-step equation

Rating: High · Format: single-number
Why: One inverse-operation read (x + 7 = 12 *is* 12 − 7 to a fluent student) — recall speed, ≤3s.
Sample: x + 7 = 12. x = ? → 5 · Rule: int-exact · Params: all four operations; add/sub operands within the fact-family cap 50, mul/div within times-table range; integer answers; signed band (e.g. x + 9 = 4) admits negative answers with the touch-minus-key caveat.
Kernels: [fk.addition-facts, fk.subtraction-facts, fk.times-tables, fk.division-facts]

### prealg.check-solution — Check a candidate solution

Rating: High · Format: true-false
Why: One substitution-and-compare plus a single tap — ≤3s; genuinely a verification judgment, which is what true-false is for.
Sample: True or false: x = 3 is a solution of 2x + 1 = 7 → true · Rule: tf · Params: forms ax + b = c with a, b ∈ [1, 9], candidates ∈ [1, 9]; false cases off by 1–2; families balanced 50/50.
Kernels: [prealg.evaluate-expression]

**KA Unit 8 — Percent & rational number word problems.**

### prealg.absolute-value — Absolute value

Rating: High · Format: single-number
Why: Pure sign strip — no computation in the base band; the |a − b| band adds one subtraction fact and stays ≤3s.
Sample: |−7| → 7 · Rule: int-exact · Params: base band |n| with n ∈ [−99, 99]; stretch band |a − b| with a, b ∈ [1, 12]; answers always non-negative integers.
Kernels: [fk.subtraction-facts]

*(The rest of Unit 8 is word-problem application — see the disposition table, which names the kernels it exercises.)*

**KA Unit 9 — Proportional relationships.** (The missing-value drill is owned by Unit 3's prealg.solve-proportion; this unit adds the read-the-constant skill.)

### prealg.constant-of-proportionality — Constant of proportionality

Rating: Medium · Format: single-number
Why: One division read from a stated pair (k = y/x) — 3–5s including prompt parse.
Sample: y is proportional to x, and y = 12 when x = 3. k = ? → 4 · Rule: int-exact · Params: k ∈ [2, 12], x ∈ [2, 9], y = kx ≤ 108; prompt variants give a pair, a table row, or the equation y = kx directly.
Kernels: [fk.division-facts]

**KA Unit 10 — One-step and two-step equations & inequalities.** (One-step equations are owned under Unit 7.)

### prealg.solve-two-step-equation — Solve a two-step equation

Rating: Medium · Format: single-number
Why: Two chained inverse operations held mentally (undo the constant, then the coefficient) — 3–7s.
Sample: 3x + 5 = 20. x = ? → 5 · Rule: int-exact · Params: ax + b = c with a ∈ [2, 9], b ∈ [−15, 15], integer x ∈ [−9, 9]; c ≤ 99; negative answers carry the touch-minus-key caveat.
Kernels: [prealg.solve-one-step-equation, fk.integer-add-sub, fk.integer-mul-div]

### prealg.solve-one-step-inequality — Solve a one-step inequality

Rating: Medium · Format: multiple-choice
Why: One inverse operation plus a direction judgment (does the sign flip?) — 3–6s with a 4-option scan; MC is justified because the drillable skill is boundary *and* direction, and no single-number restatement preserves direction (the legend's last-resort case).
Sample: Solve: −3x < 12 → x > −4 (options: x > −4 · x < −4 · x > 4 · x < 4) · Rule: mc · Params: one step by any of the four operations; nonzero coefficients ∈ [−9, 9]; integer boundaries ∈ [−12, 12]; 4 options permuting direction and boundary sign; negative-coefficient (flip) cases ≥ 40% of the family.
Kernels: [prealg.solve-one-step-equation, fk.integer-mul-div]

**KA Unit 11 — Roots, exponents, & scientific notation.**

### prealg.square-root — Square root of a perfect square

Rating: High · Format: single-number · Render: unicode-inline
Why: Inverse recall against the squares fact family — ≤3s.
Sample: √144 → 12 · Rule: int-exact · Params: radicands the squares of [2, 15]; answers ≤ 15.
Kernels: [fk.perfect-squares]

### prealg.cube-root — Cube root of a perfect cube

Rating: High · Format: single-number · Render: unicode-inline
Why: Inverse recall against the small-cube fact family — ≤3s.
Sample: ∛64 → 4 · Rule: int-exact · Params: radicands the cubes of [2, 6]; answers ≤ 6.
Kernels: [fk.perfect-cubes]

### prealg.root-between-integers — Bracket a square root between integers

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One placement judgment against the squares family (49 < 50 < 64) plus a short two-number entry — 3–6s.
Sample: √50 lies between which consecutive integers? (smaller, larger) → 7, 8 · Rule: pair-ordered · Params: non-square radicands ∈ [5, 250]; answers consecutive integers in [2, 15].
Kernels: [fk.perfect-squares]

### prealg.exponent-product-rule — Product rule for exponents

Rating: High · Format: single-number · Render: unicode-inline
Why: One addition fact once the rule is automatic (add the exponents) — ≤3s; asking for the exponent alone keeps the answer a single small integer.
Sample: 10³ × 10⁴ = 10ⁿ. n = ? → 7 · Rule: int-exact · Params: exponents ∈ [1, 9], displayed base from {2, 3, 5, 10, x}; answers ≤ 18.
Kernels: [fk.addition-facts]

### prealg.negative-exponent — Negative exponent as a unit fraction

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One rule application (reciprocal of the positive power) chained onto a power recall — 3–6s on the assumed fraction pad.
Sample: Write 2⁻³ as a fraction → 1/8 · Rule: frac-lowest-terms · Params: base ∈ [2, 10], exponent ∈ {−1, −2, −3}; denominators ≤ 1000; numerator always 1 (already lowest terms).
Kernels: [prealg.evaluate-exponent]

### prealg.scientific-to-standard — Scientific notation → standard form

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One place-shift transformation; the multi-digit answer makes entry a real share of the 3–8s budget.
Sample: 3.2 × 10⁴ in standard form → 32000 · Rule: int-exact · Params: mantissa an integer 1–9 or one-decimal-place value ∈ [1.1, 9.9]; exponent ∈ [2, 6] and ≥ the mantissa's decimal places, so answers are positive integers ≤ 7 digits.
Kernels: [fk.powers-of-ten, fk.place-value]

### prealg.scientific-notation-exponent — Exponent for scientific notation

Rating: Medium · Format: single-number
Why: One digit-count judgment (where does the point land?) — 3–5s; asking only for the exponent dodges the unsupported mixed decimal-times-power answer shape.
Sample: 45,000 = 4.5 × 10ⁿ. n = ? → 4 · Rule: int-exact · Params: values 3–7 digit whole numbers with ≤ 2 significant figures, plus small decimals (0.0032 → n = −3; negative answers carry the touch-minus-key caveat).
Kernels: [fk.place-value, fk.powers-of-ten]

**KA Unit 12 — Multi-step equations.**

### prealg.solve-multi-step-equation — Solve a multi-step equation

Rating: Low
Why: Inherently multi-step at any speed — distribute, collect like terms, then two inverse operations, with intermediate state to hold.
Kernels: [prealg.solve-two-step-equation, prealg.combine-like-terms, alg1.distribute-linear]

**KA Unit 13 — Two-variable equations.** (Evaluating y from x is owned by prealg.evaluate-expression; plotting and graph-reading are out-of-grain — see the disposition table.)

### prealg.check-point-solution — Check a point against a two-variable equation

Rating: Medium · Format: true-false
Why: One substitution of both coordinates and a compare — 3–6s; genuinely binary.
Sample: True or false: (2, 3) is a solution of y = 2x − 1 → true · Rule: tf · Params: y = mx + b with m, b ∈ [−9, 9]; coordinates ∈ [−9, 9]; false cases off by 1–3; families balanced 50/50.
Kernels: [prealg.evaluate-expression, fk.integer-mul-div, fk.integer-add-sub]

**KA Unit 14 — Functions and linear models.** (No new canonical entries: function evaluation → prealg.evaluate-expression; the slope-intercept read-off is a cross-reference.)

**Slope-intercept read-off (m and b from y = mx + b)** → see alg1.read-slope-intercept (owned by Algebra 1; minted in its calibration stub).

**KA Unit 15 — Systems of equations.**

### prealg.check-system-solution — Check a candidate solution of a 2×2 system

Rating: Medium · Format: true-false
Why: Two quick substitutions and compares — 4–7s, top half of Medium; still one binary judgment.
Sample: True or false: (2, 1) solves x + y = 3 and x − y = 1 → true · Rule: tf · Params: integer-coefficient equations with coefficients ∈ [−5, 5], coordinates ∈ [−6, 6]; false cases fail exactly one equation; families balanced 50/50.
Kernels: [prealg.check-point-solution, fk.integer-add-sub]

### prealg.solve-2x2-system — Solve a 2×2 linear system

Rating: Low
Why: Inherently multi-step at any speed — eliminate or substitute, solve, back-substitute — with intermediate results to hold; canonical here by first-course-owns (KA Pre-Algebra unit 15 lists it before Algebra 1 does).
Kernels: [prealg.solve-two-step-equation, prealg.solve-one-step-equation, fk.integer-add-sub]

**OpenStax cross-check merges — fractions & decimals (Prealgebra 2e chs. 4–5).** KA Pre-Algebra's checklist has no fraction- or decimal-arithmetic unit; four calibration pins already live in this territory, and the diff below fills the remaining fact families. Every non-pin entry in this block carries its OpenStax source note.

### prealg.simplify-fraction — Reduce a fraction to lowest terms · pinned calibration entry

Rating: High · Format: fraction · Surface-sensitive
Why: Fluent students recognize the common factor on sight — one step, ~1.5s think + ~1s entry on the assumed fraction pad; sits at the High boundary and flips to Medium if entry runs 2× slow.
Sample: Write 6/8 in lowest terms → 3/4 · Rule: frac-lowest-terms · Params: built as (a·g)/(b·g) with gcd(a, b) = 1, a, b ∈ [1, 9], g ∈ [2, 6]; given denominators ≤ 54.
Kernels: [fk.times-tables, fk.division-facts]

**prealg.common-denominator — Least common denominator of two fractions** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference (OpenStax ch. 4 territory).

### prealg.fraction-add-unlike — Add two fractions with unlike denominators · pinned calibration entry

Rating: Medium · Format: fraction
Why: One chained transformation held mentally — find the LCD, rescale, add, reduce — ~4–6s total, safely inside the 3–8s tier.
Sample: 1/2 + 1/3 → 5/6 · Rule: frac-lowest-terms · Params: distinct denominators from {2, 3, 4, 5, 6, 8, 10, 12} with LCD ≤ 24; answers in lowest terms, improper allowed (1/2 + 2/3 → 7/6).
Kernels: [prealg.common-denominator, fk.addition-facts, fk.times-tables]

### prealg.compare-fractions — Verify a fraction inequality · pinned calibration entry

Rating: Medium · Format: true-false
Why: One transformation — cross-multiply and compare — ~3–5s; the judgment is genuinely binary (verify a claimed inequality), which is what true-false is for.
Sample: True or false: 3/5 > 2/3 → false · Rule: tf · Params: denominators ≤ 12; values distinct but within ~1/6 of each other so cross-multiplication is genuinely required; families balanced 50/50 true/false.
Kernels: [fk.times-tables]

### prealg.fraction-multiply — Multiply two fractions

Rating: Medium · Format: fraction
Why: Two table facts plus a reduction (or one cross-cancellation) held mentally — 3–6s. (source: OpenStax Prealgebra 2e ch. 4 — absent from KA sweep)
Sample: 2/3 × 3/4 → 1/2 · Rule: frac-lowest-terms · Params: numerators/denominators ∈ [1, 9]; pairs constructed so at least one cross-cancellation exists; lowest-terms answers with denominator ≤ 24, improper allowed.
Kernels: [fk.times-tables, prealg.simplify-fraction]

### prealg.fraction-divide — Divide two fractions

Rating: Medium · Format: fraction
Why: One rule application (invert and multiply) chained onto the multiplication skill — 4–7s. (source: OpenStax Prealgebra 2e ch. 4 — absent from KA sweep)
Sample: 3/4 ÷ 2/5 → 15/8 · Rule: frac-lowest-terms · Params: numerators/denominators ∈ [1, 9]; results in lowest terms with denominator ≤ 24, improper allowed; divisor never equal to the dividend (answer 1 gives away the rule).
Kernels: [prealg.fraction-multiply, fk.times-tables]

### prealg.mixed-to-improper — Mixed number → improper fraction

Rating: High · Format: fraction · Surface-sensitive
Why: One fused move (whole × denominator + numerator, denominator kept) — ≤2s think; entry (~1.25s) is most of the remaining High budget, so a 2× slower surface tips it to Medium. (source: OpenStax Prealgebra 2e ch. 4 — absent from KA sweep)
Sample: Write 2 3/4 as an improper fraction → 11/4 · Rule: frac-lowest-terms · Params: whole ∈ [1, 9]; proper part in lowest terms with denominator ∈ [2, 9] (gcd(numerator, denominator) = 1 guarantees the improper result is already in lowest terms); answer numerators ≤ 89. The reverse direction (improper → mixed) has no supported answer format and is recorded as a disposition, not an entry.
Kernels: [fk.times-tables, fk.addition-facts]

### prealg.multiply-decimals — Multiply two one-place decimals · pinned calibration entry

Rating: Medium · Format: decimal
Why: One transformation — times-table product plus a decimal-place count — landing at the Medium floor (~3–4s total).
Sample: 0.3 × 0.4 → 0.12 · Rule: dec-exact · Params: both factors are tenths in [0.2, 0.9]; digit products that are multiples of 10 (e.g. 0.2 × 0.5) are excluded so the place count is always exercised and dec-exact normalization never hides a trailing zero.
Kernels: [fk.times-tables]

### prealg.decimal-add-sub — Add or subtract decimals

Rating: Medium · Format: decimal
Why: One place-aligned fact-family operation — the alignment judgment is what lifts it above the whole-number anchors into low Medium. (source: OpenStax Prealgebra 2e ch. 5 — absent from KA sweep)
Sample: 0.7 + 0.58 → 1.28 · Rule: dec-exact · Params: operands with 1–2 decimal places in (0, 20), mixed place counts required; subtraction differences kept positive; answers ≤ 2 places (no hidden trailing zeros).
Kernels: [fk.addition-facts, fk.subtraction-facts, fk.place-value]

### prealg.fraction-to-decimal — Fraction → decimal

Rating: Medium · Format: decimal
Why: Benchmark conversions are recall, the rest is one short division held mentally — 3–6s at terminating-only params. (source: OpenStax Prealgebra 2e ch. 5 — absent from KA sweep)
Sample: Write 3/8 as a decimal → 0.375 · Rule: dec-exact · Params: fractions in lowest terms with denominator ∈ {2, 4, 5, 8, 10, 20, 25}; terminating answers with ≤ 3 decimal places.
Kernels: [fk.division-facts]

### prealg.decimal-to-fraction — Decimal → fraction in lowest terms

Rating: Medium · Format: fraction
Why: One chained transformation — read the place value as the denominator, then reduce — 3–6s. (source: OpenStax Prealgebra 2e ch. 5 — absent from KA sweep)
Sample: Write 0.25 as a fraction in lowest terms → 1/4 · Rule: frac-lowest-terms · Params: decimals with 1–2 places in (0, 1), excluding values whose place-value fraction (over 10 or 100) is already in lowest terms — at least one reduction step is always required; lowest-terms denominators ≤ 25.
Kernels: [fk.place-value, prealg.simplify-fraction]

### prealg.round-to-place — Round to a named place

Rating: High · Format: decimal · Surface-sensitive
Why: One digit judgment (look one place right, round) — ≤3s, with the up-to-5-digit entry a large share of the budget; decimal format lets one entry cover whole-number and decimal targets, and dec-exact accepts integer answers unchanged. (source: OpenStax Prealgebra 2e chs. 1 & 5 — absent from KA sweep)
Sample: Round 3.86 to the nearest tenth → 3.9 · Rule: dec-exact · Params: whole numbers 3–5 digits rounded to tens/hundreds/thousands, and decimals with 2–3 places rounded to ones/tenths/hundredths; boundary digit 5 included deliberately.
Kernels: [fk.place-value]
*Marker added (Unit 9 recalibration):* Surface-sensitive — the tier flips to Medium if entry runs 2× slow, the same arithmetic that marks prealg.percent-to-decimal; the tier itself is unchanged.

**OpenStax cross-check merges — other chapters (Prealgebra 2e chs. 7, 9, 11).**

### prealg.identify-property — Name the illustrated property

Rating: Medium · Format: multiple-choice
Why: One pattern-match against four memorized property shapes plus an option scan — 3–5s; MC is justified because the answer *is* a name, with no numeric restatement. (source: OpenStax Prealgebra 2e ch. 7 — absent from KA sweep)
Sample: 3 + 5 = 5 + 3 illustrates which property? → Commutative (options: Commutative · Associative · Distributive · Identity) · Rule: mc · Params: fixed 4-option set; instance templates per property over both + and ×; operands ∈ [2, 9]; associative instances always show the moved parentheses.
Kernels: No drillable kernel beyond entries already listed

### prealg.perimeter-rectangle — Perimeter of a rectangle

Rating: Medium · Format: single-number
Why: One formula application held mentally (add the sides, double) — 3–5s. (source: OpenStax Prealgebra 2e ch. 9 — absent from KA sweep)
Sample: Perimeter of a 7 by 4 rectangle → 22 · Rule: int-exact · Params: sides ∈ [2, 20]; perimeters ≤ 80; prompt states the dimensions in text (no figure needed).
Kernels: [fk.addition-facts, fk.doubling-halving]

### prealg.area-triangle — Area of a triangle

Rating: Medium · Format: single-number
Why: One formula application (half of base × height) — two fused fact-level moves, 3–6s. (source: OpenStax Prealgebra 2e ch. 9 — absent from KA sweep)
Sample: Area of a triangle with base 10 and height 7 → 35 · Rule: int-exact · Params: base, height ∈ [2, 12] with base × height even; answers integers ≤ 72; dimensions stated in text (no figure needed).
Kernels: [fk.times-tables, fk.doubling-halving]

### prealg.circle-area-pi — Circle area as a coefficient of π

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One formula application (square the radius); asking for the coefficient of π keeps the answer a single integer — 3–5s. (source: OpenStax Prealgebra 2e ch. 9 — absent from KA sweep)
Sample: A circle has radius 5. Its area is kπ. k = ? → 25 · Rule: int-exact · Params: radius ∈ [2, 12]; answers ≤ 144. The circumference analog (k = 2r) is a separate key family if built — do not mix keys with area.
Kernels: [fk.perfect-squares]

### prealg.pythagorean-hypotenuse — Pythagorean triple recall

Rating: Medium · Format: single-number
Why: Triple recall (3-4-5 and friends) with a one-step scale check — 3–6s at triples-only params; general non-triple cases would be Low and are excluded. (source: OpenStax Prealgebra 2e ch. 9 — absent from KA sweep)
Sample: A right triangle has legs 3 and 4. How long is the hypotenuse? → 5 · Rule: int-exact · Params: triples (3,4,5), (5,12,13), (8,15,17), (7,24,25) and integer multiples up to (30,40,50); missing-leg variants included; sides stated in text (no figure needed).
Kernels: [fk.perfect-squares, prealg.square-root]

### prealg.identify-quadrant — Quadrant of a point

Rating: High · Format: single-number
Why: One two-sign read — pure recall of the quadrant map, ≤2s. (source: OpenStax Prealgebra 2e ch. 11 — absent from KA sweep)
Sample: Which quadrant contains (−3, 5)? (answer 1–4) → 2 · Rule: int-exact · Params: coordinates nonzero integers ∈ [−9, 9]; all four quadrants uniform; on-axis points excluded.
Kernels: No drillable kernel beyond entries already listed

**OpenStax chapters with no merge:** ch. 10 (Polynomials) is deliberately **not** merged — its drillable intro content is already covered by prealg.combine-like-terms and prealg.exponent-product-rule, and full polynomial arithmetic is Algebra-course grain (KA Algebra 1 unit 13 / Algebra 2 unit 1 are its canonical homes; merging here would front-run those sweeps). All other chapters are either covered by KA-swept entries or merged above — see the disposition table.

### Pre-Algebra checklist disposition table

Every KA Pre-Algebra unit (15) and every OpenStax Prealgebra 2e chapter (11) maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| KA 1 Factors and multiples | prealg.divisibility-rule-check, prealg.smallest-prime-factor, prealg.prime-factorization (Low), prealg.gcd-two-numbers (anchor), prealg.lcm-two-numbers (anchor) |
| KA 2 Patterns | prealg.next-term-arithmetic; remainder out-of-grain: writing/graphing pattern rules is modeling — no drillable content beyond kernels prealg.next-term-arithmetic, prealg.evaluate-expression |
| KA 3 Ratios and rates | prealg.simplify-ratio, prealg.unit-rate, prealg.solve-proportion; rate word problems out-of-grain — no drillable content beyond kernels prealg.unit-rate, prealg.solve-proportion |
| KA 4 Percentages | prealg.percent-to-decimal, prealg.decimal-to-percent, prealg.percent-to-fraction, prealg.fraction-to-percent, prealg.percent-of-number, prealg.find-whole-from-percent, prealg.find-percent-from-pair, prealg.percent-change |
| KA 5 Exponents intro and order of operations | prealg.evaluate-exponent, prealg.order-of-operations |
| KA 6 Variables & expressions | prealg.evaluate-expression, prealg.combine-like-terms; distributive property → cross-reference to alg1.distribute-linear (canonical home Pre-Algebra per registry); phrase-to-expression translation out-of-grain: word modeling — no drillable content beyond kernels prealg.evaluate-expression |
| KA 7 Equations & inequalities introduction | prealg.solve-one-step-equation, prealg.check-solution |
| KA 8 Percent & rational number word problems | prealg.absolute-value; remainder out-of-grain: word-problem/modeling unit — no drillable content beyond kernels prealg.percent-of-number, prealg.find-whole-from-percent, prealg.percent-change, prealg.fraction-add-unlike, fk.integer-add-sub, fk.integer-mul-div |
| KA 9 Proportional relationships | prealg.constant-of-proportionality; missing-value proportions → prealg.solve-proportion (owned under KA 3); graphing proportional relationships out-of-grain: graph reading, no supported answer shape — no drillable content beyond kernels prealg.constant-of-proportionality |
| KA 10 One-step and two-step equations & inequalities | prealg.solve-two-step-equation, prealg.solve-one-step-inequality; one-step equations → prealg.solve-one-step-equation (owned under KA 7) |
| KA 11 Roots, exponents, & scientific notation | prealg.square-root, prealg.cube-root, prealg.root-between-integers, prealg.exponent-product-rule, prealg.negative-exponent, prealg.scientific-to-standard, prealg.scientific-notation-exponent |
| KA 12 Multi-step equations | prealg.solve-multi-step-equation (Low; kernels prealg.solve-two-step-equation, prealg.combine-like-terms, alg1.distribute-linear) |
| KA 13 Two-variable equations | prealg.check-point-solution; completing solution tables → prealg.evaluate-expression; plotting/graph reading out-of-grain: needs graph input/figure output the format set does not define — no drillable content beyond kernels prealg.evaluate-expression, prealg.check-point-solution |
| KA 14 Functions and linear models | function evaluation → prealg.evaluate-expression; slope-intercept read-off → cross-reference to alg1.read-slope-intercept (owned by Algebra 1); remainder out-of-grain: linear-model interpretation and graph reading — no drillable content beyond kernels prealg.evaluate-expression, alg1.read-slope-intercept |
| KA 15 Systems of equations | prealg.check-system-solution, prealg.solve-2x2-system (Low) |
| OS 1 Whole Numbers | covered: fk.addition-facts, fk.subtraction-facts, fk.times-tables, fk.division-facts (anchors), fk.place-value, prealg.divisibility-rule-check; rounding merged as prealg.round-to-place |
| OS 2 The Language of Algebra | covered: prealg.evaluate-expression, prealg.combine-like-terms, prealg.order-of-operations, prealg.solve-one-step-equation |
| OS 3 Integers | covered: fk.integer-add-sub, fk.integer-mul-div (Foundational kernels), prealg.absolute-value |
| OS 4 Fractions | covered: prealg.simplify-fraction, prealg.fraction-add-unlike, prealg.compare-fractions, prealg.common-denominator (anchor), prealg.solve-proportion (equivalent fractions); merged: prealg.fraction-multiply, prealg.fraction-divide, prealg.mixed-to-improper. Improper → mixed direction: recorded judgment — no supported answer format (mixed numbers are not in the format legend); revisit only if a mixed-number format is ever added |
| OS 5 Decimals | covered: prealg.multiply-decimals; merged: prealg.decimal-add-sub, prealg.fraction-to-decimal, prealg.decimal-to-fraction, prealg.round-to-place |
| OS 6 Percents | covered by the KA 4 entry set (see that row) |
| OS 7 The Properties of Real Numbers | merged: prealg.identify-property; remainder out-of-grain: property vocabulary and justification prose — no drillable content beyond kernels prealg.identify-property |
| OS 8 Solving Linear Equations | covered by the KA 7 / KA 10 / KA 12 entry sets |
| OS 9 Math Models and Geometry | merged: prealg.perimeter-rectangle, prealg.area-triangle, prealg.circle-area-pi, prealg.pythagorean-hypotenuse; remainder out-of-grain: multi-step geometry word problems — no drillable content beyond kernels prealg.perimeter-rectangle, prealg.area-triangle, prealg.circle-area-pi, prealg.pythagorean-hypotenuse, prealg.percent-of-number |
| OS 10 Polynomials | no merge (recorded judgment): drillable intro covered by prealg.combine-like-terms, prealg.exponent-product-rule; polynomial arithmetic proper is Algebra-course grain — canonical homes KA Algebra 1 unit 13 / Algebra 2 unit 1 |
| OS 11 Graphs | merged: prealg.identify-quadrant; plotting/graph reading out-of-grain: no supported answer shape — no drillable content beyond kernels prealg.identify-quadrant, prealg.check-point-solution |

---

## Algebra 1

Swept against KA Algebra 1 units 1–15 with the Elementary Algebra 2e cross-check (units 16–17 are non-content — see the disposition table). Entries are grouped by the KA unit that surfaced them, followed by the OpenStax cross-check merges. Heavy cross-reference traffic runs back to Pre-Algebra owners (equation solving, exponent rules, systems — first-course-owns). Five entries carry the `pinned calibration entry` tag — authored during calibration, absorbed here in place; their pinned params are extended (never changed) where the calibration record deferred sign variants to this pass. The cross-check's headline finding is negative: the traditional-Algebra-1 one-variable-statistics/scatterplot block appears in **no** snapshot checklist source — recorded honestly in the merge block and disposition table, with no entries invented for it.

**KA Unit 1 — Algebra foundations.**

**Evaluating expressions by substitution** → see prealg.evaluate-expression (owned by Pre-Algebra).
**Combining like terms in one variable** → see prealg.combine-like-terms (owned by Pre-Algebra).

### alg1.distribute-linear — Distribute a constant over a binomial · pinned calibration entry

Rating: High · Format: short-expression · Surface-sensitive
Why: One mental step (two times-table products) with a 5-token answer ≈ 1.5s entry — the worked proof that short-expression CAN be High when the token count is tiny; flips to Medium at 2× entry time.
Sample: Expand 3(x + 4) → 3x+12 · Rule: expr-commutative-ws · Params: outer constant ∈ [2, 9]; binomial x ± c with c ∈ [1, 9]; answer alphabet {digits, x, +, −}.
Kernels: [fk.times-tables]
*Canonical-home note:* the registry records **Pre-Algebra** as this entry's canonical home (KA Pre-Algebra units 6/12 exercise it first); the slug is immutable and the record stays here where it was minted — Pre-Algebra carries the cross-reference row.

### alg1.combine-like-terms-multivar — Combine like terms across variables

Rating: Medium · Format: short-expression
Why: Two or three addition facts sorted by variable family and held mentally — 3–6s including a ~6-token entry.
Sample: Simplify 4x + 3y + 2x → 6x+3y · Rule: expr-commutative-ws · Params: 3–4 terms over two variable families (x, y) with coefficients ∈ [1, 9]; at least one family has two terms; result coefficients ≤ 19 and kept positive even in the signed band (one negative coefficient allowed among the inputs); answer alphabet {digits, x, y, +, −}.
Kernels: [prealg.combine-like-terms, fk.addition-facts]

**KA Unit 2 — Solving equations & inequalities.**

**One-step equations** → see prealg.solve-one-step-equation (owned by Pre-Algebra).
**Two-step equations** → see prealg.solve-two-step-equation (owned by Pre-Algebra).
**Multi-step equations (distribute + collect + solve)** → see prealg.solve-multi-step-equation (owned by Pre-Algebra; Low).
**One-step inequalities (boundary + direction)** → see prealg.solve-one-step-inequality (owned by Pre-Algebra).

### alg1.solve-equation-both-sides — Solve ax = bx + c

Rating: Medium · Format: single-number
Why: Two chained inverse moves (collect the x-terms, then one division) held mentally — 3–7s, the same two-move shape as prealg.solve-two-step-equation.
Sample: 7x = 4x + 12. x = ? → 4 · Rule: int-exact · Params: a, b ∈ [2, 12] distinct with a − b ∈ [2, 9]; c = (a − b)·x with integer x ∈ [2, 9]; negative-x band flips c's sign (negative answers carry the touch-minus-key caveat).
Kernels: [prealg.solve-two-step-equation, prealg.combine-like-terms, fk.subtraction-facts]

### alg1.rearrange-formula-one-step — Solve a formula for a variable (one step)

Rating: Medium · Format: short-expression
Why: One inverse-operation read applied to symbols instead of numbers — 3–5s with a ~3-token entry.
Sample: d = rt. Solve for t → d/r · Rule: expr-commutative-ws · Params: formula families with exactly one multiplicative or additive step (d = rt, A = lw, y = x + b, P = a + b + c solved for one addend); answer alphabet is the formula's 2–3 letters plus / − ( ); answers ≤ 5 tokens. Multi-step rearrangements are Low grain and excluded — they are prealg.solve-multi-step-equation in symbol clothing.
Kernels: [prealg.solve-one-step-equation]

**KA Unit 3 — Working with units.**

### alg1.unit-convert-one-step — One-step unit conversion

Rating: Medium · Format: single-number
Why: One conversion-factor recall plus one product or place shift — 3–5s.
Sample: Convert 3 hours to minutes → 180 · Rule: int-exact · Params: single-factor conversions from the time/metric/customary-length families (min↔hr, s↔min, m↔cm, m↔km, in↔ft, ft↔yd); multipliers chosen so answers are positive integers ≤ 10,000; both directions asked, the dividing direction always exact.
Kernels: [fk.unit-conversion-facts, fk.times-tables, fk.powers-of-ten]

**KA Unit 4 — Linear equations & graphs.**

### alg1.slope-two-points — Slope from two points

Rating: Medium · Format: fraction
Why: Two subtraction facts and a reduction held mentally — 4–7s on the assumed fraction pad; the document's canonical rise-over-run drill.
Sample: Slope through (1, 2) and (4, 4) → 2/3 · Rule: frac-lowest-terms · Params: integer coordinates ∈ [−9, 9] with distinct x-values; slopes non-integer in lowest terms with |numerator| ≤ 9 and denominator ≤ 9 (integer-slope cases excluded — a different answer shape that would split the key family); negative slopes included, sign to the numerator per the format spec.
Kernels: [fk.integer-add-sub, prealg.simplify-fraction]

### alg1.intercept-from-equation — Axis intercept from standard form

Rating: Medium · Format: single-number
Why: One zero-substitution and one division — 3–5s.
Sample: x-intercept of 2x + 3y = 12 (x-value only) → 6 · Rule: int-exact · Params: coefficients ∈ [2, 9]; the constant a multiple of the asked coefficient with quotient ∈ [−9, 9] excluding 0; x- and y-intercept prompts balanced; negative answers carry the touch-minus-key caveat.
Kernels: [prealg.solve-one-step-equation, fk.division-facts]

### alg1.graph-line-from-equation — Graph a line from its equation

Rating: Low
Why: Inherently multi-step at any speed — extract slope and intercept, plot, apply rise-over-run, draw — and the answer is a drawn graph, which no input format hosts.
Kernels: [alg1.read-slope-intercept, alg1.intercept-from-equation, alg1.slope-two-points]

**KA Unit 5 — Forms of linear equations.**

### alg1.read-slope-intercept — Read slope and y-intercept from y = mx + b · pinned calibration entry

Rating: High · Format: two-numbers · Surface-sensitive
Why: Pure read-off, no transformation — ~1s think + ~1.25s entry; entry dominates the High budget, hence the marker.
Sample: y = 3x − 2 — slope, then y-intercept → 3, -2 · Rule: pair-ordered · Params: m and b nonzero integers ∈ [−9, 9]; negative answers carry the engine contract's touch-minus-key caveat until the proposed pad exists.
Kernels: No drillable kernel beyond entries already listed

### alg1.read-point-slope — Read the anchor point off point-slope form

Rating: Medium · Format: two-numbers
Why: One memorized sign-flip read applied twice (y − y₁ and x − x₁ both flip) — Medium floor, ~3–4s with the pair entry.
Sample: y − 3 = 2(x − 1) passes through which point? (x, then y) → 1, 3 · Rule: pair-ordered · Params: x₁, y₁ nonzero integers ∈ [−9, 9] shown in both + and − renderings; the slope ∈ [−9, 9] excluding 0 is decorative; negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### alg1.slope-from-standard-form — Slope from standard form

Rating: Medium · Format: fraction
Why: One rule recall (m = −A/B) plus a sign judgment and a possible reduction — 3–6s.
Sample: Slope of 2x + 3y = 6 → -2/3 · Rule: frac-lowest-terms · Params: A, B nonzero integers ∈ [−9, 9]; results kept non-integer, in lowest terms after reduction with |numerator| ≤ 9 and denominator ≤ 9; sign to the numerator; the constant term is decorative.
Kernels: [fk.integer-mul-div, prealg.simplify-fraction]

### alg1.write-line-equation — Write the equation of a line

Rating: Low
Why: Inherently multi-step at any speed — compute the slope, back-solve the intercept, assemble the equation — with intermediate state to hold.
Kernels: [alg1.slope-two-points, alg1.read-slope-intercept, prealg.evaluate-expression]

**KA Unit 6 — Systems of equations.**

**Solving 2×2 linear systems** → see prealg.solve-2x2-system (owned by Pre-Algebra; Low).
**Checking a candidate solution of a system** → see prealg.check-system-solution (owned by Pre-Algebra).

### alg1.system-solution-count — How many solutions does a system have

Rating: Medium · Format: multiple-choice
Why: Two comparisons (same slope? same intercept?) plus a 3-option scan — 4–7s; MC is justified because the answer is a category and no numeric restatement preserves "infinitely many".
Sample: y = 2x + 1 and y = 2x − 4 — how many solutions? → None (options: One · None · Infinitely many) · Rule: mc · Params: both equations in slope-intercept form with m, b integers ∈ [−9, 9]; the three cases balanced; distinct-slope cases keep intercepts distinct too, so slope is the only reliable discriminator.
Kernels: [alg1.read-slope-intercept]

**KA Unit 7 — Inequalities (systems & graphs).**

### alg1.check-inequality-solution — Check a point against a two-variable inequality

Rating: Medium · Format: true-false
Why: One double substitution and a directional compare — 3–6s; genuinely a verification judgment.
Sample: True or false: (1, 4) satisfies y > 2x + 1 → true · Rule: tf · Params: forms y <, >, ≤, ≥ mx + b with m, b ∈ [−5, 5]; points ∈ [−6, 6]; boundary-equality cases included so the strict/inclusive distinction is exercised; families balanced 50/50.
Kernels: [prealg.check-point-solution, fk.integer-mul-div]

**KA Unit 8 — Functions.**

### alg1.evaluate-function — Evaluate f(x) in function notation

Rating: Medium · Format: single-number
Why: The same substitute-and-compute move as prealg.evaluate-expression with the f(x) notation read layered on — 3–6s.
Sample: f(x) = 3x − 2. f(4) = ? → 10 · Rule: int-exact · Params: linear forms ax + b and a − bx with a, b ∈ [1, 9]; inputs ∈ [−9, 9]; negative answers carry the touch-minus-key caveat.
Kernels: [prealg.evaluate-expression]

### alg1.is-function-pairs — Is a set of ordered pairs a function

Rating: Medium · Format: true-false
Why: One scan for a repeated input with different outputs — 3–6s over 3–4 shown pairs; genuinely binary.
Sample: True or false: {(1, 2), (2, 5), (1, 4)} is a function → false · Rule: tf · Params: 3–4 pairs with coordinates ∈ [0, 9]; false cases repeat exactly one x-value with different y-values; true cases may repeat a y-value (the classic distractor); families balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

**KA Unit 9 — Sequences.**

**Next term of an arithmetic pattern** → see prealg.next-term-arithmetic (owned by Pre-Algebra).

### alg1.next-term-geometric — Next term of a geometric sequence

Rating: Medium · Format: single-number
Why: Spot the common ratio, apply one product — 3–5s including the term scan.
Sample: Next term: 2, 6, 18, 54, … → 162 · Rule: int-exact · Params: first term ∈ [1, 5], ratio ∈ {2, 3, 4, 5, 10}, three or four terms shown; answers ≤ 1000.
Kernels: [fk.times-tables, fk.two-digit-times-one-digit]

### alg1.arithmetic-nth-term — nth term of an arithmetic sequence

Rating: Medium · Format: single-number
Why: One formula application (a₁ + (n−1)d) fused into two fact-level moves — 4–7s.
Sample: An arithmetic sequence starts at 3 with common difference 4. What is the 5th term? → 19 · Rule: int-exact · Params: first term ∈ [1, 12], common difference ∈ ±[2, 9], n ∈ [4, 9]; answers ∈ [−60, 99] (negative answers carry the touch-minus-key caveat).
Kernels: [fk.times-tables, fk.addition-facts, prealg.evaluate-expression]

### alg1.geometric-nth-term — nth term of a geometric sequence

Rating: Medium · Format: single-number
Why: One power recall and one product (a₁ · r^(n−1)) — Medium's upper half at the tiny params below.
Sample: A geometric sequence starts at 2 with common ratio 3. What is the 4th term? → 54 · Rule: int-exact · Params: first term ∈ [1, 5], ratio ∈ {2, 3}, n ∈ [3, 5]; answers ≤ 500.
Kernels: [prealg.evaluate-exponent, fk.times-tables]

**KA Unit 10 — Absolute value & piecewise functions.**

**Absolute value of an integer** → see prealg.absolute-value (owned by Pre-Algebra).

### alg1.evaluate-absolute-expression — Evaluate an absolute-value expression

Rating: Medium · Format: single-number
Why: One substitution, one inner computation, one sign strip — 3–6s.
Sample: |2x − 9| when x = 2 → 5 · Rule: int-exact · Params: forms |ax − b| and a|x| + b with a, b ∈ [1, 9]; inputs ∈ [−9, 9]; answers non-negative integers ≤ 99.
Kernels: [prealg.evaluate-expression, prealg.absolute-value]

### alg1.solve-absolute-value-equation — Solve an absolute-value equation

Rating: Medium · Format: two-numbers
Why: One split into two one-step equations (x − a = ±b) solved as fact-level moves — Medium's upper half, ~5–8s with the pair entry.
Sample: |x − 2| = 5 — both solutions → 7, -3 · Rule: pair-unordered · Params: forms |x| = b and |x − a| = b with a ∈ [−9, 9], b ∈ [1, 9]; both solutions ∈ [−18, 18]; negative solutions carry the touch-minus-key caveat.
Kernels: [prealg.solve-one-step-equation, prealg.absolute-value, fk.integer-add-sub]

### alg1.evaluate-piecewise — Evaluate a piecewise function

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One branch-selection judgment plus one substitution — 4–7s; the stacked case notation needs a math renderer.
Sample: f(x) = x + 1 for x < 0; f(x) = 2x for x ≥ 0. f(−3) = ? → -2 · Rule: int-exact · Params: two linear branches with coefficients ∈ [1, 5], split at 0 or ±[1, 5]; inputs ∈ [−9, 9], kept off the boundary in the base band and on it in the stretch band; negative answers carry the touch-minus-key caveat.
Kernels: [alg1.evaluate-function]

**KA Unit 11 — Exponents & radicals.**

**Product rule for exponents** → see prealg.exponent-product-rule (owned by Pre-Algebra).
**Negative exponents** → see prealg.negative-exponent (owned by Pre-Algebra).
**Square roots of perfect squares** → see prealg.square-root (owned by Pre-Algebra).
**Cube roots of perfect cubes** → see prealg.cube-root (owned by Pre-Algebra).
**Bracketing a root between integers** → see prealg.root-between-integers (owned by Pre-Algebra).

### alg1.exponent-power-rule — Power of a power

Rating: High · Format: single-number · Render: unicode-inline
Why: One times-table fact once the multiply-the-exponents rule is automatic — ≤3s; asking for the exponent alone keeps the answer one small integer.
Sample: (x³)⁴ = xⁿ. n = ? → 12 · Rule: int-exact · Params: exponents ∈ [2, 9]; displayed base from {2, 3, 5, 10, x}; answers ≤ 81.
Kernels: [fk.times-tables, prealg.exponent-product-rule]

### alg1.exponent-quotient-rule — Quotient rule for exponents

Rating: High · Format: single-number · Render: unicode-inline
Why: One subtraction fact once the subtract-the-exponents rule is automatic — ≤3s; answer is the exponent alone.
Sample: x⁷ ÷ x³ = xⁿ. n = ? → 4 · Rule: int-exact · Params: exponents ∈ [2, 12] with a positive difference in the base band; the signed band allows negative n (touch-minus-key caveat); displayed base from {2, 3, 5, 10, x}.
Kernels: [fk.subtraction-facts, prealg.exponent-product-rule]

### alg1.simplify-radical — Simplify a square root

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One largest-square-factor extraction (72 = 36 · 2) and a root recall — 4–7s.
Sample: √72 = a√b. a, then b → 6, 2 · Rule: pair-ordered · Params: radicands ∈ [8, 200] with a square factor ≥ 4; b squarefree ∈ {2, 3, 5, 6, 7, 10}; a ∈ [2, 12].
Kernels: [fk.perfect-squares, fk.times-tables, prealg.square-root]

**KA Unit 12 — Exponential growth & decay.**

### alg1.evaluate-exponential — Evaluate an exponential expression

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One power recall chained with one product — 3–6s.
Sample: f(x) = 3 · 2ˣ. f(4) = ? → 48 · Rule: int-exact · Params: coefficient ∈ [1, 9]; base ∈ {2, 3, 5, 10}; exponent ∈ [1, 5] with base^exponent ≤ 243; answers positive integers ≤ 1000.
Kernels: [prealg.evaluate-exponent, fk.times-tables, alg1.evaluate-function]

### alg1.growth-or-decay — Growth or decay from the base

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: One compare-to-1 judgment and a two-option tap — ≤3s.
Sample: y = 200(0.9)ᵗ — growth or decay? → Decay (options: Growth · Decay) · Rule: mc · Params: bases ∈ (0, 2] excluding 1, written with 1–2 decimal places; initial values decorative; families balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

### alg1.growth-factor-to-rate — Percent rate from a growth/decay factor

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One subtraction against 1 and a two-place shift — 3–5s; the answer is the percent number.
Sample: y = 500(1.07)ᵗ — what percent growth rate? (number only) → 7 · Rule: int-exact · Params: factors 1 ± r with r at 1–2 decimal places; integer percent answers ∈ [1, 75]; growth and decay balanced, the unsigned rate asked (direction lives in the prompt).
Kernels: [prealg.decimal-to-percent, fk.subtraction-facts]

**KA Unit 13 — Quadratics: Multiplying & factoring.**

### alg1.factor-pairs-sum-product — Two numbers from their sum and product · pinned calibration entry

Rating: Medium · Format: two-numbers
Why: One mental search through a factor-pair family — the core inner move of factoring — ~3–6s think + ~1.25s entry on the assumed two-number pad.
Sample: Two numbers with sum 7 and product 12 → 3, 4 · Rule: pair-unordered · Params: pinned (all-positive) band: pair members ∈ [2, 12], so sums ≤ 24 and products ≤ 144; signed band (authored this pass, as the pin deferred): pair members ∈ [−12, 12] excluding 0, covering the negative-sum and negative-product families; negative answers carry the touch-minus-key caveat.
Kernels: [fk.times-tables, fk.addition-facts]

### alg1.multiply-binomials — Multiply two binomials

Rating: Medium · Format: short-expression · Surface-sensitive
Why: Four small products with a middle-term merge held mentally, then a ~9-token entry ≈ 2.5s — Medium's upper half; flips to Low at 2× entry time, hence the marker.
Sample: Multiply: (x + 3)(x + 4) → x^2+7x+12 · Rule: expr-commutative-ws · Params: monic binomials with constants ∈ [1, 9] in the base band (middle coefficient ≤ 18, constant ≤ 81); signed band mixes ±; vanishing-middle-term cases belong to the difference-of-squares family and key separately; answer alphabet {digits, x, ^, +, −}.
Kernels: [alg1.distribute-linear, fk.times-tables, fk.addition-facts]

### alg1.factor-simple-quadratic — Factor a monic quadratic · pinned calibration entry

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One transformation (the sum-product search) but a 12-token answer ≈ 3.25s of pure entry — ~5–8s total, at Medium's ceiling; flips to Low at 2× entry time, hence the marker.
Sample: Factor: x² + 7x + 12 → (x+3)(x+4) · Rule: factored-commutative-ws · Params: pinned band: monic x² + bx + c with both roots ∈ [1, 9] (b ≤ 18, c ≤ 81); signed band (authored this pass, as the pin deferred): roots ∈ [−9, 9] excluding 0, giving all four sign patterns of b and c; answer alphabet gains −.
Kernels: [alg1.factor-pairs-sum-product]

### alg1.factor-gcf — Factor out the greatest common factor

Rating: Medium · Format: short-expression
Why: One GCD read plus two divisions, with a ~7-token entry — 3–6s.
Sample: Factor: 6x + 12 → 6(x+2) · Rule: factored-commutative-ws · Params: gcf ∈ [2, 9]; two terms with both coefficients multiples of the gcf and ≤ 72; the variable-gcf band (6x² + 9x → 3x(2x+3)) keys separately; answer alphabet {digits, x, ^, +, −, (, )}.
Kernels: [prealg.gcd-two-numbers, alg1.distribute-linear, fk.division-facts]

### alg1.factor-difference-of-squares — Factor a difference of squares

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One pattern recognition and two square-root recalls, but a ~12-token entry ≈ 3.25s — Medium's ceiling; flips to Low at 2× entry time, hence the marker.
Sample: Factor: x² − 49 → (x+7)(x-7) · Rule: factored-commutative-ws · Params: monic x² − k² with k ∈ [2, 12]; the coefficient band (a²x² − k², a ∈ [2, 5]) keys separately; answer alphabet {digits, x, +, −, (, )}.
Kernels: [fk.perfect-squares, prealg.square-root]

### alg1.factor-perfect-square-trinomial — Recognize a perfect-square trinomial

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One halving and one square-check (is c = (b/2)²?) — 3–5s; asking for a alone keeps the answer one small integer.
Sample: x² + 6x + 9 = (x + a)². a = ? → 3 · Rule: int-exact · Params: a ∈ [1, 12] (middle coefficient 2a ≤ 24, constant a² ≤ 144); the minus variant (x − a)² shows the sign in the prompt and still asks for positive a.
Kernels: [fk.doubling-halving, fk.perfect-squares]

### alg1.factor-nonmonic-quadratic — Factor a non-monic quadratic

Rating: Low
Why: Inherently multi-step at any speed — search ac's factor pairs, split the middle term, factor by grouping — with intermediate state to hold.
Kernels: [alg1.factor-pairs-sum-product, alg1.factor-gcf, alg1.multiply-binomials, fk.times-tables]

**KA Unit 14 — Quadratic functions & equations.**

### alg1.solve-quadratic-by-factoring — Solve x² + bx + c = 0 by factoring · pinned calibration entry

Rating: Low
Why: Inherently multi-step at any speed — factor, apply the zero-product property, read off both roots — the tier definition's Low case even for a fluent student.
Kernels: [alg1.factor-simple-quadratic, alg1.factor-pairs-sum-product, alg1.roots-from-factored-form]

### alg1.roots-from-factored-form — Roots from factored form

Rating: Medium · Format: two-numbers
Why: Two sign-flip reads off the factors (zero-product read-off) — Medium floor, ~3–4s with the pair entry.
Sample: y = (x − 2)(x + 5) — both roots → 2, -5 · Rule: pair-unordered · Params: roots distinct nonzero integers ∈ [−9, 9] in all sign combinations; negative roots carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### alg1.vertex-from-vertex-form — Vertex from vertex form

Rating: High · Format: two-numbers · Render: unicode-inline · Surface-sensitive
Why: A read-off with one memorized sign flip on h — ~1.5s think + ~1.5s entry; entry dominates the High budget, hence the marker.
Sample: y = (x − 3)² + 5 — vertex (h, then k) → 3, 5 · Rule: pair-ordered · Params: h, k nonzero integers ∈ [−9, 9] in both sign renderings; negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### alg1.axis-of-symmetry — Axis of symmetry from standard form

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One rule application (x = −b/2a; the monic band makes it a halving with a sign flip) — 3–5s.
Sample: y = x² − 6x + 1 — axis of symmetry x = ? → 3 · Rule: int-exact · Params: monic base band with even b ∈ [−18, 18] excluding 0; the a ∈ {2, 3} stretch band keeps b/2a an integer; the constant term is decorative; negative answers carry the touch-minus-key caveat.
Kernels: [fk.doubling-halving, fk.integer-mul-div]

### alg1.discriminant-root-count — Count real solutions via the discriminant

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One held computation (b² − 4ac) and a sign read — Medium's upper half, 5–8s at small params.
Sample: How many real solutions: x² + 6x + 9 = 0? → 1 · Rule: int-exact · Params: a ∈ [1, 3], b ∈ [−9, 9], c ∈ [−9, 9] with |b² − 4ac| ≤ 81; answers ∈ {0, 1, 2} balanced.
Kernels: [fk.perfect-squares, fk.times-tables, fk.integer-mul-div]

### alg1.solve-x-squared-equals-k — Solve x² = k

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One root recall plus the ± judgment — Medium floor with the pair entry.
Sample: x² = 49 — both solutions → 7, -7 · Rule: pair-unordered · Params: k a perfect square in {4, …, 225}; the shifted band (x − a)² = k with a ∈ [1, 9] keys separately; negative solutions carry the touch-minus-key caveat.
Kernels: [prealg.square-root, fk.perfect-squares]

### alg1.solve-by-quadratic-formula — Solve via the quadratic formula

Rating: Low
Why: Inherently multi-step at any speed — compute the discriminant, root it, then assemble two quotient values while holding every intermediate.
Kernels: [alg1.discriminant-root-count, prealg.square-root, prealg.simplify-fraction, fk.integer-add-sub]

### alg1.complete-the-square — Complete the square

Rating: Low
Why: Inherently multi-step at any speed — halve b, square it, rebalance the constant, rewrite as a shifted square, then root — a chain of moves with carried state.
Kernels: [fk.doubling-halving, fk.perfect-squares, alg1.factor-perfect-square-trinomial, alg1.solve-x-squared-equals-k]

**KA Unit 15 — Irrational numbers.**

### alg1.classify-rational-irrational — Classify a number as rational or irrational

Rating: High · Format: true-false · Render: unicode-inline
Why: One perfect-square (or form) check and a tap — ≤3s; genuinely a verification judgment.
Sample: True or false: √17 is irrational → true · Rule: tf · Params: candidates: √n for n ∈ [2, 225] with perfect and non-perfect squares balanced, terminating and repeating decimals, fractions, and π-multiples; families balanced 50/50 true/false.
Kernels: [fk.perfect-squares]

### alg1.rational-irrational-operations — Closure judgments for sums and products

Rating: Medium · Format: true-false · Render: unicode-inline
Why: One recalled closure rule (or one counterexample check) — 3–6s; binary by nature.
Sample: True or false: the sum of a rational number and an irrational number is always irrational → true · Rule: tf · Params: claim templates over {sum, product} × {rational/rational, rational/irrational, irrational/irrational} with "always" phrasing; false cases include the irrational/irrational always-claims and the zero-product trap (0 × √2 is rational); families balanced 50/50.
Kernels: [alg1.classify-rational-irrational]

**OpenStax cross-check merges — Elementary Algebra 2e.** The plan's expected KA gap — one-variable statistics/scatterplots (traditional Algebra 1) — was checked against both snapshots and **no snapshot checklist source contains it**: it is absent from the snapshotted KA Algebra 1 units 1–15 and equally absent from the Elementary Algebra 2e TOC (chapters 1–10 contain no statistics chapter). Recorded in the disposition table as out-of-checklist and flagged for a future curriculum pass — no entries were invented for it. The genuine diffs the cross-check did surface are merged below, each with its source note.

### alg1.linear-word-problem — Translate-and-solve linear word problems

Rating: Low
Why: Inherently multi-step at any speed — parse the scenario, define a variable, translate to an equation, then solve; the translation alone exceeds any tier budget. (source: OpenStax Elementary Algebra 2e ch. 3 — KA spreads these across units as applications rather than a checklist unit)
Kernels: [prealg.solve-two-step-equation, prealg.solve-multi-step-equation, prealg.unit-rate, prealg.percent-of-number]

### alg1.polynomial-degree — Degree of a polynomial

Rating: High · Format: single-number · Render: unicode-inline
Why: One largest-exponent read — ≤2s. (source: OpenStax Elementary Algebra 2e ch. 6 — absent from KA sweep)
Sample: Degree of 4x³ + 2x − 7 → 3 · Rule: int-exact · Params: 2–4 terms in one variable, exponents ≤ 9, coefficients ∈ [−9, 9]; terms not always in descending order — the scan is the skill.
Kernels: No drillable kernel beyond entries already listed

### alg1.multiply-monomials — Multiply two monomials

Rating: Medium · Format: short-expression · Render: unicode-inline
Why: Two parallel facts — coefficient product and exponent sum — with a ~5-token entry, 3–5s. (source: OpenStax Elementary Algebra 2e ch. 6 — absent from KA sweep)
Sample: 3x² · 4x³ → 12x^5 · Rule: expr-commutative-ws · Params: coefficients ∈ [2, 9] with product ≤ 81; exponents ∈ [1, 6] with sum ≤ 9; single variable; answer alphabet {digits, x, ^}.
Kernels: [fk.times-tables, prealg.exponent-product-rule]

### alg1.simplify-monomial-quotient — Divide two monomials

Rating: Medium · Format: short-expression · Render: unicode-inline
Why: One coefficient division and one exponent subtraction — 3–5s. (source: OpenStax Elementary Algebra 2e ch. 8 — absent from KA sweep)
Sample: 6x⁵ ÷ 2x² → 3x^3 · Rule: expr-commutative-ws · Params: coefficient quotient an integer ∈ [2, 9]; exponent difference ∈ [1, 6]; single variable; answer alphabet {digits, x, ^}.
Kernels: [fk.division-facts, alg1.exponent-quotient-rule]

### alg1.simplify-rational-expression — Simplify a rational expression

Rating: Low
Why: Inherently multi-step at any speed — factor numerator and denominator, then cancel common factors while holding both factorizations. (source: OpenStax Elementary Algebra 2e ch. 8 — absent from KA Algebra 1; KA hosts rational expressions in Algebra 2, but first-course-owns puts the canonical Low record here where the cross-check surfaced it)
Kernels: [alg1.factor-simple-quadratic, alg1.factor-gcf, alg1.simplify-monomial-quotient]

### alg1.multiply-square-roots — Multiply square roots

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One product under the radical and one root recall — 3–5s at integer-answer params. (source: OpenStax Elementary Algebra 2e ch. 9 — absent from KA sweep)
Sample: √2 × √8 → 4 · Rule: int-exact · Params: radicand pairs with a perfect-square product in {4, …, 144}; radicands ∈ [2, 50]; answers ∈ [2, 12].
Kernels: [fk.times-tables, prealg.square-root, fk.perfect-squares]

### Algebra 1 checklist disposition table

Every KA Algebra 1 unit (1–15, plus the non-content 16–17 row), the recorded statistics gap check, and every Elementary Algebra 2e chapter (10) maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| KA 1 Algebra foundations | alg1.distribute-linear (pin; canonical home Pre-Algebra per registry), alg1.combine-like-terms-multivar; substitution/evaluation → prealg.evaluate-expression; one-variable like terms → prealg.combine-like-terms; division-by-zero convention out-of-grain: concept vocabulary — no drillable content beyond kernels prealg.evaluate-expression |
| KA 2 Solving equations & inequalities | alg1.solve-equation-both-sides, alg1.rearrange-formula-one-step; one/two-step equations → prealg.solve-one-step-equation, prealg.solve-two-step-equation; multi-step equations → prealg.solve-multi-step-equation (Low, owned by Pre-Algebra); one-step inequalities → prealg.solve-one-step-inequality; multi-step inequalities: recorded judgment — no new entry; same moves as prealg.solve-multi-step-equation plus the flip judgment of prealg.solve-one-step-inequality |
| KA 3 Working with units | alg1.unit-convert-one-step; rate-conversion and dimensional-analysis word problems out-of-grain: modeling — no drillable content beyond kernels alg1.unit-convert-one-step, prealg.unit-rate |
| KA 4 Linear equations & graphs | alg1.slope-two-points, alg1.intercept-from-equation, alg1.graph-line-from-equation (Low); slope/intercepts read from a drawn graph out-of-grain: needs graph-figure input the format set does not define; horizontal/vertical lines: recorded judgment — zero slope is excluded from alg1.slope-two-points params (answer-shape split) and undefined slope has no numeric answer shape |
| KA 5 Forms of linear equations | alg1.read-slope-intercept (pin), alg1.read-point-slope, alg1.slope-from-standard-form, alg1.write-line-equation (Low) |
| KA 6 Systems of equations | alg1.system-solution-count; solving 2×2 systems → prealg.solve-2x2-system (Low, owned by Pre-Algebra); checking candidates → prealg.check-system-solution; systems word problems out-of-grain: modeling — no drillable content beyond kernels prealg.solve-2x2-system |
| KA 7 Inequalities (systems & graphs) | alg1.check-inequality-solution; graphing one- and two-variable inequalities and systems out-of-grain: graph output — no drillable content beyond kernels alg1.check-inequality-solution, prealg.solve-one-step-inequality |
| KA 8 Functions | alg1.evaluate-function, alg1.is-function-pairs; domain/range out-of-grain: interval answers not in the format legend; average rate of change: recorded judgment — a multi-step composite of alg1.evaluate-function and alg1.slope-two-points, no separate entry; graph interpretation out-of-grain |
| KA 9 Sequences | alg1.next-term-geometric, alg1.arithmetic-nth-term, alg1.geometric-nth-term; arithmetic next-term → prealg.next-term-arithmetic (owned by Pre-Algebra); recursive↔explicit formula conversion out-of-grain: formula writing — no drillable content beyond kernels alg1.arithmetic-nth-term, alg1.geometric-nth-term |
| KA 10 Absolute value & piecewise functions | alg1.evaluate-absolute-expression, alg1.solve-absolute-value-equation, alg1.evaluate-piecewise; absolute value of an integer → prealg.absolute-value; graphing absolute-value/piecewise functions out-of-grain: graph output |
| KA 11 Exponents & radicals | alg1.exponent-power-rule, alg1.exponent-quotient-rule, alg1.simplify-radical; product rule → prealg.exponent-product-rule; negative exponents → prealg.negative-exponent; square roots → prealg.square-root; cube roots → prealg.cube-root; root bracketing → prealg.root-between-integers |
| KA 12 Exponential growth & decay | alg1.evaluate-exponential, alg1.growth-or-decay, alg1.growth-factor-to-rate; exponential-vs-linear model selection and growth/decay word problems out-of-grain: modeling — no drillable content beyond kernels alg1.growth-or-decay, alg1.evaluate-exponential, alg1.growth-factor-to-rate |
| KA 13 Quadratics: Multiplying & factoring | alg1.factor-pairs-sum-product (pin), alg1.factor-simple-quadratic (pin), alg1.multiply-binomials, alg1.factor-gcf, alg1.factor-difference-of-squares, alg1.factor-perfect-square-trinomial, alg1.factor-nonmonic-quadratic (Low) |
| KA 14 Quadratic functions & equations | alg1.solve-quadratic-by-factoring (pin, Low), alg1.roots-from-factored-form, alg1.vertex-from-vertex-form, alg1.axis-of-symmetry, alg1.discriminant-root-count, alg1.solve-x-squared-equals-k, alg1.solve-by-quadratic-formula (Low), alg1.complete-the-square (Low); graphing parabolas and feature-reading from drawn graphs out-of-grain: graph input/output |
| KA 15 Irrational numbers | alg1.classify-rational-irrational, alg1.rational-irrational-operations |
| KA 16–17 | non-content units (course challenge/review) — no sweep required, recorded per plan |
| KA gap check — one-variable statistics & scatterplots (traditional Algebra 1) | no snapshot checklist source contains it: absent from KA Algebra 1 units 1–15 and from Elementary Algebra 2e chs. 1–10 — recorded as out-of-checklist, flagged for a future curriculum pass; no entries invented |
| OS 1 Foundations | covered: fk/prealg arithmetic and expression sets (see the Pre-Algebra section) — prealg.evaluate-expression, prealg.combine-like-terms, prealg.order-of-operations, fk.integer-add-sub, fk.integer-mul-div |
| OS 2 Solving Linear Equations and Inequalities | covered by the KA 2 entry set |
| OS 3 Math Models | merged: alg1.linear-word-problem (Low); remainder out-of-grain: applied modeling — no drillable content beyond the kernels named on that entry |
| OS 4 Graphs | covered by the KA 4 / KA 5 entry sets |
| OS 5 Systems of Linear Equations | covered by the KA 6 row (cross-references to the Pre-Algebra owners) |
| OS 6 Polynomials | merged: alg1.polynomial-degree, alg1.multiply-monomials; polynomial add/subtract: recorded judgment — the same move as prealg.combine-like-terms / alg1.combine-like-terms-multivar at more terms; full multi-term polynomial arithmetic is Algebra 2 unit 1 grain (deferred to that sweep, consistent with the Pre-Algebra OS 10 disposition) |
| OS 7 Factoring | covered by the KA 13 entry set |
| OS 8 Rational Expressions and Equations | merged: alg1.simplify-monomial-quotient, alg1.simplify-rational-expression (Low); rational-equation solving: recorded judgment — Low grain owned by KA Algebra 2 unit 10 (Equations), deferred to that sweep |
| OS 9 Roots and Radicals | merged: alg1.multiply-square-roots; covered: prealg.square-root, prealg.root-between-integers, alg1.simplify-radical; radical-equation solving: recorded judgment — owned by KA Algebra 2 unit 10, deferred to that sweep |
| OS 10 Quadratic Equations | covered by the KA 14 entry set |

---

## Geometry

Swept against the KA Geometry checklist (9 units). **There is no OpenStax Geometry book**, so this section's cross-check cannot be a TOC diff: per the plan, the check instead runs the named traditional-Geometry gap list — constructions and logic/proof-writing — against the sweep, with both outcomes recorded in the gap-merge block and the disposition table. Entries are grouped by the KA unit that surfaced them. As expected of Geometry, the Low share is the document's highest so far (10 of 46 records) — proof, construction, and solve-the-figure topics are mined for kernels, not hosted. No pinned reference entries live here; one calibration **anchor** does — geo.triangle-congruence-criteria, whose canonical record stays in the calibration section and is absorbed by reference under KA unit 3. Cross-reference traffic runs back to Pre-Algebra and Algebra 1 owners (Pythagorean triples, circle area, proportions, slope — first-course-owns), and two entries minted here (geo.trig-ratio-definition, geo.exact-trig-values) are flagged in the registry as the canonical targets of the Trig/Precalc sweep's cross-references — flags since satisfied in that pass.

**KA Unit 1 — Performing transformations.**

### geo.translate-point — Translate a point

Rating: Medium · Format: two-numbers
Why: Two parallel signed additions plus the pair entry — Medium's floor, ~3–4s; one addition alone would be High, the doubled move is what lifts it.
Sample: Translate (3, −2) by 4 right and 5 up → 7, 3 · Rule: pair-ordered · Params: points and shifts integers ∈ [−9, 9]; shifts phrased both as words (right/left/up/down) and as ⟨a, b⟩ vectors; image coordinates ∈ [−18, 18]; negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### geo.reflect-point — Reflect a point across an axis

Rating: High · Format: two-numbers · Surface-sensitive
Why: One memorized sign-flip rule and a copy-down — ~1s think + ~1.5s pair entry; entry dominates the High budget, hence the marker.
Sample: Reflect (3, −2) across the x-axis → 3, 2 · Rule: pair-ordered · Params: base band mirrors the x-axis and y-axis (pure sign flips); the y = x / y = −x band (coordinate swap plus flips) keys separately; coordinates nonzero integers ∈ [−9, 9]; negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-mul-div]

### geo.rotate-point — Rotate a point about the origin

Rating: Medium · Format: two-numbers
Why: One coordinate-rule selection (which of the 90°/180°/270° maps applies) plus a swap-and-flip — 3–6s with the pair entry.
Sample: Rotate (3, 4) 90° counterclockwise about the origin → -4, 3 · Rule: pair-ordered · Params: coordinates nonzero integers ∈ [−9, 9]; angles ∈ {90, 180, 270} in both directions (equivalent phrasings like 90° CW = 270° CCW deliberately included); negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-mul-div]

### geo.dilate-point — Dilate a point from the origin

Rating: Medium · Format: two-numbers
Why: Two parallel table facts (scale each coordinate) plus the pair entry — Medium's floor, ~3–4s.
Sample: Dilate (3, −2) from the origin by factor 4 → 12, -8 · Rule: pair-ordered · Params: coordinates nonzero integers ∈ [−9, 9]; integer factors ∈ [2, 5], plus a halving band (factor 1/2 on even coordinates); image coordinates ∈ [−45, 45]; negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.times-tables, fk.integer-mul-div, fk.doubling-halving]

**KA Unit 2 — Transformation properties and proofs.**

### geo.is-rigid-motion — Is the transformation a rigid motion

Rating: High · Format: true-false
Why: One recalled classification (translations/rotations/reflections preserve distance, dilations do not) and a tap — ≤2s; genuinely a verification judgment.
Sample: True or false: a dilation with scale factor 2 is a rigid motion → false · Rule: tf · Params: claim templates over the four transformation types × {is a rigid motion, preserves distance, preserves angle measure}; dilation angle-preservation included as the true-but-tricky case; families balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

### geo.compose-transformations — Compose two or more transformations

Rating: Low
Why: Inherently multi-step at any speed — apply each transformation in sequence while holding the intermediate image.
Kernels: [geo.translate-point, geo.reflect-point, geo.rotate-point, geo.dilate-point]

**KA Unit 3 — Congruence.**

**geo.triangle-congruence-criteria — Which congruence criterion applies** → canonical record authored as a calibration anchor · pinned calibration entry; absorbed here by reference — the section's canonical congruence-criterion entry.

### geo.vertical-angle-read — Vertical angles are equal

Rating: High · Format: single-number
Why: Pure rule recall (vertical angles are congruent) and a copy-down — ≤2s.
Sample: Two lines intersect. One angle measures 74°. What is the angle vertically opposite it? → 74 · Rule: int-exact · Params: angles ∈ [10, 170] excluding 90; the adjacent-angle variant (asking the linear-pair partner) belongs to geo.supplement-complement, not this key family.
Kernels: No drillable kernel beyond entries already listed

### geo.supplement-complement — Supplement or complement of an angle

Rating: Medium · Format: single-number
Why: One rule selection (to 90° or to 180°?) plus one 2–3 digit subtraction — Medium's floor, ~3–4s.
Sample: What is the supplement of 68°? → 112 · Rule: int-exact · Params: complements of angles ∈ [5, 85], supplements of angles ∈ [5, 175]; multiples of 5 in the base band, arbitrary integers in the stretch band; answers positive integers.
Kernels: [fk.subtraction-facts]

### geo.transversal-angle — Angle from parallel lines and a transversal

Rating: Medium · Format: single-number
Why: One relationship classification (equal or supplementary?) chained with at most one subtraction — 3–6s.
Sample: Parallel lines are cut by a transversal. One angle measures 65°. What is the measure of its co-interior (same-side interior) angle? → 115 · Rule: int-exact · Params: given angles ∈ [15, 165]; asked relationships rotate through {corresponding, alternate interior, alternate exterior (equal), co-interior (supplementary)}; the relationship is named in the prompt (no figure needed).
Kernels: [geo.supplement-complement, geo.vertical-angle-read]

### geo.triangle-angle-sum — Third angle of a triangle

Rating: Medium · Format: single-number
Why: One addition and one subtraction from 180 held in sequence — 3–5s.
Sample: A triangle has angles 65° and 48°. What is the third angle? → 67 · Rule: int-exact · Params: two given angles ∈ [15, 130] with sum ∈ [50, 165]; multiples of 5 in the base band; a right-triangle sub-band (one angle 90°) reduces to a single subtraction from 90.
Kernels: [fk.addition-facts, fk.subtraction-facts]

### geo.exterior-angle — Exterior angle of a triangle

Rating: Medium · Format: single-number
Why: One rule recall (exterior angle = sum of the two remote interiors) plus one addition — 3–5s.
Sample: A triangle has interior angles 40° and 60° at A and B. What is the exterior angle at C? → 100 · Rule: int-exact · Params: remote interiors ∈ [20, 80] in multiples of 5; the inverse variant (exterior and one remote interior given, find the other) is one subtraction and shares the key family.
Kernels: [geo.triangle-angle-sum, fk.addition-facts]

### geo.polygon-angle-sum — Interior angle sum of a polygon

Rating: Medium · Format: single-number
Why: One rule application ((n − 2) · 180) — a single held multiplication, 3–6s with the 3–4 digit entry.
Sample: What is the interior angle sum of a hexagon? → 720 · Rule: int-exact · Params: n ∈ [3, 12], named polygons through decagon plus "an n-sided polygon" phrasing; answers ≤ 1800; the regular-polygon single-angle variant (divide the sum by n) keys separately as a stretch band.
Kernels: [fk.two-digit-times-one-digit, fk.times-tables]

### geo.isosceles-base-angles — Isosceles triangle angles

Rating: Medium · Format: single-number
Why: One rule (base angles are equal) chained with a subtraction and a halving — Medium's upper half, 4–7s.
Sample: An isosceles triangle has vertex angle 40°. What is each base angle? → 70 · Rule: int-exact · Params: vertex angles even ∈ [20, 140] so base-angle answers are integers; the inverse variant (base angle given, find the vertex angle) is a doubling and a subtraction, same key family.
Kernels: [geo.triangle-angle-sum, fk.doubling-halving, fk.subtraction-facts]

### geo.corresponding-parts — Corresponding parts of congruent triangles

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: One positional letter-map read (A↔D, B↔E, C↔F) and a tap — ≤3s with a 3-option scan.
Sample: △ABC ≅ △DEF. Which side corresponds to AB? → DE (options: DE · EF · DF) · Rule: mc · Params: vertex orders scrambled (△BCA ≅ △EFD and the like) so the map must be read, not assumed; sides and angles both asked; 3 options drawn from the target triangle's parts.
Kernels: No drillable kernel beyond entries already listed

### geo.congruence-proof — Prove two triangles congruent

Rating: Low
Why: Inherently multi-step at any speed — gather the given marks, justify each correspondence, select a criterion, and chain the statements into a proof.
Kernels: [geo.triangle-congruence-criteria, geo.corresponding-parts, geo.vertical-angle-read, geo.isosceles-base-angles]

**KA Unit 4 — Similarity.**

**Missing side in similar figures (set up and solve the proportion)** → see prealg.solve-proportion (owned by Pre-Algebra) — the proportion solve is the drill; the figure only supplies the pair.

### geo.similarity-criteria — Which similarity criterion applies

Rating: Medium · Format: multiple-choice · Render: needs-figure
Why: One marked-figure read matched to a memorized criterion plus a 4-option scan — mid-Medium; the congruence anchor's move with a shorter option list.
Sample: [marked triangle pair] Which criterion proves these triangles similar? → AA (options: AA · SAS similarity · SSS similarity · Not enough info) · Rule: mc · Params: fixed 4-option set; mark styles rotate (two angle pairs; two proportional side pairs with included angle; three proportional side pairs; insufficient marks); side-length labels kept to small integers with ratios ∈ {1:2, 2:3, 3:4}.
Kernels: [geo.triangle-congruence-criteria, prealg.solve-proportion]

### geo.scale-factor — Scale factor between similar figures

Rating: Medium · Format: fraction
Why: One ratio reduction from a corresponding side pair — 3–5s on the assumed fraction pad.
Sample: Two similar triangles have corresponding sides 12 and 18. What is the scale factor (small to large)? → 3/2 · Rule: frac-lowest-terms · Params: side pairs built as (a·g, b·g) with a, b ∈ [1, 9] coprime, g ∈ [2, 8]; sides ≤ 72; direction (small→large or large→small) stated in the prompt; integer-factor cases excluded (different answer shape — they key with the dilation family).
Kernels: [prealg.simplify-ratio, prealg.simplify-fraction]

### geo.area-scale-factor — Area ratio from a length scale factor

Rating: High · Format: single-number
Why: One rule recall (area scales by k²) and one square fact — ≤3s.
Sample: A figure is scaled by factor 3. Its area is multiplied by what? → 9 · Rule: int-exact · Params: integer factors ∈ [2, 12]; answers perfect squares ≤ 144; the volume analog (k³) keys separately as geo.volume-scale-factor under Solid geometry.
Kernels: [fk.perfect-squares]

### geo.similarity-proof — Prove two triangles similar

Rating: Low
Why: Inherently multi-step at any speed — establish the angle pairs or side ratios, justify each, then conclude via a criterion.
Kernels: [geo.similarity-criteria, prealg.solve-proportion, geo.transversal-angle]

**KA Unit 5 — Right triangles & trigonometry.**

**Pythagorean triples (hypotenuse or leg recall)** → see prealg.pythagorean-hypotenuse (owned by Pre-Algebra via its OpenStax merge; the registry note recorded this cross-reference in advance).

### geo.pythagorean-verify — Is it a right triangle

Rating: Medium · Format: true-false
Why: Two square recalls, an addition, and a compare against the third square — Medium's upper half, 4–7s; genuinely a verification judgment.
Sample: True or false: a triangle with sides 6, 8, 10 is a right triangle → true · Rule: tf · Params: true cases are scaled Pythagorean triples with sides ≤ 30; false cases perturb one side by 1–2; the largest side is always listed last so the hypotenuse candidate is unambiguous; families balanced 50/50.
Kernels: [fk.perfect-squares, prealg.pythagorean-hypotenuse, fk.addition-facts]

### geo.special-right-triangle — Special right triangle side ratios

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One ratio-slot recall (1 : 1 : √2 or 1 : √3 : 2) and one scaling — 4–7s with the a, b pair entry.
Sample: A 45-45-90 triangle has legs of length 5. The hypotenuse is a√b — a, then b → 5, 2 · Rule: pair-ordered · Params: 45-45-90 leg→hypotenuse (a√2) and 30-60-90 short-leg→long-leg (a√3) slots, a ∈ [2, 12]; the rational 30-60-90 slot (hypotenuse = 2 · short leg) is excluded — a bare doubling already covered by fk.doubling-halving, and a different answer shape.
Kernels: [fk.times-tables, alg1.simplify-radical]

### geo.trig-ratio-definition — Read a trig ratio off a right triangle

Rating: Medium · Format: fraction · Render: needs-figure
Why: One SOH-CAH-TOA slot recall and a side pick, then the fraction entry — 3–6s.
Sample: [right triangle with legs 3 and 4, hypotenuse 5; θ marked where the side of length 4 meets the hypotenuse] sin θ = ? → 3/5 · Rule: frac-lowest-terms · Params: sides are primitive Pythagorean triples (3-4-5, 5-12-13, 8-15-17, 7-24-25) in the base band so the read-off is already in lowest terms; the scaled-triple band (6-8-10 → sin θ = 3/5) adds the reduction step and sits at Medium's ceiling; sin, cos, and tan rotate.
Kernels: [prealg.pythagorean-hypotenuse, prealg.simplify-fraction]

### geo.exact-trig-values — Exact trig values of special angles

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: Pure table recall (the 0°/30°/45°/60°/90° grid) plus a short-symbol option scan — ≤3s; the scan stays light because options are 3–4 characters.
Sample: sin 60° = ? → √3/2 (options: 1/2 · √2/2 · √3/2 · 1) · Rule: mc · Params: sin and cos over {0°, 30°, 45°, 60°, 90°} and tan over {0°, 30°, 45°, 60°}; fixed option pools per function ({0, 1/2, √2/2, √3/2, 1} for sin/cos; {0, √3/3, 1, √3} for tan); 4 options shown per prompt, always including the answer; radian band (authored during the Trig/Precalc pass, as promised here): the same angles posed as {0, π/6, π/4, π/3, π/2} — same table, same option pools, same keys. Canonical entry by first-course-owns — the Trig/Precalc sweep cross-references here.
Kernels: [geo.special-right-triangle, geo.trig-ratio-definition]

### geo.trig-cofunction — Cofunction complement read

Rating: High · Format: single-number
Why: One rule recall (sin θ = cos(90° − θ)) plus one subtraction fact — ≤3s.
Sample: sin 40° = cos ?° → 50 · Rule: int-exact · Params: angles ∈ [5, 85] in multiples of 5; both directions (sin→cos, cos→sin); answers positive integers.
Kernels: [geo.supplement-complement, fk.subtraction-facts]

### geo.solve-right-triangle — Solve a right triangle with trigonometry

Rating: Low
Why: Inherently multi-step at any speed — choose the ratio, set up the equation, solve, and evaluate (usually with a calculator) while holding the setup.
Kernels: [geo.trig-ratio-definition, prealg.solve-proportion, prealg.pythagorean-hypotenuse, geo.exact-trig-values]

**KA Unit 6 — Analytic geometry.**

**Slope from two points** → see alg1.slope-two-points (owned by Algebra 1).
**Equation of a parallel or perpendicular line through a point** → see alg1.write-line-equation (owned by Algebra 1; Low) — the added slope flip is geo.perpendicular-slope below.

### geo.distance-formula — Distance between two points

Rating: Medium · Format: single-number
Why: Two coordinate differences, a triple recognition, and a root — Medium's ceiling, 5–8s even with triple-friendly params.
Sample: What is the distance from (1, 2) to (4, 6)? → 5 · Rule: int-exact · Params: point pairs constructed so (|Δx|, |Δy|, d) is a Pythagorean triple with d ≤ 26; coordinates ∈ [−12, 12]; axis-aligned pairs (one coordinate shared) form the easy sub-band.
Kernels: [prealg.pythagorean-hypotenuse, fk.integer-add-sub, fk.perfect-squares]

### geo.midpoint-formula — Midpoint of a segment

Rating: Medium · Format: two-numbers
Why: Two coordinate averages (add, then halve) held in parallel plus the pair entry — 3–6s.
Sample: What is the midpoint of (2, −3) and (8, 5)? → 5, 1 · Rule: pair-ordered · Params: integer endpoints ∈ [−9, 9] with both coordinate sums even (integer midpoints only); negative coordinates carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub, fk.doubling-halving]

### geo.perpendicular-slope — Slope of a perpendicular line

Rating: High · Format: fraction · Surface-sensitive
Why: One negative-reciprocal flip — ~1s think + ~1.5s fraction entry; entry is most of the High budget, hence the marker.
Sample: A line has slope 2/3. What is the slope of a perpendicular line? → -3/2 · Rule: frac-lowest-terms · Params: given slopes ±a/b in lowest terms with a, b ∈ [1, 9]; integer given slopes (flip to unit fractions) included; sign to the numerator per the format spec; the parallel-slope variant is a copy-down and is excluded as its own trivial family.
Kernels: [alg1.slope-two-points]

### geo.coordinate-geometry-proof — Verify a figure's properties on coordinates

Rating: Low
Why: Inherently multi-step at any speed — compute several distances, slopes, or midpoints and combine them into a classification or proof.
Kernels: [geo.distance-formula, geo.midpoint-formula, alg1.slope-two-points, geo.perpendicular-slope]

**KA Unit 7 — Conic sections.**

### geo.circle-equation-read — Center from a circle's standard form

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: Two memorized sign-flip reads (the vertex-form move, applied twice) — Medium's floor, ~3–4s with the pair entry.
Sample: (x − 3)² + (y + 2)² = 25. Center (h, then k)? → 3, -2 · Rule: pair-ordered · Params: h, k nonzero integers ∈ [−9, 9] shown in both + and − renderings; the radius term is decorative here; negative coordinates carry the touch-minus-key caveat.
Kernels: [alg1.vertex-from-vertex-form, fk.integer-add-sub]

### geo.circle-radius-read — Radius from a circle's standard form

Rating: High · Format: single-number · Render: unicode-inline
Why: One square-root recall off the right-hand side — ≤3s.
Sample: (x − 3)² + (y + 2)² = 49. Radius? → 7 · Rule: int-exact · Params: right-hand sides perfect squares ∈ {4, …, 225}; the center is decorative; the non-square band (r² = 20 → r = 2√5) is excluded — different answer shape, alg1.simplify-radical territory.
Kernels: [prealg.square-root, fk.perfect-squares]

### geo.circle-general-to-standard — Circle center and radius from general form

Rating: Low
Why: Inherently multi-step at any speed — complete the square in x and in y and rebalance the constant before anything can be read off.
Kernels: [alg1.complete-the-square, geo.circle-equation-read, geo.circle-radius-read]

### geo.parabola-focus-directrix — Focus and directrix of a parabola

Rating: Low
Why: Inherently multi-step at any speed — extract the vertex, compute p from the leading coefficient, then place the focus and directrix relative to the vertex.
Kernels: [alg1.vertex-from-vertex-form, prealg.simplify-fraction, fk.integer-add-sub]

**KA Unit 8 — Circles.**

**Circle area (coefficient of π)** → see prealg.circle-area-pi (owned by Pre-Algebra via its OpenStax merge; the circumference analog is that entry's flagged separate key family).

### geo.central-inscribed-angle — Central and inscribed angles

Rating: Medium · Format: single-number
Why: One rule selection (inscribed = half the arc; central = the arc) plus at most one halving or doubling — 3–5s.
Sample: An inscribed angle intercepts an arc of 80°. What is the angle's measure? → 40 · Rule: int-exact · Params: arcs even ∈ [20, 170] so inscribed answers are integers; prompts rotate through {arc→inscribed, arc→central, inscribed→arc, central→arc}; the semicircle case (inscribed angle 90°) included; all values stated in text (no figure needed).
Kernels: [fk.doubling-halving]

### geo.arc-length-fraction — Arc length as a coefficient of π

Rating: Medium · Format: single-number
Why: Two chained fraction moves (angle/360 of 2r) with divisibility-friendly params — Medium's upper half, 4–7s.
Sample: A circle has radius 6. The length of a 90° arc is kπ. k = ? → 3 · Rule: int-exact · Params: central angles ∈ {30, 45, 60, 90, 120, 180, 270}; radii ∈ [2, 12] chosen so k = 2r · (angle/360) is a positive integer ≤ 18.
Kernels: [fk.fraction-of-number, fk.doubling-halving, prealg.simplify-fraction]

### geo.sector-area-fraction — Sector area as a coefficient of π

Rating: Medium · Format: single-number
Why: A square recall chained with a fraction-of move (angle/360 of r²) — Medium's upper half, 4–7s.
Sample: A circle has radius 6. The area of a 90° sector is kπ. k = ? → 9 · Rule: int-exact · Params: central angles ∈ {30, 45, 60, 90, 120, 180, 270}; radii ∈ [2, 12] chosen so k = r² · (angle/360) is a positive integer ≤ 108.
Kernels: [fk.perfect-squares, fk.fraction-of-number, prealg.circle-area-pi]

### geo.tangent-radius-problem — Tangent-segment problems

Rating: Low
Why: Inherently multi-step at any speed — invoke the tangent-perpendicular-to-radius fact, build the right triangle, then run the Pythagorean computation.
Kernels: [prealg.pythagorean-hypotenuse, geo.pythagorean-verify]

**KA Unit 9 — Solid geometry.**

### geo.volume-box — Volume of a rectangular box

Rating: Medium · Format: single-number
Why: Two chained multiplications held mentally — 3–6s at small dimensions.
Sample: What is the volume of a 3 × 4 × 5 box? → 60 · Rule: int-exact · Params: dimensions ∈ [2, 9] with at most one ≥ 7; volumes ≤ 336; the triangular-prism band (½ · base · height · length, divisibility-friendly) keys separately and is where the prealg.area-triangle kernel bites.
Kernels: [fk.times-tables, fk.two-digit-times-one-digit, prealg.area-triangle]

### geo.volume-cylinder-pi — Cylinder volume as a coefficient of π

Rating: Medium · Format: single-number
Why: One square recall and one product (r²h) — 3–6s.
Sample: A cylinder has radius 3 and height 5. Its volume is kπ. k = ? → 45 · Rule: int-exact · Params: r ∈ [2, 9], h ∈ [2, 12]; k = r²h ≤ 400.
Kernels: [fk.perfect-squares, fk.two-digit-times-one-digit, prealg.circle-area-pi]

### geo.volume-cone-pi — Cone volume as a coefficient of π

Rating: Medium · Format: single-number
Why: The cylinder move with a one-third factor chained on — Medium's upper half, 4–7s at divisibility-friendly params.
Sample: A cone has radius 3 and height 4. Its volume is kπ. k = ? → 12 · Rule: int-exact · Params: r ∈ [2, 9], h chosen so r²h is divisible by 3; k ≤ 150; the pyramid analog (⅓ · base area · height, no π) keys separately.
Kernels: [geo.volume-cylinder-pi, fk.fraction-of-number]

### geo.volume-sphere-pi — Sphere volume as a coefficient of π

Rating: Medium · Format: single-number
Why: One cube recall and a 4/3 factor with divisibility-friendly radii — Medium's upper half, 4–7s.
Sample: A sphere has radius 3. Its volume is kπ. k = ? → 36 · Rule: int-exact · Params: r ∈ {3, 6, 9} so k = 4r³/3 is a positive integer ≤ 972; the fraction-answer band (r = 2 → k = 32/3) is excluded — answer-shape split.
Kernels: [fk.perfect-cubes, fk.fraction-of-number]

### geo.volume-scale-factor — Volume ratio from a length scale factor

Rating: High · Format: single-number
Why: One rule recall (volume scales by k³) and one cube fact — ≤3s.
Sample: A solid is scaled by factor 3. Its volume is multiplied by what? → 27 · Rule: int-exact · Params: integer factors ∈ [2, 6]; answers perfect cubes ≤ 216.
Kernels: [fk.perfect-cubes, geo.area-scale-factor]

### geo.cross-section-id — Identify a cross-section

Rating: High · Format: multiple-choice
Why: One spatial recall (which plane cut gives which shape) and a tap — ≤3s with a 4-option scan.
Sample: A plane cuts a cylinder parallel to its base. The cross-section is a…? → Circle (options: Circle · Rectangle · Ellipse · Triangle) · Rule: mc · Params: solids ∈ {cylinder, cone, sphere, cube, rectangular prism, square pyramid} × cut orientations {parallel to base, perpendicular to base, through the apex}; 4 options per prompt drawn from a fixed shape pool.
Kernels: No drillable kernel beyond entries already listed

### geo.surface-area — Surface area of a solid

Rating: Low
Why: Inherently multi-step at any speed — enumerate the faces, compute each area, and sum while tracking which faces repeat.
Kernels: [prealg.area-triangle, prealg.perimeter-rectangle, prealg.circle-area-pi, fk.times-tables]

**Cross-check — no OpenStax Geometry book (named-gap merges).** OpenStax publishes no Geometry title, so there is no TOC to diff. Per the plan, the cross-check instead runs the named traditional-Geometry gap list — **constructions** and **logic/proof-writing** — against the KA sweep above. Outcomes: (1) **Constructions** — absent from the KA snapshot and confirmed absent from the sweep; recorded as a judgment, not merged: compass-and-straightedge work is tool manipulation with a drawn result, which no input format hosts, and its residual recall component ("which construction produces which object") is too thin to stand as a fact family. Recorded in the disposition table. (2) **Logic/proof-writing** — absent from the KA snapshot as a named unit (KA folds proofs into units 2–4); its two drillable skills are merged below with gap-list source notes.

### geo.conditional-forms — Converse, inverse, contrapositive

Rating: Medium · Format: multiple-choice
Why: One recalled statement-mapping applied to short p/q clauses plus a wordy 3-option scan — mid-Medium, 4–7s. (source: no-OpenStax-book gap check — logic/proof-writing, absent from the KA snapshot)
Sample: "If a shape is a square, then it has four sides." Which is the contrapositive? → If a shape does not have four sides, then it is not a square. (options: the converse, inverse, and contrapositive, each written out) · Rule: mc · Params: asked form uniform over {converse, inverse, contrapositive}; statement templates use one-clause p and q so options stay short; the 3 options are always the three transformed forms of the given statement.
Kernels: No drillable kernel beyond entries already listed

### geo.two-column-proof — Write a two-column proof

Rating: Low
Why: Inherently multi-step at any speed — sequence given facts, theorems, and justifications into a chain; the output is prose-structured, which no input format hosts. (source: no-OpenStax-book gap check — logic/proof-writing)
Kernels: [geo.conditional-forms, geo.triangle-congruence-criteria, geo.vertical-angle-read, geo.supplement-complement, geo.corresponding-parts]

### Geometry checklist disposition table

Every KA Geometry unit (9) plus the no-OpenStax-book cross-check rows maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| KA 1 Performing transformations | geo.translate-point, geo.reflect-point, geo.rotate-point, geo.dilate-point; transforming whole figures / drawing images out-of-grain: graph output — no drillable content beyond kernels geo.translate-point, geo.reflect-point, geo.rotate-point, geo.dilate-point |
| KA 2 Transformation properties and proofs | geo.is-rigid-motion, geo.compose-transformations (Low); transformation-based congruence arguments out-of-grain: proof prose — no drillable content beyond kernels geo.is-rigid-motion, geo.compose-transformations |
| KA 3 Congruence | geo.triangle-congruence-criteria (anchor, absorbed), geo.vertical-angle-read, geo.supplement-complement, geo.transversal-angle, geo.triangle-angle-sum, geo.exterior-angle, geo.polygon-angle-sum, geo.isosceles-base-angles, geo.corresponding-parts, geo.congruence-proof (Low) |
| KA 4 Similarity | geo.similarity-criteria, geo.scale-factor, geo.area-scale-factor, geo.similarity-proof (Low); missing side via proportion → prealg.solve-proportion (owned by Pre-Algebra) |
| KA 5 Right triangles & trigonometry | geo.pythagorean-verify, geo.special-right-triangle, geo.trig-ratio-definition, geo.exact-trig-values, geo.trig-cofunction, geo.solve-right-triangle (Low); Pythagorean triples → prealg.pythagorean-hypotenuse (owned by Pre-Algebra); general (non-triple) Pythagorean solves: recorded judgment — irrational side lengths have no supported answer shape beyond the a√b pair, and the multi-step solve is covered by the kernels on geo.solve-right-triangle |
| KA 6 Analytic geometry | geo.distance-formula, geo.midpoint-formula, geo.perpendicular-slope, geo.coordinate-geometry-proof (Low); slope → alg1.slope-two-points (owned by Algebra 1); parallel/perpendicular line equations → alg1.write-line-equation (Low, owned by Algebra 1); dividing a segment in a given ratio: recorded judgment — a weighted-average composite of geo.midpoint-formula and fk.fraction-of-number, no separate entry |
| KA 7 Conic sections | geo.circle-equation-read, geo.circle-radius-read, geo.circle-general-to-standard (Low), geo.parabola-focus-directrix (Low) |
| KA 8 Circles | geo.central-inscribed-angle, geo.arc-length-fraction, geo.sector-area-fraction, geo.tangent-radius-problem (Low); circle area/circumference → prealg.circle-area-pi (owned by Pre-Algebra); inscribed-shape angle chases and circle theorems/proofs out-of-grain: multi-step angle chasing — no drillable content beyond kernels geo.central-inscribed-angle, geo.supplement-complement, geo.triangle-angle-sum |
| KA 9 Solid geometry | geo.volume-box, geo.volume-cylinder-pi, geo.volume-cone-pi, geo.volume-sphere-pi, geo.volume-scale-factor, geo.cross-section-id, geo.surface-area (Low); density and solid-geometry word problems out-of-grain: modeling — no drillable content beyond kernels geo.volume-box, geo.volume-cylinder-pi |
| Cross-check — OpenStax | recorded: OpenStax publishes no Geometry title, so no TOC diff exists; per the plan, the cross-check runs the named traditional-Geometry gap list (constructions; logic/proof-writing) instead — outcomes in the two rows below |
| Gap — constructions | recorded judgment (not merged): compass-and-straightedge constructions are tool manipulation with a drawn result — no input format hosts the output, and the residual recall component is too thin for a fact family; no drillable content beyond kernels geo.midpoint-formula, geo.perpendicular-slope (the coordinate analogues) |
| Gap — logic & proof-writing | merged: geo.conditional-forms, geo.two-column-proof (Low), each with a gap-list source note; proof exercises beyond these are out-of-grain prose |

---

## Algebra 2

Swept against the KA Algebra 2 checklist (12 units) with the double cross-check the plan assigns this course — Intermediate Algebra 2e and Algebra & Trigonometry 2e. **This pass closes the primary in-degree window (Foundational → Algebra 2):** every kernel citation below is among the last that can count toward the primary ranking column, so the citation norm is exercised at full strictness — genuine prerequisites are cited even where the entry would read fine without them. The cross-check's headline outcomes are exactly the two gaps the plan predicted: KA Algebra 2 has **no sequences/series unit** and **no probability/counting unit** — both merged below (Intermediate Algebra 2e ch. 12; Algebra & Trigonometry 2e ch. 13) — plus one gap the plan did not name: a composite/inverse-functions block (Intermediate Algebra 2e ch. 10). No pinned calibration entries live in this section (the calibration table's pins live in Pre-Algebra and Algebra 1 only), so every rating below is calibrated against the pinned set: the short-expression entries against alg1.distribute-linear / alg1.factor-simple-quadratic, the fraction entries against prealg.simplify-fraction / prealg.fraction-add-unlike, the true-false entries against prealg.divisibility-rule-check / prealg.compare-fractions. The section lands 55 records (15 High / 30 Medium / 10 Low — tier counts as of the Unit 9 recalibration of alg2.complement-probability) plus 21 cross-reference rows; heavy cross-reference traffic runs back to Algebra 1 (the factoring toolkit, exponent rules, radicals, exponential models) and Geometry (the two registry-flagged canonical trig targets), and this section in turn mints the canonical homes the Trig/Precalc sweep cross-references (complex arithmetic, radian conversion, composite/inverse functions, series, probability and counting — satisfied in that pass). This unit also pays the two debts recorded upstream: radical-equation and rational-equation solving, deferred here by the Algebra 1 disposition table's OS 9 and OS 8 rows, land under KA unit 10.

**KA Unit 1 — Polynomial arithmetic.** (Binomial and monomial products, degree, and like-term collection are owned upstream — cross-references below; this unit's new grain is multi-term addition and the two special-product patterns.)

**Multiplying two binomials** → see alg1.multiply-binomials (owned by Algebra 1).
**Multiplying monomials** → see alg1.multiply-monomials (owned by Algebra 1).
**Degree of a polynomial** → see alg1.polynomial-degree (owned by Algebra 1).
**Combining like terms across variables** → see alg1.combine-like-terms-multivar (owned by Algebra 1).

### alg2.add-polynomials — Add or subtract two polynomials

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: Two or three parallel coefficient additions held by degree slot, then a ~11-token entry ≈ 2.75s — Medium's upper half; flips to Low at 2× entry time, hence the marker. This is the multi-term arithmetic the Pre-Algebra OS 10 and Algebra 1 OS 6 dispositions deferred here.
Sample: Add: (3x² + 2x − 1) + (x² − 5x + 4) → 4x^2-3x+3 · Rule: expr-commutative-ws · Params: two polynomials of degree 2–3 with 3 terms each, coefficients ∈ [−9, 9]; result coefficients nonzero ∈ [−12, 12] (vanishing terms excluded — spotting a cancelled term is a different scan skill and would split the key family); subtraction prompts flip every sign of the second polynomial; answer alphabet {digits, x, ^, +, −}.
Kernels: [prealg.combine-like-terms, alg1.combine-like-terms-multivar, fk.integer-add-sub]

### alg2.expand-binomial-square — Expand a squared binomial

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One pattern application (a², 2ab, b² — no FOIL bookkeeping) with a ~10-token entry — 4–7s; flips to Low at 2× entry time, hence the marker.
Sample: Expand: (x + 5)² → x^2+10x+25 · Rule: expr-commutative-ws · Params: (x ± b)² with b ∈ [1, 9] (middle coefficient 2b ≤ 18, constant b² ≤ 81); the (ax + b)² band with a ∈ [2, 3] keys separately; answer alphabet {digits, x, ^, +, −}.
Kernels: [fk.perfect-squares, fk.doubling-halving, alg1.multiply-binomials]

### alg2.expand-conjugate-product — Expand (a + b)(a − b)

Rating: High · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: Pure pattern recall (difference of squares — the middle term never exists) with a ~7-token entry ≈ 1.75s — ≤3s total; flips to Medium at 2× entry time, hence the marker.
Sample: Multiply: (x + 6)(x − 6) → x^2-36 · Rule: expr-commutative-ws · Params: (x + k)(x − k) with k ∈ [2, 12], constants k² ≤ 144; the (ax + k)(ax − k) band keys separately; answer alphabet {digits, x, ^, −}.
Kernels: [fk.perfect-squares, alg1.multiply-binomials]

**KA Unit 2 — Complex numbers.**

### alg2.imaginary-powers — Powers of i

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: One mod-4 cycle read against a memorized 4-value table plus a short-option tap — ≤3s.
Sample: i³ = ? → −i (options: 1 · i · −1 · −i) · Rule: mc · Params: exponents ∈ [2, 12] in the base band, [13, 40] in the stretch band (the mod-4 reduction is the same move at any size); fixed 4-option set {1, i, −1, −i}.
Kernels: [fk.division-facts]

### alg2.simplify-sqrt-negative — Square root of a negative number

Rating: High · Format: short-expression · Render: unicode-inline
Why: One root recall plus the i-append rule — ≤3s with a 2-token entry.
Sample: √−36 = ? → 6i · Rule: expr-commutative-ws · Params: radicands −k² with k ∈ [2, 15]; the non-square band (√−8 = 2i√2) is excluded — the ai√b answer shape splits the key family and is alg1.simplify-radical territory; answer alphabet {digits, i}.
Kernels: [prealg.square-root, fk.perfect-squares]

### alg2.add-subtract-complex — Add or subtract complex numbers

Rating: Medium · Format: short-expression · Render: unicode-inline
Why: Two parallel signed additions (real and imaginary slots) plus a ~5-token entry — Medium's floor, ~3–4s.
Sample: (3 + 2i) + (1 − 5i) → 4-3i · Rule: expr-commutative-ws · Params: real and imaginary parts nonzero integers ∈ [−9, 9]; results keep both parts nonzero, ∈ [−18, 18]; subtraction prompts included; answer alphabet {digits, i, +, −}.
Kernels: [fk.integer-add-sub]

### alg2.complex-conjugate — Conjugate of a complex number

Rating: High · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One sign flip and a copy-down — ~1s think + ~1.25s entry; entry dominates the High budget, hence the marker.
Sample: What is the conjugate of 3 − 4i? → 3+4i · Rule: expr-commutative-ws · Params: real and imaginary parts nonzero integers ∈ [−9, 9] in both sign renderings; answer alphabet {digits, i, +, −}.
Kernels: No drillable kernel beyond entries already listed

### alg2.multiply-complex — Multiply two complex numbers

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: The FOIL move of alg1.multiply-binomials plus the i² = −1 merge — Medium's ceiling, 5–8s even with a short ~4-token entry; flips to Low at 2× entry time, hence the marker.
Sample: (2 + 3i)(1 − 2i) → 8-i · Rule: expr-commutative-ws · Params: parts nonzero integers ∈ [−5, 5]; products kept with both result parts nonzero, ∈ [−40, 40]; the pure-imaginary warm-up band (3i · 2i) keys separately; answer alphabet {digits, i, +, −}.
Kernels: [alg1.multiply-binomials, fk.integer-mul-div, fk.integer-add-sub]

### alg2.solve-quadratic-complex — Solve a quadratic with complex solutions

Rating: Low
Why: Inherently multi-step at any speed — run the quadratic formula, keep the negative discriminant, convert it to i-form, and assemble both solutions while holding every intermediate.
Kernels: [alg1.solve-by-quadratic-formula, alg1.discriminant-root-count, alg2.simplify-sqrt-negative]

**KA Unit 3 — Polynomial factorization.** (The whole Algebra 1 factoring toolkit is owned upstream — cross-references below; this unit's new grain is the cube patterns and the higher-degree moves.)

**Factoring out the GCF** → see alg1.factor-gcf (owned by Algebra 1).
**Factoring a difference of squares** → see alg1.factor-difference-of-squares (owned by Algebra 1).
**Recognizing a perfect-square trinomial** → see alg1.factor-perfect-square-trinomial (owned by Algebra 1).
**Factoring a monic quadratic** → see alg1.factor-simple-quadratic (owned by Algebra 1).
**Factoring a non-monic quadratic** → see alg1.factor-nonmonic-quadratic (owned by Algebra 1; Low).

### alg2.sum-diff-cubes-pattern — Sum/difference of cubes pattern

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One cube-root recall dropped into the memorized pattern slot — 3–5s; asking for a alone dodges the ~17-token factored answer, which would be entry-prohibitive at any tier.
Sample: x³ + 27 = (x + a)(x² − ax + a²). a = ? → 3 · Rule: int-exact · Params: constants k³ with k ∈ [2, 6]; sum and difference variants balanced (the difference variant shows (x − a)(x² + ax + a²)); answers ∈ [2, 6].
Kernels: [fk.perfect-cubes, prealg.cube-root]

### alg2.factor-by-grouping — Factor a four-term polynomial by grouping

Rating: Low
Why: Inherently multi-step at any speed — split into pairs, factor each pair's GCF, then factor out the common binomial while holding both halves.
Kernels: [alg1.factor-gcf, alg1.factor-pairs-sum-product]

### alg2.factor-quadratic-form — Factor an expression in quadratic form

Rating: Low
Why: Inherently multi-step at any speed — spot the u = x² substitution, factor the disguised quadratic, then substitute back through both factors.
Kernels: [alg1.factor-simple-quadratic, alg1.exponent-power-rule]

**KA Unit 4 — Polynomial division.**

### alg2.divide-poly-by-monomial — Divide a polynomial by a monomial

Rating: Medium · Format: short-expression · Render: unicode-inline
Why: Two parallel monomial quotients (coefficient division plus exponent subtraction, term by term) — 3–6s with a ~8-token entry.
Sample: (6x⁵ + 9x³) ÷ 3x² → 2x^3+3x · Rule: expr-commutative-ws · Params: 2-term dividends; coefficients multiples of the divisor coefficient with quotients ∈ [2, 9]; exponent differences ≥ 1 (no constant or negative-exponent results); answer alphabet {digits, x, ^, +, −}.
Kernels: [alg1.simplify-monomial-quotient, fk.division-facts]

### alg2.remainder-theorem — Remainder via the remainder theorem

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One rule recall (remainder = p(a)) collapsing a division into a single substitute-and-evaluate — 4–7s.
Sample: What is the remainder when x² + 3x + 1 is divided by x − 2? → 11 · Rule: int-exact · Params: monic quadratics and cubics with coefficients ∈ [−5, 5]; divisors x − a with a ∈ [−3, 3] excluding 0; answers ∈ [−40, 40] (negative answers carry the touch-minus-key caveat).
Kernels: [prealg.evaluate-expression, alg1.evaluate-function]

### alg2.factor-check — Is (x − a) a factor

Rating: Medium · Format: true-false · Render: unicode-inline
Why: One remainder-theorem evaluation compared against zero — 3–6s; genuinely a verification judgment, which is what true-false is for.
Sample: True or false: (x − 2) is a factor of x³ − 8 → true · Rule: tf · Params: monic quadratics and cubics with coefficients ∈ [−5, 5]; candidate roots a ∈ [−3, 3] excluding 0; false cases leave remainders ±[1, 6]; families balanced 50/50.
Kernels: [alg2.remainder-theorem, prealg.check-solution]

### alg2.polynomial-long-division — Polynomial long (or synthetic) division

Rating: Low
Why: Inherently multi-step at any speed — divide the lead terms, multiply back, subtract, bring down, repeat — a full held algorithm whichever notation is used.
Kernels: [alg1.simplify-monomial-quotient, alg1.multiply-binomials, alg2.add-polynomials, alg2.remainder-theorem]

**KA Unit 5 — Polynomial graphs.**

**Zeros from factored form** → see alg1.roots-from-factored-form (owned by Algebra 1).

### alg2.zero-multiplicity — Multiplicity of a zero

Rating: High · Format: single-number · Render: unicode-inline
Why: One exponent read off the named factor — ≤3s.
Sample: y = (x − 2)³(x + 1). What is the multiplicity of the zero at x = 2? → 3 · Rule: int-exact · Params: 2–3 distinct linear factors with exponents ∈ [1, 4], roots ∈ [−9, 9]; the asked zero rotates; answers ∈ [1, 4].
Kernels: [alg1.roots-from-factored-form]

### alg2.multiplicity-cross-touch — Cross or touch at a zero

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: One parity judgment on the read-off exponent (odd crosses, even touches) and a two-option tap — ≤3s.
Sample: y = (x − 2)²(x + 1). At x = 2, the graph…? → Touches the x-axis (options: Crosses the x-axis · Touches the x-axis) · Rule: mc · Params: factored polynomials as in alg2.zero-multiplicity; the asked zero's exponent ∈ [1, 4]; odd/even families balanced 50/50.
Kernels: [alg2.zero-multiplicity]

### alg2.end-behavior — End behavior of a polynomial

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Two chained judgments — locate the leading term, then combine degree parity with the coefficient's sign — 3–6s with a two-option tap.
Sample: y = −2x³ + x − 5. As x → ∞, y → ? → −∞ (options: ∞ · −∞) · Rule: mc · Params: degrees ∈ [2, 5], leading coefficients ∈ [−5, 5] excluding 0; terms not always in descending order (the scan is part of the skill); x → ∞ and x → −∞ prompts balanced.
Kernels: [alg1.polynomial-degree, fk.integer-mul-div]

**KA Unit 6 — Rational exponents and radicals.** (Square-root simplification and products are owned by Algebra 1; the perfect-root reads by Pre-Algebra — cross-references below and in the disposition table.)

**Simplifying square roots to a√b** → see alg1.simplify-radical (owned by Algebra 1).
**Multiplying square roots** → see alg1.multiply-square-roots (owned by Algebra 1).

### alg2.evaluate-rational-exponent — Evaluate a rational-exponent power

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One root recall chained with one small power (8^(2/3): cube root, then square) — 3–6s; the stacked fractional exponent needs a math renderer.
Sample: Evaluate 8^(2/3) → 4 · Rule: int-exact · Params: bases from the perfect-power families {4, 8, 9, 16, 25, 27, 32, 64, 81, 100, 125}; exponents p/q with q ∈ {2, 3}, p ∈ [1, 3], chosen so answers are positive integers ≤ 243; unit-fraction exponents (p = 1) form the easy sub-band.
Kernels: [prealg.square-root, prealg.cube-root, prealg.evaluate-exponent]

### alg2.rational-exponent-product — Product rule with rational exponents

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One fraction addition wearing exponent clothes — 3–6s; params keep the exponent sum an integer so the answer is a single small number.
Sample: 2^(1/2) · 2^(3/2) = 2ⁿ. n = ? → 2 · Rule: int-exact · Params: exponent pairs p/q + r/q with q ∈ {2, 3, 4} summing to an integer ∈ [1, 4]; displayed base from {2, 3, 5, 10, x}.
Kernels: [prealg.exponent-product-rule, prealg.fraction-add-unlike]

### alg2.simplify-cube-root — Simplify a cube root

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One largest-cube-factor extraction (54 = 27 · 2) with a cube-root recall — 4–7s; the a, b pair mirrors alg1.simplify-radical's shape.
Sample: ∛54 = a∛b. a, then b → 3, 2 · Rule: pair-ordered · Params: radicands ∈ [16, 250] with a cube factor ≥ 8; b cube-free ∈ {2, 3, 4, 5, 6, 7, 9, 10}; a ∈ [2, 5].
Kernels: [fk.perfect-cubes, prealg.cube-root, alg1.simplify-radical]

### alg2.combine-radicals — Add or subtract like radicals

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: One simplification to a common surd plus one coefficient addition — 4–7s.
Sample: √8 + √2 = a√b. a, then b → 3, 2 · Rule: pair-ordered · Params: pairs built so both terms reduce to multiples of one surd √b with b ∈ {2, 3, 5}; result coefficients ∈ [2, 9]; already-like pairs (2√3 + 4√3) form the easy sub-band.
Kernels: [alg1.simplify-radical, fk.addition-facts]

**KA Unit 7 — Exponential models.** (The growth/decay reads are owned by Algebra 1 — cross-references below; the modeling remainder is in the disposition table.)

**Growth vs decay from the base** → see alg1.growth-or-decay (owned by Algebra 1).
**Percent rate from a growth/decay factor** → see alg1.growth-factor-to-rate (owned by Algebra 1).
**Evaluating a·bˣ** → see alg1.evaluate-exponential (owned by Algebra 1).

### alg2.exponential-solve-common-base — Solve bˣ = k by recognizing the power

Rating: High · Format: single-number · Render: unicode-inline
Why: One inverse-power recall against the powers fact family (2ˣ = 32 is "which power of 2 is 32") — ≤3s.
Sample: 2ˣ = 32. x = ? → 5 · Rule: int-exact · Params: bases ∈ {2, 3, 4, 5, 10}; k a memorized power with exponent answers ∈ [2, 6]; the base-rewrite band (4ˣ = 32 → x = 5/2) is excluded — a fraction answer splits the shape, and the multi-step rewrite is Trig/Precalc grain.
Kernels: [prealg.evaluate-exponent]

**KA Unit 8 — Logarithms.**

### alg2.evaluate-log — Evaluate a logarithm

Rating: High · Format: single-number · Render: unicode-inline
Why: The same inverse-power recall as alg2.exponential-solve-common-base in log notation — ≤3s once the notation is automatic; log↔exponent form conversion is exercised implicitly here, not as a separate entry.
Sample: log₂ 32 = ? → 5 · Rule: int-exact · Params: bases ∈ {2, 3, 5, 10}; arguments memorized powers with answers ∈ [0, 6] (log-of-1 and log-of-base cases included); the negative-answer band (log₂ ¼ = −2) carries the touch-minus-key caveat.
Kernels: [prealg.evaluate-exponent, alg2.exponential-solve-common-base]

### alg2.log-product-rule — Product rule for logs

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One rule application (sum of logs = log of the product) chained with one evaluation — 4–7s.
Sample: log₆ 4 + log₆ 9 = ? → 2 · Rule: int-exact · Params: argument pairs whose product is a small power of the base; bases ∈ {2, 3, 5, 6, 10}; answers ∈ [1, 4]; the quotient-rule variant (difference of logs) shares params and keys separately.
Kernels: [alg2.evaluate-log, fk.times-tables]

### alg2.log-power-rule — Power rule for logs

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One exponent pull-down and one multiplication fact — 3–6s.
Sample: log₂ 8⁵ = ? → 15 · Rule: int-exact · Params: inner arguments memorized powers of the base (inner log value ∈ [1, 4]); outer exponents ∈ [2, 6]; answers ≤ 24.
Kernels: [alg2.evaluate-log, fk.times-tables]

### alg2.natural-log-facts — Natural-log special values

Rating: High · Format: single-number · Render: unicode-inline
Why: Pure recall of the ln fact family (ln 1 = 0, ln e = 1, ln eᵏ = k) — ≤2s.
Sample: ln e³ = ? → 3 · Rule: int-exact · Params: prompts over {ln 1, ln e, ln eᵏ with k ∈ [2, 6]}; the negative-k band carries the touch-minus-key caveat.
Kernels: [alg2.evaluate-log]

### alg2.solve-exponential-equation — Solve an exponential equation with logs

Rating: Low
Why: Inherently multi-step at any speed — isolate the exponential, take a log of both sides, then solve the resulting equation (usually with calculator evaluation).
Kernels: [alg2.evaluate-log, alg2.exponential-solve-common-base, prealg.solve-two-step-equation]

**KA Unit 9 — Transformations of functions.**

### alg2.function-shift-direction — Which way does f(x ± a) ± b shift

Rating: High · Format: multiple-choice
Why: One recalled rule pair (inside moves opposite, outside moves as written) and a short 4-option scan — ≤3s.
Sample: Compared with y = f(x), the graph of y = f(x − 4) is shifted…? → 4 right (options: 4 right · 4 left · 4 up · 4 down) · Rule: mc · Params: single shifts a ∈ [1, 9]; inside/outside position and ± sign balanced; the inside-minus-moves-right trap is the point of the family.
Kernels: No drillable kernel beyond entries already listed

### alg2.function-reflection-rule — Which axis does −f(x) / f(−x) reflect across

Rating: High · Format: multiple-choice
Why: One recalled rule (outside minus flips y, inside minus flips x) and a two-option tap — ≤3s.
Sample: The graph of y = f(−x) is the graph of f reflected across which axis? → the y-axis (options: the x-axis · the y-axis) · Rule: mc · Params: −f(x) and f(−x) prompts balanced 50/50; the composed band (−f(−x)) is excluded — two rules at once is a different family.
Kernels: No drillable kernel beyond entries already listed

### alg2.function-scale-direction — Stretch or compression from a·f(x) / f(bx)

Rating: Medium · Format: multiple-choice
Why: One rule selection with the counterintuitive inside-factor inversion (f(2x) compresses) plus a 4-option scan — 3–6s.
Sample: Compared with y = f(x), the graph of y = f(2x) is…? → compressed horizontally (options: stretched horizontally · compressed horizontally · stretched vertically · compressed vertically) · Rule: mc · Params: factors ∈ {2, 3, 1/2, 1/3}; inside and outside positions balanced; fractional factors exercise the second inversion.
Kernels: No drillable kernel beyond entries already listed

### alg2.transformed-point — Track a point through a transformation

Rating: Medium · Format: two-numbers
Why: The shift rules applied to one concrete point — two signed additions after the rule read — 4–7s with the pair entry.
Sample: (2, 5) lies on y = f(x). Which point lies on y = f(x − 3) + 1? → 5, 6 · Rule: pair-ordered · Params: base points ∈ [−9, 9]; shifts a, b ∈ [1, 6] in all four sign combinations; image coordinates ∈ [−15, 15]; negative coordinates carry the touch-minus-key caveat.
Kernels: [alg2.function-shift-direction, fk.integer-add-sub]

### alg2.even-odd-classify — Even, odd, or neither

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One exponent-parity scan across the terms (or one f(−x) substitution check) — 3–6s with a 3-option tap.
Sample: f(x) = x³ − 4x. Even, odd, or neither? → Odd (options: Even · Odd · Neither) · Rule: mc · Params: polynomials with 2–3 terms, exponents ≤ 5, coefficients ∈ [−9, 9]; all-even, all-odd, and mixed cases balanced; the constant-term-is-even convention exercised (x² + 3 is even).
Kernels: [prealg.evaluate-expression]

**KA Unit 10 — Equations.** (This unit pays the two debts recorded upstream: the Algebra 1 disposition table's OS 9 and OS 8 rows deferred radical-equation and rational-equation solving here.)

### alg2.solve-sqrt-equation-simple — Solve √x = k

Rating: High · Format: single-number · Render: unicode-inline
Why: One squaring recall — the inverse read of prealg.square-root — ≤3s.
Sample: √x = 7. x = ? → 49 · Rule: int-exact · Params: k ∈ [2, 15]; answers perfect squares ≤ 225; the shifted band (√(x − a) = k) adds one addition and keys separately.
Kernels: [fk.perfect-squares, prealg.square-root]

### alg2.check-extraneous — Extraneous-solution check

Rating: Medium · Format: true-false · Render: unicode-inline
Why: One substitution against the original equation with the sign trap in view (√x is never negative) — 3–6s; genuinely a verification judgment.
Sample: True or false: x = 9 is a solution of √x = −3 → false · Rule: tf · Params: one-step radical and rational equations; candidates ∈ [1, 25]; false cases split between arithmetic misses and the extraneous traps (negative-radical and zero-denominator cases ≥ 40%); families balanced 50/50.
Kernels: [prealg.check-solution, prealg.square-root]

### alg2.solve-radical-equation — Solve a radical equation

Rating: Low
Why: Inherently multi-step at any speed — isolate the radical, square both sides, solve the resulting equation, then check for extraneous roots.
Kernels: [alg2.solve-sqrt-equation-simple, prealg.solve-two-step-equation, alg2.check-extraneous]

### alg2.solve-rational-equation — Solve a rational equation

Rating: Low
Why: Inherently multi-step at any speed — clear denominators (or cross-multiply), solve, then exclude values that zero a denominator.
Kernels: [prealg.solve-proportion, prealg.solve-multi-step-equation, alg1.simplify-rational-expression, alg2.check-extraneous]

**KA Unit 11 — Trigonometry.** (The right-triangle foundations are owned by Geometry — cross-references below, hitting the two canonical targets the Geometry pass flagged in the registry; this unit's new grain is radians and the identity/quadrant reads. Unit-circle coordinates at special angles are the same fact family as geo.exact-trig-values and are satisfied by that cross-reference — radian phrasing joins that entry's key families during the Trig/Precalc pass, per its registry note.)

**Right-triangle trig ratios (SOH-CAH-TOA)** → see geo.trig-ratio-definition (owned by Geometry).
**Exact trig values at special angles / unit-circle coordinates** → see geo.exact-trig-values (owned by Geometry).

### alg2.degrees-to-radians — Convert degrees to radians

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One ratio reduction (θ/180 in lowest terms) — 3–6s on the assumed fraction pad.
Sample: Express 150° in radians as kπ. k = ? → 5/6 · Rule: frac-lowest-terms · Params: angles multiples of 15 ∈ [15, 330] excluding multiples of 180 (integer k excluded — answer-shape split); k in lowest terms with denominator ∈ {2, 3, 4, 6, 12}.
Kernels: [prealg.simplify-fraction, fk.division-facts]

### alg2.radians-to-degrees — Convert radians to degrees

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One fraction-of move (the coefficient of π, taken of 180°) — 3–5s.
Sample: Convert 2π/3 radians to degrees → 120 · Rule: int-exact · Params: coefficients p/q with q ∈ {2, 3, 4, 6}, p ∈ [1, 11], values in (0, 2π]; integer-degree answers ≤ 360.
Kernels: [fk.fraction-of-number, fk.times-tables]

### alg2.pythagorean-identity-apply — Find cos θ from sin θ via the identity

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One triple recall through the sin²θ + cos²θ = 1 lens (3-4-5 in fraction clothes) plus a quadrant sign read — 4–7s.
Sample: sin θ = 3/5 and θ is in Quadrant I. cos θ = ? → 4/5 · Rule: frac-lowest-terms · Params: ratios from the primitive triples (3-4-5, 5-12-13, 8-15-17, 7-24-25), already in lowest terms; Quadrant I base band; the Quadrant II–IV band adds the sign judgment (sign to the numerator per the format spec); sin→cos and cos→sin balanced.
Kernels: [prealg.pythagorean-hypotenuse, geo.trig-ratio-definition, prealg.simplify-fraction]

### alg2.trig-sign-by-quadrant — Sign of a trig function by quadrant

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One recalled sign map (ASTC) applied to a two-condition read — 3–5s; the answer is the quadrant number, so entry is one digit.
Sample: sin θ < 0 and cos θ > 0. Which quadrant is θ in? (1–4) → 4 · Rule: int-exact · Params: condition pairs over {sin, cos, tan} × {< 0, > 0} with a unique quadrant answer; all four quadrants balanced; answers ∈ [1, 4].
Kernels: [prealg.identify-quadrant]

**KA Unit 12 — Modeling.** Out-of-grain end-to-end (the course's word-problem capstone) — see the disposition table, which names the kernels it exercises.

**OpenStax cross-check merges — sequences, series, and the binomial theorem (Intermediate Algebra 2e ch. 12; Algebra & Trigonometry 2e ch. 13).** The plan's first predicted gap, confirmed: KA Algebra 2's 12 units contain no sequences/series unit. The sequence skills themselves are owned upstream (cross-references below); the series, factorial, and binomial fact families are new and merged here, each with its source note.

**Next term of an arithmetic sequence** → see prealg.next-term-arithmetic (owned by Pre-Algebra).
**nth term of an arithmetic sequence** → see alg1.arithmetic-nth-term (owned by Algebra 1).
**Next term of a geometric sequence** → see alg1.next-term-geometric (owned by Algebra 1).
**nth term of a geometric sequence** → see alg1.geometric-nth-term (owned by Algebra 1).

### alg2.arithmetic-series-sum — Sum of an arithmetic series (endpoints given)

Rating: Medium · Format: single-number
Why: One formula application (n/2 · (a₁ + aₙ)) fused into an addition and one held multiplication — Medium's upper half, 4–7s at the friendly params below. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: An arithmetic series has 10 terms, first term 3, last term 21. What is the sum? → 120 · Rule: int-exact · Params: n ∈ {4, 6, 8, 10, 20} (even, so n/2 is whole); a₁, aₙ ∈ [1, 30] with a₁ + aₙ ≤ 40; answers ≤ 400; the variant where aₙ must be computed first is excluded — that composite is alg1.arithmetic-nth-term chained with this entry, Low grain.
Kernels: [fk.addition-facts, fk.doubling-halving, fk.two-digit-times-one-digit]

### alg2.geometric-series-sum — Sum of a finite geometric series

Rating: Low
Why: Inherently multi-step at any speed — evaluate rⁿ, subtract 1, divide, and multiply by the first term while holding each intermediate. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Kernels: [prealg.evaluate-exponent, alg1.geometric-nth-term, fk.division-facts]

### alg2.infinite-geometric-sum — Sum of an infinite geometric series

Rating: Medium · Format: single-number
Why: One formula application (a / (1 − r)) that collapses to a subtraction and one small fraction division at benchmark ratios — 4–7s. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: 8 + 4 + 2 + 1 + … = ? → 16 · Rule: int-exact · Params: ratios ∈ {1/2, 1/3, 1/4, 2/3, 3/4}; first terms chosen so a / (1 − r) is a positive integer ≤ 100; prompts show either the leading terms (ratio inferred) or a and r explicitly.
Kernels: [prealg.fraction-divide, fk.doubling-halving, alg1.next-term-geometric]

### alg2.evaluate-sigma — Evaluate a small sigma-notation sum

Rating: Medium · Format: single-number · Render: needs-math-render
Why: Three substitutions and a running sum held mentally — Medium's ceiling, 5–8s at three terms; the stacked Σ limits need a math renderer. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: Σₖ₌₁³ (2k + 1) → 15 · Rule: int-exact · Params: summands ak + b with a, b ∈ [1, 5]; exactly 3 terms (upper limit 3, or an index range of size 3); answers ≤ 60.
Kernels: [prealg.evaluate-expression, fk.addition-facts]

### alg2.factorial — Evaluate a factorial

Rating: High · Format: single-number
Why: Pure fact-family recall through 6! for a fluent student — ≤3s with a ≤3-digit entry. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: 5! = ? → 120 · Rule: int-exact · Params: n ∈ [0, 6] (0! = 1 included deliberately); answers ≤ 720; 7! and up drift into computation and are excluded from the recall family.
Kernels: [fk.times-tables]

### alg2.binomial-coefficient — Evaluate a binomial coefficient

Rating: Medium · Format: single-number
Why: One small-case recall (Pascal's-triangle rows) or one collapsed quotient (6 · 5 / 2) — 3–6s at the params below. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: C(6, 2) = ? → 15 · Rule: int-exact · Params: n ∈ [3, 8]; k ∈ {0, 1, 2, n−2, n−1, n} (the symmetry shortcut is part of the skill); answers ≤ 70; prompts use both C(n, k) and "n choose k" phrasings.
Kernels: [alg2.factorial, fk.times-tables, fk.division-facts]

### alg2.binomial-expansion — Expand a binomial power

Rating: Low
Why: Inherently multi-step at any speed — generate the coefficient row, walk the descending/ascending powers, and combine sign and constant factors term by term. (source: OpenStax Intermediate Algebra 2e ch. 12 / Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Kernels: [alg2.binomial-coefficient, alg1.multiply-binomials, prealg.evaluate-exponent]

**OpenStax cross-check merges — probability and counting (Algebra & Trigonometry 2e ch. 13).** The plan's second predicted gap, confirmed: no KA Algebra 2 unit hosts probability or counting. Merged below with source notes. Only Algebra & Trigonometry 2e carries this block — Intermediate Algebra 2e has no probability chapter — noted so the diff record is complete.

### alg2.simple-probability — Probability of a simple event

Rating: High · Format: fraction · Surface-sensitive
Why: One favorable-over-total read — ~1.5s think + ~1s entry on the assumed fraction pad; flips to Medium if entry runs 2× slow, hence the marker. (source: OpenStax Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: A bag holds 3 red and 5 blue marbles. P(red) = ? → 3/8 · Rule: frac-lowest-terms · Params: totals ≤ 20; base-band answers already in lowest terms; the reduce band (4 red of 12 → 1/3) adds one reduction and sits at the High/Medium boundary; contexts rotate (marbles, dice, spinners, cards by suit) with the arithmetic shape fixed.
Kernels: [prealg.simplify-fraction]

### alg2.complement-probability — Probability of the complement

Rating: High · Format: fraction · Surface-sensitive
Why: One fused move — recast 1 over the given denominator and subtract the numerators ((5 − 2)/5) — ~1.5s think + ~1s entry on the assumed fraction pad; entry is most of the remaining High budget, so a 2× slower surface tips it to Medium. (source: OpenStax Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: P(rain) = 2/5. What is P(no rain)? → 3/5 · Rule: frac-lowest-terms · Params: given probabilities a/b in lowest terms with b ∈ [3, 12]; answers (b−a)/b are automatically in lowest terms since gcd(a, b) = 1.
Kernels: [fk.subtraction-facts, alg2.simple-probability]
*Rating adjusted (Unit 9 recalibration):* Medium → High — measured against the fraction pins, this is one fused subtract-over-a-kept-denominator move, strictly simpler than prealg.mixed-to-improper (High × fraction) and only a subtraction fact beyond alg2.simple-probability (High × fraction); the original Medium-floor call was an outlier against the calibration table.

### alg2.permutation-count — Count ordered arrangements

Rating: Medium · Format: single-number
Why: One falling-product read (5 · 4 for two slots) held mentally — 3–6s. (source: OpenStax Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Sample: How many ways can 1st and 2nd place be awarded among 5 runners? → 20 · Rule: int-exact · Params: n ∈ [4, 10], slots ∈ {2, 3}; answers ≤ 720; full-line arrangements (all n in order) asked through n = 5 and keyed as their own family alongside alg2.factorial.
Kernels: [fk.times-tables, alg2.factorial]

### alg2.compound-event-probability — Probability of a compound event

Rating: Low
Why: Inherently multi-step at any speed — decompose into and/or structure, pick the multiplication or addition rule, compute each piece, and combine the fractions. (source: OpenStax Algebra & Trigonometry 2e ch. 13 — absent from KA sweep)
Kernels: [alg2.simple-probability, alg2.complement-probability, prealg.fraction-multiply, prealg.fraction-add-unlike]

**OpenStax cross-check merges — composite and inverse functions (Intermediate Algebra 2e ch. 10).** A third genuine diff beyond the two the plan predicted: Intermediate Algebra 2e opens its exponential/log chapter with composite and inverse functions, which no snapshotted KA Algebra 2 unit hosts (KA places them in Precalculus unit 1). First-course-owns puts the canonical records here, where the cross-check surfaced them; the Trig/Precalc sweep cross-references them, per the registry notes (satisfied in that pass).

### alg2.evaluate-composite — Evaluate a composite function at a point

Rating: Medium · Format: single-number · Render: unicode-inline
Why: Two chained evaluations (inner first, then outer) held mentally — 4–7s. (source: OpenStax Intermediate Algebra 2e ch. 10 — absent from KA Algebra 2; KA hosts it in Precalculus unit 1, which cross-references here (satisfied in the Trig/Precalc pass))
Sample: f(x) = 2x + 1 and g(x) = x². f(g(2)) = ? → 9 · Rule: int-exact · Params: one linear and one quadratic (or two linear) with coefficients ∈ [1, 5]; inputs ∈ [−4, 4]; both orders asked (f(g(x)) and g(f(x))); answers ∈ [−40, 60] (negative answers carry the touch-minus-key caveat).
Kernels: [alg1.evaluate-function, prealg.evaluate-expression]

### alg2.inverse-of-linear — Inverse of a linear function

Rating: Medium · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: One two-step un-doing read (subtract b, divide by a) written as a single expression — 4–7s with a ~8-token entry; flips to Low at 2× entry time, hence the marker. (source: OpenStax Intermediate Algebra 2e ch. 10 — absent from KA Algebra 2; KA hosts it in Precalculus unit 1, which cross-references here (satisfied in the Trig/Precalc pass))
Sample: f(x) = 2x + 3. f⁻¹(x) = ? → (x-3)/2 · Rule: expr-commutative-ws · Params: f(x) = ax + b with a ∈ [2, 9], b ∈ [1, 9] in both signs; the answer's canonical shape is (x − b)/a — the split form x/a − b/a is a different token string and is not accepted, since holding the un-doing as one expression is the drill; answer alphabet {digits, x, +, −, /, (, )}.
Kernels: [alg1.rearrange-formula-one-step, prealg.solve-two-step-equation]

### Algebra 2 checklist disposition table

Every KA Algebra 2 unit (12), every Intermediate Algebra 2e chapter (12), and every Algebra & Trigonometry 2e chapter (13) maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows. (Algebra & Trigonometry 2e chapters 7–10 are trigonometry-course grain; their rows record the deferral to the Trig/Precalc sweep, which uses the same book as its cross-check.)

| Checklist unit | Disposition |
|---|---|
| KA 1 Polynomial arithmetic | alg2.add-polynomials, alg2.expand-binomial-square, alg2.expand-conjugate-product; binomial products → alg1.multiply-binomials; monomial products → alg1.multiply-monomials; degree → alg1.polynomial-degree; like terms → alg1.combine-like-terms-multivar; binomial × trinomial and longer products: recorded judgment — the FOIL move compounded past one held merge is Low grain with no new kernel beyond alg1.multiply-binomials, alg2.add-polynomials |
| KA 2 Complex numbers | alg2.imaginary-powers, alg2.simplify-sqrt-negative, alg2.add-subtract-complex, alg2.complex-conjugate, alg2.multiply-complex, alg2.solve-quadratic-complex (Low) |
| KA 3 Polynomial factorization | alg2.sum-diff-cubes-pattern, alg2.factor-by-grouping (Low), alg2.factor-quadratic-form (Low); GCF / difference of squares / perfect-square trinomial / monic / non-monic factoring → alg1.factor-gcf, alg1.factor-difference-of-squares, alg1.factor-perfect-square-trinomial, alg1.factor-simple-quadratic, alg1.factor-nonmonic-quadratic (owned by Algebra 1) |
| KA 4 Polynomial division | alg2.divide-poly-by-monomial, alg2.remainder-theorem, alg2.factor-check, alg2.polynomial-long-division (Low) |
| KA 5 Polynomial graphs | alg2.zero-multiplicity, alg2.multiplicity-cross-touch, alg2.end-behavior; zeros from factored form → alg1.roots-from-factored-form; sketching, positivity intervals, and turning-point analysis out-of-grain: graph output/reading — no drillable content beyond kernels alg2.end-behavior, alg2.zero-multiplicity, alg2.multiplicity-cross-touch |
| KA 6 Rational exponents and radicals | alg2.evaluate-rational-exponent, alg2.rational-exponent-product, alg2.simplify-cube-root, alg2.combine-radicals; square-root simplification → alg1.simplify-radical; root products → alg1.multiply-square-roots; perfect square/cube roots → prealg.square-root, prealg.cube-root (owned upstream) |
| KA 7 Exponential models | alg2.exponential-solve-common-base; growth vs decay → alg1.growth-or-decay; factor ↔ rate → alg1.growth-factor-to-rate; evaluation → alg1.evaluate-exponential; model construction and interpretation word problems out-of-grain: modeling — no drillable content beyond kernels alg1.evaluate-exponential, alg1.growth-factor-to-rate, alg2.exponential-solve-common-base |
| KA 8 Logarithms | alg2.evaluate-log, alg2.log-product-rule, alg2.log-power-rule, alg2.natural-log-facts, alg2.solve-exponential-equation (Low); log ↔ exponent form conversion: recorded judgment — exercised inside alg2.evaluate-log, no separate entry; change of base: recorded judgment — calculator-dependent evaluation with no exact fact family beyond alg2.evaluate-log |
| KA 9 Transformations of functions | alg2.function-shift-direction, alg2.function-reflection-rule, alg2.function-scale-direction, alg2.transformed-point, alg2.even-odd-classify; graphing transformed functions and reading transformations off drawn graphs out-of-grain: graph input/output — no drillable content beyond kernels alg2.function-shift-direction, alg2.transformed-point |
| KA 10 Equations | alg2.solve-sqrt-equation-simple, alg2.check-extraneous, alg2.solve-radical-equation (Low — the debt from Algebra 1's OS 9 row), alg2.solve-rational-equation (Low — the debt from Algebra 1's OS 8 row); solving equations by graphing out-of-grain: graph reading — no drillable content beyond kernels alg2.check-extraneous |
| KA 11 Trigonometry | alg2.degrees-to-radians, alg2.radians-to-degrees, alg2.pythagorean-identity-apply, alg2.trig-sign-by-quadrant; right-triangle ratios → geo.trig-ratio-definition; special-angle values and unit-circle coordinates → geo.exact-trig-values (owned by Geometry); sinusoidal graphs and their features: recorded judgment — owned by the Trig/Precalc sweep (KA Trigonometry unit 2), deferred |
| KA 12 Modeling | out-of-grain end-to-end: modeling/word-problem unit — no drillable content beyond kernels alg1.evaluate-exponential, alg2.exponential-solve-common-base, alg2.evaluate-composite, alg2.arithmetic-series-sum |
| Int 1 Foundations | covered: the fk/prealg arithmetic, expression, and exponent sets (see the Pre-Algebra section and Algebra 1 OS 1 row) |
| Int 2 Solving Linear Equations | covered by the Pre-Algebra KA 7/10/12 and Algebra 1 KA 2 entry sets; absolute-value inequalities out-of-grain: interval answers are not in the format legend — no drillable content beyond kernels alg1.solve-absolute-value-equation, prealg.solve-one-step-inequality |
| Int 3 Graphs and Functions | covered by the Algebra 1 KA 4/5/8 entry sets; graph reading out-of-grain (recorded there) |
| Int 4 Systems of Linear Equations | covered: prealg.solve-2x2-system (Low), prealg.check-system-solution, alg1.system-solution-count; 3×3 systems: recorded judgment — the same elimination moves compounded, no new kernel beyond prealg.solve-2x2-system |
| Int 5 Polynomials and Polynomial Functions | covered by the KA 1 entry set and its Algebra 1 owners |
| Int 6 Factoring | covered by the KA 3 entry set (alg2.sum-diff-cubes-pattern, alg2.factor-by-grouping and the Algebra 1 owners) |
| Int 7 Rational Expressions and Functions | covered: alg1.simplify-rational-expression (Low, owned by Algebra 1), alg2.solve-rational-equation (Low); complex fractions: recorded judgment — a Low-grain composite of prealg.fraction-divide and alg1.simplify-rational-expression, no separate entry |
| Int 8 Roots and Radicals | covered by the KA 6 entry set plus alg2.solve-radical-equation (Low); rationalizing denominators: recorded judgment — the a√b/c answer shape is not in the format legend; no drillable content beyond kernels alg1.simplify-radical, alg1.multiply-square-roots |
| Int 9 Quadratic Equations and Functions | covered by the Algebra 1 KA 14 entry set plus alg2.solve-quadratic-complex (Low) |
| Int 10 Exponential and Logarithmic Functions | covered by the KA 7/8 entry sets; merged: alg2.evaluate-composite, alg2.inverse-of-linear (composite/inverse block — the diff beyond the plan's predicted gaps) |
| Int 11 Conics | covered: geo.circle-equation-read, geo.circle-radius-read, geo.circle-general-to-standard (Low), geo.parabola-focus-directrix (Low) — owned by Geometry; ellipse and hyperbola feature reads: recorded judgment — owned by KA Precalculus unit 5, deferred to the Trig/Precalc sweep |
| Int 12 Sequences, Series and Binomial Theorem | merged (the plan's predicted gap): alg2.arithmetic-series-sum, alg2.geometric-series-sum (Low), alg2.infinite-geometric-sum, alg2.evaluate-sigma, alg2.factorial, alg2.binomial-coefficient, alg2.binomial-expansion (Low); sequences themselves → prealg.next-term-arithmetic, alg1.arithmetic-nth-term, alg1.next-term-geometric, alg1.geometric-nth-term (owned upstream) |
| A&T 1 Prerequisites | covered: the fk/prealg/alg1 foundations sets (see the Algebra 1 OS 1 row) |
| A&T 2 Equations and Inequalities | covered by the Pre-Algebra/Algebra 1 equation sets plus alg2.solve-quadratic-complex, alg2.solve-radical-equation, alg2.solve-rational-equation (all Low) |
| A&T 3 Functions | covered by the Algebra 1 KA 8 and Algebra 2 KA 9 entry sets plus alg2.evaluate-composite |
| A&T 4 Linear Functions | covered by the Algebra 1 KA 4/5 entry sets |
| A&T 5 Polynomial and Rational Functions | covered by the KA 1/3/4/5 entry sets and their Algebra 1 owners; rational-function asymptotes: recorded judgment — owned by KA Precalculus unit 4, deferred to the Trig/Precalc sweep |
| A&T 6 Exponential and Logarithmic Functions | covered by the KA 7/8 entry sets plus alg2.evaluate-composite, alg2.inverse-of-linear |
| A&T 7 The Unit Circle: Sine and Cosine Functions | trigonometry-course grain: deferred to the Trig/Precalc sweep (the Algebra 2-grain unit-circle intro is the KA 11 row) |
| A&T 8 Periodic Functions | trigonometry-course grain: deferred to the Trig/Precalc sweep |
| A&T 9 Trigonometric Identities and Equations | trigonometry-course grain: deferred to the Trig/Precalc sweep (the identity's Algebra 2-grain intro is merged as alg2.pythagorean-identity-apply under KA 11) |
| A&T 10 Further Applications of Trigonometry | trigonometry-course grain: deferred to the Trig/Precalc sweep |
| A&T 11 Systems of Equations and Inequalities | covered: the Pre-Algebra/Algebra 1 systems owners (see Int 4 row); matrices: recorded judgment — owned by KA Precalculus unit 7, deferred to the Trig/Precalc sweep |
| A&T 12 Analytic Geometry | covered by the Geometry KA 6/7 entry sets; ellipse and hyperbola: recorded judgment — owned by KA Precalculus unit 5, deferred (same as Int 11) |
| A&T 13 Sequences, Probability, and Counting Theory | merged (the plan's predicted gaps): the Int 12 series/binomial set plus the probability/counting block — alg2.simple-probability, alg2.complement-probability, alg2.permutation-count, alg2.compound-event-probability (Low) |

---

## Trigonometry / Precalculus

Joint sweep of both KA trig-track courses — Trigonometry (4 units) and Precalculus (10 units) — deduplicated between themselves (KA Precalc unit 2 assumes the standalone Trigonometry course's foundations and sweeps as pure dedup) and against earlier canonical owners, with the Algebra & Trigonometry 2e / Precalculus 2e cross-check. **This is the document's heaviest cross-reference section, by design:** the Algebra 2 pass pre-flagged ~20 canonical homes for exactly this sweep (complex arithmetic, radian conversion, the identity and quadrant reads, series, probability and counting, composite/inverse functions), and Geometry's two registry-flagged trig targets (geo.trig-ratio-definition, geo.exact-trig-values) absorb all right-triangle trig. The section lands 53 records (7 High / 33 Medium / 13 Low) plus 40 cross-reference rows (38 to earlier-course owners, 2 intra-section — vector magnitude and limits-at-infinity resolve to entries minted earlier in this same sweep). **The primary in-degree window (Foundational → Algebra 2) is closed:** every citation below counts only toward the registry's full-range column — the expected post-Algebra 2 behavior, not a defect — so the citation norm is applied at the same strictness as before, but its yield is forward inventory. No pinned calibration entries live here (the pins live in Pre-Algebra and Algebra 1 only); ratings are calibrated against the pinned set — MC entries against geo.triangle-congruence-criteria / geo.exact-trig-values, fraction entries against prealg.simplify-fraction / prealg.fraction-add-unlike, two-number entries against alg1.read-slope-intercept / alg1.factor-pairs-sum-product, true-false entries against prealg.divisibility-rule-check / prealg.compare-fractions. This pass pays the four deferral debts the Algebra 2 disposition table recorded against Algebra & Trigonometry 2e chapters 7–10 (each chapter has an explicit payoff row in the disposition table), pays the Algebra 2 KA 11 sinusoid deferral, pays the Int 11 / A&T 12 ellipse-hyperbola deferral, and extends geo.exact-trig-values with its promised radian phrasing (recorded in that entry's params). The cross-check's genuine diff beyond the recorded deferrals: polar coordinates and parametric equations (A&T ch. 10 / Precalculus 2e ch. 8) appear in **neither** KA snapshot course — merged at the end of the section with source notes; the BC section (CED unit 9) will cross-reference them.

**KA Trigonometry Unit 1 — Right triangles & trigonometry.** Fully owned by earlier courses — Geometry's unit 5 and Pre-Algebra's Pythagorean entry; the registry flagged geo.trig-ratio-definition and geo.exact-trig-values for exactly this absorption. No new grain (right-triangle word problems are out-of-grain — see the disposition table).

**Right-triangle trig ratios (SOH-CAH-TOA)** → see geo.trig-ratio-definition (owned by Geometry).
**Special right triangles (45-45-90 / 30-60-90)** → see geo.special-right-triangle (owned by Geometry).
**Sine–cosine complements** → see geo.trig-cofunction (owned by Geometry).
**Pythagorean theorem / triples** → see prealg.pythagorean-hypotenuse (owned by Pre-Algebra).
**Solving right triangles for sides and angles** → see geo.solve-right-triangle (owned by Geometry; Low).

**KA Trigonometry Unit 2 — Trigonometric functions.** (The unit-circle value table, radian conversions, and sign map are owned upstream — cross-references below; this unit's new grain is angle bookkeeping, all-quadrant evaluation, the reciprocal functions, sinusoid feature reads, and inverse trig at special values.)

**Unit-circle values at special angles** → see geo.exact-trig-values (owned by Geometry) — radian phrasing joins that entry's key families this pass, per its registry note (params extension recorded in the entry).
**Degrees → radians** → see alg2.degrees-to-radians (owned by Algebra 2).
**Radians → degrees** → see alg2.radians-to-degrees (owned by Algebra 2).
**Trig-function signs by quadrant (ASTC)** → see alg2.trig-sign-by-quadrant (owned by Algebra 2).

### trig.reference-angle — Reference angle of a rotation

Rating: Medium · Format: single-number
Why: One quadrant placement plus one subtraction against 180 or 360 — 3–5s.
Sample: What is the reference angle of 150°? → 30 · Rule: int-exact · Params: angles multiples of 5 in (90°, 360°) off the axes (Quadrant I inputs excluded — the answer is the angle itself, a giveaway family); answers ∈ [5, 85]; radian-posed variants are excluded — the kπ answer shape belongs to the fraction format and would split the key family (the skill is identical).
Kernels: [fk.subtraction-facts]

### trig.coterminal-angle — Coterminal angle in [0°, 360°)

Rating: Medium · Format: single-number
Why: One ±360 adjustment (occasionally two) — 3–5s with a 2–3 digit entry.
Sample: Which angle in [0°, 360°) is coterminal with 405°? → 45 · Rule: int-exact · Params: inputs multiples of 5 in [−720°, 1080°] excluding [0°, 360°) itself; at most two 360-steps needed; answers ∈ [0, 355].
Kernels: [fk.addition-facts, fk.subtraction-facts]

### trig.exact-trig-any-quadrant — Exact trig values beyond Quadrant I

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Two chained recalls — reference angle, then the ASTC sign — on top of the value table, 3–6s with a short-symbol option scan.
Sample: sin 150° = ? → 1/2 (options: 1/2 · −1/2 · √3/2 · −√3/2) · Rule: mc · Params: sin/cos/tan at special angles in Quadrants II–IV (150°, 210°, 315°, … and their radian forms 5π/6, 7π/6, …); 4 options pairing the two candidate magnitudes with both signs; the Quadrant I table itself is owned by geo.exact-trig-values and excluded here.
Kernels: [geo.exact-trig-values, trig.reference-angle, alg2.trig-sign-by-quadrant]

### trig.reciprocal-trig-value — Evaluate a reciprocal trig function

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One table recall plus one reciprocal flip — 3–5s with a short-symbol scan.
Sample: csc 30° = ? → 2 (options: 2 · 1/2 · √2 · 2√3/3) · Rule: mc · Params: csc/sec/cot over the special angles where the base function is nonzero; fixed option pools per function, rationalized forms shown (2√3/3, never 2/√3); 4 options, answer always present.
Kernels: [geo.exact-trig-values, prealg.fraction-divide]

### trig.amplitude-from-equation — Amplitude off a sinusoid's equation

Rating: High · Format: single-number
Why: One |a| read — pure read-off, ≤2s.
Sample: y = −3 sin(2x) + 1. Amplitude? → 3 · Rule: int-exact · Params: a nonzero integer ∈ [−9, 9]; the angular coefficient and vertical shift are decorative; sin and cos prompts balanced; answers always positive integers.
Kernels: [prealg.absolute-value]

### trig.midline-from-equation — Midline off a sinusoid's equation

Rating: High · Format: single-number
Why: One constant-term read with its sign — ≤2s.
Sample: y = 2 sin(3x) − 4. The midline is y = ? → -4 · Rule: int-exact · Params: vertical shifts nonzero integers ∈ [−9, 9] in both sign renderings; amplitude and angular coefficient decorative; negative answers carry the touch-minus-key caveat.
Kernels: No drillable kernel beyond entries already listed

### trig.period-from-equation — Period off a sinusoid's equation

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One rule application (period = 2π/b) reduced to lowest terms — 3–6s on the assumed fraction pad.
Sample: The period of y = sin(4x) is kπ. k = ? → 1/2 · Rule: frac-lowest-terms · Params: b ∈ {3, 4, 6, 8, 12} (b ∈ {1, 2} excluded — integer k is an answer-shape split); k = 2/b in lowest terms; sin and cos prompts balanced; the tangent family (period π/b) is a recorded separate key family if built.
Kernels: [prealg.simplify-fraction, fk.division-facts]

### trig.evaluate-inverse-trig — Inverse trig at special values

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One inverse table read constrained to the principal range — 3–6s with a short option scan.
Sample: arcsin(1/2) = ? → π/6 (options: π/6 · π/4 · π/3 · π/2) · Rule: mc · Params: arcsin/arccos/arctan over the special-value table, answers restricted to each function's principal range; negative inputs (arcsin(−1/2) = −π/6) form the stretch band; 4 options drawn from the special-angle pool.
Kernels: [geo.exact-trig-values]

### trig.graph-sinusoid — Graph a sinusoidal function

Rating: Low
Why: Inherently multi-step at any speed — extract amplitude, period, midline, and phase shift, then draw the curve; the output is a graph, which no input format hosts.
Kernels: [trig.amplitude-from-equation, trig.period-from-equation, trig.midline-from-equation, alg2.function-shift-direction]

**KA Trigonometry Unit 3 — Non-right triangles & trigonometry.**

### trig.triangle-area-sine — Triangle area from two sides and the included angle

Rating: Medium · Format: single-number
Why: One formula application (½ab sin C) that collapses to two products and a halving at special angles — Medium's upper half, 4–7s.
Sample: A triangle has sides 8 and 5 with a 30° included angle. Its area? → 10 · Rule: int-exact · Params: sides ∈ [2, 12] with ab even; included angle ∈ {30°, 90°, 150°} (sin = 1/2 or 1) so answers are positive integers ≤ 72; the 60°/120° band is excluded — irrational areas have no supported answer shape.
Kernels: [geo.exact-trig-values, fk.times-tables, fk.doubling-halving]

### trig.choose-triangle-law — Law of sines or law of cosines

Rating: Medium · Format: multiple-choice
Why: One configuration classification (what is given, what is asked) mapped to a memorized rule — 3–6s.
Sample: You know two sides and the included angle and want the third side. Which law applies? → Law of cosines (options: Law of sines · Law of cosines) · Rule: mc · Params: given-information templates over {ASA/AAS → sines, SAS/SSS → cosines, SSA → sines}; phrased both abstractly ("two angles and a side") and with concrete labeled values; families balanced 50/50.
Kernels: [geo.triangle-congruence-criteria]

### trig.law-of-sines-solve — Solve a triangle with the law of sines

Rating: Low
Why: Inherently multi-step at any speed — set up the sine ratio, cross-multiply, and evaluate (usually with a calculator) while holding the setup.
Kernels: [prealg.solve-proportion, geo.exact-trig-values, geo.triangle-angle-sum, trig.choose-triangle-law]

### trig.law-of-cosines-solve — Solve a triangle with the law of cosines

Rating: Low
Why: Inherently multi-step at any speed — assemble c² = a² + b² − 2ab cos C, evaluate each piece, combine, then take the root.
Kernels: [fk.perfect-squares, geo.exact-trig-values, prealg.square-root, trig.choose-triangle-law]

**KA Trigonometry Unit 4 — Trigonometric equations and identities.**

**Pythagorean identity (cos θ from sin θ with quadrant sign)** → see alg2.pythagorean-identity-apply (owned by Algebra 2).

### trig.tan-from-sin-cos — Tangent via the quotient identity

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One identity recall (tan = sin/cos) plus a fraction division that cancels the shared denominator — 3–6s.
Sample: sin θ = 3/5 and cos θ = 4/5. tan θ = ? → 3/4 · Rule: frac-lowest-terms · Params: sin/cos pairs from the primitive triples (3-4-5, 5-12-13, 8-15-17, 7-24-25), answers already in lowest terms; the signed band (Quadrant II–IV values) puts the sign on the numerator per the format spec; cot prompts share the params and key separately.
Kernels: [geo.trig-ratio-definition, prealg.fraction-divide]

### trig.trig-parity — Even/odd identities for trig functions

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: Pure parity recall (cos is even; sin and tan are odd) — ≤2s with a 4-option tap.
Sample: sin(−θ) = ? → −sin θ (options: sin θ · −sin θ · cos θ · −cos θ) · Rule: mc · Params: sin/cos/tan prompts balanced; fixed 4-option pool per function pairing ± of the same function and its cofunction.
Kernels: No drillable kernel beyond entries already listed

### trig.angle-sum-formula-recall — Angle addition formula recall

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Pure formula recall, but the four look-alike expansions force a careful option scan — 3–6s, and the scan is most of the budget.
Sample: sin(a + b) = ? → sin a cos b + cos a sin b (options: sin a cos b + cos a sin b · sin a cos b − cos a sin b · cos a cos b − sin a sin b · cos a cos b + sin a sin b) · Rule: mc · Params: sin(a ± b) and cos(a ± b) prompts balanced; the options are always the four expansions, so sign-and-function discrimination is the whole skill; double-angle forms (sin 2θ, cos 2θ) included as a = b phrasings in the stretch band.
Kernels: No drillable kernel beyond entries already listed

### trig.double-angle-evaluate — Evaluate sin 2θ from sin θ and cos θ

Rating: Medium · Format: fraction · Render: unicode-inline · Surface-sensitive
Why: One formula recall (2 sin θ cos θ) plus two held products — Medium's ceiling, 5–8s; flips to Low if fraction entry runs 2× slow, hence the marker.
Sample: sin θ = 3/5 and cos θ = 4/5. sin 2θ = ? → 24/25 · Rule: frac-lowest-terms · Params: sin/cos pairs from the primitive triples; answers 2ab/c² already in lowest terms by the triple's structure; the cos 2θ variant (cos²θ − sin²θ) shares params and keys separately.
Kernels: [trig.angle-sum-formula-recall, prealg.fraction-multiply]

### trig.solve-basic-trig-equation — Solve sin θ = k on [0°, 360°)

Rating: Medium · Format: two-numbers · Surface-sensitive
Why: One table inversion plus one reflection rule for the second solution — Medium's upper half, 5–8s with the pair entry; flips to Low at 2× entry time, hence the marker.
Sample: Solve sin θ = 1/2 for 0° ≤ θ < 360° — both solutions → 30, 150 · Rule: pair-unordered · Params: sin/cos/tan set equal to a ± special value; both solutions integer degree measures in [0, 360); single-solution and no-solution families (sin θ = 2) excluded — different answer shapes; equations needing algebraic isolation first are trig.solve-trig-equation-general grain (Low).
Kernels: [geo.exact-trig-values, trig.reference-angle, alg2.trig-sign-by-quadrant]

### trig.solve-trig-equation-general — Solve a general trig equation

Rating: Low
Why: Inherently multi-step at any speed — isolate the trig function (possibly factoring a trig quadratic first), invert at a reference angle, then enumerate solutions across quadrants and periods.
Kernels: [trig.solve-basic-trig-equation, alg1.factor-simple-quadratic, alg2.pythagorean-identity-apply]

### trig.prove-identity — Prove a trigonometric identity

Rating: Low
Why: Inherently multi-step at any speed — rewrite one side through a chain of identity substitutions toward the target form; the output is a derivation, which no input format hosts.
Kernels: [alg2.pythagorean-identity-apply, trig.tan-from-sin-cos, trig.trig-parity, trig.angle-sum-formula-recall]

**KA Precalculus Unit 1 — Composite and inverse functions.**

**Evaluating f(g(x)) at a point** → see alg2.evaluate-composite (owned by Algebra 2 via its OpenStax merge; the registry note recorded this cross-reference in advance).
**Inverse of a linear function** → see alg2.inverse-of-linear (owned by Algebra 2 via its OpenStax merge).

### trig.compose-functions-expression — Compose two functions symbolically

Rating: Medium · Format: short-expression
Why: One substitution and one distribute-and-collect held mentally, then a ~5-token entry — 4–7s.
Sample: f(x) = 2x + 1 and g(x) = x − 3. f(g(x)) = ? → 2x-5 · Rule: expr-commutative-ws · Params: outer linear ax + b with a ∈ [2, 5], b ∈ [1, 9]; inner x ± c with c ∈ [1, 9]; both composition orders asked; result coefficients nonzero ∈ [−20, 20]; answer alphabet {digits, x, +, −}.
Kernels: [alg2.evaluate-composite, alg1.distribute-linear, prealg.combine-like-terms]

### trig.verify-inverse-pair — Are two functions inverses

Rating: Medium · Format: true-false
Why: One composition check (does g undo f, structurally or at a test value?) — 3–6s; genuinely a verification judgment.
Sample: True or false: g(x) = (x − 3)/2 is the inverse of f(x) = 2x + 3 → true · Rule: tf · Params: f linear ax + b with a ∈ [2, 5], b ∈ [1, 9]; false cases flip a sign or swap a and b inside g (the classic near-miss); families balanced 50/50.
Kernels: [alg2.inverse-of-linear, alg2.evaluate-composite]

**KA Precalculus Unit 2 — Trigonometry.** Pure dedup, exactly as the checklist snapshot warns ("KA Precalc Unit 2 assumes the standalone Trigonometry course's foundations"): every lesson resolves to a Trigonometry-course entry above (inverse trig → trig.evaluate-inverse-trig; law of sines/cosines → trig.law-of-sines-solve, trig.law-of-cosines-solve, trig.choose-triangle-law; equations → trig.solve-basic-trig-equation, trig.solve-trig-equation-general; angle addition → trig.angle-sum-formula-recall, trig.double-angle-evaluate) or an earlier owner (alg2.pythagorean-identity-apply; geo.exact-trig-values). No new grain — see the disposition row; sinusoidal modeling is out-of-grain.

**KA Precalculus Unit 3 — Complex numbers.** (The arithmetic core is owned by Algebra 2 — the five registry-flagged cross-references below; this unit's new grain is the complex plane and the polar bridge.)

**Powers of i** → see alg2.imaginary-powers (owned by Algebra 2).
**Square root of a negative number** → see alg2.simplify-sqrt-negative (owned by Algebra 2).
**Adding and subtracting complex numbers** → see alg2.add-subtract-complex (owned by Algebra 2).
**Complex conjugates** → see alg2.complex-conjugate (owned by Algebra 2).
**Multiplying complex numbers** → see alg2.multiply-complex (owned by Algebra 2).
**Distance between complex numbers (as plane points)** → see geo.distance-formula (owned by Geometry).
**Midpoint of complex numbers (as plane points)** → see geo.midpoint-formula (owned by Geometry).

### trig.complex-quadrant — Quadrant of a complex number

Rating: High · Format: single-number
Why: One two-sign read on the a + bi form — the quadrant map in complex clothes, ≤2s.
Sample: Which quadrant of the complex plane contains 3 − 4i? (answer 1–4) → 4 · Rule: int-exact · Params: real and imaginary parts nonzero integers ∈ [−9, 9]; all four quadrants uniform; on-axis numbers excluded.
Kernels: [prealg.identify-quadrant]

### trig.complex-modulus — Modulus of a complex number

Rating: Medium · Format: single-number
Why: One √(a² + b²) triple recognition — the Pythagorean read in complex clothes, 3–6s.
Sample: |3 + 4i| = ? → 5 · Rule: int-exact · Params: (|a|, |b|, |z|) drawn from the Pythagorean triples (3-4-5, 5-12-13, 8-15-17, 7-24-25) and their ≤×3 multiples, signs free; answers ≤ 75. Also the canonical home of vector magnitude and the polar-form r-computation (registry note) — the same fact family, keyed together.
Kernels: [prealg.pythagorean-hypotenuse, geo.distance-formula]

### trig.complex-divide — Divide two complex numbers

Rating: Low
Why: Inherently multi-step at any speed — multiply numerator and denominator by the conjugate, expand both products, then reduce the resulting fraction.
Kernels: [alg2.complex-conjugate, alg2.multiply-complex, prealg.simplify-fraction]

### trig.complex-to-polar — Convert a complex number to polar form

Rating: Low
Why: Inherently multi-step at any speed — compute the modulus, find the reference angle, then place the argument by quadrant.
Kernels: [trig.complex-modulus, trig.reference-angle, geo.exact-trig-values, trig.complex-quadrant]

**KA Precalculus Unit 4 — Rational functions.**

**Simplifying rational expressions** → see alg1.simplify-rational-expression (owned by Algebra 1; Low).
**Solving rational equations** → see alg2.solve-rational-equation (owned by Algebra 2; Low).

### trig.vertical-asymptote — Vertical asymptote of a rational function

Rating: High · Format: single-number
Why: One denominator-zero read with a sign flip — ≤3s.
Sample: y = (x + 1)/(x − 3). Vertical asymptote at x = ? → 3 · Rule: int-exact · Params: denominators x − a with a nonzero ∈ [−9, 9] in both sign renderings; numerators share no factor with the denominator (shared factors are trig.identify-hole's family); negative answers carry the touch-minus-key caveat.
Kernels: [alg1.roots-from-factored-form]

### trig.horizontal-asymptote — Horizontal asymptote of a rational function

Rating: Medium · Format: single-number
Why: One degree comparison plus a leading-coefficient division — 3–6s.
Sample: y = (6x + 1)/(2x − 5). Horizontal asymptote at y = ? → 3 · Rule: int-exact · Params: equal-degree pairs with integer leading-coefficient ratios ∈ [−9, 9] excluding 0 (non-integer ratios excluded — answer-shape split), plus the lower-degree-numerator band (answer 0); the no-horizontal-asymptote case is excluded (no numeric answer shape); negative answers carry the touch-minus-key caveat. Also satisfies the limit-at-infinity rows of KA Precalc unit 10 — same read, per the registry note.
Kernels: [alg1.polynomial-degree, fk.division-facts]

### trig.identify-hole — Removable discontinuity from factored form

Rating: Medium · Format: single-number
Why: One common-factor spot across numerator and denominator plus a sign-flip read — 3–5s.
Sample: y = ((x − 2)(x + 5))/(x − 2). Hole at x = ? → 2 · Rule: int-exact · Params: both parts shown factored with exactly one shared linear factor, roots nonzero ∈ [−9, 9]; unfactored displays are excluded — factoring first pushes the chain to Low grain; negative answers carry the touch-minus-key caveat.
Kernels: [alg1.roots-from-factored-form]

### trig.graph-rational-function — Graph a rational function

Rating: Low
Why: Inherently multi-step at any speed — locate asymptotes, holes, and intercepts, then assemble the sketch; the output is a graph, which no input format hosts.
Kernels: [trig.vertical-asymptote, trig.horizontal-asymptote, trig.identify-hole, alg1.intercept-from-equation]

**KA Precalculus Unit 5 — Conic sections.** (Circles and the parabola focus/directrix are owned by Geometry — cross-references below; this unit's new grain is the ellipse/hyperbola feature reads, paying the Int 11 / A&T 12 deferrals recorded during the Algebra 2 pass.)

**Circle center from standard form** → see geo.circle-equation-read (owned by Geometry).
**Circle radius from standard form** → see geo.circle-radius-read (owned by Geometry).
**Circle features from general form** → see geo.circle-general-to-standard (owned by Geometry; Low).
**Parabola focus and directrix** → see geo.parabola-focus-directrix (owned by Geometry; Low).

### trig.ellipse-axes-read — Semi-axis lengths off an ellipse's standard form

Rating: Medium · Format: two-numbers · Render: needs-math-render
Why: Two square-root recalls plus a which-is-larger judgment — 3–6s with the pair entry; the stacked x²/a² form needs a math renderer.
Sample: x²/25 + y²/9 = 1 — semi-major, then semi-minor axis length → 5, 3 · Rule: pair-ordered · Params: denominators distinct perfect squares ∈ {4, …, 144} in both orientations (major axis on x or y); answers ∈ [2, 12].
Kernels: [prealg.square-root, fk.perfect-squares]

### trig.ellipse-foci-distance — Focal distance of an ellipse

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One formula application (c² = a² − b²) that collapses to a subtraction and a root recall — Medium's upper half, 4–7s.
Sample: x²/25 + y²/9 = 1. The foci are (±c, 0). c = ? → 4 · Rule: int-exact · Params: denominator pairs with a² − b² a perfect square — (b, c, a) Pythagorean-triple-structured (25 − 9 = 16); answers c ∈ [3, 12]. The hyperbola analog (c² = a² + b²) is a recorded separate key family — same move, opposite sign (see the disposition row).
Kernels: [fk.perfect-squares, fk.subtraction-facts, prealg.square-root]

### trig.hyperbola-asymptote-slope — Asymptote slope off a hyperbola's standard form

Rating: Medium · Format: fraction · Render: needs-math-render
Why: Two square-root recalls assembled into b/a — 3–6s on the assumed fraction pad.
Sample: x²/9 − y²/4 = 1. The positive asymptote slope? → 2/3 · Rule: frac-lowest-terms · Params: denominators perfect squares ∈ {4, …, 144} with the slope non-integer and already in lowest terms (integer slopes excluded — answer-shape split); the y-leading orientation (slope a/b) balanced in; the positive slope is always the one asked.
Kernels: [prealg.square-root, prealg.simplify-fraction]

### trig.classify-conic — Classify a conic from its equation

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One coefficient scan (signs and equality of the squared terms; a missing square) — 3–6s with a 4-option tap.
Sample: x² + 4y² = 16 is which conic? → Ellipse (options: Circle · Ellipse · Parabola · Hyperbola) · Rule: mc · Params: forms Ax² + Cy² + Dx + Ey = F with the four cases balanced (A = C circle; A ≠ C same-sign ellipse; opposite signs hyperbola; one square missing parabola); coefficients ∈ [−9, 9].
Kernels: No drillable kernel beyond entries already listed

**KA Precalculus Unit 6 — Vectors.**

**Scalar multiplication of a vector (component scaling)** → see geo.dilate-point (owned by Geometry — the identical component move in vector notation).

### trig.vector-add — Add two vectors componentwise

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: Two parallel signed additions plus the pair entry — Medium's floor, ~3–4s; the translate-a-point move in vector notation.
Sample: ⟨3, −2⟩ + ⟨1, 5⟩ = ? → 4, 3 · Rule: pair-ordered · Params: components nonzero integers ∈ [−9, 9]; subtraction prompts included; results ∈ [−18, 18]; negative components carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub, geo.translate-point]

### trig.vector-from-points — Vector between two points

Rating: Medium · Format: two-numbers
Why: Two coordinate subtractions (terminal minus initial, with the order trap) — 3–5s with the pair entry.
Sample: The vector from (1, 2) to (4, 6)? → 3, 4 · Rule: pair-ordered · Params: integer points ∈ [−9, 9]; components nonzero ∈ [−12, 12]; negative components carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

**Vector magnitude** → see trig.complex-modulus (owned by this section under KA Precalc unit 3 — the same √(a² + b²) fact family, keyed together per the registry note).

### trig.vector-direction-angle — Direction angle of a vector

Rating: Low
Why: Inherently multi-step at any speed — form the component ratio, invert the tangent, then adjust the angle for quadrant.
Kernels: [geo.trig-ratio-definition, trig.evaluate-inverse-trig, trig.reference-angle, prealg.identify-quadrant]

**KA Precalculus Unit 7 — Matrices.**

**Solving 2×2 linear systems (with or without matrix notation)** → see prealg.solve-2x2-system (owned by Pre-Algebra; Low).

### trig.matrix-add-entry — One entry of a matrix sum

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One position lookup plus one signed addition — Medium's floor, ~3–4s; the bracket layout needs a math renderer.
Sample: A = [3 −1; 2 5], B = [1 4; −2 0]. The row 1, column 2 entry of A + B? → 3 · Rule: int-exact · Params: 2×2 matrices with entries ∈ [−9, 9]; A + B and A − B prompts balanced; the scalar band (an entry of kA, k ∈ [2, 5]) keys separately; negative answers carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### trig.matrix-multiply-entry — One entry of a matrix product

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One row-times-column dot product — two signed products and an addition held mentally — Medium's upper half, 4–7s.
Sample: A = [2 1; 3 4], B = [5 0; −1 2]. The row 1, column 1 entry of AB? → 9 · Rule: int-exact · Params: 2×2 matrices with entries ∈ [−5, 5]; the asked position rotates; answers ∈ [−60, 60]; negative answers carry the touch-minus-key caveat.
Kernels: [fk.times-tables, fk.integer-mul-div, fk.integer-add-sub]

### trig.determinant-2x2 — Determinant of a 2×2 matrix

Rating: Medium · Format: single-number · Render: needs-math-render
Why: Two products and a subtraction (ad − bc) held mentally — 3–6s.
Sample: det [3 1; 4 2] = ? → 2 · Rule: int-exact · Params: entries ∈ [−9, 9]; answers ∈ [−99, 99], nonzero in the base band (the singular case joins the trig.matrix-inverse-2x2 story); negative answers carry the touch-minus-key caveat.
Kernels: [fk.times-tables, fk.integer-mul-div, fk.subtraction-facts]

### trig.matrix-product-defined — Is a matrix product defined

Rating: High · Format: true-false
Why: One inner-dimension match (columns of A = rows of B) — ≤3s; genuinely a verification judgment.
Sample: True or false: the product of a 2×3 matrix and a 3×4 matrix is defined → true · Rule: tf · Params: dimensions ∈ [1, 5]²; false cases mismatch the inner dimensions (outer-dimension distractors deliberate); the result-size variant ("…and the product is 2×4") shares the family; balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

### trig.matrix-inverse-2x2 — Inverse of a 2×2 matrix

Rating: Low
Why: Inherently multi-step at any speed — compute the determinant, swap and negate the entries, then divide all four by the determinant while holding every intermediate; the matrix answer shape also has no input format.
Kernels: [trig.determinant-2x2, prealg.simplify-fraction, fk.integer-mul-div]

**KA Precalculus Unit 8 — Probability and combinatorics.** (The whole computational core is owned by Algebra 2's OpenStax merge — the registry-flagged cross-references below; this unit's new grain is the counting principle and the Low counting-probability composite.)

**Probability of a simple event** → see alg2.simple-probability (owned by Algebra 2).
**Complement probability** → see alg2.complement-probability (owned by Algebra 2).
**Permutation counts** → see alg2.permutation-count (owned by Algebra 2).
**Factorials** → see alg2.factorial (owned by Algebra 2).
**Binomial coefficients / combinations** → see alg2.binomial-coefficient (owned by Algebra 2).
**Binomial theorem expansion** → see alg2.binomial-expansion (owned by Algebra 2; Low).
**Compound-event probability** → see alg2.compound-event-probability (owned by Algebra 2; Low).

### trig.multiplication-principle — Fundamental counting principle

Rating: Medium · Format: single-number
Why: One rule application (multiply the independent choice counts) plus prompt parse — 3–5s.
Sample: A menu has 3 mains and 4 sides. How many main-and-side combinations? → 12 · Rule: int-exact · Params: 2–3 independent stages with counts ∈ [2, 6]; products ≤ 120; contexts rotate (menus, outfits, codes) with the arithmetic shape fixed.
Kernels: [fk.times-tables]

### trig.probability-with-counting — Probability via combinatorial counting

Rating: Low
Why: Inherently multi-step at any speed — count favorable and total outcomes with combinatorial formulas, then assemble and reduce the probability fraction.
Kernels: [alg2.simple-probability, alg2.binomial-coefficient, alg2.permutation-count, trig.multiplication-principle]

**KA Precalculus Unit 9 — Series.** (Everything computable is owned by Algebra 2's OpenStax merge — cross-references below; the new grain is the convergence judgment.)

**Arithmetic series sums** → see alg2.arithmetic-series-sum (owned by Algebra 2).
**Finite geometric series sums** → see alg2.geometric-series-sum (owned by Algebra 2; Low).
**Infinite geometric series sums** → see alg2.infinite-geometric-sum (owned by Algebra 2).
**Sigma-notation evaluation** → see alg2.evaluate-sigma (owned by Algebra 2).

### trig.geometric-series-converges — Does a geometric series converge

Rating: High · Format: true-false
Why: One |r| < 1 judgment off an easy ratio read — ≤3s; genuinely a verification judgment.
Sample: True or false: 8 + 4 + 2 + 1 + … converges → true · Rule: tf · Params: ratios ∈ {±1/2, ±1/3, ±2/3, ±3/4, ±1, ±2, ±3/2}; series shown as 4 leading terms with integer or simple-fraction terms; |r| < 1 and |r| ≥ 1 cases balanced 50/50 (r = ±1 included as the trap).
Kernels: [alg1.next-term-geometric]

**KA Precalculus Unit 10 — Limits and continuity.**

### trig.limit-by-substitution — Limit by direct substitution

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One continuity recognition plus one substitute-and-evaluate — 3–6s.
Sample: lim (x → 2) of x² + 3x − 1 → 9 · Rule: int-exact · Params: polynomials of degree ≤ 2 with coefficients ∈ [−5, 5]; approach points ∈ [−4, 4]; answers ∈ [−40, 60]; negative answers carry the touch-minus-key caveat.
Kernels: [prealg.evaluate-expression, alg1.evaluate-function]

### trig.limit-removable-factor — Limit of a removable-singularity quotient

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One difference-of-squares recognition, a cancel, and a substitution — Medium's ceiling, 5–8s; the fluent shortcut ((x² − a²)/(x − a) → 2a at x = a) is the drill.
Sample: lim (x → 3) of (x² − 9)/(x − 3) → 6 · Rule: int-exact · Params: numerators x² − a² with a ∈ [2, 9], denominators x − a, approach point a; answers 2a ≤ 18; general factor-and-cancel quotients are excluded — factoring first pushes the chain to Low (trig.limit-by-rationalizing hosts the radical analog).
Kernels: [alg1.factor-difference-of-squares, prealg.evaluate-expression]

### trig.classify-discontinuity — Classify a discontinuity

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: One structural read (shared factor → removable; denominator zero alone → infinite; piecewise mismatch → jump) — 3–6s with a 3-option tap.
Sample: At x = 2, f(x) = ((x − 2)(x + 1))/(x − 2) has which type of discontinuity? → Removable (options: Removable · Jump · Infinite) · Rule: mc · Params: factored rational functions (removable vs infinite cases) and two-branch piecewise functions with a gap (jump cases); the three cases balanced; values ∈ [−9, 9].
Kernels: [trig.identify-hole, trig.vertical-asymptote]

### trig.continuity-at-point — Is a piecewise function continuous at the seam

Rating: Medium · Format: true-false · Render: needs-math-render
Why: Two branch evaluations at the boundary and a compare — Medium's upper half, 4–7s; genuinely a verification judgment.
Sample: f(x) = x + 1 for x < 2; f(x) = 2x − 1 for x ≥ 2. True or false: f is continuous at x = 2 → true · Rule: tf · Params: two linear branches with coefficients ∈ [1, 5], seam at x ∈ [−3, 3]; false cases miss by 1–3; families balanced 50/50.
Kernels: [alg1.evaluate-piecewise, alg1.evaluate-function]

**Limits at infinity of a rational function** → see trig.horizontal-asymptote (owned by this section under KA Precalc unit 4 — the same leading-term read, per the registry note).

### trig.limit-by-rationalizing — Limit requiring algebraic manipulation

Rating: Low
Why: Inherently multi-step at any speed — multiply by a conjugate (or clear a complex fraction), expand, cancel, then substitute, holding the chain throughout.
Kernels: [alg2.expand-conjugate-product, alg1.simplify-rational-expression, prealg.evaluate-expression]

**OpenStax cross-check merges — polar coordinates and parametric equations (Algebra & Trigonometry 2e ch. 10 / Precalculus 2e ch. 8).** The genuine diff beyond the four recorded deferrals: both cross-check books host polar coordinates and parametric equations in their trig-applications chapters, and **neither KA snapshot course contains them** (KA hosts them in AP Calculus BC territory — CED unit 9, which cross-references here per first-course-owns; satisfied in the BC pass). Merged below with source notes; the polar form of complex numbers was already handled under KA Precalc unit 3 (trig.complex-to-polar).

### trig.polar-to-rectangular — Polar → rectangular coordinates

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: Two special-value products ((r cos θ, r sin θ)) held in parallel — 4–7s with the pair entry. (source: OpenStax A&T 2e ch. 10 / Precalculus 2e ch. 8 — absent from both KA snapshot courses)
Sample: Convert (r, θ) = (2, 180°) to rectangular coordinates → -2, 0 · Rule: pair-ordered · Params: r ∈ [1, 9]; θ ∈ {0°, 90°, 180°, 270°} and radian equivalents (axis angles only — integer coordinates; the 30°/45°/60° band is excluded, irrational coordinates have no supported answer shape); negative coordinates carry the touch-minus-key caveat.
Kernels: [geo.exact-trig-values, fk.integer-mul-div]

### trig.parametric-evaluate — Evaluate a parametric point

Rating: Medium · Format: two-numbers
Why: Two parallel substitute-and-evaluate moves — 4–7s with the pair entry. (source: OpenStax A&T 2e ch. 10 / Precalculus 2e ch. 8 — absent from both KA snapshot courses)
Sample: x = 2t + 1, y = t². The point at t = 3? → 7, 9 · Rule: pair-ordered · Params: x(t) linear, y(t) linear or t², coefficients ∈ [1, 5]; t ∈ [−4, 4]; coordinates ∈ [−20, 20]; negative coordinates carry the touch-minus-key caveat.
Kernels: [prealg.evaluate-expression, alg1.evaluate-function]

### trig.eliminate-parameter — Eliminate the parameter

Rating: Low
Why: Inherently multi-step at any speed — solve one equation for t, substitute into the other, and simplify to a Cartesian equation. (source: OpenStax A&T 2e ch. 10 / Precalculus 2e ch. 8 — absent from both KA snapshot courses)
Kernels: [alg1.rearrange-formula-one-step, alg2.evaluate-composite, prealg.combine-like-terms]

### Trigonometry / Precalculus checklist disposition table

Every KA Trigonometry unit (4), every KA Precalculus unit (10), the four Algebra & Trigonometry 2e chapters deferred here by the Algebra 2 pass (7–10, each with an explicit payoff row), and every Precalculus 2e chapter (12) maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| KA Trig 1 Right triangles & trigonometry | fully cross-referenced: geo.trig-ratio-definition, geo.special-right-triangle, geo.trig-cofunction, geo.solve-right-triangle (Low), prealg.pythagorean-hypotenuse (all owned upstream); right-triangle word problems and modeling out-of-grain — no drillable content beyond kernels geo.trig-ratio-definition, geo.exact-trig-values |
| KA Trig 2 Trigonometric functions | trig.reference-angle, trig.coterminal-angle, trig.exact-trig-any-quadrant, trig.reciprocal-trig-value, trig.amplitude-from-equation, trig.midline-from-equation, trig.period-from-equation, trig.evaluate-inverse-trig, trig.graph-sinusoid (Low — pays the Algebra 2 KA 11 sinusoid deferral); unit circle → geo.exact-trig-values (radian phrasing joined this pass); radians → alg2.degrees-to-radians, alg2.radians-to-degrees; ASTC → alg2.trig-sign-by-quadrant; feature reads from drawn graphs out-of-grain: graph input; tangent graphs: recorded judgment — the period-π analog of trig.period-from-equation, a separate key family if built |
| KA Trig 3 Non-right triangles & trigonometry | trig.triangle-area-sine, trig.choose-triangle-law, trig.law-of-sines-solve (Low), trig.law-of-cosines-solve (Low); applied triangle word problems out-of-grain — no drillable content beyond kernels trig.choose-triangle-law, geo.exact-trig-values |
| KA Trig 4 Trigonometric equations and identities | trig.tan-from-sin-cos, trig.trig-parity, trig.angle-sum-formula-recall, trig.double-angle-evaluate, trig.solve-basic-trig-equation, trig.solve-trig-equation-general (Low), trig.prove-identity (Low); Pythagorean identity → alg2.pythagorean-identity-apply (owned by Algebra 2) |
| KA Precalc 1 Composite and inverse functions | trig.compose-functions-expression, trig.verify-inverse-pair; point evaluation → alg2.evaluate-composite, inverse of a linear function → alg2.inverse-of-linear (owned by Algebra 2); domain/range and invertibility-from-graph out-of-grain: interval answers are not in the format legend / graph reading — no drillable content beyond kernels alg2.evaluate-composite, alg2.inverse-of-linear |
| KA Precalc 2 Trigonometry | pure dedup (the snapshot's own note): inverse trig → trig.evaluate-inverse-trig; law of sines/cosines → trig.law-of-sines-solve, trig.law-of-cosines-solve, trig.choose-triangle-law; equations → trig.solve-basic-trig-equation, trig.solve-trig-equation-general; angle addition → trig.angle-sum-formula-recall, trig.double-angle-evaluate; identities → alg2.pythagorean-identity-apply, trig.prove-identity; values → geo.exact-trig-values, trig.exact-trig-any-quadrant; sinusoidal models out-of-grain: modeling — no drillable content beyond kernels trig.amplitude-from-equation, trig.period-from-equation, trig.midline-from-equation |
| KA Precalc 3 Complex numbers | trig.complex-quadrant, trig.complex-modulus, trig.complex-divide (Low), trig.complex-to-polar (Low); arithmetic → alg2.imaginary-powers, alg2.simplify-sqrt-negative, alg2.add-subtract-complex, alg2.complex-conjugate, alg2.multiply-complex (owned by Algebra 2); plane distance/midpoint → geo.distance-formula, geo.midpoint-formula (owned by Geometry); multiplying in polar form: recorded judgment — a Low-grain composite of trig.complex-to-polar and alg2.multiply-complex, no separate entry |
| KA Precalc 4 Rational functions | trig.vertical-asymptote, trig.horizontal-asymptote, trig.identify-hole, trig.graph-rational-function (Low); simplification → alg1.simplify-rational-expression (Low, owned by Algebra 1); equations → alg2.solve-rational-equation (Low, owned by Algebra 2); slant asymptotes: recorded judgment — requires polynomial long division (alg2.polynomial-long-division, Low) and an expression answer, no drillable read beyond it |
| KA Precalc 5 Conic sections | trig.ellipse-axes-read, trig.ellipse-foci-distance, trig.hyperbola-asymptote-slope, trig.classify-conic (pays the Int 11 / A&T 12 ellipse-hyperbola deferrals from the Algebra 2 pass); circles → geo.circle-equation-read, geo.circle-radius-read, geo.circle-general-to-standard (Low); parabola → geo.parabola-focus-directrix (Low) (owned by Geometry); hyperbola foci: recorded judgment — the same single-formula move as trig.ellipse-foci-distance with c² = a² + b², a separate key family if built |
| KA Precalc 6 Vectors | trig.vector-add, trig.vector-from-points, trig.vector-direction-angle (Low); magnitude → trig.complex-modulus (same √(a²+b²) family, owned under KA Precalc 3); scalar multiplication → geo.dilate-point (owned by Geometry); unit vectors: recorded judgment — fraction-component pairs are not in the format legend (two-numbers is integer-only); vector word problems out-of-grain: modeling — no drillable content beyond kernels trig.vector-add, trig.complex-modulus |
| KA Precalc 7 Matrices | trig.matrix-add-entry, trig.matrix-multiply-entry, trig.determinant-2x2, trig.matrix-product-defined, trig.matrix-inverse-2x2 (Low); systems via matrices → prealg.solve-2x2-system (Low, owned by Pre-Algebra); matrix transformations of the plane and whole-matrix answers out-of-grain: no matrix answer format — no drillable content beyond kernels trig.matrix-multiply-entry, trig.determinant-2x2 |
| KA Precalc 8 Probability and combinatorics | trig.multiplication-principle, trig.probability-with-counting (Low); the computational core → alg2.simple-probability, alg2.complement-probability, alg2.permutation-count, alg2.factorial, alg2.binomial-coefficient, alg2.binomial-expansion (Low), alg2.compound-event-probability (Low) (owned by Algebra 2) |
| KA Precalc 9 Series | trig.geometric-series-converges; sums → alg2.arithmetic-series-sum, alg2.geometric-series-sum (Low), alg2.infinite-geometric-sum, alg2.evaluate-sigma (owned by Algebra 2) |
| KA Precalc 10 Limits and continuity | trig.limit-by-substitution, trig.limit-removable-factor, trig.classify-discontinuity, trig.continuity-at-point, trig.limit-by-rationalizing (Low); limits at infinity of rationals → trig.horizontal-asymptote (same read, owned under KA Precalc 4); limits from graphs and tables out-of-grain: graph/table reading — no drillable content beyond kernels trig.limit-by-substitution, trig.continuity-at-point |
| A&T 7 The Unit Circle: Sine and Cosine Functions (deferred debt — **paid**) | paid by the KA Trig 2 set: geo.exact-trig-values (with the radian extension authored this pass), trig.reference-angle, trig.coterminal-angle, trig.exact-trig-any-quadrant, alg2.degrees-to-radians, alg2.radians-to-degrees |
| A&T 8 Periodic Functions (deferred debt — **paid**) | paid by: trig.amplitude-from-equation, trig.midline-from-equation, trig.period-from-equation, trig.graph-sinusoid (Low), trig.evaluate-inverse-trig, trig.reciprocal-trig-value |
| A&T 9 Trigonometric Identities and Equations (deferred debt — **paid**) | paid by the KA Trig 4 set (trig.tan-from-sin-cos, trig.trig-parity, trig.angle-sum-formula-recall, trig.double-angle-evaluate, trig.solve-basic-trig-equation, trig.solve-trig-equation-general, trig.prove-identity) plus alg2.pythagorean-identity-apply; half-angle and sum-to-product formulas: recorded judgment — Low-grain composites with no new kernel beyond trig.angle-sum-formula-recall, alg2.pythagorean-identity-apply |
| A&T 10 Further Applications of Trigonometry (deferred debt — **paid**) | paid by the KA Trig 3 set (laws of sines/cosines, triangle area) and the KA Precalc 6 vector set; merged beyond the deferral: trig.polar-to-rectangular, trig.parametric-evaluate, trig.eliminate-parameter (Low); polar form of complex numbers → trig.complex-to-polar (Low, KA Precalc 3); rectangular→polar r-computation → trig.complex-modulus (registry note) |
| Precalc 2e 1 Functions | covered: the Algebra 1 KA 8 / Algebra 2 KA 9 function sets plus alg2.evaluate-composite, alg2.inverse-of-linear, trig.compose-functions-expression, trig.verify-inverse-pair |
| Precalc 2e 2 Linear Functions | covered by the Algebra 1 KA 4/5 entry sets |
| Precalc 2e 3 Polynomial and Rational Functions | covered by the Algebra 2 KA 1/3/4/5 entry sets plus the KA Precalc 4 rational-function set |
| Precalc 2e 4 Exponential and Logarithmic Functions | covered by the Algebra 2 KA 7/8 entry sets |
| Precalc 2e 5 Trigonometric Functions | covered by the KA Trig 1 and KA Trig 2 rows (Geometry owners plus the trig.* unit-2 set) |
| Precalc 2e 6 Periodic Functions | covered by the A&T 8 payoff row |
| Precalc 2e 7 Trigonometric Identities and Equations | covered by the A&T 9 payoff row |
| Precalc 2e 8 Further Applications of Trigonometry | covered by the A&T 10 payoff row (including the polar/parametric merges) |
| Precalc 2e 9 Systems of Equations and Inequalities | covered: the Pre-Algebra/Algebra 1 systems owners (see the Algebra 2 Int 4 row) plus the KA Precalc 7 matrix set; partial fractions: recorded judgment — a Low-grain composite of alg2.solve-rational-equation and prealg.solve-2x2-system territory, no drillable kernel beyond those |
| Precalc 2e 10 Analytic Geometry | covered by the KA Precalc 5 conic set and its Geometry owners |
| Precalc 2e 11 Sequences, Probability and Counting Theory | covered by the Algebra 2 sequences/series/probability merge block (cross-referenced under KA Precalc 8/9) plus trig.multiplication-principle |
| Precalc 2e 12 Introduction to Calculus | covered by the KA Precalc 10 limit set; the derivative preview: recorded judgment — Calculus AB grain (CED units 1–2), deferred to that sweep |

---

## AP Calculus AB

Swept against AP Calculus CED Units 1–8, the calculus checklist of record. **There is no OpenStax cross-check for the calculus sections:** the document snapshots no OpenStax calculus TOC, and per the plan the AP CED is the sole named checklist here — recorded explicitly in the disposition table's cross-check row rather than silently omitted (the Geometry section's no-book row is the precedent). The section lands 44 records (8 High / 19 Medium / 17 Low) plus 8 cross-reference rows, and delivers the strongest Low→kernel extraction in the document, as the plan predicted: the derivative and antiderivative fact families minted under CED 2/3/6 (calcab.derivative-power-rule, calcab.derivative-standard-table, calcab.chain-rule-recall, calcab.antiderivative-power-rule, calcab.antiderivative-standard-table) are cited by nearly every Low entry below — the fast kernels the multi-step calculus problems decompose into — alongside citation traffic to earlier courses (exact trig values, the Algebra 1 factoring toolkit, equation solving, evaluation skills). CED Unit 1 is absorbed almost entirely by the five Trig/Precalc limit entries the registry pre-flagged for exactly this sweep, plus geo.exact-trig-values per its registry note — all flags updated to satisfied. The primary in-degree window (Foundational → Algebra 2) remains closed: every citation here counts toward the registry's full-range column only — expected post-Algebra 2 behavior, not a defect. No pinned calibration entries live here; ratings are calibrated against the pinned set — MC entries against geo.triangle-congruence-criteria, true-false entries against prealg.divisibility-rule-check / prealg.compare-fractions, short-expression entries against alg1.distribute-linear / alg1.factor-simple-quadratic, single-number entries against the prealg.gcd-two-numbers / prealg.lcm-two-numbers Medium pins and the fk.* High pins. **No new accepted-answer rules were needed:** derivative-expression answers ride the existing `expr-commutative-ws` short-expression rule (checked before considering a new rule — commutative term/factor reordering with no other rewrite is exactly the right acceptance for a derivative in standard form).

**CED Unit 1 — Limits and Continuity.** (The computational limit toolkit is owned by Trig/Precalc — the registry pre-flagged all five entries for this absorption; this unit's new grain is the two AP-specific judgments below.)

**Limits by direct substitution** → see trig.limit-by-substitution (owned by Trig/Precalc).
**Limits of removable-singularity quotients** → see trig.limit-removable-factor (owned by Trig/Precalc).
**Limits requiring conjugates or complex fractions** → see trig.limit-by-rationalizing (owned by Trig/Precalc; Low).
**Classifying discontinuities** → see trig.classify-discontinuity (owned by Trig/Precalc).
**Continuity at a piecewise seam** → see trig.continuity-at-point (owned by Trig/Precalc).
**Limits at infinity of rational functions** → see trig.horizontal-asymptote (owned by Trig/Precalc — the same leading-term read).
**Infinite limits / vertical asymptotes** → see trig.vertical-asymptote (owned by Trig/Precalc).
**Exact trig values at special angles** (cited throughout both calculus sections) → see geo.exact-trig-values (owned by Geometry — per its registry note).

### calcab.special-trig-limits — Special trig limits

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One recall of the sin x/x = 1 fact plus a coefficient read — 3–5s; the quotient display needs a math renderer.
Sample: lim (x → 0) of sin(5x)/x → 5 · Rule: int-exact · Params: families lim sin(ax)/x = a and lim sin(ax)/sin(bx) = a/b with a a multiple of b (integer answers only — the a/b fraction band is an answer-shape split and excluded); a, b ∈ [1, 9]; the lim (1 − cos x)/x = 0 family keys separately (answer always 0); answers ∈ [0, 9].
Kernels: [trig.limit-by-substitution, fk.division-facts]

### calcab.ivt-guarantees-zero — Does the IVT guarantee a zero

Rating: Medium · Format: true-false
Why: One hypothesis check (continuity stated?) plus one endpoint sign compare — 3–6s; genuinely a verification judgment.
Sample: True or false: f is continuous on [1, 4] with f(1) = −3 and f(4) = 2, so f must have a zero in (1, 4) → true · Rule: tf · Params: endpoint values nonzero integers ∈ [−9, 9]; true cases have opposite-sign endpoints with continuity stated; false cases keep same-sign endpoints (the IVT guarantees nothing) or drop the continuity hypothesis; families balanced 50/50.
Kernels: [trig.continuity-at-point]

**CED Unit 2 — Differentiation: Definition and Fundamental Properties.**

### calcab.derivative-power-rule — Power rule

Rating: High · Format: short-expression · Render: unicode-inline · Surface-sensitive
Why: Pure rule recall (bring the exponent down, drop it by one) with a 4-token answer ≈ 1s entry + Enter — High; flips to Medium at 2× entry time, hence the marker.
Sample: d/dx x⁵ → 5x^4 · Rule: expr-commutative-ws · Params: n ∈ [2, 9] (n = 1 and constants excluded — read-off giveaways); the negative- and fractional-exponent bands are excluded here (their rewritten forms 1/x and √x live in calcab.derivative-standard-table); answer alphabet {digits, x, ^}.
Kernels: No drillable kernel beyond entries already listed

### calcab.derivative-standard-table — Standard derivative table

Rating: High · Format: multiple-choice · Render: unicode-inline
Why: Pure table recall plus one tap — ≤3s; the option pool's sign flips and cofunction near-misses are the whole discrimination.
Sample: d/dx sin x = ? → cos x (options: cos x · −cos x · sin x · −sin x) · Rule: mc · Params: fact families d/dx of sin x, cos x, tan x, eˣ, ln x, plus the rewritten power-rule forms 1/x and √x; 4 options per family pairing the answer with its sign flip and the classic near-misses (tan x options: sec²x · sec x tan x · cot x · −sec²x); each function keys separately — the table rows are the fact family.
Kernels: [calcab.derivative-power-rule]

### calcab.derivative-at-point — Evaluate f′ at a point

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One rule application plus one substitute-and-evaluate held mentally — 3–6s.
Sample: f(x) = x³. f′(2) = ? → 12 · Rule: int-exact · Params: monomials axⁿ with a ∈ [1, 5], n ∈ [2, 4]; evaluation points ∈ [−3, 3]; answers ∈ [−99, 99]; negative answers carry the touch-minus-key caveat.
Kernels: [calcab.derivative-power-rule, prealg.evaluate-exponent, fk.times-tables]

### calcab.differentiate-polynomial — Differentiate a short polynomial

Rating: Medium · Format: short-expression · Render: unicode-inline
Why: Termwise rule application (two coefficient products; the constant drops) held mentally, then a ~4–6-token entry — 3–6s.
Sample: d/dx (3x² + 5x − 4) → 6x+5 · Rule: expr-commutative-ws · Params: polynomials of degree 2–3 with 3 terms, coefficients ∈ [1, 9]; result coefficients ≤ 27; answer alphabet {digits, x, ^, +, −}.
Kernels: [calcab.derivative-power-rule, fk.times-tables]

### calcab.product-quotient-rule-recall — Product and quotient rule recall

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Pure formula recall, but the four look-alike arrangements force a careful option scan — 3–6s (the angle-sum-formula precedent).
Sample: (fg)′ = ? → f′g + fg′ (options: f′g + fg′ · f′g − fg′ · f′g′ · f′g + fg) · Rule: mc · Params: product and quotient prompts balanced; quotient options permute numerator order and sign ((f′g − fg′)/g² vs (fg′ − f′g)/g² and the no-square distractor); the two rules key separately.
Kernels: No drillable kernel beyond entries already listed

### calcab.recognize-difference-quotient — Recognize a difference quotient

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: One structural recognition (this limit *is* f′) plus a table read — 3–6s.
Sample: lim (h → 0) of (sin(x + h) − sin x)/h = ? → cos x (options: cos x · sin x · −cos x · 0) · Rule: mc · Params: base functions from the standard table (sin x, cos x, eˣ, ln x, xⁿ); both forms (f(x + h) − f(x))/h and (f(x) − f(a))/(x − a) (the second band answers with f′(a) at a special value); the 0 distractor is fixed in every pool — mistaking the limit for plain substitution is the classic miss.
Kernels: [calcab.derivative-standard-table, calcab.derivative-power-rule]

### calcab.apply-product-rule — Differentiate a product

Rating: Low
Why: Inherently multi-step at any speed — differentiate both factors, assemble f′g + fg′, then collect like terms.
Kernels: [calcab.product-quotient-rule-recall, calcab.derivative-standard-table, calcab.derivative-power-rule, alg2.add-polynomials]

### calcab.tangent-line-equation — Equation of a tangent line

Rating: Low
Why: Inherently multi-step at any speed — evaluate f(a), differentiate, evaluate f′(a), then assemble the point-slope equation.
Kernels: [calcab.derivative-at-point, alg1.evaluate-function, alg1.write-line-equation]

**CED Unit 3 — Differentiation: Composite, Implicit, and Inverse Functions.**

### calcab.chain-rule-recall — Chain rule recall

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Pure formula recall with look-alike composite arrangements forcing the scan — 3–5s.
Sample: (f(g(x)))′ = ? → f′(g(x))·g′(x) (options: f′(g(x))·g′(x) · f′(x)·g′(x) · f′(g′(x)) · f′(g(x))) · Rule: mc · Params: fixed 4-option pool of the correct form and the three classic malformations (uncomposed product; derivative inside; missing inner factor).
Kernels: [alg2.evaluate-composite]

### calcab.chain-rule-linear-inner — Chain rule with a linear inner function

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One table recall plus one bring-the-coefficient-out application — 3–6s.
Sample: d/dx sin(3x) = ? → 3 cos 3x (options: 3 cos 3x · cos 3x · −3 cos 3x · 3 cos x) · Rule: mc · Params: outer function from the standard table (sin, cos, eˣ), inner ax with a ∈ [2, 9]; options permute the coefficient (missing/present), sign, and inner argument; each outer function keys separately; the ln(ax) family (derivative 1/x — the coefficient cancels) is the deliberate trap band.
Kernels: [calcab.derivative-standard-table, calcab.chain-rule-recall]

### calcab.derivative-inverse-trig-table — Inverse-trig derivative table

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Pure table recall, but the three derivatives and their negations are dense look-alikes — 3–6s of careful scan.
Sample: d/dx arctan x = ? → 1/(1 + x²) (options: 1/(1 + x²) · −1/(1 + x²) · 1/√(1 − x²) · −1/√(1 − x²)) · Rule: mc · Params: arcsin/arccos/arctan; fixed option pool drawn from the three table derivatives and their negations; each function keys separately.
Kernels: No drillable kernel beyond entries already listed

### calcab.second-derivative-power — Evaluate f″ at a point

Rating: Medium · Format: single-number · Render: unicode-inline
Why: Two rule applications collapse to one n(n − 1) product for a fluent student, plus an evaluation — Medium's upper half, 4–7s.
Sample: f(x) = x⁴. f″(1) = ? → 12 · Rule: int-exact · Params: monomials axⁿ with a ∈ [1, 3], n ∈ [3, 5]; evaluation points ∈ [−2, 2]; answers ∈ [−96, 96]; negative answers carry the touch-minus-key caveat.
Kernels: [calcab.derivative-power-rule, fk.times-tables, prealg.evaluate-exponent]

### calcab.implicit-differentiation — Implicit differentiation

Rating: Low
Why: Inherently multi-step at any speed — differentiate both sides with chain-rule bookkeeping on every y term, collect the dy/dx terms, then solve for dy/dx.
Kernels: [calcab.chain-rule-recall, calcab.derivative-power-rule, alg1.solve-equation-both-sides]

### calcab.derivative-inverse-function-value — Derivative of an inverse at a value

Rating: Low
Why: Inherently multi-step at any speed — find a with f(a) = b, compute f′(a), then take the reciprocal, holding each intermediate.
Kernels: [calcab.derivative-at-point, alg2.inverse-of-linear, prealg.fraction-divide]

**CED Unit 4 — Contextual Applications of Differentiation.**

### calcab.velocity-from-position — Velocity from a position function

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One contextual identification (v = s′) plus a differentiate-and-evaluate — Medium's upper half, 4–7s.
Sample: s(t) = t³ − 3t. The velocity at t = 2? → 9 · Rule: int-exact · Params: position polynomials of degree 2–3 with coefficients ∈ [1, 5]; t ∈ [1, 4]; the acceleration variant (a = s″) keys separately; answers ∈ [−60, 60]; negative answers carry the touch-minus-key caveat.
Kernels: [calcab.differentiate-polynomial, calcab.derivative-at-point]

### calcab.indeterminate-form-check — Verify an indeterminate form

Rating: Medium · Format: true-false · Render: needs-math-render
Why: Two substitution reads (numerator and denominator) plus a compare — 3–6s; genuinely a verification judgment, and the gate L'Hôpital's rule requires.
Sample: True or false: lim (x → 0) of (eˣ − 1)/x is a 0/0 indeterminate form → true · Rule: tf · Params: quotients built from polynomial, trig, exponential, and log pieces; true cases 0/0 or ∞/∞; false cases have a nonzero denominator limit or a finite/nonzero numerator over 0; families balanced 50/50.
Kernels: [trig.limit-by-substitution]

### calcab.lhopital-apply — Evaluate a limit by L'Hôpital's rule

Rating: Low
Why: Inherently multi-step at any speed — verify the indeterminate form, differentiate numerator and denominator separately, then re-evaluate the limit (sometimes more than once).
Kernels: [calcab.indeterminate-form-check, calcab.derivative-standard-table, calcab.differentiate-polynomial, trig.limit-by-substitution]

### calcab.related-rates — Related rates

Rating: Low
Why: Inherently multi-step at any speed — set up the geometric relation, differentiate implicitly with respect to time, substitute the snapshot values, then solve for the asked rate.
Kernels: [calcab.implicit-differentiation, calcab.chain-rule-recall, prealg.circle-area-pi, prealg.pythagorean-hypotenuse]

### calcab.linear-approximation — Tangent-line approximation

Rating: Low
Why: Inherently multi-step at any speed — evaluate f and f′ at the anchor, form the tangent line, then evaluate it at the nearby input.
Kernels: [calcab.derivative-at-point, alg1.write-line-equation, prealg.evaluate-expression]

**CED Unit 5 — Analytical Applications of Differentiation.**

### calcab.derivative-sign-read — Increasing or decreasing from f′

Rating: High · Format: true-false
Why: Pure sign-to-behavior recall (f′ > 0 means increasing) plus a single tap — ≤3s; genuinely a verification judgment.
Sample: True or false: if f′(3) = −2, then f is decreasing at x = 3 → true · Rule: tf · Params: f′ values nonzero integers ∈ [−9, 9]; increasing and decreasing claims crossed with both signs, balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

### calcab.concavity-sign-read — Concavity from f″

Rating: High · Format: true-false
Why: Pure sign-to-shape recall (f″ > 0 means concave up) plus a single tap — ≤3s.
Sample: True or false: if f″(1) = 4, the graph of f is concave up at x = 1 → true · Rule: tf · Params: f″ values nonzero integers ∈ [−9, 9]; concave-up and concave-down claims crossed with both signs, balanced 50/50.
Kernels: No drillable kernel beyond entries already listed

### calcab.second-derivative-test-read — Second-derivative test

Rating: High · Format: multiple-choice
Why: One memorized sign map (f′ = 0 with f″ < 0 is a max) plus a tap — ≤3s with a 3-option scan.
Sample: f′(2) = 0 and f″(2) = −3. At x = 2, f has ? → Local maximum (options: Local maximum · Local minimum · Neither/inconclusive) · Rule: mc · Params: f″ values nonzero ∈ [−9, 9] for the max/min families; the f″ = 0 inconclusive case forms its own stretch band; fixed 3 options.
Kernels: [calcab.concavity-sign-read]

### calcab.critical-point-quadratic — Critical point of a quadratic

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One mental differentiation and one linear solve, collapsing to x = −b/2a (the axis-of-symmetry read in calculus clothes) — 3–6s.
Sample: f(x) = x² − 6x + 1. Critical point at x = ? → 3 · Rule: int-exact · Params: quadratics ax² + bx + c with a ∈ [1, 4], b chosen so −b/2a is an integer ∈ [−9, 9]; c decorative; negative answers carry the touch-minus-key caveat.
Kernels: [calcab.differentiate-polynomial, prealg.solve-one-step-equation, alg1.axis-of-symmetry]

### calcab.mvt-apply — Find the Mean Value Theorem's c

Rating: Low
Why: Inherently multi-step at any speed — compute the average rate over the interval, differentiate, set the two equal, then solve.
Kernels: [alg1.slope-two-points, calcab.differentiate-polynomial, prealg.solve-two-step-equation]

### calcab.find-inflection-points — Find inflection points

Rating: Low
Why: Inherently multi-step at any speed — differentiate twice, solve f″ = 0, then confirm the concavity sign actually changes.
Kernels: [calcab.differentiate-polynomial, prealg.solve-two-step-equation, calcab.concavity-sign-read]

### calcab.absolute-extrema-closed-interval — Absolute extrema on a closed interval

Rating: Low
Why: Inherently multi-step at any speed — the candidates test: find critical points, evaluate f at each and at both endpoints, then compare the list.
Kernels: [calcab.critical-point-quadratic, calcab.differentiate-polynomial, alg1.evaluate-function]

### calcab.optimization — Applied optimization

Rating: Low
Why: Inherently multi-step at any speed — model the quantity, reduce to one variable, differentiate, find and classify the critical point, then answer the asked variant.
Kernels: [calcab.critical-point-quadratic, calcab.second-derivative-test-read, alg1.evaluate-function]

**CED Unit 6 — Integration and Accumulation of Change.**

### calcab.antiderivative-power-rule — Antiderivative power rule

Rating: High · Format: single-number · Render: needs-math-render
Why: Pure inverse-rule recall (raise the exponent, divide by it) — ≤3s with a 1-digit entry; asking for the shared exponent-and-divisor n keeps the answer a single integer.
Sample: ∫x⁴ dx = xⁿ/n + C. n = ? → 5 · Rule: int-exact · Params: integrand exponents ∈ [1, 8] (the exponent–divisor coincidence of the pure power family is the point); the coefficient variant ∫axⁿ dx keys separately and still asks for n only; answers ∈ [2, 9].
Kernels: [calcab.derivative-power-rule]

### calcab.antiderivative-standard-table — Standard antiderivative table

Rating: High · Format: multiple-choice · Render: needs-math-render
Why: Pure inverse-table recall plus one tap — ≤3s; the sign flips in the option pool are the whole discrimination.
Sample: ∫cos x dx = ? → sin x + C (options: sin x + C · −sin x + C · cos x + C · −cos x + C) · Rule: mc · Params: table families ∫sin x, ∫cos x, ∫eˣ, ∫1/x, ∫sec²x; 4 options per family pairing the answer with sign flips and cofunction near-misses; each family keys separately.
Kernels: [calcab.derivative-standard-table]

### calcab.ftc-derivative-of-accumulation — Derivative of an accumulation function

Rating: High · Format: short-expression · Render: needs-math-render · Surface-sensitive
Why: Pure rule recall (FTC part 1 — swap t for x) with a ~3-token entry — High; flips to Medium at 2× entry time, hence the marker.
Sample: g(x) = ∫₂ˣ t³ dt. g′(x) = ? → x^3 · Rule: expr-commutative-ws · Params: integrands tⁿ (n ∈ [2, 5]) and 2-term polynomials in t; lower bound decorative ∈ [0, 5]; the chain-rule upper-bound variant (upper limit x², a composite) is Low grain and excluded; answer alphabet {digits, x, ^, +, −}.
Kernels: No drillable kernel beyond entries already listed

### calcab.definite-integral-power — Evaluate a one-term definite integral

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One antiderivative recall plus an endpoint evaluation (and a subtraction in the offset band) — Medium's upper half, 4–7s.
Sample: ∫₀² 3x² dx = ? → 8 · Rule: int-exact · Params: integrands axⁿ with a a multiple of n + 1 (integer antiderivative coefficients); bounds integers ∈ [0, 4], zero lower bound in the base band (nonzero lower bounds form the subtract band); answers ∈ [1, 99].
Kernels: [calcab.antiderivative-power-rule, prealg.evaluate-exponent, fk.subtraction-facts]

### calcab.integral-additivity — Definite-integral properties

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One property recall (adjacent intervals add; reversal negates; constants factor) plus one signed operation — Medium's floor, ~3–4s.
Sample: ∫₁³ f(x) dx = 5 and ∫₃⁷ f(x) dx = 2. ∫₁⁷ f(x) dx = ? → 7 · Rule: int-exact · Params: given values integers ∈ [−9, 9]; families: adjacent-interval additivity, bound reversal (∫₇¹ from ∫₁⁷), and constant-multiple ∫kf with k ∈ [2, 5], each keyed separately; answers ∈ [−45, 45]; negative answers carry the touch-minus-key caveat.
Kernels: [fk.integer-add-sub]

### calcab.riemann-sum-compute — Compute a Riemann sum

Rating: Low
Why: Inherently multi-step at any speed — evaluate f at each sample point, multiply by the widths, and accumulate the running sum.
Kernels: [alg1.evaluate-function, fk.times-tables, fk.addition-facts]

### calcab.u-substitution — Integrate by u-substitution

Rating: Low
Why: Inherently multi-step at any speed — choose u, transform the integrand and differential (and bounds, if definite), integrate, then back-substitute.
Kernels: [calcab.antiderivative-standard-table, calcab.antiderivative-power-rule, calcab.chain-rule-recall]

**CED Unit 7 — Differential Equations.** (The BC-only topics of this unit — Euler's method and the logistic model — are recorded in the BC-only section's extension block.)

### calcab.verify-de-solution — Verify a differential-equation solution

Rating: Medium · Format: true-false · Render: unicode-inline
Why: One differentiate-and-compare held mentally — 3–6s; genuinely a verification judgment.
Sample: True or false: y = e³ˣ satisfies y′ = 3y → true · Rule: tf · Params: candidates Ceᵏˣ against y′ = ky, and sin kx / cos kx against y″ = −k²y (keyed separately); k ∈ [−5, 5] nonzero; false cases flip a sign or offset the coefficient by 1–2; families balanced 50/50.
Kernels: [calcab.chain-rule-linear-inner, calcab.derivative-standard-table]

### calcab.exponential-de-solution — General solution of y′ = ky

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: One memorized solution shape (y = Ceᵏᵗ) plus a scan of the two classic traps — 3–5s.
Sample: The general solution of dy/dt = 5y? → y = Ce⁵ᵗ (options: y = Ce⁵ᵗ · y = Ce⁻⁵ᵗ · y = 5eᵗ + C · y = e⁵ᵗ + C) · Rule: mc · Params: k nonzero ∈ [−9, 9]; the fixed option pool probes the sign of k and where C sits (factor vs added constant).
Kernels: [calcab.chain-rule-linear-inner]

### calcab.solve-separable-de — Solve a separable differential equation

Rating: Low
Why: Inherently multi-step at any speed — separate the variables, integrate both sides, fit the constant to the initial condition, then isolate y.
Kernels: [calcab.antiderivative-power-rule, calcab.antiderivative-standard-table, alg2.natural-log-facts, prealg.solve-one-step-equation]

**CED Unit 8 — Applications of Integration.** (The BC-only arc-length topic is recorded in the BC-only section's extension block.)

### calcab.average-value-from-integral — Average value from a given integral

Rating: Medium · Format: single-number · Render: needs-math-render
Why: One formula recall (1/(b − a) times the integral) collapsing to a single division — 3–5s.
Sample: ∫₁⁵ f(x) dx = 12. The average value of f on [1, 5]? → 3 · Rule: int-exact · Params: interval widths ∈ [2, 9]; integral values chosen so answers are integers ∈ [−12, 12]; negative answers carry the touch-minus-key caveat.
Kernels: [fk.division-facts, fk.subtraction-facts]

### calcab.position-from-velocity-simple — Position from velocity and an initial value

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One antiderivative recall, one evaluation, one addition — Medium's upper half, 4–7s.
Sample: v(t) = 2t and s(0) = 3. s(2) = ? → 7 · Rule: int-exact · Params: v linear or one-term quadratic with integer antiderivative values; t ∈ [1, 3]; initial values ∈ [−9, 9]; answers ∈ [−40, 40]; negative answers carry the touch-minus-key caveat.
Kernels: [calcab.antiderivative-power-rule, prealg.evaluate-expression, fk.integer-add-sub]

### calcab.area-between-curves — Area between curves

Rating: Low
Why: Inherently multi-step at any speed — find the intersections, subtract the functions the right way around, then integrate the difference.
Kernels: [alg1.solve-quadratic-by-factoring, alg2.add-polynomials, calcab.definite-integral-power]

### calcab.volume-disk-washer — Volumes by disks and washers

Rating: Low
Why: Inherently multi-step at any speed — set up π∫(R² − r²), square the radius functions, then integrate and evaluate.
Kernels: [calcab.definite-integral-power, alg2.expand-binomial-square, prealg.circle-area-pi]

### calcab.volume-cross-sections — Volumes by known cross-sections

Rating: Low
Why: Inherently multi-step at any speed — express the cross-sectional area from the base region, then integrate it along the axis.
Kernels: [calcab.definite-integral-power, prealg.area-triangle, fk.perfect-squares]

### AP Calculus AB checklist disposition table

Every AB CED unit (1–8) plus the no-OpenStax cross-check row maps to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| CED 1 Limits and Continuity | calcab.special-trig-limits, calcab.ivt-guarantees-zero; the core limit toolkit → trig.limit-by-substitution, trig.limit-removable-factor, trig.limit-by-rationalizing (Low), trig.classify-discontinuity, trig.continuity-at-point (owned by Trig/Precalc — the registry's pre-flagged absorption, satisfied); limits at infinity → trig.horizontal-asymptote; infinite limits → trig.vertical-asymptote; squeeze theorem: recorded judgment — a bounding argument whose one drill-shaped instance is calcab.special-trig-limits; estimating limits from graphs and tables out-of-grain: graph/table reading — no drillable content beyond kernels trig.limit-by-substitution |
| CED 2 Differentiation: Definition and Fundamental Properties | calcab.derivative-power-rule, calcab.derivative-standard-table, calcab.derivative-at-point, calcab.differentiate-polynomial, calcab.product-quotient-rule-recall, calcab.recognize-difference-quotient, calcab.apply-product-rule (Low), calcab.tangent-line-equation (Low); differentiability-implies-continuity: recorded judgment — concept vocabulary with no fact family |
| CED 3 Differentiation: Composite, Implicit, and Inverse Functions | calcab.chain-rule-recall, calcab.chain-rule-linear-inner, calcab.derivative-inverse-trig-table, calcab.second-derivative-power, calcab.implicit-differentiation (Low), calcab.derivative-inverse-function-value (Low) |
| CED 4 Contextual Applications of Differentiation | calcab.velocity-from-position, calcab.indeterminate-form-check, calcab.lhopital-apply (Low), calcab.related-rates (Low), calcab.linear-approximation (Low); interpreting the derivative in context out-of-grain: modeling prose — no drillable content beyond kernels calcab.velocity-from-position, calcab.derivative-sign-read |
| CED 5 Analytical Applications of Differentiation | calcab.derivative-sign-read, calcab.concavity-sign-read, calcab.second-derivative-test-read, calcab.critical-point-quadratic, calcab.mvt-apply (Low), calcab.find-inflection-points (Low), calcab.absolute-extrema-closed-interval (Low), calcab.optimization (Low); Extreme Value Theorem: recorded judgment — an existence guarantee with no computation; curve sketching and derivative-graph reading out-of-grain: graph input/output — no drillable content beyond kernels calcab.derivative-sign-read, calcab.concavity-sign-read, calcab.critical-point-quadratic |
| CED 6 Integration and Accumulation of Change | calcab.antiderivative-power-rule, calcab.antiderivative-standard-table, calcab.ftc-derivative-of-accumulation, calcab.definite-integral-power, calcab.integral-additivity, calcab.riemann-sum-compute (Low), calcab.u-substitution (Low); integrands needing long division or completing the square: recorded judgment — Low-grain composites of alg2.polynomial-long-division / alg1.complete-the-square and the antiderivative tables, no new kernel; accumulation-of-change word problems out-of-grain: modeling — no drillable content beyond kernels calcab.definite-integral-power, calcab.integral-additivity; BC-only techniques (integration by parts, partial fractions, improper integrals) → the BC-only section's extension block |
| CED 7 Differential Equations | calcab.verify-de-solution, calcab.exponential-de-solution, calcab.solve-separable-de (Low); slope fields out-of-grain: graph input/output — no drillable content beyond kernels calcab.verify-de-solution; BC-only topics (Euler's method, logistic model) → the BC-only section's extension block |
| CED 8 Applications of Integration | calcab.average-value-from-integral, calcab.position-from-velocity-simple, calcab.area-between-curves (Low), calcab.volume-disk-washer (Low), calcab.volume-cross-sections (Low); displacement vs total distance: recorded judgment — a sign-analysis composite of calcab.position-from-velocity-simple and calcab.derivative-sign-read, no separate entry; BC-only arc length → the BC-only section's extension block |
| Cross-check — OpenStax | recorded: the document snapshots no OpenStax calculus TOC — per the plan, the AP CED is the sole checklist for the calculus sections, so there is no TOC diff to run; recorded here explicitly rather than silently omitted (the Geometry no-book row is the precedent) |

---

## BC-only

Swept against AP Calculus CED Units 9–10, the BC-only units — plus a clearly labeled **extension block** for the topics the CED marks BC-only *inside* the shared units (integration by parts, partial fractions, and improper integrals in unit 6; Euler's method and the logistic model in unit 7; arc length in unit 8): the checklist snapshot is unit-grain, so recording these here keeps "nothing dropped" honest without re-sweeping units the AB section owns. The same no-OpenStax condition as the AB section applies and is recorded in the cross-check row. The section lands 26 records (3 High / 15 Medium / 8 Low) plus 9 cross-reference rows. **This pass pays every remaining registry forward-flag:** the polar/parametric merge block the Trig/Precalc pass minted for exactly this sweep (trig.polar-to-rectangular, trig.parametric-evaluate, trig.eliminate-parameter — cross-referenced under CED 9), trig.geometric-series-converges, and **alg2.infinite-geometric-sum's BC clause** — the oldest outstanding flag in the registry, recorded during the Algebra 2 pass — all updated to satisfied. Series-convergence facts are the marquee fact-family territory the plan predicted: the p-series and ratio-test threshold reads below are pure-recall drills that the Low series composites (interval of convergence, Taylor construction, error bounds) cite as their fast kernels. Citations count toward the full-range registry column only (the primary window closed at Algebra 2 — expected). No pinned calibration entries live here; ratings are calibrated against the pinned set — true-false entries against prealg.divisibility-rule-check / prealg.compare-fractions, MC entries against geo.triangle-congruence-criteria, fraction entries against prealg.simplify-fraction / prealg.fraction-add-unlike, two-number entries against alg1.read-slope-intercept / alg1.factor-pairs-sum-product. No new accepted-answer rules were needed.

**CED Unit 9 — Parametric Equations, Polar Coordinates, and Vector-Valued Functions.** (The precalculus substrate is owned by Trig/Precalc — its OpenStax merge block was minted for this sweep; this unit's new grain is the calculus on top of it.)

**Evaluating a parametric point at t** → see trig.parametric-evaluate (owned by Trig/Precalc).
**Eliminating the parameter** → see trig.eliminate-parameter (owned by Trig/Precalc; Low).
**Polar ↔ rectangular conversion** → see trig.polar-to-rectangular (owned by Trig/Precalc).
**Vector addition and subtraction** → see trig.vector-add (owned by Trig/Precalc).
**Speed / magnitude of a velocity vector** → see trig.complex-modulus (owned by Trig/Precalc — the same √(a² + b²) fact family, per its registry note).

### calcbc.parametric-slope-formula-recall — Parametric slope formula

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: Pure formula recall, but the reciprocal look-alike forces a careful scan — 3–5s.
Sample: For x = x(t), y = y(t), dy/dx = ? → (dy/dt)/(dx/dt) (options: (dy/dt)/(dx/dt) · (dx/dt)/(dy/dt) · (dy/dt)·(dx/dt) · dy/dt − dx/dt) · Rule: mc · Params: fixed 4-option pool — the correct quotient, its reciprocal, the product, and the difference malformation.
Kernels: No drillable kernel beyond entries already listed

### calcbc.vector-derivative-evaluate — Derivative of a vector-valued function at t

Rating: Medium · Format: two-numbers · Render: unicode-inline
Why: Two parallel differentiate-and-evaluate moves plus the pair entry — 4–7s.
Sample: r(t) = ⟨t², 3t⟩. r′(1) = ? → 2, 3 · Rule: pair-ordered · Params: components polynomial of degree ≤ 3 with coefficients ∈ [1, 5]; t ∈ [−2, 3]; the second-derivative variant r″ keys separately; components of the answer integers ∈ [−20, 20]; negative components carry the touch-minus-key caveat.
Kernels: [calcab.derivative-power-rule, calcab.derivative-at-point]

### calcbc.polar-area-formula-recall — Polar area formula

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: Pure formula recall; the ½ and the square are exactly what the look-alike options probe — 3–5s.
Sample: The area swept by r = f(θ) from θ = α to θ = β is ? → ½∫r² dθ (options: ½∫r² dθ · ∫r² dθ · ½∫r dθ · 2π∫r dθ) · Rule: mc · Params: fixed 4-option pool permuting the ½ factor and the power of r (the shell-formula look-alike included).
Kernels: No drillable kernel beyond entries already listed

### calcbc.parametric-slope-at-point — Parametric slope at a point

Rating: Low
Why: Inherently multi-step at any speed — differentiate both components, form the quotient, then evaluate at the given t while holding both derivatives.
Kernels: [calcbc.parametric-slope-formula-recall, calcab.derivative-at-point, prealg.simplify-fraction]

### calcbc.second-derivative-parametric — Parametric second derivative

Rating: Low
Why: Inherently multi-step at any speed — differentiate dy/dx with respect to t, then divide by dx/dt again, holding the chain throughout.
Kernels: [calcbc.parametric-slope-formula-recall, calcab.chain-rule-recall, alg1.simplify-rational-expression]

### calcbc.polar-area-compute — Compute a polar-region area

Rating: Low
Why: Inherently multi-step at any speed — set up ½∫r², expand the square (with an identity where the integrand demands it), integrate, then evaluate the bounds.
Kernels: [calcbc.polar-area-formula-recall, calcab.definite-integral-power, alg2.expand-binomial-square, alg2.pythagorean-identity-apply]

**CED Unit 10 — Infinite Sequences and Series.** (Geometric-series convergence and sums are owned upstream — the flagged cross-references below, including alg2.infinite-geometric-sum's BC clause; this unit's new grain is the convergence-test fact families and the Taylor/Maclaurin machinery.)

**Convergence of a geometric series** → see trig.geometric-series-converges (owned by Trig/Precalc — registry flag satisfied).
**Sum of a convergent infinite geometric series** → see alg2.infinite-geometric-sum (owned by Algebra 2 — the BC clause its registry note carried since the Algebra 2 pass, satisfied here).
**Finite geometric partial sums** → see alg2.geometric-series-sum (owned by Algebra 2; Low).
**Limit of a rational sequence** → see trig.horizontal-asymptote (owned by Trig/Precalc — the same leading-term read, per its registry note).

### calcbc.p-series-converges — p-series convergence

Rating: High · Format: true-false
Why: One p-read against the memorized p > 1 line — ≤3s; genuinely a verification judgment.
Sample: True or false: 1 + 1/4 + 1/9 + 1/16 + ⋯ converges → true · Rule: tf · Params: p-series shown as 4 expanded terms with p ∈ {1/2, 1, 2, 3} (the harmonic p = 1 is the marquee false case); geometric look-alikes excluded — owned by trig.geometric-series-converges; families balanced 50/50.
Kernels: [fk.perfect-squares]

### calcbc.ratio-test-read — Ratio-test threshold

Rating: High · Format: multiple-choice
Why: One memorized threshold read (L < 1 converges, L > 1 diverges, L = 1 says nothing) plus a tap — ≤3s.
Sample: The ratio test gives L = 1/2 for a series. The conclusion? → Converges absolutely (options: Converges absolutely · Diverges · Test is inconclusive) · Rule: mc · Params: L ∈ {0, 1/3, 1/2, 2/3, 1, 3/2, 2, ∞} spanning all three zones (L = 1 is the trap); fixed 3 options.
Kernels: No drillable kernel beyond entries already listed

### calcbc.nth-term-test — nth-term divergence test

Rating: Medium · Format: true-false
Why: One term-limit read plus the test's one-way logic (it can only prove divergence) — 3–6s.
Sample: True or false: 1/2 + 2/3 + 3/4 + 4/5 + ⋯ diverges → true · Rule: tf · Params: true cases have term limit ≠ 0 (rational terms with equal degrees); false cases claim the test *proves convergence* for terms → 0 (it never does) or claim divergence where the terms do vanish; families balanced 50/50.
Kernels: [trig.horizontal-asymptote]

### calcbc.alternating-series-converges — Alternating series test

Rating: Medium · Format: true-false · Render: unicode-inline
Why: Two quick condition checks (magnitudes decrease; terms → 0) — 3–6s; genuinely a verification judgment.
Sample: True or false: 1 − 1/2 + 1/3 − 1/4 + ⋯ converges → true · Rule: tf · Params: alternating series shown as 4 expanded terms; true cases have decreasing magnitudes with limit 0; false cases break one condition (terms ↛ 0, or magnitudes not decreasing); families balanced 50/50.
Kernels: [calcbc.nth-term-test]

### calcbc.choose-convergence-test — Choose the convergence test

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: One structural classification against memorized cues (factorials → ratio; 1/nᵖ → p-series; (−1)ⁿ → alternating; rⁿ → geometric) — 3–6s; the trig.choose-triangle-law of series.
Sample: Which test settles Σ n/3ⁿ? → Ratio test (options: Ratio test · p-series test · Alternating series test · Geometric series test) · Rule: mc · Params: series templates keyed to their canonical test (factorial/mixed exponential terms → ratio; pure 1/nᵖ → p-series; alternating-sign → alternating; pure rⁿ → geometric); fixed 4 options; templates where two tests apply equally are excluded.
Kernels: [calcbc.p-series-converges, trig.geometric-series-converges, calcbc.ratio-test-read]

### calcbc.absolute-conditional-classify — Absolute vs conditional convergence

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Two chained convergence reads (the series; then its absolute-value version) — Medium's upper half, 4–7s.
Sample: Σ (−1)ⁿ⁺¹/n is ? → Conditionally convergent (options: Absolutely convergent · Conditionally convergent · Divergent) · Rule: mc · Params: the three classic families balanced — alternating harmonic (conditional), alternating p > 1 (absolute), alternating with terms ↛ 0 (divergent); fixed 3 options.
Kernels: [calcbc.p-series-converges, calcbc.alternating-series-converges, calcbc.nth-term-test]

### calcbc.maclaurin-table-recall — Maclaurin series table

Rating: Medium · Format: multiple-choice · Render: unicode-inline
Why: Pure table recall, but the look-alike expansions force a term-pattern scan (factorials? alternating? odd powers?) — 3–6s.
Sample: 1 + x + x²/2! + x³/3! + ⋯ is the Maclaurin series of ? → eˣ (options: eˣ · sin x · cos x · 1/(1 − x)) · Rule: mc · Params: the four table series (eˣ, sin x, cos x, 1/(1 − x)) asked in both directions — series shown, name the function (as sampled) and function shown, pick the expansion; each direction keys separately; fixed 4-option pool.
Kernels: [alg2.factorial]

### calcbc.maclaurin-coefficient — Coefficient in a table Maclaurin series

Rating: Medium · Format: fraction · Render: unicode-inline
Why: One table recall plus one factorial read — 3–6s on the assumed fraction pad.
Sample: The coefficient of x³ in the Maclaurin series of eˣ? → 1/6 · Rule: frac-lowest-terms · Params: functions from the table; asked degree n ∈ [2, 5]; answers ±1/n! (already lowest terms); the sign band comes from the sin/cos alternation; the vanishing sin/cos slots (coefficient 0) are excluded — answer-shape split; negative fractions put the sign on the numerator per the format spec.
Kernels: [calcbc.maclaurin-table-recall, alg2.factorial]

### calcbc.taylor-coefficient-from-derivative — Taylor coefficient from a derivative value

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One formula recall (cₙ = f⁽ⁿ⁾(a)/n!) collapsing to a single division — 3–5s.
Sample: f⁽³⁾(0) = 12. The coefficient of x³ in f's Maclaurin series? → 2 · Rule: int-exact · Params: n ∈ [2, 4]; f⁽ⁿ⁾(0) a multiple of n! with quotients ∈ [−9, 9]; the reverse direction (coefficient given, derivative asked) keys separately; negative answers carry the touch-minus-key caveat.
Kernels: [alg2.factorial, fk.division-facts]

### calcbc.radius-geometric-form — Radius of convergence, geometric form

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One |r| < 1 read mapped onto the geometric ratio x/a — 3–5s.
Sample: Σ (x/3)ⁿ converges exactly when |x| < R. R = ? → 3 · Rule: int-exact · Params: forms (x/a)ⁿ and ((x − c)/a)ⁿ (centered band asks for R only) with a ∈ [2, 9]; the (ax)ⁿ family (R = 1/a, a fraction) is excluded — answer-shape split; answers ∈ [2, 9].
Kernels: [trig.geometric-series-converges]

### calcbc.interval-of-convergence — Interval of convergence

Rating: Low
Why: Inherently multi-step at any speed — run the ratio test on the general term, solve the resulting inequality, then check both endpoints with separate convergence arguments.
Kernels: [calcbc.ratio-test-read, calcbc.radius-geometric-form, calcbc.p-series-converges, calcbc.alternating-series-converges]

### calcbc.taylor-polynomial-build — Build a Taylor polynomial

Rating: Low
Why: Inherently multi-step at any speed — compute successive derivatives at the center, divide each by its factorial, and assemble the polynomial while holding the list.
Kernels: [calcbc.taylor-coefficient-from-derivative, calcab.derivative-standard-table, calcab.differentiate-polynomial]

### calcbc.lagrange-error-bound — Lagrange error bound

Rating: Low
Why: Inherently multi-step at any speed — bound the (n + 1)st derivative, assemble M·|x − a|ⁿ⁺¹/(n + 1)!, then evaluate the bound.
Kernels: [calcbc.taylor-coefficient-from-derivative, alg2.factorial, prealg.evaluate-exponent]

**BC-scope extensions within shared CED units 6–8.** The CED marks these topics BC-only inside units the AB section owns; the unit-grain checklist snapshot cannot separate them, so they are enumerated here (each AB disposition row for units 6–8 points at this block). Same entry grammar, same registry mediation.

### calcbc.parts-formula-recall — Integration-by-parts formula

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: Pure formula recall with a sign-and-placement trap in the options — 3–5s. (CED 6, BC scope)
Sample: ∫u dv = ? → uv − ∫v du (options: uv − ∫v du · uv + ∫v du · vu − ∫u dv · u dv − ∫uv) · Rule: mc · Params: fixed 4-option pool permuting the sign and the residual-integral contents.
Kernels: [calcab.product-quotient-rule-recall]

### calcbc.integration-by-parts — Integrate by parts

Rating: Low
Why: Inherently multi-step at any speed — choose u and dv, differentiate and antidifferentiate, assemble uv − ∫v du, then finish the residual integral. (CED 6, BC scope)
Kernels: [calcbc.parts-formula-recall, calcab.antiderivative-standard-table, calcab.derivative-standard-table]

### calcbc.partial-fraction-decomposition — Partial fractions

Rating: Low
Why: Inherently multi-step at any speed — factor the denominator, set up unknown numerators, solve the coefficient system, then integrate the pieces. (CED 6, BC scope)
Kernels: [alg1.factor-simple-quadratic, prealg.solve-2x2-system, calcab.antiderivative-standard-table]

### calcbc.improper-p-integral-converges — Improper p-integral convergence

Rating: Medium · Format: true-false · Render: needs-math-render
Why: One p-threshold read — the integral twin of the p-series fact — 3–5s; genuinely a verification judgment. (CED 6, BC scope)
Sample: True or false: ∫₁^∞ 1/x² dx converges → true · Rule: tf · Params: ∫₁^∞ 1/xᵖ with p ∈ {1/2, 1, 2, 3} (p = 1 the trap); the ∫₀¹ endpoint-singularity band flips the criterion (converges for p < 1) and keys separately; families balanced 50/50.
Kernels: [calcbc.p-series-converges, calcab.antiderivative-power-rule]

### calcbc.euler-step — One Euler-method step

Rating: Medium · Format: single-number · Render: unicode-inline
Why: One slope evaluation plus one multiply-and-add held mentally — 4–7s. (CED 7, BC scope)
Sample: dy/dx = x + y with y(0) = 1, step size h = 1. One Euler step gives y(1) ≈ ? → 2 · Rule: int-exact · Params: f(x, y) linear with coefficients ∈ [1, 3]; h ∈ {1, 2}; exactly one step (multi-step tables are Low grain and excluded); answers integers ∈ [−20, 20]; negative answers carry the touch-minus-key caveat.
Kernels: [prealg.evaluate-expression, fk.times-tables, fk.integer-add-sub]

### calcbc.logistic-limit-read — Carrying capacity of a logistic model

Rating: High · Format: single-number · Render: unicode-inline
Why: One carrying-capacity read off the memorized logistic shape — ≤3s. (CED 7, BC scope)
Sample: dP/dt = 0.5P(1 − P/400). lim (t → ∞) P = ? → 400 · Rule: int-exact · Params: forms kP(1 − P/M) and kP(M − P) (limit M in both, but the read differs — keyed separately); M round values ∈ [50, 900]; k decorative; the fastest-growth read (P = M/2) is a stretch band keyed separately.
Kernels: No drillable kernel beyond entries already listed

### calcbc.arc-length-formula-recall — Arc-length formula

Rating: Medium · Format: multiple-choice · Render: needs-math-render
Why: Pure formula recall with sign, root, and volume-formula look-alikes forcing the scan — 3–6s. (CED 8, BC scope; the parametric family serves CED 9)
Sample: The arc length of y = f(x) for a ≤ x ≤ b is ? → ∫ₐᵇ √(1 + (f′(x))²) dx (options: ∫ₐᵇ √(1 + (f′(x))²) dx · ∫ₐᵇ √(1 − (f′(x))²) dx · ∫ₐᵇ (1 + f′(x)²) dx · π∫ₐᵇ f(x)² dx) · Rule: mc · Params: the function form (sampled) and the parametric form ∫√((dx/dt)² + (dy/dt)²) dt as two keyed families; fixed 4-option pools permuting the sign under the root, the root itself, and the disk-volume look-alike.
Kernels: No drillable kernel beyond entries already listed (see prealg.pythagorean-hypotenuse — the formula is the Pythagorean idea recalled whole)

### BC-only checklist disposition table

Both BC-only CED units (9–10), the three BC-scope extension rows for shared units 6–8, and the no-OpenStax cross-check row map to entry slugs, a cross-reference, or an explicit disposition. Zero unmapped rows.

| Checklist unit | Disposition |
|---|---|
| CED 9 Parametric Equations, Polar Coordinates, and Vector-Valued Functions | calcbc.parametric-slope-formula-recall, calcbc.vector-derivative-evaluate, calcbc.polar-area-formula-recall, calcbc.parametric-slope-at-point (Low), calcbc.second-derivative-parametric (Low), calcbc.polar-area-compute (Low); parametric evaluation → trig.parametric-evaluate, parameter elimination → trig.eliminate-parameter (Low), polar ↔ rectangular → trig.polar-to-rectangular (owned by Trig/Precalc — the merge block minted for this sweep, flags satisfied); vector addition → trig.vector-add; speed/magnitude → trig.complex-modulus (the √(a² + b²) family); parametric arc length → calcbc.arc-length-formula-recall (extension block — the parametric family); vector-valued integrals: recorded judgment — componentwise application of calcab.antiderivative-power-rule, no new fact family; polar-curve graphing out-of-grain: graph output — no drillable content beyond kernels trig.polar-to-rectangular, geo.exact-trig-values |
| CED 10 Infinite Sequences and Series | calcbc.p-series-converges, calcbc.ratio-test-read, calcbc.nth-term-test, calcbc.alternating-series-converges, calcbc.choose-convergence-test, calcbc.absolute-conditional-classify, calcbc.maclaurin-table-recall, calcbc.maclaurin-coefficient, calcbc.taylor-coefficient-from-derivative, calcbc.radius-geometric-form, calcbc.interval-of-convergence (Low), calcbc.taylor-polynomial-build (Low), calcbc.lagrange-error-bound (Low); geometric convergence → trig.geometric-series-converges, infinite geometric sums → alg2.infinite-geometric-sum (BC clause paid), partial sums → alg2.geometric-series-sum (Low); sequence limits → trig.horizontal-asymptote; direct/limit comparison tests: recorded judgment — the choose-the-test read is hosted by calcbc.choose-convergence-test and execution is Low-grain with no kernel beyond calcbc.p-series-converges; telescoping series: recorded judgment — partial-fraction rewrite plus cancellation bookkeeping, Low grain with no kernel beyond calcbc.partial-fraction-decomposition; term-by-term differentiation/integration of power series: recorded judgment — calcab.derivative-power-rule / calcab.antiderivative-power-rule applied inside a sum, no new fact family |
| CED 6 (BC scope) — advanced integration techniques | calcbc.parts-formula-recall, calcbc.integration-by-parts (Low), calcbc.partial-fraction-decomposition (Low), calcbc.improper-p-integral-converges |
| CED 7 (BC scope) — Euler's method and the logistic model | calcbc.euler-step, calcbc.logistic-limit-read; logistic solution curves and interpretation out-of-grain: modeling — no drillable content beyond kernels calcbc.logistic-limit-read, calcab.exponential-de-solution |
| CED 8 (BC scope) — arc length | calcbc.arc-length-formula-recall; arc-length computation: recorded judgment — the setup is the recall entry and the evaluation is a Low-grain composite of calcab.definite-integral-power with no new kernel |
| Cross-check — OpenStax | recorded: same condition as the AB section — no OpenStax calculus snapshot exists in this document; the AP CED is the sole checklist per the plan |

---

## Unit 9 consistency pass — changelog (verify-only)

One full-document pass: recalibration against the anchors + pinned reference set, legend/registry/disposition audits, cross-reference annotation normalization, and the in-degree computation. **Nothing was inserted** — no new entries, kernels, formats, or rules; every change below is an adjustment, repair, or annotation, listed with its reason.

**Audit results** (scripted over the machine-parseable `Rating:` and `Kernels:` lines, with fenced grammar examples excluded):

- 346 rated entries; 346 registry rows; 100 cross-reference rows. Every registry slug has exactly one owning entry and every entry has exactly one registry row — **zero orphan slugs**.
- Format ids: **0 unknown**. Rule ids: **0 unknown**. Render flags: **0 unknown**. Rule↔format pairings: **0 illegal** (all 346 records use only legend vocabulary).
- Kernel citations: **0 unresolved** (every cited slug is registered and owned by an entry), 0 self-citations, 0 `Kernels:`-grammar violations; every cross-reference row's target resolves.
- Disposition tables: **0 unmapped checklist units** and 0 unknown slugs named in any row — Pre-Algebra 26 rows (15 KA + 11 OS), Algebra 1 27 (15 KA + non-content row + statistics gap row + 10 OS), Geometry 12 (9 KA + 3 cross-check/gap), Algebra 2 37 (12 KA + 12 Int + 13 A&T), Trig/Precalc 30 (4 KA Trig + 10 KA Precalc + 4 A&T payoffs + 12 Precalc 2e), Calculus AB 9 (8 CED + cross-check), BC-only 6 (2 CED + 3 extension + cross-check).
- Synonym scan of the slug list: no two slugs name one skill. The deliberate near-pairs are each recorded where they live: alg2.evaluate-log vs alg2.exponential-solve-common-base (same recall, two notations — cross-cited); calcab.critical-point-quadratic vs alg1.axis-of-symmetry ("in calculus clothes", kernel-cited); the √(a² + b²) family consolidated under trig.complex-modulus by registry note.
- Citation-completeness spot-check (sample of six across sections: prealg.percent-of-number, alg1.simplify-radical, geo.sector-area-fraction, alg2.pythagorean-identity-apply, trig.exact-trig-any-quadrant, calcab.definite-integral-power): no missing genuine prerequisites found.

**Recalibration outcomes.** Every entry was compared against the anchors and the calibration table; the borderline calls flagged by the course passes were each re-examined. One tier changed, one marker was added, and all other flagged calls stand:

| Entry | Flagged as | Outcome |
|---|---|---|
| geo.exact-trig-values | High × MC vs the Medium × MC anchor | **Kept High** — pure table recall with 3–4-character options; the anchor's Medium comes from figure-reading plus a 5-option scan, and High × MC is established by trig.trig-parity, alg1.growth-or-decay, calcab.derivative-standard-table |
| geo.distance-formula | Medium ceiling | **Kept Medium** — three fact-level micro-moves at triple-friendly params, inside 8s like alg1.discriminant-root-count |
| geo.translate-point, geo.dilate-point | Medium floor vs arguably High | **Kept Medium** — "one move is High, the doubled parallel move is Medium" is the document-wide rule (geo.midpoint-formula, trig.vector-add, alg2.add-subtract-complex all rate Medium on it); promoting these two would fork the tier line |
| alg2.complement-probability | Medium floor vs High | **Adjusted Medium → High** (note on the entry) — one fused subtract-over-a-kept-denominator, strictly simpler than prealg.mixed-to-improper (High × fraction) |
| alg2.multiply-complex | Medium ceiling | **Kept Medium** — FOIL plus the i² merge is strictly more than alg1.multiply-binomials (Medium's upper half) |
| alg2.expand-conjugate-product | High × short-expression | **Kept High** — pattern recall plus a ~7-token entry ≈ 2.75s, the alg1.distribute-linear pin's case |
| trig.limit-removable-factor | Medium via restricted params | **Kept Medium** — the fluent 2a shortcut under the restricted x² − a² family is one recognition plus a doubling |
| trig.solve-basic-trig-equation | Medium ceiling, surface-sensitive | **Kept Medium** — one table inversion plus one reflection rule; the Surface-sensitive marker already carries the entry-time risk |
| trig.double-angle-evaluate | Medium ceiling, surface-sensitive | **Kept Medium** — formula recall plus two held triple-products stays under 8s |
| trig.geometric-series-converges | High × TF | **Kept High** — the ratio read off 4 simple shown terms is fluent-instant; the calcbc.p-series-converges precedent (High off 4 expanded terms) |
| trig.triangle-area-sine | Medium via restricted angles | **Kept Medium** — two products plus a halving at sin ∈ {1/2, 1} |
| calcab.derivative-power-rule | High × short-expression | **Kept High** — rule recall plus a 4-token entry, the distribute-linear pin's case |
| calcab.ftc-derivative-of-accumulation | High × short-expression | **Kept High** — swap-t-for-x recall plus a ~3-token entry; the compact symbolic prompt does not spend the prealg.common-denominator anchor's reading budget |
| calcab.mvt-apply | Low | **Kept Low** — three chained Medium-grade sub-computations at any parameter restriction |
| calcbc.euler-step | Medium via one-step params | **Kept Medium** — one slope evaluation plus one multiply-add, the alg1.arithmetic-nth-term shape |
| prealg.round-to-place | (surfaced by the sweep, not pre-flagged) | **Marker added: Surface-sensitive** (note on the entry) — entry-dominated High exactly like prealg.percent-to-decimal; tier unchanged |

No other outliers surfaced by the full sweep. The Algebra 2 section-intro tier counts were updated for the one tier change.

**Textual repairs (verification hygiene, no semantic change intended):**

1. Input-format legend, `fraction` normalization bullet: repaired the garbled sentence "must still be entered as the format demands the rule states" to say what the surrounding spec intends — integer-valued answers stay on the fraction surface, and the accepted written form is governed by the entry's rule.
2. prealg.decimal-to-fraction: rewrote the confusing Params clause ("excluding values already over 10 in lowest terms only when no reduction exists") — the parameter intent, unchanged, is that decimals whose place-value fraction is already in lowest terms are excluded so one reduction step is always exercised.
3. Satisfied-tense updates: four sentences still said a later course "will cross-reference" where the cross-reference has since been recorded (Geometry section intro; Algebra 2 section intro; Algebra 2 composite/inverse merge block; Trig/Precalc polar/parametric merge block).
4. Registry tense on the four fk. anchor rows: the Foundational-kernels seeding and the Pre-Algebra sweep were one and the same pass — the label now says so instead of reading as two events.

**Annotation normalization (55 registry rows).** Registry rows for cross-referenced canonical owners inconsistently carried the "first-course-owns: X cross-references here" note. Every registry row that is the target of at least one cross-reference row now names each citing course: 49 rows gained the note and 6 rows (prealg.solve-proportion, prealg.pythagorean-hypotenuse, prealg.solve-2x2-system, alg2.solve-rational-equation, alg2.geometric-series-sum, trig.complex-modulus) had an existing note extended. Notes added by this pass are tagged "(noted in the Unit 9 consistency pass)".

**In-degree computation.** Computed per the In-degree & citation rules, with the counting rule clarified there during this pass (only bracketed `Kernels:` lists count; cross-reference rows, `(see …)` pointers, registry annotations, and disposition mentions do not): distinct citing entry slugs over the 689 (entry, kernel) citation pairs, fenced grammar examples excluded; the primary column filters to citing entries whose own section is Foundational → Algebra 2. Both columns are recorded for all 346 registry rows. **Top-10 spot-recount:** the ten highest primary in-degrees (fk.times-tables 49/58, fk.addition-facts 25/27, fk.division-facts 23/28, fk.perfect-squares 23/28, fk.integer-add-sub 19/26, fk.subtraction-facts 15/21, prealg.simplify-fraction 14/19, fk.doubling-halving 14/15, fk.integer-mul-div 13/17, prealg.square-root 11/15) were manually recounted by an independent method — **all ten match the recorded values**, and the fk.doubling-halving citer list was verified name-by-name (15 citers: 14 primary-window, 1 Trig/Precalc; prose mentions correctly excluded).

---

## Build this first

The prioritized top picks: ~20–30 topics ranked by primary (Foundational→Algebra 2) kernel in-degree with the full-range column secondary; each flagged current-engine or needs-input-type-X with MC-fallback status and render flag; includes the zero-engine-work starter subset and the post-Algebra-2 forward inventory. *Authored in a later pass.*
