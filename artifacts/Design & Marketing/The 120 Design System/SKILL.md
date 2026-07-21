---
name: the120-design
description: Use this skill to generate well-branded interfaces and assets for The 120 (a selective network of 120 Toronto kids, ages 8–17), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Quick orientation:
- `readme.md` — brand context, content voice, visual foundations, iconography, and the file index.
- `styles.css` — the one stylesheet to link; it imports every token + webfont from `tokens/`.
- `guidelines/` — foundation specimen cards (Brand, Colors, Type, Spacing).
- `components/` — React primitives (brand, actions, forms, content, crm), each with a `.d.ts` + `.prompt.md`.
- `ui_kits/` — full-screen recreations: marketing site, member dashboard, staff CRM.
- `assets/` — real reference photography. The brand mark is pure type (the `Wordmark` component), not a logo file.
