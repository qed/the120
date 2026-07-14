---
date: 2026-07-14
topic: remove-alpha-gt-timeback-2hl
---

# Remove Alpha, GT, TimeBack, and 2 Hour Learning from the Website

## Problem Frame

The 120's public site currently leans on the Alpha / GT / TimeBack / 2 Hour Learning ecosystem for identity ("run as GT Toronto", "part of the 2 Hour Learning Network") and for proof (network outcome stats, network student testimonials, Alpha camp parent stories, GT advisor roster). All mentions of these brands must be removed from every visitor-facing surface — plus two explicitly included non-visitor surfaces: the members' dashboard (R13) and `app/` code comments (R14). Content whose honesty depends on network attribution cannot simply be de-labelled — each piece was decided individually (removed, de-branded, or trimmed) in the 2026-07-14 brainstorm session.

Ruling made during brainstorm: **TimeBack is included in the removal** alongside Alpha, GT, and 2 Hour Learning.

Driver (confirmed 2026-07-14): a **voluntary rebrand/positioning decision** — The 120 stands on its own brand. No contractual or legal constraint; conservative handling of borrowed content is a choice, not an obligation. The 120 **continues to deliver academics on the same platform, unnamed**, so "the learning platform behind The 120's academics" remains an accurate description.

## Requirements

**Site-wide**
- R1. Footer legal line (`app/components/Footer.tsx`): delete the network claim. "© 2026 The 120 · A learning centre, part of the 2 Hour Learning Network." becomes "© 2026 The 120 · A learning centre." (rest of the line — accreditation disclaimer, TIN CAN trademark — unchanged).
- R2. CASL consent checkbox (`app/components/account/AccountModal.tsx`): entity name becomes just "The 120" — "Yes — The 120 may email and text me about…".

**Home page (/)**
- R3. Hero badge (`app/components/Hero.tsx`): replace "PART OF THE 2 HOUR LEARNING NETWORK" with The 120's own credential line "FOUNDING COHORT · FALL 2026 · TORONTO".
- R4. How It Works intro (`app/components/HowItWorks.tsx`): trim the GT clause. Paragraph ends at "Each group qualifies its members its own way." No claim about who runs the Scholars' assessment.
- R5. Scholars group data (`app/lib/site.ts`): de-brand. Blurb: "Accelerated academics. Mastery with no ceiling." Body: "For gifted kids who love to learn. Accelerated, mastery-based academics with no ceiling." Drop "run as GT Toronto" everywhere this data renders (home groups band, /scholars, page metadata).
- R6. Parent stories band (`app/components/ParentStoriesBand.tsx`): keep the three quote cards (they are brand-clean); rewrite the attribution footnote generically, e.g. "Experiences on the learning platform behind The 120's academics." Add founder disclosure to Peter's card: detail line becomes "Toronto parent · three kids · founder of The 120" (matching /parents).
- R6b. Tuition teaser (`app/components/TuitionTeaser.tsx`, rendered on the home page): drop "with TimeBack" — "…upgrade to $15,000 for the Full Academic Core."

**Parent stories (/parents)**
- R7. Trim the page to platform stories. Peter's story stays, de-branded (TimeBack → "the learning platform"). Ian Logan's and Gordon McKay's stories are cut down to their platform paragraphs (adaptive pacing/gap-filling, kids wanting extra work, XPs); the Alpha-camp narrative paragraphs (Orange County camp, medic track, snack challenge, drones, "Alpha Summer Miami", "Alpha coming to Toronto") are removed. Hero subline, page metadata, story detail lines, and the closing disclosure line are all de-branded. Surviving paragraphs get minimal rewritten lead-ins where needed (e.g. Gordon's story currently opens by referencing the cut camp narrative) so each trimmed story reads self-contained — these lead-in edits are covered by the same permission re-check.

**Scholars program (/scholars and /gt)**
- R8. Rebuild `/scholars` as the full Scholars program page, keeping the **sibling group-page chrome** (minimal "← THE 120" top bar and thin footer row, like Athletes/Founders/Makers/Givers — not the site-wide Nav/Footer the old GT page used). Section order: de-branded hero; product pillars (Subject card loses platform names **and** the borrowed "3x the pace" claim); a **CTA row (Join the 120 + Book a call)** closing the pillars section in the slot where the network-outcomes stats box was; the de-branded simulator (R10b); key dates; promises; $15k tuition split; FAQ; CTA band. Hero kicker: "MASTERY WITH NO CEILING · FOUNDING COHORT FALL 2026". Add one qualification sentence: "Admission by application and academic review." The assessment-gate claim otherwise stays dropped site-wide.
- R9. Redirect only — **no archive page**: `/gt` permanently redirects to `/scholars` and the old page is deleted (git history is the archive; `/gt-old` was considered and rejected). Inbound buttons retargeted: the `/tuition` "See the full program" CTA points to `/scholars`; the old `/scholars` "The full GT program →" CTA disappears with the rebuild.
- R10. Borrowed network proof is removed from all visitor-facing surfaces: the outcome stats band (`proofStats` — 3x velocity, 1400+ SAT, 91%, AP 5s) and the "51+ campuses" network attribution lines in `Testimonials.tsx` and `ProductPillars.tsx`, the "2 Hour Learning student" testimonials, and the hero stat line "1400+ SAT BY 8TH GRADE · 3X VELOCITY".
- R10b. The simulator **returns de-branded** on the rebuilt `/scholars`: component and all visible copy renamed (no "TimeBack"), and the network-results disclaimer replaced with purely illustrative framing, e.g. "Illustrative simulation of mastery-based pacing — not a promised outcome." No network attribution anywhere; the curve is presented as a model, not results.

**Tuition (/tuition)**
- R11. All six brand mentions on `/tuition` go generic (no platform named anywhere):
  - Page metadata description: "…or $15,000 for the Full Academic Core." (drop "with TimeBack")
  - Hero paragraph: "$15,000 for the Full Academic Core: 5 hours a week of AI-adaptive, mastery-based academics for 1 to 3 subjects of your choice."
  - Full Academic Core card: "The complete academic core: 5 hours a week of AI-adaptive, mastery-based academics for 1 to 3 subjects, your choice."
  - Checklist "5 hours a week of TimeBack, your academic core" → "5 hours a week of adaptive academics, your academic core"
  - Checklist "Academics via Alpha Anywhere or GT Anywhere, by group" → "Adaptive academics, 1–3 subjects, by group"
  - Membership card "No TimeBack academics." → "No academic core."

**FAQ (/faq)**
- R12. Three answers edited: the "run by GT" clause is trimmed per R4/R8 (sentence ends at "its own way"); "For Scholars accelerating with GT" becomes "For Scholars on an accelerated path"; and the pricing answer's "with 5 hours a week of TimeBack for 1 to 3 subjects" becomes "with 5 hours a week of AI-adaptive, mastery-based academics for 1 to 3 subjects" (per R11 phrasing).

**Dashboard (members-only)**
- R13. Advisor roster (`app/dashboard/data.ts`): remove the real GT advisors' names and bios; workshops display "Advisor to be announced" until The 120 has its own roster. Scrub GT references from workshop descriptions, the audition note, and the retired-catalog notes. Add a one-line member-facing framing note in the workshops view: "We're assembling The 120's own advisor roster — advisors will be announced as they're confirmed."

**Internal code hygiene**
- R14. Scrub brand mentions from `app/` code comments (`Nav.tsx`, `globals.css`, `site.ts`, `scholars/page.tsx`, `groups/[slug]/page.tsx`, `Wordmark.tsx`, `AccountModal.tsx`, `parents/page.tsx`) and delete the unused `app/components/SeatsRemaining.tsx` component and the unreferenced brand asset `public/reference/partner-lockup.svg` (its vector text reads "The Gifted Academy of Alpha School"). Supabase migrations, `artifacts/`, and `docs/` are untouched.

## Success Criteria

- A brand sweep of rendered visitor-facing pages returns zero matches — no exceptions. Sweep spec: case-insensitive exact-phrase matches for "Alpha", "TimeBack", "2 Hour Learning", "Alpha Anywhere", "GT Anywhere", "GT Toronto"; word-boundary matches (`\bGT\b`) for the bare "GT" token against rendered text content, not raw HTML (avoids false hits on "length", `&gt;` entities, and the unrelated internal "GTM" acronym).
- Source-level check for the explicitly included non-visitor surfaces: `app/dashboard/data.ts` (R13) and the R14 comment files contain no brand mentions.
- `/gt` permanently redirects (301 or 308 — mechanism decided in planning) to `/scholars`; the old GT page no longer exists at any route.
- Off-repo visitor surfaces verified brand-clean: Stripe product/price display names (checkout + receipts), Supabase auth email templates, and the booking destination (`BOOKING_URL` target).
- No outcome claim or testimonial on the site belongs to the network: everything shown is The 120's own (parent quotes are platform experiences presented without brand attribution).
- The site still tells a complete story: Scholars have a full program page, tuition still explains what the $15k buys, home page still has social proof.

## Scope Boundaries

- **`/gauntlet` is unrelated** — "Gauntlet" is The 120's own game, not a GT brand. Do not touch it.
- Supabase migrations (applied history), CRM seed data, `artifacts/` (including `AlphaTestimonials.md`, the source of truth for original testimonial wording), and `docs/` keep their references — internal records, not the website.
- No archive route ships; git history preserves the old GT page. (Older Vercel preview/production deployments remain reachable at their immutable URLs — accepted, voluntary-rebrand context.)
- No new proof content (own testimonials, own outcome data) is created in this task — that's a follow-up once The 120 has its own results.
- Nurture email copy (`app/lib/nurture/copy.ts`) was verified clean — no brand mentions, no changes needed.

## Key Decisions

- **Voluntary rebrand, not a forced separation**: The 120 stands on its own brand by choice; same platform continues to deliver academics, unnamed.
- **TimeBack goes too**: full ecosystem separation, not just the three names originally listed.
- **Borrowed proof is cut, not de-branded**: unattributed network stats/testimonials would be dishonest; the site stands on its own claims until it has its own results. Exception: the simulator returns as an explicitly illustrative model (R10b) — a hypothetical, not a results claim.
- **Assessment-gate claim dropped entirely**, replaced by one honest sentence: "Admission by application and academic review."
- **Scholars keep a deep program page** at `/scholars`, in sibling group-page chrome; pillars section closes with a CTA row where the stats box was.
- **No `/gt-old` archive**: considered, rejected — a live branded page (with working enrollment CTAs and drifting shared components) buys nothing git doesn't already provide.
- **Real people's content handled conservatively**: GT advisors removed from the dashboard (with a member-facing framing line); parent stories trimmed with permission confirmed; founder quote disclosed as such on the home band.

## Dependencies / Assumptions

- **Permission confirmed** (2026-07-14): Ian Logan and Gordon McKay have both approved the edited versions of their stories. No release gate; everything ships together.
- Platform continuity confirmed: The 120 continues on the same delivery platform, unnamed. The $15,000 Full Academic Core offer survives unchanged except for its description.

## Outstanding Questions

### Deferred to Planning
- [Affects R9][Technical] Redirect mechanism for `/gt` → `/scholars` (`next.config.ts` redirect vs. route-level).
- [Affects R8][Technical] How much of the old GT page's component structure is reused vs. rebuilt when folding into `/scholars` (ProductPillars and GtTuition are currently GT-flavored components; the simulator component needs a rename per R10b).
- [Affects R8][Technical] How the sibling group-page chrome (minimal top bar, thin footer row) extends to a long multi-section page.
- [Affects Success Criteria][Needs research] Where Stripe product/price display names and Supabase auth email templates are configured, and whether they carry brand mentions.

## Next Steps

-> `/ce:plan` for structured implementation planning
