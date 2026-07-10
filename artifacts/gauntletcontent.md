# Gauntlet Content Taxonomy — Pre-Algebra through AP Calculus BC

**Deliverable of the 2026-07-10 content-taxonomy cycle.** This document is the map a future engineering cycle uses to add content to The Gauntlet (`/gauntlet`). It is self-contained: everything needed to pick a topic and build its generator is in the entry itself. No game code changes accompany this document.

**The thesis it encodes:** from Pre-Algebra through AP Calculus BC, a large set of building-block skills can be drilled to automaticity at Gauntlet speed, lightening the cognitive load of the slow multi-step problems the game will never host. Slow topics are not dropped — each one names the fast kernels hiding inside it.

**Coverage is a thesis map, not an audience claim.** The shipped game targets grade 3–8 bands. Near-term build value concentrates in Foundational kernels through Algebra 2; the Trig/Precalc and Calculus sections are forward inventory for older students. Build priority lives in §10 (Top Picks), not in coverage depth.

---

## 1. How to read this document

### 1.1 Entry format

Every topic is one drillable skill or fact family with a stable slug ID:

```
#### `course.skill-name` — Human title
**Rating.** One-line rationale.
- Sample: prompt → `answer` · input: <format> · accepted: <rule>
- Range: parameter bounds for a generator.
- Kernels: `slug`, `slug`   (prerequisite skills, cited by slug)
```

Low-rated entries replace Sample/Range with:

```
- Fast kernels inside: `slug`, `slug`   (the drillable sub-skills this slow topic contains)
```

or, where a Low topic genuinely contains nothing drillable beyond entries already listed elsewhere, an explicit statement to that effect — absence is a recorded judgment, never an omission.

Kernel citations are always by slug so in-degree (how many entries cite a skill as prerequisite) is mechanically countable: `grep` for the slug on `Kernels:` / `Fast kernels inside:` lines. §10's ranking is computed exactly that way.

### 1.2 Rating semantics

The rating measures **total response time for a fluent student** — thinking plus answer entry under the sample's input format, on the game's touch-first input surfaces (format-specific on-screen pads like the shipped numeric keypad), with no paper and no multi-step derivation.

| Rating | Meaning | Total response time |
|---|---|---|
| **High** | Recall or a single mental step | ≈ ≤3s |
| **Medium** | One mental transformation, still no paper | ≈ 3–8s |
| **Low** | Inherently multi-step at any speed | — |

A topic whose *thinking* is instant but whose required *input* is slow to enter (a long typed expression) rates down accordingly.

### 1.3 Input formats (expanded lightweight set)

Ratings assume the game could cheaply support these formats. **Today's engine supports only `single number` (integer, optional minus) and `multiple choice`** — everything else is a proposal, not existing capability. Each High/Medium sample states which format it needs, so this document doubles as a map of which new input types unlock which content.

| Format | Description | Engine status |
|---|---|---|
| `single number` | One integer, optional minus sign | **current-engine** |
| `multiple choice` | 3–5 tap targets | **current-engine** |
| `single number (decimal)` | One number with a decimal-point key | new |
| `two numbers` | An ordered or unordered pair, e.g. `7, 12` | new |
| `short expression` | Brief typed math, e.g. `(x+7)(x+12)`, `2x` | new |
| `true/false` | Two tap targets | new (trivial MC variant) |

**Format-selection rule.** Each topic is rated under the most production-like lightweight format that fits it, in order of preference: single number → two numbers → short expression → multiple choice. MC is a topic's *native* format only when the real skill is genuinely discriminative (e.g., naming a congruence criterion). An MC rendering of a production skill is a degraded fallback and never the basis for its rating.

**Submission and answer-checking model.** The current numeric input auto-judges the instant input length reaches the answer's length (no submit action) and strips everything but digits and minus. Variable-length formats (two numbers, short expression, decimals) cannot auto-judge that way, so every new format assumes an **explicit Enter-to-submit** model unless an entry states otherwise; entry-time estimates include the submit keystroke. The engine checks answers by exact string match, so every two-number or short-expression sample states its **accepted-answer rule** (e.g., "pair, order-insensitive"; "factored form, factors in either order, whitespace ignored") — these rules are the spec for the normalization layer that submission implies.

Recurring accepted-answer rules, named once here and referenced by entries:
- **pair-any-order** — two numbers, order-insensitive, comma- or space-separated.
- **pair-ordered** — two numbers in the stated order (e.g., x then y; numerator then denominator).
- **reduced-fraction-pair** — numerator, denominator as pair-ordered, fully reduced, minus sign on the numerator.
- **coef-radicand** — simplified radical `a√b` entered as pair-ordered `a, b` with b square-free.
- **pi-coefficient** — answer is `kπ`; enter the integer k as single number.
- **factored-form** — product of factors, factors in either order, whitespace ignored, `*` optional.
- **expression-canonical** — polynomial in descending degree, whitespace ignored, `^` for powers.

### 1.4 Completeness checklists (audit sources)

Each course section is swept against a named outline so "nothing dropped" is auditable:

- **Pre-Algebra → Precalculus:** the Khan Academy course unit lists for Pre-algebra, Algebra 1, High School Geometry, Algebra 2, and Precalculus (stated per section). Chosen because they are public, unit-enumerated, and match the standard US sequence the game anchors to.
- **AP Calculus AB / BC:** the College Board AP Calculus AB/BC Course and Exam Description (CED) Units 1–8 (AB) and BC-only extensions of Units 6–10.

Every unit-level topic from these checklists appears either as a rated entry or as a named kernel under a Low entry. Where an entry covers a whole checklist unit, the section's audit note says so.

---

## 2. Calibration anchors — the eight shipped topics, rated first

These are the worked examples of the tier definitions in §1.2. All later ratings are calibrated against them. (Implementation: `app/gauntlet/game/problems.ts`.)

#### `fk.times-tables` — Multiplication facts *(shipped: `mul`)*
**High.** Pure recall; 2–3 digit answer auto-judged on the numeric pad. Think ≤1s, entry ≤2s.
- Sample: `7 × 8` → `56` · input: single number
- Range: factors 2–12, band-scaled (2–6 / 2–10 / 2–12).

#### `fk.div-facts` — Division facts *(shipped: `div`)*
**High.** Inverse recall of the times table; same profile as multiplication.
- Sample: `56 ÷ 8` → `7` · input: single number
- Range: divisor and quotient 2–12, band-scaled.
- Kernels: `fk.times-tables`

#### `fk.add-within-50` — Addition facts and small sums *(shipped: `add`)*
**High.** Recall within 20; one carry step at the top band, still ≤3s total.
- Sample: `8 + 7` → `15` · input: single number
- Range: sums ≤12 / ≤20 / ≤50 by band.

#### `fk.sub-within-50` — Subtraction facts and small differences *(shipped: `sub`)*
**High.** Inverse of addition recall.
- Sample: `15 − 8` → `7` · input: single number
- Range: minuend ≤12 / ≤20 / ≤50 by band.
- Kernels: `fk.add-within-50`

#### `fk.gcd-small` — Greatest common divisor, small pairs *(shipped: `gcd`)*
**Medium.** One mental transformation: scan the smaller number's factors for the largest shared one. ~3–6s.
- Sample: `GCD(12, 18)` → `6` · input: single number
- Range: shared factor 2–9 by band; co-multipliers 2–7.
- Kernels: `fk.times-tables`, `fk.divisibility-check`

#### `fk.lcm-small` — Least common multiple, small pairs *(shipped: `lcm`)*
**Medium.** One transformation: walk multiples of the larger number until the smaller divides it. ~3–8s.
- Sample: `LCM(6, 8)` → `24` · input: single number
- Range: operands from band pool; LCM capped 40/90/144.
- Kernels: `fk.times-tables`, `fk.div-facts`

#### `fk.common-denominator` — Least common denominator *(shipped: `denom`)*
**Medium.** LCM with a reading step: extract the denominators, then walk multiples.
- Sample: `LCD of 3/4 and 5/6` → `12` · input: single number
- Range: denominators from band pool, LCM-capped as above.
- Kernels: `fk.lcm-small`

#### `geom.congruence-criteria` — Triangle congruence criterion *(shipped: `congruence`)*
**Medium.** Read the tick/angle marks, match to a criterion. Genuinely discriminative, so MC is its native format (see §1.3), including a "Not enough info" distractor.
- Sample: two marked triangles → `SAS` · input: multiple choice
- Range: SSS/SAS/ASA/AAS/none; randomized rotation and mark placement.
- Kernels: `geom.angle-pairs-supplementary`

---

## 3. Foundational kernels (`fk.`)

Sub-Pre-Algebra skills that later entries cite as prerequisites. Seven of them (`fk.times-tables`, `fk.div-facts`, `fk.add-within-50`, `fk.sub-within-50`, `fk.gcd-small`, `fk.lcm-small`, `fk.common-denominator`) are already shipped and rated in §2; they are not repeated here. Arithmetic below Pre-Algebra is otherwise out of scope except where a listed topic needs it as a kernel — this section exists exactly to host those.

**Audit note:** no external checklist governs this section; membership is driven by citations from later sections. Every slug cited anywhere in this document resolves to an entry.

#### `fk.add-multi-digit` — Two-digit mental addition
**Medium.** One carrying transformation, no paper.
- Sample: `47 + 38` → `85` · input: single number
- Range: two-digit operands, at most one carry; sums ≤ 150.
- Kernels: `fk.add-within-50`

#### `fk.sub-multi-digit` — Two-digit mental subtraction
**Medium.** One borrow transformation.
- Sample: `82 − 47` → `35` · input: single number
- Range: two-digit operands, at most one borrow, non-negative results.
- Kernels: `fk.sub-within-50`

#### `fk.mul-by-pow10` — Multiply by 10s/100s
**High.** Shift-and-recall; single step.
- Sample: `40 × 7` → `280` · input: single number
- Range: one factor in {10…90, 100…900 step 100}, other factor 2–12.
- Kernels: `fk.times-tables`

#### `fk.doubles-halves` — Double and halve
**High.** Single-step recall through 2- and 3-digit numbers.
- Sample: `Half of 86` → `43` · input: single number
- Range: doubling ≤ 250; halving even numbers ≤ 500.
- Kernels: `fk.times-tables`

#### `fk.squares-to-20` — Perfect squares
**High.** Pure recall.
- Sample: `13²` → `169` · input: single number
- Range: bases 2–20.
- Kernels: `fk.times-tables`

#### `fk.sqrt-perfect` — Square roots of perfect squares
**High.** Inverse recall of the squares table.
- Sample: `√144` → `12` · input: single number
- Range: radicands from squares of 2–20.
- Kernels: `fk.squares-to-20`

#### `fk.cubes-small` — Small cubes
**High.** Recall.
- Sample: `4³` → `64` · input: single number
- Range: bases 2–10.
- Kernels: `fk.times-tables`

#### `fk.powers-of-two` — Powers of 2
**High.** Recall; the backbone of exponential-function fluency later.
- Sample: `2⁷` → `128` · input: single number
- Range: exponents 1–12.

#### `fk.divisibility-check` — Is a a factor of b?
**High.** Recall or one divisibility-rule application.
- Sample: `Is 7 a factor of 84?` → `true` · input: true/false
- Range: candidate factors 2–12; targets ≤ 200; ~50% true.
- Kernels: `fk.times-tables`, `fk.div-facts`

#### `fk.divisibility-rules` — Divisibility rules for 3, 4, 6, 9
**High.** Single rule application (digit sum, last two digits).
- Sample: `Is 351 divisible by 3?` → `true` · input: true/false
- Range: 3-digit targets; rules for 3, 4, 6, 9; ~50% true.
- Kernels: `fk.add-within-50`

#### `fk.primes-to-100` — Prime recognition
**High.** Recall for small numbers; one divisibility probe for the tricky ones (51, 57, 91).
- Sample: `Is 51 prime?` → `false` · input: true/false
- Range: 2–100, oversampling the classic traps.
- Kernels: `fk.divisibility-rules`

#### `fk.smallest-prime-factor` — Smallest prime factor
**High.** One probe in order 2, 3, 5, 7.
- Sample: `Smallest prime factor of 91` → `7` · input: single number
- Range: composites ≤ 200 whose smallest prime factor is ≤ 11.
- Kernels: `fk.divisibility-rules`, `fk.primes-to-100`

#### `fk.fraction-simplify` — Reduce a fraction to lowest terms
**Medium.** One GCD extraction plus two divisions.
- Sample: `Simplify 18/24` → `3, 4` · input: two numbers · accepted: reduced-fraction-pair
- Range: numerator/denominator ≤ 60; GCD 2–12.
- Kernels: `fk.gcd-small`, `fk.div-facts`

#### `fk.fraction-equivalents` — Scale a fraction up
**High.** One multiplication after spotting the scale factor.
- Sample: `3/4 = ?/20` → `15` · input: single number
- Range: base denominators 2–12; scale factors 2–10.
- Kernels: `fk.times-tables`, `fk.div-facts`

#### `fk.mixed-improper` — Mixed number ↔ improper fraction
**Medium.** One multiply-and-add (or divide) transformation.
- Sample: `2¾ = ?/4` → `11` · input: single number
- Range: whole parts 1–9, denominators 2–12.
- Kernels: `fk.times-tables`, `fk.add-within-50`

#### `fk.fraction-add-like` — Add fractions, same denominator
**High.** One addition; denominator unchanged.
- Sample: `3/8 + 2/8 = ?/8` → `5` · input: single number
- Range: denominators 3–12; results left unreduced (reduction is `fk.fraction-simplify`).
- Kernels: `fk.add-within-50`

#### `fk.fraction-compare` — Which fraction is larger?
**High.** One cross-multiplication or benchmark comparison.
- Sample: `Which is larger: 3/7 or 2/5?` → `3/7` · input: multiple choice (the two fractions)
- Range: denominators 2–12; pairs within 15% of each other so benchmarks alone don't trivialize it.
- Kernels: `fk.times-tables`

#### `fk.decimal-fraction-common` — Common decimal ↔ fraction equivalents
**High.** Pure recall of the standard set.
- Sample: `0.375 as a fraction` → `3, 8` · input: two numbers · accepted: reduced-fraction-pair
- Range: halves, quarters, fifths, eighths, tenths, and thirds (0.333… shown as ⅓-family MC).
- Kernels: `fk.fraction-simplify`

#### `fk.percent-fraction-equivalents` — Common percent ↔ fraction equivalents
**High.** Recall of the benchmark set.
- Sample: `40% as a fraction in lowest terms` → `2, 5` · input: two numbers · accepted: reduced-fraction-pair
- Range: multiples of 5% plus 12.5%, 33⅓%, 66⅔% (thirds as MC).
- Kernels: `fk.decimal-fraction-common`

#### `fk.rounding` — Round to a given place
**High.** Single-step place-value read.
- Sample: `Round 3,472 to the nearest hundred` → `3500` · input: single number
- Range: 3–5 digit targets; tens/hundreds/thousands.

#### `fk.order-of-operations` — Order of operations, two operators
**Medium.** One precedence decision plus two operations.
- Sample: `3 + 4 × 5` → `23` · input: single number
- Range: two operators from {+, −, ×}, optionally one paren pair; operands ≤ 12.
- Kernels: `fk.times-tables`, `fk.add-within-50`, `fk.sub-within-50`

---

## 4. Pre-Algebra (`prealg.`)

**Audit checklist:** Khan Academy *Pre-algebra* course units (Factors & multiples · Patterns · Ratios & rates · Percentages · Exponents intro · Order of operations · Variables & expressions · Equations & inequalities intro · Percent & rational word problems · Proportional relationships · One/two-step equations & inequalities · Roots, exponents & scientific notation), plus the signed-number, geometry, and data units of Khan Grade 7–8 Math, which the standard Pre-Algebra course absorbs. Factors & multiples is largely covered by §2/§3 kernels (`fk.gcd-small`, `fk.lcm-small`, `fk.primes-to-100`, `fk.smallest-prime-factor`); patterns is covered by the sequence entries in §5 (Algebra 1). Word-problem units appear as Low entries.

#### `prealg.int-add-signed` — Add signed integers
**High.** One sign decision plus a fact recall.
- Sample: `−8 + 13` → `5` · input: single number
- Range: operands −20…20, excluding trivial same-sign small sums.
- Kernels: `fk.add-within-50`, `fk.sub-within-50`

#### `prealg.int-sub-signed` — Subtract signed integers
**High.** Rewrite-as-addition is a single automatized step.
- Sample: `−5 − (−9)` → `4` · input: single number
- Range: operands −20…20; double-negative forms oversampled.
- Kernels: `prealg.int-add-signed`

#### `prealg.int-mul-signed` — Multiply signed integers
**High.** Sign rule plus times-table recall.
- Sample: `−7 × 6` → `−42` · input: single number
- Range: factors 2–12 with random signs.
- Kernels: `fk.times-tables`

#### `prealg.int-div-signed` — Divide signed integers
**High.** Sign rule plus division-fact recall.
- Sample: `−54 ÷ 9` → `−6` · input: single number
- Range: divisor and quotient 2–12 with random signs.
- Kernels: `fk.div-facts`, `prealg.int-mul-signed`

#### `prealg.sign-of-power` — Sign of a power of a negative
**High.** Parity read of the exponent.
- Sample: `Is (−3)⁵ positive or negative?` → `negative` · input: multiple choice
- Range: bases −2…−9, exponents 2–9.
- Kernels: `prealg.int-mul-signed`

#### `prealg.abs-value` — Absolute value
**High.** Single-step read.
- Sample: `|−14|` → `14` · input: single number
- Range: operands −99…99.

#### `prealg.abs-expression` — Absolute value of a small expression
**High.** One inner operation, then the absolute-value read.
- Sample: `|3 − 9|` → `6` · input: single number
- Range: inner operands ≤ 20, one operation.
- Kernels: `prealg.abs-value`, `prealg.int-sub-signed`

#### `prealg.reciprocal` — Reciprocal of a fraction or integer
**High.** Flip; recall-grade.
- Sample: `Reciprocal of 3/4` → `4, 3` · input: two numbers · accepted: reduced-fraction-pair
- Range: proper/improper fractions with terms ≤ 12; integers (reciprocal 1/n).
- Kernels: `fk.fraction-simplify`

#### `prealg.fraction-add-unlike` — Add fractions, unlike denominators
**Medium.** One LCD conversion, then add; kept to denominators where the LCD is one of them or their product.
- Sample: `1/4 + 1/6` → `5, 12` · input: two numbers · accepted: reduced-fraction-pair
- Range: denominators 2–12, LCD ≤ 24; results proper or ≤ 2.
- Kernels: `fk.common-denominator`, `fk.fraction-equivalents`, `fk.fraction-add-like`

#### `prealg.fraction-sub-unlike` — Subtract fractions, unlike denominators
**Medium.** Same profile as unlike addition.
- Sample: `5/6 − 1/4` → `7, 12` · input: two numbers · accepted: reduced-fraction-pair
- Range: as `prealg.fraction-add-unlike`, non-negative results.
- Kernels: `prealg.fraction-add-unlike`

#### `prealg.fraction-mul` — Multiply fractions
**Medium.** Cross-cancel then multiply — one transformation when cancellation is designed in.
- Sample: `2/3 × 9/10` → `3, 5` · input: two numbers · accepted: reduced-fraction-pair
- Range: terms ≤ 12, always at least one cross-cancellation, products with terms ≤ 20.
- Kernels: `fk.times-tables`, `fk.fraction-simplify`

#### `prealg.fraction-div` — Divide fractions
**Medium.** Flip-and-multiply as one chunk.
- Sample: `3/4 ÷ 3/8` → `2` · input: single number
- Range: designed so results are integers or fractions with terms ≤ 12.
- Kernels: `prealg.reciprocal`, `prealg.fraction-mul`

#### `prealg.fraction-of-number` — Fraction of a whole number
**High.** Divide then multiply, chunked as one step at these ranges.
- Sample: `2/3 of 27` → `18` · input: single number
- Range: denominators 2–12 dividing the whole evenly; wholes ≤ 144.
- Kernels: `fk.div-facts`, `fk.times-tables`

#### `prealg.decimal-add-sub` — Add/subtract decimals mentally
**Medium.** One alignment transformation.
- Sample: `3.7 + 1.85` → `5.55` · input: single number (decimal) · accepted: exact decimal, trailing zeros ignored
- Range: ≤ 2 decimal places, operands < 20.
- Kernels: `fk.add-multi-digit`, `fk.sub-multi-digit`

#### `prealg.decimal-mul-pow10` — Shift decimals by powers of ten
**High.** Single shift.
- Sample: `3.45 × 100` → `345` · input: single number
- Range: ×/÷ by 10, 100, 1000; designed so answers are integers (division variants use e.g. 345 ÷ 100 → decimal pad).
- Kernels: `fk.mul-by-pow10`

#### `prealg.decimal-mul-small` — Multiply small decimals
**Medium.** Fact recall plus a decimal-place count.
- Sample: `0.6 × 0.4` → `0.24` · input: single number (decimal) · accepted: exact decimal
- Range: one-place decimals from the 2–12 tables.
- Kernels: `fk.times-tables`

#### `prealg.decimal-div-clean` — Divide decimals, clean cases
**Medium.** One rescale-to-integers transformation.
- Sample: `7.2 ÷ 0.9` → `8` · input: single number
- Range: designed for integer quotients 2–12.
- Kernels: `fk.div-facts`, `prealg.decimal-mul-pow10`

#### `prealg.percent-benchmark` — Benchmark percents of a number
**High.** 10%/25%/50%-family recall with one scale step.
- Sample: `25% of 84` → `21` · input: single number
- Range: percents in {5, 10, 20, 25, 50, 75, 100, 200}; bases divisible for integer answers.
- Kernels: `fk.doubles-halves`, `fk.div-facts`

#### `prealg.percent-of-number` — General percent of a number
**Medium.** Compose from benchmarks (30% = 3 × 10%).
- Sample: `30% of 90` → `27` · input: single number
- Range: multiples of 5% up to 95%; bases ≤ 400, integer answers.
- Kernels: `prealg.percent-benchmark`, `fk.times-tables`

#### `prealg.percent-to-decimal` — Percent ↔ decimal conversion
**High.** One two-place shift.
- Sample: `7.5% as a decimal` → `0.075` · input: single number (decimal) · accepted: exact decimal
- Range: 0.1%–250%, at most one decimal place in the percent.
- Kernels: `prealg.decimal-mul-pow10`

#### `prealg.percent-change` — Percent increase/decrease, clean cases
**Medium.** One difference, one division against the base.
- Sample: `From 80 to 100 is what % increase?` → `25` · input: single number
- Range: bases and changes chosen for integer percent answers ≤ 200%.
- Kernels: `fk.sub-multi-digit`, `prealg.percent-of-number`

#### `prealg.ratio-simplify` — Simplify a ratio
**Medium.** Same operation as fraction reduction.
- Sample: `Simplify 18 : 24` → `3, 4` · input: two numbers · accepted: pair-ordered
- Range: terms ≤ 60, GCD 2–12.
- Kernels: `fk.fraction-simplify`

#### `prealg.unit-rate` — Unit rate
**Medium.** One division framed in context.
- Sample: `240 km in 3 hours = ? km/h` → `80` · input: single number
- Range: integer rates; divisors 2–12.
- Kernels: `fk.div-facts`, `prealg.decimal-mul-pow10`

#### `prealg.proportion-solve` — Solve a proportion
**Medium.** One scale-factor spot or cross-multiply.
- Sample: `3/4 = x/20 · x = ?` → `15` · input: single number
- Range: scale factors 2–12, integer answers.
- Kernels: `fk.fraction-equivalents`

#### `prealg.exponent-eval` — Evaluate small powers
**High.** Recall (or one repeated-multiplication chunk).
- Sample: `3⁴` → `81` · input: single number
- Range: bases 2–10, exponents 2–4, values ≤ 1024.
- Kernels: `fk.squares-to-20`, `fk.cubes-small`, `fk.powers-of-two`

#### `prealg.exponent-product-rule` — Product rule for exponents
**High.** Add the exponents.
- Sample: `x³ · x⁵ = x^?` → `8` · input: single number
- Range: exponents 1–12; occasional numeric bases.
- Kernels: `fk.add-within-50`

#### `prealg.exponent-quotient-rule` — Quotient rule for exponents
**High.** Subtract the exponents.
- Sample: `x⁹ ÷ x⁴ = x^?` → `5` · input: single number
- Range: exponents 1–12, non-negative results (negative results live in `prealg.exponent-negative`).
- Kernels: `fk.sub-within-50`

#### `prealg.exponent-power-rule` — Power of a power
**High.** Multiply the exponents.
- Sample: `(x³)⁴ = x^?` → `12` · input: single number
- Range: exponents 2–9.
- Kernels: `fk.times-tables`

#### `prealg.exponent-zero` — Zero exponent
**High.** Recall.
- Sample: `5⁰` → `1` · input: single number
- Range: any nonzero base, mixed with small real powers as distractor pressure.

#### `prealg.exponent-negative` — Negative exponents
**High.** One flip-to-reciprocal step.
- Sample: `2⁻³ as a fraction` → `1, 8` · input: two numbers · accepted: reduced-fraction-pair
- Range: bases 2–5, exponents −1…−3.
- Kernels: `prealg.exponent-eval`, `prealg.reciprocal`

#### `prealg.scientific-notation-exp` — Standard form → scientific notation exponent
**High.** Count the shift.
- Sample: `4,500,000 = 4.5 × 10^?` → `6` · input: single number
- Range: magnitudes 10²–10⁹ and 10⁻¹–10⁻⁶.
- Kernels: `prealg.decimal-mul-pow10`

#### `prealg.scientific-to-standard` — Scientific notation → standard form
**Medium.** One shift, but the entry is long (many digits), which rates it down per §1.2.
- Sample: `3.2 × 10⁴` → `32000` · input: single number
- Range: exponents 2–6 so entry stays ≤ 7 keys.
- Kernels: `prealg.decimal-mul-pow10`

#### `prealg.sqrt-estimate` — Locate a square root between integers
**High.** Bracket against the squares table.
- Sample: `√50 is between n and n+1. n = ?` → `7` · input: single number
- Range: radicands 5–400, non-perfect squares.
- Kernels: `fk.squares-to-20`

#### `prealg.evaluate-expression` — Evaluate a linear expression
**Medium.** One substitution, two operations.
- Sample: `3x − 4 at x = 5` → `11` · input: single number
- Range: coefficients −9…9, inputs −9…9.
- Kernels: `fk.times-tables`, `prealg.int-add-signed`, `fk.order-of-operations`

#### `prealg.combine-like-terms` — Combine like terms
**Medium.** One collection pass; short expression to enter.
- Sample: `7x + 3 − 2x` → `5x+3` · input: short expression · accepted: expression-canonical
- Range: 3–4 terms, one variable, coefficients −9…9.
- Kernels: `prealg.int-add-signed`

#### `prealg.distribute` — Distribute over a binomial
**Medium.** Two multiplications, one written form.
- Sample: `3(2x − 5)` → `6x-15` · input: short expression · accepted: expression-canonical
- Range: outer factors −9…9, inner coefficients ≤ 12.
- Kernels: `prealg.int-mul-signed`

#### `prealg.one-step-equation` — One-step equations
**High.** Single inverse operation.
- Sample: `x + 9 = 17` → `8` · input: single number
- Range: all four operations, integer solutions −12…12.
- Kernels: `fk.sub-within-50`, `fk.div-facts`

#### `prealg.two-step-equation` — Two-step equations
**Medium.** Two inverse operations, no paper at these ranges.
- Sample: `3x − 5 = 16` → `7` · input: single number
- Range: coefficients 2–12, integer solutions −12…12.
- Kernels: `prealg.one-step-equation`, `prealg.int-add-signed`

#### `prealg.inequality-truth` — Compare signed numbers
**High.** Number-line read.
- Sample: `−3 > −5` → `true` · input: true/false
- Range: integers −20…20; decimals to one place at the top band.
- Kernels: `prealg.int-add-signed`

#### `prealg.inequality-flip` — Solve a one-step inequality (sign flip)
**Medium.** One inverse operation plus the flip decision.
- Sample: `Solve −2x < 10` → `x > -5` · input: multiple choice (four sign/direction variants)
- Range: coefficients −12…12 excluding 0; integer boundaries.
- Kernels: `prealg.one-step-equation`, `prealg.int-div-signed`

#### `prealg.coordinate-quadrant` — Quadrant of a point
**High.** Two sign reads.
- Sample: `(−3, 5) is in quadrant…` → `2` · input: single number
- Range: nonzero coordinates −12…12; axis points as MC variant ("on the x-axis").

#### `prealg.perimeter-rectangle` — Perimeter of a rectangle
**High.** One add, one double.
- Sample: `Perimeter of a 7 × 12 rectangle` → `38` · input: single number
- Range: sides 2–20.
- Kernels: `fk.add-within-50`, `fk.doubles-halves`

#### `prealg.area-rect-triangle` — Area of rectangles and triangles
**High.** One multiplication (with a halving for triangles).
- Sample: `Area of a triangle, base 10, height 7` → `35` · input: single number
- Range: dimensions 2–20; triangle cases with even products.
- Kernels: `fk.times-tables`, `fk.doubles-halves`

#### `prealg.volume-rect-prism` — Volume of a rectangular prism
**Medium.** Two multiplications.
- Sample: `Volume of a 3 × 4 × 5 box` → `60` · input: single number
- Range: dimensions 2–10.
- Kernels: `fk.times-tables`

#### `prealg.mean-small` — Mean of a small set
**Medium.** One sum, one division.
- Sample: `Mean of 4, 7, 9, 12` → `8` · input: single number
- Range: 3–5 values ≤ 20, integer means.
- Kernels: `fk.add-multi-digit`, `fk.div-facts`

#### `prealg.median-mode` — Median and mode
**High.** Ordered read of a short list.
- Sample: `Median of 3, 7, 9, 12, 15` → `9` · input: single number
- Range: 5–7 values, presented unsorted at higher difficulty.

#### `prealg.probability-simple` — Probability of a simple event
**Medium.** Count favorable, count total, reduce.
- Sample: `P(rolling an even number on a d6)` → `1, 2` · input: two numbers · accepted: reduced-fraction-pair
- Range: dice, coins, marble urns ≤ 12 items.
- Kernels: `fk.fraction-simplify`

#### `prealg.percent-word-problems` — Percent & rational-number word problems
**Low.** Reading and modeling time dominates; the arithmetic inside is fast but the problem is not a few-second item at any fluency.
- Fast kernels inside: `prealg.percent-of-number`, `prealg.percent-change`, `prealg.fraction-of-number`, `prealg.unit-rate`

#### `prealg.multi-step-word-problems` — Multi-step arithmetic word problems
**Low.** Same reading/modeling bottleneck as all word problems.
- Fast kernels inside: `prealg.two-step-equation`, `fk.order-of-operations`, `prealg.proportion-solve`. No drillable kernel beyond entries already listed elsewhere.

---

## 5. Algebra 1 (`alg1.`)

**Audit checklist:** Khan Academy *Algebra 1* units (Algebra foundations · Solving equations & inequalities · Working with units · Linear equations & graphs · Forms of linear equations · Systems of equations · Inequalities · Functions · Sequences · Absolute value & piecewise functions · Exponents & radicals · Exponential growth & decay · Quadratics: multiplying & factoring · Quadratic functions & equations · Irrational numbers). "Algebra foundations" is covered by §4 (`prealg.evaluate-expression`, `prealg.combine-like-terms`, `prealg.distribute`); "Working with units" appears as a Low entry; graphing-as-an-action units appear as Low entries with their read-off kernels extracted.

#### `alg1.linear-eq-multistep` — Multi-step linear equation, one distribution
**Medium.** Distribute mentally, then two-step solve.
- Sample: `2(x − 3) = 10` → `8` · input: single number
- Range: outer factor 2–9, integer solutions −12…12.
- Kernels: `prealg.distribute`, `prealg.two-step-equation`

#### `alg1.linear-eq-var-both-sides` — Variables on both sides
**Medium.** One collect step, one two-step solve.
- Sample: `5x − 4 = 3x + 10` → `7` · input: single number
- Range: coefficients −9…9, integer solutions.
- Kernels: `prealg.combine-like-terms`, `prealg.two-step-equation`

#### `alg1.literal-equation-onestep` — Rearrange a formula, one inversion
**Medium.** Single inverse operation on symbols.
- Sample: `d = rt. Solve for t.` → `d/r` · input: short expression · accepted: expression-canonical (also accepts `d/r` vs `(d)/(r)` after whitespace strip)
- Range: two- and three-symbol formulas needing exactly one inversion.
- Kernels: `prealg.one-step-equation`

#### `alg1.slope-two-points` — Slope from two points
**Medium.** Two subtractions and a division.
- Sample: `Slope through (2, 3) and (6, 11)` → `2` · input: single number
- Range: coordinates −12…12, integer slopes; fraction slopes as reduced-fraction-pair variant.
- Kernels: `prealg.int-sub-signed`, `fk.fraction-simplify`

#### `alg1.slope-from-equation` — Slope from slope-intercept form
**High.** Coefficient read.
- Sample: `Slope of y = −3x + 7` → `−3` · input: single number
- Range: integer slopes −12…12; fraction slopes as two-numbers variant.

#### `alg1.intercept-from-equation` — y-intercept from slope-intercept form
**High.** Constant read.
- Sample: `y-intercept of y = 4x − 9` → `−9` · input: single number
- Range: integer intercepts −20…20.

#### `alg1.standard-to-slope` — Slope from standard form
**Medium.** One −A/B transformation.
- Sample: `Slope of 2x + 3y = 12` → `-2, 3` · input: two numbers · accepted: reduced-fraction-pair
- Range: A, B in −9…9 excluding 0.
- Kernels: `fk.fraction-simplify`, `prealg.int-div-signed`

#### `alg1.x-intercept` — x-intercept of a line
**Medium.** Set y = 0, one division.
- Sample: `x-intercept of y = 3x − 12` → `4` · input: single number
- Range: designed for integer intercepts −12…12.
- Kernels: `prealg.one-step-equation`

#### `alg1.parallel-perpendicular-slope` — Parallel/perpendicular slopes
**High.** Copy, or negate-and-flip.
- Sample: `Slope perpendicular to 2/5` → `-5, 2` · input: two numbers · accepted: reduced-fraction-pair
- Range: slopes with terms ≤ 12.
- Kernels: `prealg.reciprocal`

#### `alg1.point-on-line` — Is a point on the line?
**High.** One substitution check.
- Sample: `Is (3, 5) on y = 2x − 1?` → `true` · input: true/false
- Range: coordinates −12…12; ~50% true, false cases off by small amounts.
- Kernels: `prealg.evaluate-expression`

#### `alg1.point-slope-read` — Read point and slope from point-slope form
**High.** Sign-aware read of y − y₁ = m(x − x₁).
- Sample: `y − 4 = 3(x + 2) passes through…` → `-2, 4` · input: two numbers · accepted: pair-ordered (x, y)
- Range: coordinates −12…12, integer slopes.
- Kernels: `prealg.int-sub-signed`

#### `alg1.function-eval` — Evaluate f(x)
**High.** One substitution into a quadratic-or-simpler rule.
- Sample: `f(x) = x² − 3x. f(4) = ?` → `4` · input: single number
- Range: inputs −9…9; rules up to one square plus one linear term.
- Kernels: `fk.squares-to-20`, `prealg.evaluate-expression`

#### `alg1.function-notation-read` — Interpret function notation
**High.** Read (a, b) ↔ f(a) = b.
- Sample: `f(3) = 7 means the graph passes through…` → `(3, 7)` · input: multiple choice
- Range: small integer pairs; distractors swap coordinates.

#### `alg1.domain-range-discrete` — Domain/range of a discrete set
**Medium.** Read off a small relation.
- Sample: `Range of {(1,4), (2,7), (3,4)}` → `{4, 7}` · input: multiple choice
- Range: 3–5 pairs, values ≤ 12.

#### `alg1.system-by-substitution-inspection` — Solve an inspection-grade system
**Medium.** One substitution, one two-step solve.
- Sample: `y = 2x and x + y = 9. (x, y) = ?` → `3, 6` · input: two numbers · accepted: pair-ordered (x, y)
- Range: one equation pre-solved for a variable; integer solutions −12…12.
- Kernels: `prealg.two-step-equation`, `prealg.combine-like-terms`

#### `alg1.system-solution-count` — How many solutions does a system have?
**Medium.** Compare slopes/intercepts.
- Sample: `y = 2x + 1 and y = 2x − 3 have how many solutions?` → `0` · input: single number
- Range: 0 / 1 / infinitely-many (MC label for the last); slope-intercept pairs.
- Kernels: `alg1.slope-from-equation`

#### `alg1.system-elimination` — Solve a general 2×2 system
**Low.** Scale, add, back-substitute — inherently multi-step.
- Fast kernels inside: `prealg.combine-like-terms`, `prealg.int-mul-signed`, `prealg.two-step-equation`, `alg1.system-by-substitution-inspection`

#### `alg1.inequality-two-step` — Two-step inequality
**Medium.** Two-step solve plus flip bookkeeping.
- Sample: `Solve 3x − 4 < 11` → `x < 5` · input: multiple choice (boundary + direction variants)
- Range: coefficients −9…9, integer boundaries.
- Kernels: `prealg.two-step-equation`, `prealg.inequality-flip`

#### `alg1.compound-inequality-read` — Read a compound inequality
**Medium.** Membership check against an AND/OR condition.
- Sample: `Is x = 4 a solution of 1 < x ≤ 4?` → `true` · input: true/false
- Range: integer bounds −12…12, mixed strict/inclusive.
- Kernels: `prealg.inequality-truth`

#### `alg1.exponent-rules-mixed` — Mixed exponent rules
**High.** One rule composition read.
- Sample: `(x²y³)² = x⁴y^?` → `6` · input: single number
- Range: exponents 1–9, two rules per item max.
- Kernels: `prealg.exponent-product-rule`, `prealg.exponent-power-rule`, `prealg.exponent-quotient-rule`

#### `alg1.exponential-eval` — Evaluate an exponential function
**Medium.** One power recall, one multiplication.
- Sample: `f(x) = 5 · 2ˣ. f(4) = ?` → `80` · input: single number
- Range: bases 2, 3, 5, 10; exponents ≤ 6; coefficients ≤ 9.
- Kernels: `fk.powers-of-two`, `prealg.exponent-eval`, `fk.mul-by-pow10`

#### `alg1.exponential-growth-factor` — Growth/decay rate from the model
**High.** Read b in a·bˣ against 1 ± r.
- Sample: `y = 200(1.05)ᵗ grows what % per period?` → `5` · input: single number
- Range: rates 1–95%, growth and decay.
- Kernels: `prealg.percent-to-decimal`

#### `alg1.growth-vs-decay` — Growth or decay?
**High.** Compare b to 1.
- Sample: `y = 40(0.85)ᵗ: growth or decay?` → `decay` · input: multiple choice
- Range: b in 0.05–3, avoiding b = 1.
- Kernels: `alg1.exponential-growth-factor`

#### `alg1.poly-degree` — Degree of a polynomial
**High.** Scan for the max exponent.
- Sample: `Degree of 4x³ − x⁷ + 2` → `7` · input: single number
- Range: 2–4 terms, degree ≤ 9, unsorted terms.

#### `alg1.poly-add` — Add/subtract small polynomials
**Medium.** One collection pass; entry cost noted.
- Sample: `(3x² + 2x) + (x² − 5x)` → `4x^2-3x` · input: short expression · accepted: expression-canonical
- Range: ≤ 3 terms each, coefficients −9…9.
- Kernels: `prealg.combine-like-terms`

#### `alg1.monomial-mul` — Multiply monomials
**High.** Multiply coefficients, add exponents.
- Sample: `(3x²)(4x⁵)` → `12x^7` · input: short expression · accepted: expression-canonical
- Range: coefficients 2–9, exponents 1–9.
- Kernels: `fk.times-tables`, `prealg.exponent-product-rule`

#### `alg1.binomial-mul` — Multiply two binomials (FOIL)
**Medium.** Four products chunked to three terms; the entry is the slow part, rating it at the bottom of Medium.
- Sample: `(x + 3)(x + 5)` → `x^2+8x+15` · input: short expression · accepted: expression-canonical
- Range: monic, constants −9…9.
- Kernels: `alg1.factor-pairs-sum-product`, `prealg.int-mul-signed`, `prealg.int-add-signed`

#### `alg1.square-binomial` — Square a binomial
**Medium.** Pattern recall (a² + 2ab + b²), then entry.
- Sample: `(x + 6)²` → `x^2+12x+36` · input: short expression · accepted: expression-canonical
- Range: constants −9…9.
- Kernels: `fk.squares-to-20`, `fk.doubles-halves`

#### `alg1.diff-squares-product` — Multiply conjugates
**High.** Pattern recall (a² − b²); short answer.
- Sample: `(x − 7)(x + 7)` → `x^2-49` · input: short expression · accepted: expression-canonical
- Range: constants 2–12.
- Kernels: `fk.squares-to-20`

#### `alg1.factor-pairs-sum-product` — Factor pairs by sum and product
**High.** The flagship kernel of the whole taxonomy: scan factor pairs of c for the pair summing to b. Recall-grade with table fluency.
- Sample: `Two numbers multiply to 84 and add to 19.` → `7, 12` · input: two numbers · accepted: pair-any-order
- Range: |c| ≤ 144 with both factors ≤ 12; positive targets first, then mixed signs (product negative → factors of opposite sign).
- Kernels: `fk.times-tables`, `prealg.int-add-signed`

#### `alg1.factor-gcf` — Factor out the GCF
**Medium.** One GCD spot, one division pass.
- Sample: `6x² + 9x` → `3x(2x+3)` · input: short expression · accepted: factored-form
- Range: GCFs 2–9 times x⁰–x²; two terms.
- Kernels: `fk.gcd-small`, `fk.div-facts`

#### `alg1.factor-trinomial-monic` — Factor a monic trinomial
**Medium.** One sum-product spot plus factored-form entry.
- Sample: `x² + 9x + 20` → `(x+4)(x+5)` · input: short expression · accepted: factored-form
- Range: constants as in `alg1.factor-pairs-sum-product`.
- Kernels: `alg1.factor-pairs-sum-product`

#### `alg1.factor-diff-squares` — Factor a difference of squares
**Medium.** Pattern recall plus entry.
- Sample: `x² − 81` → `(x-9)(x+9)` · input: short expression · accepted: factored-form
- Range: perfect squares to 20²; 4x²-style leading squares at higher difficulty.
- Kernels: `fk.sqrt-perfect`

#### `alg1.factor-technique-recognize` — Which factoring technique applies?
**High.** Discriminative read — MC is native (§1.3).
- Sample: `4x² − 25 factors by…` → `difference of squares` · input: multiple choice
- Range: GCF / difference of squares / monic trinomial / not factorable over ℤ.
- Kernels: `alg1.factor-diff-squares`, `alg1.factor-trinomial-monic`

#### `alg1.factor-nonmonic` — Factor ax² + bx + c, a > 1
**Low.** Grouping or trial-and-error is multi-step at any fluency.
- Fast kernels inside: `alg1.factor-pairs-sum-product`, `alg1.factor-gcf`, `fk.times-tables`

#### `alg1.quadratic-roots-factored` — Roots from factored form
**High.** Sign-flip read per factor.
- Sample: `Roots of (x − 3)(x + 8) = 0` → `3, -8` · input: two numbers · accepted: pair-any-order
- Range: roots −12…12; repeated-root variant asks the single root.
- Kernels: `prealg.one-step-equation`

#### `alg1.quadratic-solve-monic` — Solve a monic quadratic by factoring
**Medium.** Sum-product spot, then root read.
- Sample: `x² + 5x + 6 = 0` → `-2, -3` · input: two numbers · accepted: pair-any-order
- Range: as `alg1.factor-pairs-sum-product`, both roots integers.
- Kernels: `alg1.factor-pairs-sum-product`, `alg1.quadratic-roots-factored`

#### `alg1.quadratic-sqrt-method` — Solve x² = k
**Medium.** One root recall plus the ± bookkeeping.
- Sample: `x² = 49` → `7, -7` · input: two numbers · accepted: pair-any-order
- Range: perfect squares to 400; (x−a)² = k variant at higher difficulty.
- Kernels: `fk.sqrt-perfect`

#### `alg1.discriminant` — Compute the discriminant
**Medium.** b² − 4ac with small values; three operations chunked.
- Sample: `Discriminant of x² + 6x + 2` → `28` · input: single number
- Range: |a| ≤ 4, |b| ≤ 12, |c| ≤ 12.
- Kernels: `fk.squares-to-20`, `prealg.int-mul-signed`, `fk.sub-multi-digit`

#### `alg1.discriminant-root-count` — Number of real roots from the discriminant
**High.** Sign read.
- Sample: `Discriminant = −5. How many real roots?` → `0` · input: single number
- Range: discriminant given directly or via `alg1.discriminant`-grade coefficients.
- Kernels: `alg1.discriminant`

#### `alg1.vertex-x` — Axis of symmetry / vertex x
**High.** −b/2a as a single recall-step.
- Sample: `Vertex x of y = x² − 8x + 3` → `4` · input: single number
- Range: a in {±1, ±2}, b even for integer answers; fraction answers as reduced-fraction-pair variant.
- Kernels: `prealg.int-div-signed`, `fk.doubles-halves`

#### `alg1.quadratic-formula-full` — Solve by the quadratic formula
**Low.** Evaluate, simplify a radical, reduce a fraction — multi-step at any speed.
- Fast kernels inside: `alg1.discriminant`, `fk.sqrt-perfect`, `alg1.radical-simplify`, `fk.fraction-simplify`, `prealg.int-add-signed`

#### `alg1.radical-simplify` — Simplify a square root
**Medium.** One largest-square extraction.
- Sample: `√72 = a√b` → `6, 2` · input: two numbers · accepted: coef-radicand
- Range: radicands ≤ 300 with square factors from {4, 9, 16, 25, 36, 49, 64, 100, 144}.
- Kernels: `fk.squares-to-20`, `fk.divisibility-check`

#### `alg1.radical-mul` — Multiply square roots
**Medium.** Multiply radicands, then one simplification.
- Sample: `√8 · √2` → `4` · input: single number
- Range: designed so products are perfect squares or simplify to a√b with a, b ≤ 12.
- Kernels: `fk.times-tables`, `alg1.radical-simplify`

#### `alg1.rational-exponent` — Evaluate rational exponents
**High.** Root-then-power as one chunk on friendly bases.
- Sample: `27^(2/3)` → `9` · input: single number
- Range: bases from small perfect powers (4, 8, 9, 16, 25, 27, 32, 64, 81, 100, 125); exponents with numerator ≤ 3.
- Kernels: `fk.sqrt-perfect`, `fk.cubes-small`, `prealg.exponent-eval`

#### `alg1.rational-irrational-classify` — Rational or irrational?
**High.** Recognition against the perfect-square/known-constant table.
- Sample: `Is √50 rational?` → `false` · input: true/false
- Range: square roots (perfect and not), fractions, terminating/repeating decimals, π-multiples.
- Kernels: `fk.sqrt-perfect`

#### `alg1.abs-equation` — Solve |x − a| = k
**Medium.** Split to two cases, each one-step.
- Sample: `|x − 3| = 7` → `10, -4` · input: two numbers · accepted: pair-any-order
- Range: a, k integers ≤ 12; no-solution (k < 0) as true/false variant.
- Kernels: `prealg.abs-value`, `prealg.one-step-equation`

#### `alg1.piecewise-eval` — Evaluate a piecewise function
**Medium.** One branch decision, one substitution.
- Sample: `f(x) = {x² if x < 2; 3x if x ≥ 2}. f(4) = ?` → `12` · input: single number
- Range: two branches, linear/quadratic rules, integer inputs −9…9.
- Kernels: `alg1.function-eval`, `prealg.inequality-truth`

#### `alg1.sequence-arithmetic-next` — Next term, arithmetic sequence
**High.** Spot the common difference, add once.
- Sample: `5, 9, 13, … next?` → `17` · input: single number
- Range: differences −12…12, terms ≤ 200.
- Kernels: `fk.add-multi-digit`

#### `alg1.sequence-arithmetic-nth` — nth term, arithmetic sequence
**Medium.** a₁ + (n−1)d as one chunk.
- Sample: `a₁ = 3, d = 4. a₁₀ = ?` → `39` · input: single number
- Range: d ≤ 12, n ≤ 15.
- Kernels: `fk.times-tables`, `fk.add-multi-digit`

#### `alg1.sequence-geometric-ratio` — Common ratio
**High.** One division.
- Sample: `Ratio of 6, 18, 54, …` → `3` · input: single number
- Range: integer ratios ±2…±6; fraction ratios as reduced-fraction-pair variant.
- Kernels: `fk.div-facts`

#### `alg1.unit-conversion` — Unit analysis / conversion chains
**Low.** Choosing and chaining conversion factors is a modeling task.
- Fast kernels inside: `prealg.unit-rate`, `fk.mul-by-pow10`, `prealg.proportion-solve`. No drillable kernel beyond entries already listed elsewhere.

#### `alg1.graph-line` — Graph a line / read a graphed line
**Low.** Plotting is an interaction the game doesn't host; reading a rendered graph duplicates the algebraic read-offs.
- Fast kernels inside: `alg1.slope-from-equation`, `alg1.intercept-from-equation`, `alg1.x-intercept`, `alg1.point-on-line`

#### `alg1.scatter-association` — Direction of association in a scatterplot
**Medium.** Visual gestalt read; needs a rendered figure (the engine already renders SVG triangles, so figures are feasible).
- Sample: rendered scatterplot → `negative` · input: multiple choice (positive / negative / none)
- Range: 12–20 points, |r| ≥ 0.6 for signal cases.

---

## 6. Geometry (`geom.`)

**Audit checklist:** Khan Academy *High School Geometry* units (Performing transformations · Transformation properties & proofs · Congruence · Similarity · Right triangles & trigonometry · Analytic geometry · Conic sections · Circles · Solid geometry). Proof-writing appears as a Low entry with its recall kernels extracted; right-triangle trig ratio *values* live in §8 (`trig.`) and are cited from here. `geom.congruence-criteria` is shipped and rated in §2. Figure-bearing entries note it; the engine already renders SVG triangles, so small figures are established capability.

#### `geom.angle-pairs-complementary` — Complement of an angle
**High.** One subtraction from 90.
- Sample: `Complement of 37°` → `53` · input: single number
- Range: 1–89.
- Kernels: `fk.sub-multi-digit`

#### `geom.angle-pairs-supplementary` — Supplement of an angle
**High.** One subtraction from 180.
- Sample: `Supplement of 118°` → `62` · input: single number
- Range: 1–179.
- Kernels: `fk.sub-multi-digit`

#### `geom.vertical-angles` — Vertical angles
**High.** Recall: equal.
- Sample: figure, one angle marked 74° → `74` · input: single number (figure)
- Range: 20–160; distractor variants mark the adjacent angle instead.
- Kernels: `geom.angle-pairs-supplementary`

#### `geom.parallel-transversal` — Angles at a transversal
**Medium.** One relationship classification (alternate interior, corresponding, co-interior), then equal-or-supplementary.
- Sample: figure, given 65°, find the marked alternate-interior angle → `65` · input: single number (figure)
- Range: 30–150; all four relationship types.
- Kernels: `geom.vertical-angles`, `geom.angle-pairs-supplementary`

#### `geom.triangle-angle-sum` — Third angle of a triangle
**High.** Subtract a sum from 180.
- Sample: `Angles 58° and 64°. Third angle?` → `58` · input: single number
- Range: positive integer angles.
- Kernels: `fk.add-multi-digit`, `fk.sub-multi-digit`

#### `geom.exterior-angle` — Exterior angle theorem
**Medium.** Recall the remote-interior-sum rule, one addition.
- Sample: `Remote interior angles 40° and 65°. Exterior angle?` → `105` · input: single number
- Range: positive integer angles.
- Kernels: `geom.triangle-angle-sum`, `fk.add-multi-digit`

#### `geom.isosceles-base-angles` — Isosceles triangle angles
**Medium.** One subtraction, one halving.
- Sample: `Isosceles triangle, vertex angle 40°. Base angle?` → `70` · input: single number
- Range: vertex angles even, 10–170.
- Kernels: `geom.triangle-angle-sum`, `fk.doubles-halves`

#### `geom.triangle-inequality` — Can these sides form a triangle?
**High.** One sum-vs-side comparison.
- Sample: `Sides 3, 4, 8?` → `false` · input: true/false
- Range: sides ≤ 30; ~50% degenerate/impossible, near-miss cases oversampled.
- Kernels: `fk.add-within-50`

#### `geom.similarity-scale-factor` — Missing side in similar figures
**Medium.** One proportion.
- Sample: `Sides scale 4 → 6. What does 10 become?` → `15` · input: single number
- Range: integer scale results; ratios with terms ≤ 12.
- Kernels: `prealg.proportion-solve`

#### `geom.similar-criteria` — Which similarity criterion?
**High.** Discriminative — MC native.
- Sample: marked figure → `AA` · input: multiple choice (AA / SAS~ / SSS~ / not similar)
- Range: as `geom.congruence-criteria` with ratio marks.
- Kernels: `geom.congruence-criteria`

#### `geom.pythagorean-triples` — Pythagorean triple recall
**High.** Recall of the standard triples and their multiples.
- Sample: `Legs 6 and 8. Hypotenuse?` → `10` · input: single number
- Range: (3,4,5), (5,12,13), (8,15,17), (7,24,25) and ×2/×3 multiples; leg-finding variants.
- Kernels: `fk.squares-to-20`

#### `geom.pythagorean-converse` — Is it a right triangle?
**High.** Triple recognition (or one square-sum check).
- Sample: `Sides 5, 12, 13: right triangle?` → `true` · input: true/false
- Range: triples vs near-misses (5,12,14).
- Kernels: `geom.pythagorean-triples`, `fk.squares-to-20`

#### `geom.special-right-45` — 45-45-90 sides
**High.** Multiply or divide by √2 — recall-grade.
- Sample: `45-45-90, leg 7. Hypotenuse = a√b:` → `7, 2` · input: two numbers · accepted: coef-radicand
- Range: legs 2–12; hypotenuse-given variants use k√2 inputs.
- Kernels: `fk.sqrt-perfect`

#### `geom.special-right-30-60` — 30-60-90 sides
**Medium.** Recall the 1 : √3 : 2 ladder, one placement decision.
- Sample: `30-60-90, short leg 5. Hypotenuse?` → `10` · input: single number (√3-answers as coef-radicand)
- Range: short legs 2–12.
- Kernels: `geom.special-right-45`, `fk.doubles-halves`

#### `geom.distance-formula` — Distance between two points
**Medium.** Two differences, then triple recognition — constrained to triple-generating pairs.
- Sample: `Distance from (2, 3) to (5, 7)` → `5` · input: single number
- Range: coordinate differences forming Pythagorean triples only.
- Kernels: `prealg.int-sub-signed`, `geom.pythagorean-triples`

#### `geom.midpoint` — Midpoint of a segment
**Medium.** Two averages.
- Sample: `Midpoint of (2, 8) and (6, 4)` → `4, 6` · input: two numbers · accepted: pair-ordered (x, y)
- Range: even coordinate sums for integer answers; −12…12.
- Kernels: `prealg.mean-small`

#### `geom.polygon-angle-sum` — Interior angle sum of a polygon
**Medium.** (n−2)·180 as one chunk.
- Sample: `Interior angle sum of a hexagon` → `720` · input: single number
- Range: n = 3–12, named or given as n.
- Kernels: `fk.times-tables`

#### `geom.regular-polygon-angle` — Each angle of a regular polygon
**Medium.** Sum then divide; friendly n keeps it mental.
- Sample: `Each interior angle of a regular pentagon` → `108` · input: single number
- Range: n in {3, 4, 5, 6, 8, 9, 10, 12}.
- Kernels: `geom.polygon-angle-sum`, `fk.div-facts`

#### `geom.quadrilateral-hierarchy` — Quadrilateral property facts
**High.** Recall of the parallelogram/rhombus/rectangle/square hierarchy.
- Sample: `Every rhombus is a parallelogram.` → `true` · input: true/false
- Range: hierarchy claims plus diagonal properties (bisect, perpendicular, congruent); ~50% true.

#### `geom.area-parallelogram` — Area of a parallelogram
**High.** One multiplication (the trap is using the slant side — figure variants test it).
- Sample: `Base 8, height 5. Area?` → `40` · input: single number
- Range: dimensions 2–20; figure variant includes a decoy slant length.
- Kernels: `prealg.area-rect-triangle`

#### `geom.area-trapezoid` — Area of a trapezoid
**Medium.** Average the bases, multiply by height.
- Sample: `Bases 6 and 10, height 4. Area?` → `32` · input: single number
- Range: even base sums; dimensions ≤ 20.
- Kernels: `prealg.mean-small`, `fk.times-tables`

#### `geom.circumference-pi` — Circumference as a π-multiple
**High.** Double the radius.
- Sample: `Radius 7. Circumference = kπ. k = ?` → `14` · input: single number · accepted: pi-coefficient
- Range: radii/diameters 2–20.
- Kernels: `fk.doubles-halves`

#### `geom.area-circle-pi` — Circle area as a π-multiple
**High.** Square the radius.
- Sample: `Radius 6. Area = kπ. k = ?` → `36` · input: single number · accepted: pi-coefficient
- Range: radii 2–20.
- Kernels: `fk.squares-to-20`

#### `geom.arc-length-fraction` — Arc length from a central angle
**Medium.** One fraction-of-circle read, one multiplication.
- Sample: `90° arc, circumference 24π. Arc length = kπ. k = ?` → `6` · input: single number · accepted: pi-coefficient
- Range: angles from {30, 45, 60, 90, 120, 180, 270}; clean circumferences.
- Kernels: `geom.circumference-pi`, `prealg.fraction-of-number`

#### `geom.sector-area` — Sector area from a central angle
**Medium.** Same fraction-of-circle move on area.
- Sample: `60° sector, circle area 36π. Sector = kπ. k = ?` → `6` · input: single number · accepted: pi-coefficient
- Range: as `geom.arc-length-fraction`.
- Kernels: `geom.area-circle-pi`, `prealg.fraction-of-number`

#### `geom.central-inscribed-angle` — Inscribed angle theorem
**Medium.** Halve (or double) across the theorem.
- Sample: `Inscribed angle on an 80° arc` → `40` · input: single number
- Range: even arcs 20–180; Thales (semicircle → 90°) oversampled.
- Kernels: `fk.doubles-halves`

#### `geom.tangent-radius-facts` — Tangent and chord facts
**High.** Recall (tangent ⊥ radius; equal tangents from a point; perpendicular from center bisects chord).
- Sample: `A tangent is perpendicular to the radius at the point of tangency.` → `true` · input: true/false
- Range: fact claims, ~50% true with plausible false variants.

#### `geom.circle-equation-center` — Center from circle equation
**High.** Sign-flip read of (x−h)² + (y−k)² = r².
- Sample: `Center of (x − 3)² + (y + 2)² = 25` → `3, -2` · input: two numbers · accepted: pair-ordered (x, y)
- Range: h, k −12…12.
- Kernels: `prealg.int-sub-signed`

#### `geom.circle-equation-radius` — Radius from circle equation
**High.** One square root.
- Sample: `Radius of x² + y² = 49` → `7` · input: single number
- Range: r² from perfect squares to 400.
- Kernels: `fk.sqrt-perfect`

#### `geom.volume-prism-cylinder` — Volume of prisms and cylinders
**Medium.** Base area times height.
- Sample: `Cylinder r = 3, h = 5. Volume = kπ. k = ?` → `45` · input: single number · accepted: pi-coefficient
- Range: dimensions 2–12.
- Kernels: `geom.area-circle-pi`, `fk.times-tables`

#### `geom.volume-cone-sphere` — Volume of cones, pyramids, spheres
**Medium.** Formula recall plus one clean evaluation.
- Sample: `Cone r = 3, h = 4. Volume = kπ. k = ?` → `12` · input: single number · accepted: pi-coefficient
- Range: values chosen so the ⅓ or 4/3 factor cancels to integers.
- Kernels: `geom.volume-prism-cylinder`, `prealg.fraction-of-number`

#### `geom.surface-area` — Surface area of solids
**Low.** Summing several face areas is multi-step at any fluency.
- Fast kernels inside: `prealg.area-rect-triangle`, `geom.area-circle-pi`, `geom.circumference-pi`, `fk.add-multi-digit`

#### `geom.transformation-identify` — Name the transformation
**High.** Gestalt read of a before/after figure.
- Sample: rendered pre/post figure → `rotation` · input: multiple choice (translation / reflection / rotation / dilation)
- Range: single transformations, unambiguous cases.

#### `geom.reflect-point` — Reflect a point over an axis
**High.** One sign flip.
- Sample: `Reflect (3, −5) over the x-axis` → `3, 5` · input: two numbers · accepted: pair-ordered (x, y)
- Range: coordinates −12…12; over x-axis, y-axis, and y = x.
- Kernels: `prealg.coordinate-quadrant`

#### `geom.rotate-point-90` — Rotate a point 90°/180° about the origin
**Medium.** One coordinate-swap-and-flip rule.
- Sample: `Rotate (2, 5) 90° counterclockwise` → `-5, 2` · input: two numbers · accepted: pair-ordered (x, y)
- Range: coordinates −12…12; 90° CW, 90° CCW, 180°.
- Kernels: `geom.reflect-point`

#### `geom.translate-point` — Translate a point
**High.** Two additions.
- Sample: `(3, 4) translated by ⟨−2, 6⟩` → `1, 10` · input: two numbers · accepted: pair-ordered (x, y)
- Range: coordinates and shifts −12…12.
- Kernels: `prealg.int-add-signed`

#### `geom.dilate-point` — Dilate a point from the origin
**High.** Two multiplications.
- Sample: `Dilate (2, 3) by factor 3` → `6, 9` · input: two numbers · accepted: pair-ordered (x, y)
- Range: factors ½–5 (half only on even coordinates).
- Kernels: `fk.times-tables`

#### `geom.trig-ratio-identify` — Which trig ratio fits the figure?
**Medium.** Discriminative read of a labeled right triangle — MC native.
- Sample: labeled triangle, "which ratio equals opposite/hypotenuse for θ?" → `sin θ` · input: multiple choice (figure)
- Range: sin/cos/tan from each acute angle.
- Kernels: `geom.pythagorean-triples`

#### `geom.proof-two-column` — Write a congruence/similarity proof
**Low.** Proof construction is the definitional multi-step task.
- Fast kernels inside: `geom.congruence-criteria`, `geom.similar-criteria`, `geom.vertical-angles`, `geom.parallel-transversal`, `geom.quadrilateral-hierarchy`

#### `geom.area-composite` — Area of composite figures
**Low.** Decompose-then-sum is multi-step.
- Fast kernels inside: `prealg.area-rect-triangle`, `geom.area-circle-pi`, `geom.area-trapezoid`. No drillable kernel beyond entries already listed elsewhere.

#### `geom.solid-cross-sections` — Cross-sections and rotations of solids
**Medium.** Spatial recall — MC native.
- Sample: `A plane parallel to the base cuts a cone. The cross-section is a…` → `circle` · input: multiple choice
- Range: cones, cylinders, spheres, prisms, pyramids; parallel and perpendicular cuts.

---

## 7. Algebra 2 (`alg2.`)

**Audit checklist:** Khan Academy *Algebra 2* units (Polynomial arithmetic · Complex numbers · Polynomial factorization · Polynomial division · Polynomial graphs · Rational exponents & radicals · Exponential models · Logarithms · Transformations of functions · Equations · Trigonometry · Modeling · Rational functions), plus the sequences/series and combinatorics units of the standard Algebra 2 course. The trigonometry unit lives in §8 (`trig.`); modeling appears as a Low entry.

#### `alg2.i-powers` — Powers of i
**High.** Mod-4 recall.
- Sample: `i⁷ = ?` → `−i` · input: multiple choice (1, i, −1, −i)
- Range: exponents 2–40.

#### `alg2.complex-add` — Add/subtract complex numbers
**Medium.** Two component operations.
- Sample: `(3 + 2i) + (5 − 7i) = a + bi` → `8, -5` · input: two numbers · accepted: pair-ordered (a, b)
- Range: components −12…12.
- Kernels: `prealg.int-add-signed`

#### `alg2.complex-conjugate` — Complex conjugate
**High.** One sign flip.
- Sample: `Conjugate of 4 − 3i = a + bi` → `4, 3` · input: two numbers · accepted: pair-ordered (a, b)
- Range: components −12…12.

#### `alg2.complex-magnitude` — Magnitude of a complex number
**Medium.** Pythagorean-triple recognition on the components.
- Sample: `|3 + 4i|` → `5` · input: single number
- Range: components from Pythagorean triples.
- Kernels: `geom.pythagorean-triples`

#### `alg2.complex-mul` — Multiply complex numbers
**Low.** Four products plus an i²-fold — genuinely multi-step.
- Fast kernels inside: `alg1.binomial-mul`, `alg2.i-powers`, `prealg.int-mul-signed`

#### `alg2.vertex-form-read` — Vertex from vertex form
**High.** Sign-aware read of a(x−h)² + k.
- Sample: `Vertex of y = (x − 3)² + 7` → `3, 7` · input: two numbers · accepted: pair-ordered (h, k)
- Range: h, k −12…12; a ≠ 1 as noise.
- Kernels: `geom.circle-equation-center`

#### `alg2.complete-square-term` — The completing-the-square constant
**High.** Halve b, square it.
- Sample: `x² + 10x + ? is a perfect square` → `25` · input: single number
- Range: even b, |b| ≤ 24.
- Kernels: `fk.doubles-halves`, `fk.squares-to-20`

#### `alg2.complete-square-full` — Rewrite in vertex form by completing the square
**Low.** Multi-step rewrite with bookkeeping.
- Fast kernels inside: `alg2.complete-square-term`, `alg2.vertex-form-read`, `prealg.int-add-signed`

#### `alg2.factor-cubes` — Factor sum/difference of cubes
**Medium.** Pattern recall; the quadratic factor makes entry long, so an MC fallback is acceptable here.
- Sample: `x³ − 27` → `(x-3)(x^2+3x+9)` · input: short expression · accepted: factored-form
- Range: cubes of 1–6.
- Kernels: `fk.cubes-small`, `alg1.factor-technique-recognize`

#### `alg2.factor-by-grouping` — Factor a four-term polynomial by grouping
**Low.** Two GCF pulls plus a re-factor — multi-step.
- Fast kernels inside: `alg1.factor-gcf`, `alg1.factor-pairs-sum-product`

#### `alg2.poly-end-behavior` — End behavior from the leading term
**High.** Degree parity + leading sign, one read.
- Sample: `As x → ∞, −2x⁵ → ?` → `−∞` · input: multiple choice (arrow-pair options)
- Range: degrees 2–7, leading coefficients −9…9.
- Kernels: `prealg.sign-of-power`

#### `alg2.zero-multiplicity` — Multiplicity of a zero
**High.** Exponent read from factored form.
- Sample: `Multiplicity of x = 2 in (x − 2)³(x + 1)` → `3` · input: single number
- Range: multiplicities 1–4; 2–3 factors.
- Kernels: `alg1.quadratic-roots-factored`

#### `alg2.multiplicity-graph-behavior` — Cross or touch at a zero?
**High.** Parity read of the multiplicity.
- Sample: `At a zero of multiplicity 2, the graph…` → `touches and turns` · input: multiple choice
- Range: multiplicities 1–4.
- Kernels: `alg2.zero-multiplicity`

#### `alg2.remainder-theorem` — Remainder via p(c)
**Medium.** One substitution into a small cubic.
- Sample: `Remainder of x³ − 2x + 1 ÷ (x − 2)` → `5` · input: single number
- Range: |c| ≤ 3, coefficients −9…9, ≤ 4 terms.
- Kernels: `alg1.function-eval`, `fk.cubes-small`

#### `alg2.factor-theorem-check` — Is (x − c) a factor?
**Medium.** One p(c) = 0 check.
- Sample: `Is (x − 3) a factor of x² − 9x + 18?` → `true` · input: true/false
- Range: as `alg2.remainder-theorem`; ~50% true.
- Kernels: `alg2.remainder-theorem`

#### `alg2.poly-division` — Polynomial long/synthetic division
**Low.** Iterated divide-multiply-subtract — multi-step by construction.
- Fast kernels inside: `alg2.remainder-theorem`, `alg1.monomial-mul`, `prealg.int-sub-signed`

#### `alg2.rational-zero-candidates` — Possible rational zeros
**Medium.** p/q factor listing for small cases.
- Sample: `How many candidates ±p/q does 2x³ + … + 3 have with p from 3?` → MC listing variants; canonical: `±1, ±3, ±1/2, ±3/2` · input: multiple choice
- Range: constant/leading terms with 2–4 factor pairs.
- Kernels: `fk.divisibility-check`

#### `alg2.rational-simplify` — Simplify a rational expression
**Medium.** Factor-and-cancel with monic factors.
- Sample: `(x² − 9)/(x + 3)` → `x-3` · input: short expression · accepted: expression-canonical
- Range: difference-of-squares and monic-trinomial numerators; linear denominators.
- Kernels: `alg1.factor-diff-squares`, `alg1.factor-trinomial-monic`

#### `alg2.rational-excluded-value` — Excluded values of a rational expression
**High.** Set the denominator's factor to zero.
- Sample: `Excluded value of 5/(x − 4)` → `4` · input: single number
- Range: linear denominators; factored quadratic denominators as two-numbers variant.
- Kernels: `alg1.quadratic-roots-factored`

#### `alg2.rational-mul-div` — Multiply/divide rational expressions
**Low.** Factor twice, cancel across four positions.
- Fast kernels inside: `alg2.rational-simplify`, `alg1.factor-trinomial-monic`, `prealg.fraction-mul`

#### `alg2.rational-add` — Add rational expressions
**Low.** LCD over polynomials plus distribution.
- Fast kernels inside: `fk.common-denominator`, `prealg.distribute`, `prealg.combine-like-terms`

#### `alg2.radical-equation-simple` — Solve √(x + a) = b
**Medium.** Square both sides, one-step solve.
- Sample: `√(x + 5) = 3` → `4` · input: single number
- Range: b 2–12; extraneous-solution true/false variant ("does x = … check?").
- Kernels: `fk.squares-to-20`, `prealg.one-step-equation`

#### `alg2.rational-exponent-convert` — Radical ↔ rational exponent
**High.** Direct notation swap.
- Sample: `√(x³) = x^(a/b)` → `3, 2` · input: two numbers · accepted: pair-ordered (a, b)
- Range: roots 2–4, powers 1–5.
- Kernels: `alg1.rational-exponent`

#### `alg2.log-eval-exact` — Evaluate exact logarithms
**High.** Inverse-power recall.
- Sample: `log₂ 32` → `5` · input: single number
- Range: bases 2, 3, 5, 10; integer results −3…6 (fractional results as reduced-fraction-pair variant).
- Kernels: `fk.powers-of-two`, `prealg.exponent-eval`

#### `alg2.log-exponential-convert` — Log form ↔ exponential form
**High.** Notation swap.
- Sample: `log₃ 81 = 4 means 3^? = 81` → `4` · input: single number
- Range: as `alg2.log-eval-exact`.
- Kernels: `alg2.log-eval-exact`

#### `alg2.log-product-rule` — Product/quotient rules for logs
**High.** One rule application on exact values.
- Sample: `log₂ 8 + log₂ 4` → `5` · input: single number
- Range: arguments multiplying to exact powers.
- Kernels: `alg2.log-eval-exact`

#### `alg2.log-power-rule` — Power rule for logs
**High.** Pull the exponent, multiply.
- Sample: `log₃ (9⁵)` → `10` · input: single number
- Range: inner values as exact powers; exponents 2–6.
- Kernels: `alg2.log-eval-exact`, `fk.times-tables`

#### `alg2.ln-e-eval` — Natural log / e recall
**High.** ln eˣ = x and eˡⁿ ˣ = x.
- Sample: `ln e⁷` → `7` · input: single number
- Range: exponents −3…9, both directions.
- Kernels: `alg2.log-exponential-convert`

#### `alg2.exponential-solve-common-base` — Solve aˣ = b, exact case
**Medium.** Rewrite b as a power of a.
- Sample: `2ˣ = 64` → `6` · input: single number
- Range: bases 2, 3, 5, 10; includes rewrite cases like 4ˣ = 32 (fraction answers as reduced-fraction-pair).
- Kernels: `fk.powers-of-two`, `alg2.log-eval-exact`, `prealg.exponent-power-rule`

#### `alg2.exponential-solve-logs` — Solve aˣ = b, log case
**Low.** Requires taking logs and dividing — calculator-bound in practice.
- Fast kernels inside: `alg2.log-power-rule`, `alg2.log-exponential-convert`. No drillable kernel beyond entries already listed elsewhere.

#### `alg2.function-composition-eval` — Evaluate a composition
**Medium.** Two chained evaluations.
- Sample: `f(x) = 2x + 1, g(x) = x². f(g(2)) = ?` → `9` · input: single number
- Range: linear/quadratic pairs, inputs −5…5.
- Kernels: `alg1.function-eval`

#### `alg2.inverse-function-eval` — Read an inverse's value
**Medium.** Swap the pair: f(a) = b ⟹ f⁻¹(b) = a.
- Sample: `f(3) = 11. f⁻¹(11) = ?` → `3` · input: single number
- Range: small tables or linear rules.
- Kernels: `alg1.function-notation-read`

#### `alg2.inverse-linear` — Inverse of a linear function
**Medium.** Un-do the two steps in reverse.
- Sample: `Inverse of f(x) = 3x − 6` → `(x+6)/3` · input: short expression · accepted: expression-canonical
- Range: coefficients −9…9.
- Kernels: `prealg.two-step-equation`, `alg1.literal-equation-onestep`

#### `alg2.transform-identify` — Identify a function transformation
**High.** Read the shift/stretch/reflection off the rule.
- Sample: `y = f(x − 3) + 2 moves the graph…` → `right 3, up 2` · input: multiple choice
- Range: single and paired transformations; sign traps oversampled.
- Kernels: `alg2.vertex-form-read`

#### `alg2.even-odd-function` — Even, odd, or neither
**Medium.** One f(−x) substitution read.
- Sample: `x³ − x is…` → `odd` · input: multiple choice (even / odd / neither)
- Range: polynomials ≤ 4 terms; |x| and mixed cases.
- Kernels: `prealg.sign-of-power`

#### `alg2.domain-radical` — Domain of a square-root function
**Medium.** One inequality solve.
- Sample: `Domain of √(x − 5)` → `x ≥ 5` · input: multiple choice (boundary + direction variants)
- Range: linear radicands, integer boundaries.
- Kernels: `prealg.inequality-flip`

#### `alg2.asymptote-vertical` — Vertical asymptote
**High.** Zero of the denominator.
- Sample: `Vertical asymptote of 1/(x − 3)` → `3` · input: single number
- Range: linear denominators; factored quadratics as two-numbers variant (excluding holes — see `alg2.hole-vs-asymptote`).
- Kernels: `alg2.rational-excluded-value`

#### `alg2.asymptote-horizontal` — Horizontal asymptote
**Medium.** Degree comparison, then leading-coefficient ratio.
- Sample: `HA of (2x² + 1)/(x² − 4)` → `2` · input: single number
- Range: degree pairs 0–3; y = 0 and none cases as MC variant.
- Kernels: `alg1.poly-degree`, `fk.fraction-simplify`

#### `alg2.hole-vs-asymptote` — Hole or asymptote?
**Medium.** Does the factor cancel?
- Sample: `In (x−3)(x+1)/(x−3)(x−5), x = 3 is a…` → `hole` · input: multiple choice
- Range: factored rational functions, 2–3 linear factors.
- Kernels: `alg2.rational-simplify`, `alg2.asymptote-vertical`

#### `alg2.sequence-geometric-nth` — nth term, geometric sequence
**Medium.** a₁·rⁿ⁻¹ with small powers.
- Sample: `a₁ = 2, r = 3. a₅ = ?` → `162` · input: single number
- Range: r ±2…±4, n ≤ 6.
- Kernels: `prealg.exponent-eval`, `alg1.sequence-geometric-ratio`

#### `alg2.series-arithmetic-sum` — Sum of an arithmetic series
**Low.** Formula recall plus multi-value evaluation.
- Fast kernels inside: `prealg.mean-small`, `fk.times-tables`, `alg1.sequence-arithmetic-nth`

#### `alg2.series-geometric-infinite` — Sum of an infinite geometric series
**Medium.** a/(1 − r) on clean values.
- Sample: `8 + 4 + 2 + 1 + … = ?` → `16` · input: single number
- Range: |r| in {1/2, 1/3, 1/4, 1/10}, integer sums.
- Kernels: `alg1.sequence-geometric-ratio`, `prealg.fraction-div`

#### `alg2.binomial-coefficient` — Compute C(n, k)
**Medium.** One formula chunk at small n.
- Sample: `C(6, 2)` → `15` · input: single number
- Range: n ≤ 10, k ≤ 4 (symmetry cases included).
- Kernels: `fk.times-tables`, `fk.div-facts`

#### `alg2.binomial-expansion-coefficient` — Coefficient in a binomial expansion
**Medium.** Pascal-row recall or one C(n,k) computation.
- Sample: `Coefficient of x²y² in (x + y)⁴` → `6` · input: single number
- Range: n ≤ 6; (x + 2y)-style inner coefficients at higher difficulty (one extra power step).
- Kernels: `alg2.binomial-coefficient`, `prealg.exponent-eval`

#### `alg2.permutation-count` — Compute P(n, k)
**Medium.** Falling-factorial chunk.
- Sample: `P(5, 2)` → `20` · input: single number
- Range: n ≤ 10, k ≤ 3.
- Kernels: `fk.times-tables`

#### `alg2.probability-compound` — Compound probability
**Low.** Modeling independence/dependence, then fraction chains.
- Fast kernels inside: `prealg.probability-simple`, `prealg.fraction-mul`

#### `alg2.abs-inequality` — Solve |x| < k and |x| > k
**Medium.** One split rule.
- Sample: `|x| < 5 means…` → `−5 < x < 5` · input: multiple choice
- Range: k 1–20; |x − a| variants at higher difficulty.
- Kernels: `alg1.abs-equation`

#### `alg2.discriminant-complex` — Complex roots from the discriminant
**High.** Sign read extended to ℂ.
- Sample: `Discriminant = −16: the roots are…` → `2 complex (non-real)` · input: multiple choice
- Range: as `alg1.discriminant-root-count`.
- Kernels: `alg1.discriminant-root-count`

#### `alg2.system-3var` — Solve a 3×3 linear system
**Low.** Elimination at depth — the canonical paper task.
- Fast kernels inside: `alg1.system-elimination`, `prealg.combine-like-terms`. No drillable kernel beyond entries already listed elsewhere.

#### `alg2.modeling-word-problems` — Exponential/quadratic modeling problems
**Low.** Reading, translating, and choosing a model dominate.
- Fast kernels inside: `alg1.exponential-growth-factor`, `alg1.vertex-x`, `prealg.percent-to-decimal`. No drillable kernel beyond entries already listed elsewhere.

---

## 8. Trigonometry / Precalculus (`trig.`)

**Audit checklist:** Khan Academy *Precalculus* units (Composite & inverse functions · Trigonometry · Complex numbers · Rational functions · Conic sections · Vectors · Matrices · Probability & combinatorics · Series · Limits & continuity). Composite/inverse functions, rational functions, and combinatorics are covered in §7; limits & continuity live in §9 (`calcab.`). Exact-value trigonometry here is the single richest vein of High-rated content above Algebra 2.

#### `trig.deg-to-rad` — Degrees → radians
**High.** Recall of the standard set; one fraction otherwise.
- Sample: `150° = aπ/b` → `5, 6` · input: two numbers · accepted: reduced-fraction-pair (of π)
- Range: multiples of 15° in 0–360°.
- Kernels: `fk.fraction-simplify`

#### `trig.rad-to-deg` — Radians → degrees
**High.** Same recall in reverse.
- Sample: `π/3 in degrees` → `60` · input: single number
- Range: denominators 2, 3, 4, 6, 12; multiples through 2π.
- Kernels: `trig.deg-to-rad`

#### `trig.exact-sin` — Exact sine values, first quadrant
**High.** Pure recall of the 0/30/45/60/90 table.
- Sample: `sin 30°` → `1, 2` · input: two numbers · accepted: reduced-fraction-pair (√-values as MC: √2/2, √3/2)
- Range: {0°, 30°, 45°, 60°, 90°} and radian twins.
- Kernels: `trig.deg-to-rad`

#### `trig.exact-cos` — Exact cosine values, first quadrant
**High.** Same table, co-side.
- Sample: `cos 60°` → `1, 2` · input: two numbers · accepted: reduced-fraction-pair (√-values as MC)
- Range: as `trig.exact-sin`.
- Kernels: `trig.exact-sin`

#### `trig.exact-tan` — Exact tangent values, first quadrant
**High.** Recall (0, √3/3, 1, √3, undefined).
- Sample: `tan 45°` → `1` · input: single number (√-values and "undefined" as MC)
- Range: as `trig.exact-sin`.
- Kernels: `trig.exact-sin`, `trig.exact-cos`

#### `trig.quadrant-signs` — Sign of a trig function by quadrant
**High.** ASTC recall.
- Sample: `Sign of cos θ in QIII` → `negative` · input: multiple choice
- Range: sin/cos/tan × QI–QIV.
- Kernels: `prealg.coordinate-quadrant`

#### `trig.reference-angle` — Reference angle
**High.** One fold to the first quadrant.
- Sample: `Reference angle of 210°` → `30` · input: single number
- Range: multiples of 15° in 0–360°; radian variants.
- Kernels: `geom.angle-pairs-supplementary`

#### `trig.exact-values-any-quadrant` — Exact values beyond QI
**Medium.** Reference angle plus sign — two chunked steps.
- Sample: `sin 5π/6` → `1, 2` · input: two numbers · accepted: reduced-fraction-pair (√-values as MC)
- Range: special angles through 2π, all quadrants.
- Kernels: `trig.exact-sin`, `trig.reference-angle`, `trig.quadrant-signs`

#### `trig.cofunction` — Cofunction identities
**High.** 90° − θ swap.
- Sample: `cos 20° = sin ?°` → `70` · input: single number
- Range: 1–89.
- Kernels: `geom.angle-pairs-complementary`

#### `trig.pythagorean-identity-triple` — Find cos from sin (triples)
**Medium.** Triple recognition plus a quadrant sign.
- Sample: `sin θ = 3/5, θ in QI. cos θ = ?` → `4, 5` · input: two numbers · accepted: reduced-fraction-pair
- Range: Pythagorean-triple ratios; all quadrants at higher difficulty.
- Kernels: `geom.pythagorean-triples`, `trig.quadrant-signs`

#### `trig.reciprocal-identities` — Reciprocal function values
**High.** One flip on an exact value.
- Sample: `sec 60°` → `2` · input: single number (fraction/√ answers as MC)
- Range: sec/csc/cot at special angles.
- Kernels: `trig.exact-cos`, `prealg.reciprocal`

#### `trig.identity-recall` — Core identity recall
**High.** Discriminative recall — MC native.
- Sample: `sin²θ + cos²θ = ?` → `1` · input: multiple choice
- Range: Pythagorean family (three forms), quotient identity, even/odd properties.
- Kernels: `trig.exact-sin`

#### `trig.amplitude-read` — Amplitude of a sinusoid
**High.** |a| read.
- Sample: `Amplitude of y = −4 sin(3x)` → `4` · input: single number
- Range: |a| 1–12.
- Kernels: `prealg.abs-value`

#### `trig.period-read` — Period of a sinusoid
**Medium.** 2π/|b| as one step.
- Sample: `Period of y = sin(3x) is aπ/b` → `2, 3` · input: two numbers · accepted: reduced-fraction-pair (of π)
- Range: b in 1–8 and 1/2, 1/3; tan-period variants.
- Kernels: `fk.fraction-simplify`

#### `trig.midline-read` — Midline of a sinusoid
**High.** Vertical-shift read.
- Sample: `Midline of y = 3 sin(x) + 5` → `5` · input: single number
- Range: shifts −12…12.
- Kernels: `alg2.transform-identify`

#### `trig.phase-shift-read` — Phase shift of a sinusoid
**Medium.** Sign-aware read of (x − c).
- Sample: `y = sin(x − π/4) shifts…` → `right π/4` · input: multiple choice
- Range: shifts of π/6, π/4, π/3, π/2 both directions; factored vs unfactored forms.
- Kernels: `alg2.transform-identify`

#### `trig.inverse-trig-exact` — Exact inverse-trig values
**Medium.** Reverse table lookup plus range bookkeeping.
- Sample: `arcsin(1/2) in degrees` → `30` · input: single number
- Range: table values; principal-range traps (arccos(−1/2) → 120°) at higher difficulty.
- Kernels: `trig.exact-sin`, `trig.reference-angle`

#### `trig.solve-basic-equation` — Solve sin x = k on [0°, 360°)
**Medium.** One table lookup plus the second-quadrant twin.
- Sample: `sin x = 1/2. Solutions in [0°, 360°)?` → `30, 150` · input: two numbers · accepted: pair-any-order
- Range: table values of sin/cos/tan; radian variants.
- Kernels: `trig.inverse-trig-exact`, `trig.exact-values-any-quadrant`

#### `trig.sum-formula-recall` — Sum/difference formula recall
**High.** Discriminative recall — MC native.
- Sample: `sin(a + b) = ?` → `sin a cos b + cos a sin b` · input: multiple choice
- Range: sin/cos sum and difference; sign-trap distractors.
- Kernels: `trig.identity-recall`

#### `trig.double-angle-recall` — Double-angle formula recall
**High.** MC native; the three cos 2θ forms are the point.
- Sample: `cos 2θ = ?` → `1 − 2sin²θ` (any correct form) · input: multiple choice
- Range: sin 2θ, cos 2θ (all three forms), tan 2θ.
- Kernels: `trig.sum-formula-recall`

#### `trig.double-angle-eval` — Evaluate sin 2θ from a triple
**Medium.** 2·sin·cos on recalled triple values — chunked but dense; top of Medium.
- Sample: `sin θ = 3/5, QI. sin 2θ = ?` → `24, 25` · input: two numbers · accepted: reduced-fraction-pair
- Range: triple ratios only, QI first.
- Kernels: `trig.double-angle-recall`, `trig.pythagorean-identity-triple`, `prealg.fraction-mul`

#### `trig.sum-formula-apply` — Evaluate sin 15°-type exact values
**Low.** Formula + two exact values + radical arithmetic.
- Fast kernels inside: `trig.sum-formula-recall`, `trig.exact-sin`, `trig.exact-cos`, `alg1.radical-mul`

#### `trig.identity-verify` — Verify a trig identity
**Low.** Open-ended algebraic derivation.
- Fast kernels inside: `trig.identity-recall`, `trig.reciprocal-identities`, `trig.pythagorean-identity-triple`. No drillable kernel beyond entries already listed elsewhere.

#### `trig.law-of-sines` — Law of sines problems
**Low.** Set up a proportion across a figure, then multi-step evaluation.
- Fast kernels inside: `trig.exact-sin`, `prealg.proportion-solve`, `trig.sum-formula-recall`

#### `trig.law-of-cosines` — Law of cosines problems
**Low.** The canonical slow topic: squares, products, a cosine, then a root.
- Fast kernels inside: `trig.exact-cos`, `fk.squares-to-20`, `fk.sqrt-perfect`, `prealg.int-mul-signed`, `fk.order-of-operations`

#### `trig.polar-to-rect` — Polar point → rectangular
**Medium.** Two exact-value multiplications.
- Sample: `(r, θ) = (2, 60°). x = ?` → `1` · input: single number (√-coordinates as coef-radicand)
- Range: r 1–6, special angles.
- Kernels: `trig.exact-cos`, `trig.exact-sin`

#### `trig.complex-polar-modulus` — Modulus/argument of a complex number
**Medium.** Same skill as `alg2.complex-magnitude` plus a quadrant read for the argument.
- Sample: `Argument of 1 + i (degrees)` → `45` · input: single number
- Range: components from triples and 45°/30°/60° families.
- Kernels: `alg2.complex-magnitude`, `trig.quadrant-signs`

#### `trig.vector-add` — Add vectors componentwise
**High.** Two additions.
- Sample: `⟨2, 3⟩ + ⟨−1, 5⟩` → `1, 8` · input: two numbers · accepted: pair-ordered (x, y)
- Range: components −12…12.
- Kernels: `geom.translate-point`

#### `trig.vector-scalar` — Scale a vector
**High.** Two multiplications.
- Sample: `3⟨2, −4⟩` → `6, -12` · input: two numbers · accepted: pair-ordered (x, y)
- Range: scalars −5…5, components −12…12.
- Kernels: `geom.dilate-point`

#### `trig.vector-magnitude` — Magnitude of a vector
**Medium.** Triple recognition.
- Sample: `|⟨3, 4⟩|` → `5` · input: single number
- Range: triple components; non-triple as coef-radicand at higher difficulty.
- Kernels: `geom.pythagorean-triples`, `alg1.radical-simplify`

#### `trig.dot-product` — Dot product
**Medium.** Two products, one sum.
- Sample: `⟨2, 3⟩ · ⟨4, −1⟩` → `5` · input: single number
- Range: components −9…9.
- Kernels: `prealg.int-mul-signed`, `prealg.int-add-signed`

#### `trig.dot-perpendicular` — Perpendicularity by dot product
**High.** Zero-check.
- Sample: `Are ⟨2, 3⟩ and ⟨−3, 2⟩ perpendicular?` → `true` · input: true/false
- Range: ~50% true (rotated pairs), near-miss false cases.
- Kernels: `trig.dot-product`

#### `trig.matrix-add-entry` — Add matrices (one entry)
**High.** One addition at a named position.
- Sample: `(A + B)₁₂ for small given A, B` → answer · input: single number
- Range: 2×2, entries −12…12.
- Kernels: `prealg.int-add-signed`

#### `trig.matrix-scalar-entry` — Scale a matrix (one entry)
**High.** One multiplication.
- Sample: `(3A)₂₁` → answer · input: single number
- Range: 2×2, scalars −5…5.
- Kernels: `prealg.int-mul-signed`

#### `trig.matrix-mul-entry` — Matrix product, one entry
**Medium.** A row-dot-column — the dot product in disguise.
- Sample: `(AB)₁₁ for given 2×2 A, B` → answer · input: single number
- Range: entries −9…9.
- Kernels: `trig.dot-product`

#### `trig.determinant-2x2` — 2×2 determinant
**High.** ad − bc as one chunk.
- Sample: `det [[3, 1], [4, 2]]` → `2` · input: single number
- Range: entries −9…9.
- Kernels: `prealg.int-mul-signed`, `prealg.int-sub-signed`

#### `trig.conic-identify` — Identify the conic from its equation
**High.** Discriminative read — MC native.
- Sample: `x²/9 + y²/4 = 1 is a…` → `ellipse` · input: multiple choice (circle / ellipse / parabola / hyperbola)
- Range: standard forms, including sign and square-presence traps.
- Kernels: `geom.circle-equation-center`

#### `trig.ellipse-axes` — Semi-axes of an ellipse
**High.** Square-root read of the denominators.
- Sample: `Semi-major axis of x²/25 + y²/9 = 1` → `5` · input: single number
- Range: perfect-square denominators to 144.
- Kernels: `fk.sqrt-perfect`

#### `trig.parabola-focus` — Focus of a parabola from 4p form
**Medium.** One 4p read, one division.
- Sample: `y² = 12x. Focus = (a, 0). a = ?` → `3` · input: single number
- Range: 4p multiples of 4 up to 48, both orientations.
- Kernels: `fk.div-facts`

#### `trig.hyperbola-asymptote-slope` — Asymptote slopes of a hyperbola
**Medium.** ±b/a read from standard form.
- Sample: `Asymptote slope of x²/9 − y²/4 = 1 (positive one)` → `2, 3` · input: two numbers · accepted: reduced-fraction-pair
- Range: perfect-square denominators.
- Kernels: `trig.ellipse-axes`, `fk.fraction-simplify`

#### `trig.factorial-eval` — Evaluate factorials
**High.** Recall through 8!.
- Sample: `6!` → `720` · input: single number
- Range: 0! through 8!; ratio forms (7!/5!) as a Medium variant folded here.
- Kernels: `fk.times-tables`

#### `trig.sigma-notation-eval` — Evaluate a small sigma sum
**Medium.** Expand 3–4 terms and add.
- Sample: `Σₖ₌₁⁴ k²` → `30` · input: single number
- Range: k², 2k+1, small geometric terms; ≤ 4 terms.
- Kernels: `fk.squares-to-20`, `fk.add-multi-digit`

#### `trig.parametric-eliminate` — Eliminate the parameter, linear case
**Medium.** One substitution between two linear equations.
- Sample: `x = t + 1, y = 2t. y in terms of x?` → `2x-2` · input: short expression · accepted: expression-canonical
- Range: linear pairs, integer coefficients ≤ 5.
- Kernels: `alg1.literal-equation-onestep`, `prealg.distribute`

---

## 9. AP Calculus AB (`calcab.`)

**Audit checklist:** AP Calculus AB/BC Course and Exam Description (CED), Units 1–8: (1) Limits & continuity · (2) Differentiation: definition & fundamental properties · (3) Composite, implicit & inverse functions · (4) Contextual applications · (5) Analytical applications · (6) Integration & accumulation · (7) Differential equations · (8) Applications of integration. Every CED unit appears below as rated entries, Low entries with kernels, or both. Derivative-rule recall is the calculus counterpart of the times tables — the densest High-value vein in the upper half of this document.

#### `calcab.limit-direct-sub` — Limit by direct substitution
**Medium.** One evaluation once continuity is recognized.
- Sample: `lim (x→2) x² + 3` → `7` · input: single number
- Range: polynomials ≤ degree 2, inputs −5…5.
- Kernels: `alg1.function-eval`

#### `calcab.limit-factor-cancel` — Limit of a 0/0 form by cancelling
**Medium.** Spot the shared factor, cancel, substitute.
- Sample: `lim (x→3) (x² − 9)/(x − 3)` → `6` · input: single number
- Range: difference-of-squares and monic-trinomial numerators.
- Kernels: `alg2.rational-simplify`, `calcab.limit-direct-sub`

#### `calcab.limit-at-infinity` — Limit at infinity of a rational function
**Medium.** Degree comparison — the horizontal-asymptote skill in limit notation.
- Sample: `lim (x→∞) (3x² + 1)/(x² − 5)` → `3` · input: single number
- Range: as `alg2.asymptote-horizontal`.
- Kernels: `alg2.asymptote-horizontal`

#### `calcab.limit-special-trig` — The special trig limits
**High.** Recall: sin x/x → 1, (1 − cos x)/x → 0.
- Sample: `lim (x→0) sin x / x` → `1` · input: single number
- Range: the two canonical forms plus sin(kx)/x → k scalings.
- Kernels: `trig.exact-sin`

#### `calcab.one-sided-limit-read` — One-sided limits from a piecewise rule
**Medium.** Pick the branch, evaluate.
- Sample: `f(x) = {x² if x < 2; 3x if x ≥ 2}. lim (x→2⁻) f(x)?` → `4` · input: single number
- Range: two-branch piecewise, junction inputs −5…5.
- Kernels: `alg1.piecewise-eval`

#### `calcab.continuity-check` — Continuity at a point
**Medium.** Compare left limit, right limit, value.
- Sample: `Same f as above: continuous at x = 2?` → `false` · input: true/false
- Range: jump, removable, and continuous cases ~⅓ each.
- Kernels: `calcab.one-sided-limit-read`

#### `calcab.ivt-applies` — Does IVT guarantee a root?
**Medium.** Sign check at the endpoints plus a continuity read.
- Sample: `f continuous, f(1) = −3, f(4) = 5. Root in (1, 4) guaranteed?` → `true` · input: true/false
- Range: sign pairs, plus discontinuous decoys.
- Kernels: `prealg.inequality-truth`

#### `calcab.derivative-power-rule` — Power rule
**High.** The times table of calculus: exponent down, degree drops.
- Sample: `d/dx x⁷` → `7x^6` · input: short expression · accepted: expression-canonical
- Range: exponents −3…9 including fractional (x^(3/2)) at higher difficulty.
- Kernels: `fk.times-tables`, `prealg.exponent-quotient-rule`

#### `calcab.derivative-coefficient` — Derivative of cxⁿ, coefficient asked
**High.** One multiplication — current-engine friendly form of the power rule.
- Sample: `d/dx 5x³ = kx². k = ?` → `15` · input: single number
- Range: coefficients −9…9, exponents 2–9.
- Kernels: `calcab.derivative-power-rule`

#### `calcab.derivative-sin-cos` — Derivatives of sin and cos
**High.** Recall with the sign cycle.
- Sample: `d/dx sin x` → `cos x` · input: multiple choice
- Range: sin, cos, and the four-step derivative cycle (d⁴/dx⁴ sin x).
- Kernels: `trig.identity-recall`

#### `calcab.derivative-exp-ln` — Derivatives of eˣ and ln x
**High.** Recall.
- Sample: `d/dx ln x` → `1/x` · input: multiple choice
- Range: eˣ, ln x, aˣ (with ln a factor) as higher difficulty.
- Kernels: `alg2.ln-e-eval`

#### `calcab.derivative-other-trig` — Derivatives of tan, sec, csc, cot
**Medium.** Recall of the second-tier table.
- Sample: `d/dx tan x` → `sec²x` · input: multiple choice
- Range: all four, sign traps in distractors.
- Kernels: `calcab.derivative-sin-cos`, `trig.reciprocal-identities`

#### `calcab.derivative-at-point` — Evaluate f′ at a point
**Medium.** Differentiate one term, substitute.
- Sample: `f(x) = x³. f′(2) = ?` → `12` · input: single number
- Range: single power/trig/exp terms, inputs −5…5.
- Kernels: `calcab.derivative-power-rule`, `alg1.function-eval`

#### `calcab.derivative-limit-definition` — Recognize the limit definition
**High.** Discriminative read — MC native.
- Sample: `lim (h→0) [f(a+h) − f(a)]/h = ?` → `f′(a)` · input: multiple choice
- Range: both definition forms; disguised instances (identify f and a) at higher difficulty.
- Kernels: `calcab.derivative-power-rule`

#### `calcab.product-rule-recall` — Product rule recall
**High.** MC native.
- Sample: `(fg)′ = ?` → `f′g + fg′` · input: multiple choice
- Range: distractors include (f′g′) and quotient-rule fragments.
- Kernels: `calcab.derivative-power-rule`

#### `calcab.quotient-rule-recall` — Quotient rule recall
**High.** MC native; the order-of-numerator trap is the point.
- Sample: `(f/g)′ = ?` → `(f′g − fg′)/g²` · input: multiple choice
- Range: sign- and order-swapped distractors.
- Kernels: `calcab.product-rule-recall`

#### `calcab.chain-rule-coefficient` — Chain rule on (ax + b)ⁿ
**Medium.** Power rule times inner derivative, asked as a coefficient.
- Sample: `d/dx (3x + 1)⁵ = k(3x + 1)⁴. k = ?` → `15` · input: single number
- Range: a 2–9, n 2–9.
- Kernels: `calcab.derivative-power-rule`, `fk.times-tables`

#### `calcab.chain-rule-structure` — Identify outer/inner in a composition
**Medium.** Decomposition read — MC native.
- Sample: `sin(x²): outer function?` → `sin u` · input: multiple choice
- Range: two-deep compositions of power/trig/exp/ln.
- Kernels: `alg2.function-composition-eval`

#### `calcab.derivative-inverse-trig` — Derivatives of arcsin, arctan
**Medium.** Second-tier recall.
- Sample: `d/dx arctan x` → `1/(1 + x²)` · input: multiple choice
- Range: arcsin, arccos, arctan; sign/radicand distractors.
- Kernels: `trig.inverse-trig-exact`

#### `calcab.derivative-inverse-function` — Derivative of an inverse at a point
**Low.** Locate the paired point, then reciprocate — multi-step bookkeeping.
- Fast kernels inside: `alg2.inverse-function-eval`, `prealg.reciprocal`, `calcab.derivative-at-point`

#### `calcab.implicit-differentiation` — Implicit differentiation
**Low.** Term-by-term with chain-rule flags, then solve for y′.
- Fast kernels inside: `calcab.chain-rule-coefficient`, `calcab.product-rule-recall`, `alg1.literal-equation-onestep`

#### `calcab.tangent-line-slope` — Slope of the tangent line
**Medium.** One derivative, one substitution — `calcab.derivative-at-point` in graph language.
- Sample: `Slope of the tangent to y = x² at x = 3` → `6` · input: single number
- Range: as `calcab.derivative-at-point`.
- Kernels: `calcab.derivative-at-point`, `alg1.slope-from-equation`

#### `calcab.related-rates` — Related rates problems
**Low.** Model, relate, differentiate, substitute — the archetypal multi-step problem.
- Fast kernels inside: `calcab.chain-rule-coefficient`, `geom.area-circle-pi`, `geom.pythagorean-triples`, `geom.volume-cone-sphere`

#### `calcab.position-velocity-accel` — Position/velocity/acceleration reads
**High.** Which-derivative-is-which recall plus one evaluation.
- Sample: `s(t) = t³. Velocity at t = 2?` → `12` · input: single number
- Range: single-term positions; speeding-up/slowing-down (sign agreement) as true/false variant.
- Kernels: `calcab.derivative-at-point`

#### `calcab.linear-approximation` — Linear approximation
**Low.** Build the tangent line, then evaluate at the offset.
- Fast kernels inside: `calcab.tangent-line-slope`, `prealg.evaluate-expression`, `prealg.decimal-add-sub`

#### `calcab.lhopital-applies` — Does L'Hôpital's rule apply?
**Medium.** Indeterminate-form check.
- Sample: `lim (x→0) sin x / x²: is the form 0/0?` → `true` · input: true/false
- Range: 0/0, ∞/∞, and non-indeterminate decoys (1/0, 0·finite).
- Kernels: `calcab.limit-direct-sub`

#### `calcab.increasing-from-fprime` — f′ sign → behavior of f
**High.** The core analytical read.
- Sample: `f′(x) > 0 on (a, b) means f is … on (a, b)` → `increasing` · input: multiple choice
- Range: f′ sign facts, f″ concavity facts, and mixed statements as true/false.
- Kernels: `calcab.derivative-power-rule`

#### `calcab.critical-points` — Critical points of a simple f
**Medium.** Differentiate one term pair, solve f′ = 0.
- Sample: `f′(x) = 3x² − 12. Critical x-values?` → `2, -2` · input: two numbers · accepted: pair-any-order
- Range: f′ quadratic with integer roots ≤ 5, or given directly.
- Kernels: `alg1.quadratic-sqrt-method`, `calcab.derivative-power-rule`

#### `calcab.first-derivative-test` — Classify a critical point from a sign chart
**Medium.** One sign-change read — MC native.
- Sample: `f′ goes + to − at x = c. f has a … at c` → `local max` · input: multiple choice
- Range: max/min/neither from sign patterns.
- Kernels: `calcab.increasing-from-fprime`

#### `calcab.concavity-from-fsecond` — Concavity from f″
**High.** Sign read.
- Sample: `f″(x) > 0 means f is concave…` → `up` · input: multiple choice
- Range: concavity facts plus second-derivative-test statements.
- Kernels: `calcab.increasing-from-fprime`

#### `calcab.inflection-point` — Inflection point of a simple f
**Medium.** Solve f″ = 0 (one step) plus a sign-change acknowledgment.
- Sample: `f″(x) = 6x − 12. Inflection at x = ?` → `2` · input: single number
- Range: linear f″; quadratic f″ with integer roots at higher difficulty.
- Kernels: `prealg.two-step-equation`, `calcab.concavity-from-fsecond`

#### `calcab.extreme-value-candidates` — Where can an absolute max live?
**High.** Candidates recall: critical points and endpoints.
- Sample: `On [a, b], the absolute max of continuous f occurs at…` → `a critical point or endpoint` · input: multiple choice
- Range: EVT and candidates-test statements.
- Kernels: `calcab.critical-points`

#### `calcab.mvt-conclusion` — Mean Value Theorem numeric conclusion
**Medium.** One average-rate computation.
- Sample: `f(1) = 3, f(5) = 11, f differentiable. MVT gives f′(c) = ?` → `2` · input: single number
- Range: integer average rates; hypothesis-check variants as true/false.
- Kernels: `alg1.slope-two-points`

#### `calcab.optimization` — Optimization problems
**Low.** Model, constrain, differentiate, verify — multi-step by design.
- Fast kernels inside: `calcab.critical-points`, `calcab.first-derivative-test`, `prealg.area-rect-triangle`, `alg1.vertex-x`

#### `calcab.antiderivative-power` — Antiderivative power rule
**High.** Exponent up, divide — the inverse recall.
- Sample: `∫ x⁴ dx = x⁵/k + C. k = ?` → `5` · input: single number
- Range: exponents −3…9 excluding −1 (that's `calcab.antiderivative-recognize`).
- Kernels: `calcab.derivative-power-rule`

#### `calcab.antiderivative-recognize` — Antiderivatives of the basic table
**High.** Recall: cos → sin, 1/x → ln|x|, eˣ → eˣ, sec² → tan.
- Sample: `∫ cos x dx = ?` → `sin x + C` · input: multiple choice
- Range: the eight-function basic table; sign traps.
- Kernels: `calcab.derivative-sin-cos`, `calcab.derivative-exp-ln`

#### `calcab.definite-integral-power` — Definite integral of one term
**Medium.** Antidifferentiate, evaluate twice, subtract — chunked on clean bounds.
- Sample: `∫₀² 3x² dx` → `8` · input: single number
- Range: single terms, bounds 0–3, integer answers.
- Kernels: `calcab.antiderivative-power`, `fk.cubes-small`, `prealg.int-sub-signed`

#### `calcab.ftc-derivative-of-integral` — FTC part 1
**Medium.** d/dx ∫ᵃˣ f(t)dt = f(x); one substitution when asked at a point.
- Sample: `g(x) = ∫₁ˣ t² dt. g′(2) = ?` → `4` · input: single number
- Range: single-term integrands; chain-rule upper bounds (x²) reserved for BC-level difficulty.
- Kernels: `fk.squares-to-20`, `calcab.antiderivative-power`

#### `calcab.integral-properties` — Definite-integral properties
**High.** Recall: reversal negates, adjacency adds, ∫ₐᵃ = 0.
- Sample: `∫₂⁵ f = 7. ∫₅² f = ?` → `−7` · input: single number
- Range: one-property applications with small given values.
- Kernels: `prealg.int-add-signed`

#### `calcab.riemann-over-under` — Riemann sums over/underestimate
**Medium.** Match rule (left/right/trapezoid) against monotonicity/concavity.
- Sample: `f increasing: a left Riemann sum is an…` → `underestimate` · input: multiple choice
- Range: the standard rule × behavior grid.
- Kernels: `calcab.increasing-from-fprime`

#### `calcab.average-value-formula` — Average value of a function
**Medium.** Formula recall plus one division when numeric.
- Sample: `∫₁⁴ f = 12. Average value of f on [1, 4]?` → `4` · input: single number
- Range: integer given-integral values; formula-recognition MC variant.
- Kernels: `fk.div-facts`, `prealg.mean-small`

#### `calcab.u-substitution` — Integrate by u-substitution
**Low.** Choose u, transform, integrate, back-substitute.
- Fast kernels inside: `calcab.chain-rule-coefficient`, `calcab.antiderivative-power`, `calcab.antiderivative-recognize`

#### `calcab.separable-de-recognize` — Is the differential equation separable?
**Medium.** Structure read — MC/true-false native.
- Sample: `dy/dx = xy separable?` → `true` · input: true/false
- Range: separable vs non-separable forms, ~50% each.
- Kernels: `alg1.factor-gcf`

#### `calcab.exponential-de-solution` — Solution of dy/dt = ky
**High.** Recall: y = y₀e^(kt); read k and y₀.
- Sample: `dy/dt = 3y, y(0) = 5. y(t) = ?` → `5e^(3t)` · input: multiple choice
- Range: k, y₀ −9…9.
- Kernels: `alg2.ln-e-eval`, `alg1.exponential-growth-factor`

#### `calcab.slope-field-match` — Match a slope field to its equation
**Medium.** Gestalt pattern read; needs a rendered figure.
- Sample: rendered slope field → `dy/dx = x` · input: multiple choice (figure)
- Range: dy/dx from {x, y, xy, x+y, x², −y}; distinctive fields only.
- Kernels: `calcab.separable-de-recognize`

#### `calcab.accumulation-interpretation` — Integral of a rate = net change
**High.** Interpretation recall.
- Sample: `v(t) is velocity. ∫₀⁵ v(t)dt is the…` → `displacement` · input: multiple choice
- Range: displacement vs distance vs position traps; rate-in/rate-out setups.
- Kernels: `calcab.position-velocity-accel`

#### `calcab.area-between-curves` — Area between curves
**Low.** Find intersections, set up, integrate.
- Fast kernels inside: `calcab.definite-integral-power`, `alg1.quadratic-solve-monic`, `calcab.integral-properties`

#### `calcab.volume-revolution` — Volumes of revolution (disk/washer)
**Low.** Set up π∫(R² − r²), then a full definite integral.
- Fast kernels inside: `geom.area-circle-pi`, `fk.squares-to-20`, `calcab.definite-integral-power`

#### `calcab.volume-cross-sections` — Volumes by known cross-sections
**Low.** Same pipeline with a section-area model.
- Fast kernels inside: `prealg.area-rect-triangle`, `calcab.definite-integral-power`. No drillable kernel beyond entries already listed elsewhere.

---

## 10. AP Calculus BC — BC-only topics (`calcbc.`)

**Audit checklist:** AP Calculus CED, BC-only extensions: Unit 6 (integration by parts · partial fractions · improper integrals) · Unit 7 (Euler's method · logistic models) · Unit 8 (arc length) · Unit 9 (parametric, vector-valued & polar functions) · Unit 10 (infinite sequences & series). Series is the standout: convergence-test *verdicts* are recall-grade, making Unit 10 far more Gauntlet-friendly than its reputation suggests.

#### `calcbc.parts-formula-recall` — Integration by parts formula
**High.** MC native.
- Sample: `∫ u dv = ?` → `uv − ∫ v du` · input: multiple choice
- Range: sign- and order-swapped distractors; LIATE choice-of-u variants.
- Kernels: `calcab.product-rule-recall`

#### `calcbc.parts-apply` — Integrate by parts
**Low.** Choose u/dv, differentiate, integrate, assemble.
- Fast kernels inside: `calcbc.parts-formula-recall`, `calcab.antiderivative-recognize`, `calcab.antiderivative-power`

#### `calcbc.partial-fractions-coefficients` — Partial-fraction constants (cover-up)
**Medium.** Cover-up evaluation is a single substitution per constant.
- Sample: `1/((x−1)(x+2)) = A/(x−1) + B/(x+2). A = ?` → `1, 3` · input: two numbers · accepted: reduced-fraction-pair
- Range: two distinct linear factors, roots −5…5.
- Kernels: `alg1.function-eval`, `fk.fraction-simplify`

#### `calcbc.improper-converges` — Does the improper integral converge?
**Medium.** One p-comparison.
- Sample: `∫₁^∞ 1/x² dx converges?` → `true` · input: true/false
- Range: p-integrals at both endpoints; exponential tails.
- Kernels: `calcbc.p-series-test`, `calcab.limit-at-infinity`

#### `calcbc.improper-p-value` — Evaluate a clean improper p-integral
**Medium.** Antidifferentiate, take the limit — chunked on 1/x² family.
- Sample: `∫₁^∞ 1/x² dx` → `1` · input: single number
- Range: integrands 1/xᵖ, p in {2, 3}; lower bounds 1–3 with reduced-fraction-pair answers.
- Kernels: `calcab.antiderivative-power`, `calcab.limit-at-infinity`

#### `calcbc.euler-step` — One Euler's method step
**Medium.** y + h·f(x, y) with clean numbers.
- Sample: `dy/dx = x + y, (0, 1), h = 1. After one step, y = ?` → `2` · input: single number
- Range: integer/half-integer h, one step only; f linear in x, y.
- Kernels: `prealg.evaluate-expression`, `prealg.decimal-add-sub`

#### `calcbc.logistic-carrying-capacity` — Carrying capacity read
**High.** Read K from dP/dt = kP(1 − P/K).
- Sample: `dP/dt = 0.5P(1 − P/800). Carrying capacity?` → `800` · input: single number
- Range: K 50–5000; equivalent factored forms.
- Kernels: `calcab.exponential-de-solution`

#### `calcbc.logistic-max-growth` — Fastest-growth population
**High.** Recall: at K/2.
- Sample: `Same model: P at fastest growth?` → `400` · input: single number
- Range: even K for integer halves.
- Kernels: `calcbc.logistic-carrying-capacity`, `fk.doubles-halves`

#### `calcbc.arc-length-formula` — Arc length formula recall
**High.** MC native, all three forms (function, parametric, polar).
- Sample: `Arc length of y = f(x) on [a, b] = ?` → `∫ₐᵇ √(1 + (f′)²) dx` · input: multiple choice
- Range: the three setups; distractors drop the square or the 1.
- Kernels: `calcab.derivative-power-rule`

#### `calcbc.arc-length-apply` — Compute an arc length
**Low.** Derivative, square, root-simplify, integrate.
- Fast kernels inside: `calcbc.arc-length-formula`, `calcab.definite-integral-power`, `alg1.radical-simplify`. No drillable kernel beyond entries already listed elsewhere.

#### `calcbc.parametric-dydx` — dy/dx for parametric curves
**Medium.** (dy/dt)/(dx/dt), one division on clean derivatives.
- Sample: `x = t², y = t³. dy/dx at t = 2?` → `3` · input: single number
- Range: single-term x(t), y(t); t −3…3, integer answers.
- Kernels: `calcab.derivative-power-rule`, `fk.fraction-simplify`

#### `calcbc.parametric-second-derivative` — d²y/dx² for parametric curves
**Low.** A derivative of a quotient, re-divided — nested multi-step.
- Fast kernels inside: `calcbc.parametric-dydx`, `calcab.quotient-rule-recall`

#### `calcbc.vector-derivative` — Derivative of a vector-valued function
**Medium.** Componentwise power rule.
- Sample: `r(t) = ⟨t², t³⟩. r′(1) = ?` → `2, 3` · input: two numbers · accepted: pair-ordered (x, y)
- Range: single-term components, t −3…3.
- Kernels: `calcab.derivative-power-rule`, `trig.vector-add`

#### `calcbc.speed-from-velocity` — Speed of a parametric particle
**Medium.** Magnitude of velocity — triple-constrained.
- Sample: `v(t) = ⟨3, 4⟩. Speed?` → `5` · input: single number
- Range: velocity components forming Pythagorean triples.
- Kernels: `trig.vector-magnitude`, `calcbc.vector-derivative`

#### `calcbc.polar-to-rect-point` — Polar → rectangular in calculus contexts
**Medium.** Same skill as `trig.polar-to-rect`, cited here for the audit sweep.
- Sample: `(r, θ) = (4, π/3). x = ?` → `2` · input: single number
- Range: special angles, r ≤ 6.
- Kernels: `trig.polar-to-rect`

#### `calcbc.polar-area-formula` — Polar area formula recall
**High.** MC native.
- Sample: `Area inside r(θ), α ≤ θ ≤ β = ?` → `½∫ r² dθ` · input: multiple choice
- Range: distractors drop the ½ or the square.
- Kernels: `geom.sector-area`

#### `calcbc.geometric-series-sum` — Sum a convergent geometric series
**High.** a/(1 − r) recall — same move as `alg2.series-geometric-infinite`, in series notation.
- Sample: `Σₙ₌₀^∞ 5·(1/2)ⁿ` → `10` · input: single number
- Range: |r| in {1/2, 1/3, 1/4, 2/3}, integer sums.
- Kernels: `alg2.series-geometric-infinite`

#### `calcbc.geometric-series-converge` — Geometric convergence check
**High.** |r| < 1 read.
- Sample: `Σ (3/2)ⁿ converges?` → `false` · input: true/false
- Range: r spanning both sides of 1, including negatives.
- Kernels: `fk.fraction-compare`

#### `calcbc.nth-term-test` — nth-term test verdict
**High.** Do the terms go to 0? If not, diverges.
- Sample: `Σ n/(n+1): terms → 1 ≠ 0, so the series…` → `diverges` · input: multiple choice
- Range: term limits via `calcab.limit-at-infinity`-grade reads; "test is inconclusive" trap when terms → 0.
- Kernels: `calcab.limit-at-infinity`

#### `calcbc.p-series-test` — p-series verdict
**High.** p > 1 read.
- Sample: `Σ 1/n³ converges?` → `true` · input: true/false
- Range: p in {1/2, 1, 2, 3}; the harmonic series (p = 1, diverges) oversampled as the canonical trap.
- Kernels: `fk.fraction-compare`

#### `calcbc.alternating-series-test` — Alternating series verdict
**Medium.** Two-condition check (terms decreasing, terms → 0).
- Sample: `Σ (−1)ⁿ/n converges?` → `true` · input: true/false
- Range: alternating harmonic family; decoys failing one condition.
- Kernels: `calcbc.nth-term-test`

#### `calcbc.ratio-test-conclusion` — Ratio test conclusion from L
**High.** L < 1 / L > 1 / L = 1 read.
- Sample: `Ratio test gives L = 1/3. The series…` → `converges absolutely` · input: multiple choice
- Range: L values spanning the three cases.
- Kernels: `fk.fraction-compare`

#### `calcbc.series-test-choice` — Which convergence test fits?
**Medium.** Discriminative structure read — MC native.
- Sample: `Best first test for Σ n²/3ⁿ?` → `ratio test` · input: multiple choice
- Range: geometric / p-series / alternating / ratio / nth-term shapes.
- Kernels: `calcbc.ratio-test-conclusion`, `calcbc.p-series-test`, `calcbc.geometric-series-converge`

#### `calcbc.conditional-vs-absolute` — Conditional vs absolute convergence
**Medium.** Pair the series with its absolute-value twin.
- Sample: `Σ (−1)ⁿ/n converges…` → `conditionally` · input: multiple choice
- Range: alternating p-series family.
- Kernels: `calcbc.alternating-series-test`, `calcbc.p-series-test`

#### `calcbc.maclaurin-recall` — Maclaurin series recall
**High.** The four canonical series (eˣ, sin, cos, 1/(1−x)) — MC native.
- Sample: `Σ xⁿ/n! is the Maclaurin series of…` → `eˣ` · input: multiple choice
- Range: all four, both directions (series→function, function→series).
- Kernels: `trig.factorial-eval`

#### `calcbc.taylor-coefficient` — A Taylor coefficient
**Medium.** f⁽ⁿ⁾(a)/n! on clean values.
- Sample: `Coefficient of x³ in the Maclaurin series of eˣ = 1/k. k = ?` → `6` · input: single number
- Range: n ≤ 4; canonical series and given-derivative-value forms.
- Kernels: `calcbc.maclaurin-recall`, `trig.factorial-eval`

#### `calcbc.radius-of-convergence-simple` — Radius of convergence, geometric case
**Medium.** Read R off Σ (x/c)ⁿ shapes.
- Sample: `Σ (x/3)ⁿ converges for |x| < ?` → `3` · input: single number
- Range: centers at 0; (x−a) shifts as an interval-endpoint MC variant.
- Kernels: `calcbc.geometric-series-converge`

#### `calcbc.lagrange-error-bound` — Lagrange error bound
**Low.** Bound a derivative, build the term, evaluate — assembled, not recalled.
- Fast kernels inside: `calcbc.taylor-coefficient`, `trig.factorial-eval`, `prealg.exponent-eval`

---

## 11. Build this first — top picks by kernel in-degree

**Method.** Every entry's `Kernels:` / `Fast kernels inside:` citations were counted mechanically (541 citations across 343 entries). **Core in-degree** counts citations from Foundational kernels through Algebra 2 — the current grade 3–8 audience. **Full-range in-degree** (all sections through BC) is shown as the secondary column so thesis-wide leverage stays visible. The eight already-shipped topics (§2) are excluded from the picks; for reference, `fk.times-tables` alone is cited by 37 entries — the empirical anchor of the whole kernel thesis.

**Engine flags.** **current-engine** means today's grader handles it: a single integer answer (optionally negative) or multiple choice — a decimal or fractional answer is *not* current-engine. **needs ⟨format⟩** picks note whether an MC fallback is acceptable or the pick is **no-MC-fallback** because production practice is the point.

| # | Topic | Core | Full | Rating | Engine |
|---|---|---|---|---|---|
| 1 | `fk.squares-to-20` | 13 | 17 | High | current-engine |
| 2 | `prealg.int-add-signed` | 11 | 14 | High | current-engine |
| 3 | `fk.doubles-halves` | 10 | 11 | High | current-engine |
| 4 | `fk.fraction-simplify` | 9 | 14 | Medium | needs two numbers · **no-MC-fallback** |
| 5 | `prealg.int-mul-signed` | 7 | 11 | High | current-engine |
| 6 | `fk.sqrt-perfect` | 7 | 9 | High | current-engine |
| 7 | `fk.add-multi-digit` | 7 | 8 | Medium | current-engine |
| 8 | `prealg.two-step-equation` | 7 | 8 | Medium | current-engine |
| 9 | `prealg.one-step-equation` | 7 | 7 | High | current-engine |
| 10 | `prealg.int-sub-signed` | 6 | 8 | High | current-engine |
| 11 | `prealg.exponent-eval` | 6 | 7 | High | current-engine |
| 12 | `fk.sub-multi-digit` | 6 | 6 | Medium | current-engine |
| 13 | `prealg.combine-like-terms` | 6 | 6 | Medium | needs short expression · MC fallback acceptable |
| 14 | `prealg.decimal-mul-pow10` | 5 | 5 | High | current-engine (integer-answer variants) |
| 15 | `alg1.factor-pairs-sum-product` | 5 | 5 | High | needs two numbers · **no-MC-fallback** |
| 16 | `geom.pythagorean-triples` | 4 | 7 | High | current-engine |
| 17 | `geom.area-circle-pi` | 4 | 6 | High | current-engine (pi-coefficient answers) |
| 18 | `fk.cubes-small` | 4 | 5 | High | current-engine |
| 19 | `fk.powers-of-two` | 4 | 4 | High | current-engine |
| 20 | `prealg.fraction-of-number` | 4 | 4 | High | current-engine |
| 21 | `alg2.log-eval-exact` | 4 | 4 | High | current-engine |
| 22 | `alg1.function-eval` | 3 | 6 | High | current-engine |
| 23 | `prealg.proportion-solve` | 3 | 4 | Medium | current-engine |
| 24 | `trig.exact-sin` | 0 | 9 | High | needs two numbers · MC acceptable for √-values |
| 25 | `calcab.derivative-power-rule` | 0 | 11 | High | needs short expression · current-engine via `calcab.derivative-coefficient` |

**Tie-break and judgment notes** (one line each, per R7):

- #7/#8/#9 order within the 7-tie: `fk.add-multi-digit` first because it unblocks the most Medium entries elsewhere; equations follow because they inherit it.
- #10–#13 within the 6-tie: signed subtraction before exponent evaluation because the signed-arithmetic trio (#2/#5/#10) should ship as a set — one training track, three topics.
- #22 `alg1.function-eval` promoted over same-core peers (`prealg.reciprocal`, `prealg.fraction-mul`): its full-range count (6) is higher and every calculus evaluation entry stands on it.
- #23 `prealg.proportion-solve` promoted for the same reason: it carries similarity, unit rates, and percent — the middle-school word-problem backbone.
- #24 `trig.exact-sin` is a thesis pick from the full-range column: 9 citations, all above Algebra 2 — it is the `fk.times-tables` of trigonometry and the cheapest future-proofing in the catalog.
- #25 `calcab.derivative-power-rule` likewise (11 full-range citations, the highest of any non-shipped topic outside the core): its coefficient form `calcab.derivative-coefficient` is current-engine today, so the "derivative times tables" needs zero input work to pilot.

**Zero-engine-work starter subset.** Nineteen of the 25 picks run on today's grader exactly as specified: #1–#3, #5–#12, #14, #16–#23 (using the integer/pi-coefficient variants noted). A content-only release could ship the top 12 of these as three tracks — *squares & roots* (#1, #6, #18, #19), *signed arithmetic* (#2, #5, #10), *mental arithmetic* (#3, #7, #12, #14) — before any new input type is built.

**What the new input types unlock** (from the picks above): `two numbers` unlocks #4 and #15 — fraction reduction and sum-product factor pairs, the two highest-leverage non-current-engine kernels in the catalog — plus exact trig values (#24) and most coordinate-pair content in §6–§8. `short expression` unlocks #13 and #25 plus the factoring/FOIL family in §5. If only one new input type gets built, build `two numbers`.

---

## 12. Maintenance

- **Recomputing the ranking:** in-degree is mechanical — parse `#### \`slug\`` definition lines and count slug occurrences on `- Kernels:` / `- Fast kernels inside:` lines (excluding the §1.1 format template). Any script or grep pipeline reproducing that count will reproduce §11.
- **Adding entries:** keep the grain at one drillable skill, cite kernels by slug only, and rate against the §2 anchors (times tables = High; GCD = Medium). If a new Low entry contains no new kernel, say so explicitly.
- **Stats at authoring time (2026-07-10):** 343 entries — 156 High, 149 Medium, 38 Low — 541 kernel citations. Sections: Foundational kernels 21 (+8 shipped anchors in §2) · Pre-Algebra 49 · Algebra 1 54 · Geometry 41 · Algebra 2 50 · Trig/Precalc 43 · Calc AB 49 · BC-only 28.
