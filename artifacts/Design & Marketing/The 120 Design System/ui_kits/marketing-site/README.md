# UI Kit — The 120 Marketing Site

The public marketing site. An editorial, scarcity-driven recruitment page for the founding cohort.

## Screens
- `index.html` — interactive homepage. Composes DS primitives (Wordmark, Button, SeatsDot, Kicker, DisplayHeading, GroupCard, StatCard, FeatureCard, FaqItem, TextField/Select/Checkbox). "Join the 120" opens the account-creation modal.

## Structure (top → bottom)
Floating white card nav → full-bleed photo hero with bottom-anchored Georgia headline → intro + seats indicator → **five groups** band (indigo, 5-up GroupCards) → "Membership is 3 things" (2px-topped columns) → proof strip on ink (FeatureCard + StatCards) → tuition teaser → FAQ accordion → red CTA band → indigo footer.

## Fidelity notes
- Marketing blue is deep indigo `--blue` (#22219B), not the electric staff blue.
- Copy is deliberate: "group" not "tribe", no em dashes in product copy, Canadian spelling.
- Red is scarce — one loud CTA per band.
- Source: `120-The120/app/page.tsx` + `app/components/*` and the design handoff `Home.dc.html`.
