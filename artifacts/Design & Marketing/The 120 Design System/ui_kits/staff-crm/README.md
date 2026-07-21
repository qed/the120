# UI Kit — Staff CRM (`/crm`)

The staff-only admissions tool: "Admin.dc.html grown into a product." Two staff users run the founding-cohort close from here.

## Screens
- `index.html` — CRM shell with the electric-blue chrome (logo chip, `ADMISSIONS · CRM` breadcrumb, blush `STAFF ONLY` pill, live seat label) and a mono tab row. Two working tabs:
  - **Dossiers** (default) — two-pane review queue: filter chips + candidate rows on the left, full dossier detail on the right (payment strip, group chip, subject/parent cards, the electric-blue PROJECT PITCH card, move-candidate stage chips).
  - **Pipeline** — family table with stage pills, heat pips, source chips (ambassador codes in red), CASL-consent column, colour-coded last-touch, and the co-pilot's next action.

## Fidelity notes
- Denser and quieter than the marketing site; same identity.
- Electric blue `--crm-blue` (#0300ED) is the accent (chrome, active tab, pitch card); red is action/heat; green/amber are functional only.
- Heat = five red **squares** (echoing the logo chip), not dots.
- Selected row: white with a 1px electric-blue border + blue glow.
- Source: `120-The120/artifacts/crm-design-brief.md`, `app/crm/*`, handoff `Admin.dc.html`.
