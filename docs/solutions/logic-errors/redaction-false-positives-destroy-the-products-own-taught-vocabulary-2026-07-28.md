---
module: funnel
date: "2026-07-28"
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "Honest quiz answers stored as '▮▮▮': 'sell to 3 houses on my street' → 'sell to ▮▮▮'"
  - "Kid-shorthand '@home and @school' redacted as social handles"
  - "'apple cider' genericized to 'a big brand cider' by the brand list"
root_cause: logic_error
resolution_type: code_fix
tags:
  - moderation
  - redaction
  - false-positive
  - regex
  - pii
  - taught-vocabulary
related_components:
  - testing_framework
---

# Redaction false positives destroy the product's own taught vocabulary

## Problem

An in-repo PII moderation pass (U9, `app/lib/funnel/moderation.ts`) redacted the
very answers the product teaches children to give. The templates screen shows
"First customers: **Three houses on your street**" — and when a child typed the
digit form, `moderateForStorage("sell to 3 houses on my street")` returned
`"sell to ▮▮▮"`. The stored answer WAS the redaction. Both reviewers found this
independently; neither the author nor the initial tests did.

## Symptoms

- The STREET pattern (`number + up to 3 arbitrary words + street-type word`)
  matched distance and count phrases: "20 minutes down the road", "2 doors down
  the street", "I walk 2 dogs down the lane".
- The HANDLE pattern matched kid-shorthand: "lemonade @home and @school".
- The case-insensitive brand list containing "apple" rewrote "apple cider" —
  a founders-stand template literally suggests baked goods and drinks.
- The 7-digit local phone ("call my mom at 555-0192") passed UNredacted while
  the comment claimed "seven-plus digits" — a miss in the opposite direction.

## What Didn't Work

The initial false-positive test sweep held only money/count phrases
("$1200 for the season", "120 kids"). It was built from the author's
imagination of honest answers, not from the product's own copy — so it
validated the patterns against strawmen while the templates' shipped
vocabulary failed.

## Solution

Two halves: fix the patterns, and source the test corpus from the copy.

1. STREET now rejects intermediate stopwords (determiners, pronouns, measure
   words) between the number and the street-type word, so "12 Main St" still
   matches while "3 houses on my street" cannot:

   ```ts
   const STREET_STOPWORD =
     "(?:my|the|a|an|our|your|his|her|their|on|down|up|in|at|of|to|per|min|mins|minute|minutes|hour|hours|day|days|week|weeks|block|blocks|door|doors|house|houses|kid|kids|dog|dogs|mile|miles|km|kms|people|families)";
   const STREET = new RegExp(
     `\\b\\d{1,5}[a-z]?\\s+(?:(?!${STREET_STOPWORD}\\b)[A-Za-z'.-]+\\s+){0,3}(?:st|street|ave|…)\\b\\.?`,
     "gi"
   );
   ```

2. HANDLE got a short stoplist (`@(?!(?:home|school|work|…)\b)`); "apple" was
   dropped from the brand list (the trademark risk moved to the compose
   prompt); PHONE gained a separator-required 7-digit branch.

3. The test file now carries a "taught vocabulary" sweep whose sentences come
   from the templates and quiz suggestions themselves, asserting
   `clean === input` and `flags === []` for each.

## Why This Works

A redaction pass has two failure directions and only one of them shows up in
an adversarial corpus. Misses (PII survives) are what security-minded tests
hunt. False positives (honest text destroyed) are invisible unless the corpus
includes what honest users actually type — and the highest-density source of
that is the product's own copy, because the UI actively coaches users toward
those exact phrases. When a template says "Three houses on your street", the
moderation layer WILL receive that sentence.

## Prevention

- When building any filter/redaction/validation over free text, harvest the
  no-false-positive corpus from the product's shipped copy: templates,
  placeholders, suggestions, marketing lines users will echo back.
- Test both directions with equal weight: an adversarial PII corpus asserting
  redaction on the stored value, AND an honest-vocabulary corpus asserting
  byte-identical passthrough.
- Over-redaction is a data-quality bug downstream: the next consumer (here,
  U10's compose model) receives "▮▮▮" as the customer hypothesis and builds a
  project around it. Treat destroyed-honest-input as severity comparable to
  leaked PII.
