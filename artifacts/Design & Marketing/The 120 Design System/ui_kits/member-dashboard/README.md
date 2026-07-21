# UI Kit — Member Dashboard

The signed-in family view where parents build each child's "dossier" (the application) and track their path to one of the 120 seats.

## Screens
- `index.html` — Overview. Electric-blue sidebar (wordmark, nav, "your kids", parent + seat label), main column with dossier cards (completeness bar + status pill + edit/view/submit actions), add-child row, and the electric-blue "path to a seat" pipeline. Toggle "Workshop catalog" in the sidebar.

## Fidelity notes
- Staff/member app background is `--crm-bg` (#ECEAE5); sidebar + accent cards are electric blue `--crm-blue` (#0300ED).
- Completeness bar fills electric blue, or green at 100%.
- Georgia for the page title, mono for labels/pipeline chips.
- Source: `120-The120/app/dashboard/*` and the handoff `Dashboard.dc.html`.
