# Roadmap — the120.school

Working task list for the site. Check items off as they land; add new ones at the bottom of a section.

## 🔴 Needs a decision (blocking build work)

- [ ] **Design direction — five groups vs. single network.** Two candidate designs exist:
  - The **design handoff bundle** (shared separately): the 120 is five groups — Athletes, Founders, Makers, Scholars (GT), Givers — with **$3,000 CAD Membership** (math via Math Academy, no TimeBack) + **$15,000 Full Academic Core**, and GT Toronto as the Scholars' sub-site.
  - The **July 5 design brief (v4)**: single gifted network, assessment-gated top 1–2%, **$15,000 all-inclusive** — this is what's live right now.
  These conflict on pricing, audience, and site structure, and the handoff can't be dated against the brief. A handoff-styled version is being built on a branch (Vercel preview link to follow) so both can be compared live before choosing.
- [ ] **Household income brackets** on account creation: currently CAD-adjusted (Under $75,000 / $75,000–$200,000 / Over $200,000 / Prefer not to say). Brief lists this as an open item — confirm or revert to GT's original figures.
- [ ] **Full Academic Core pricing** (brief open item): same $15,000 as Membership, or premium?

## 🟠 External setup (accounts / services — not code)

- [ ] **Create a Supabase project** for the site.
  - Enable email auth (password + magic link).
  - Add the project keys to Vercel → Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and `SUPABASE_SERVICE_ROLE_KEY` as a server-only var).
  - The schema is already modeled in code (`app/dashboard/data.ts`: parents → children → subject picks / workshops / project pitch → dossier status), so wiring is a small change once keys exist.
- [ ] **Create a booking link** (Cal.com or Calendly) for "Book a Call" — a single 20–30 min intro-call event is enough. Drop the URL in this file or in an env var; every "Book a call" button currently points at a placeholder.
- [ ] **Domain**: register/confirm `the120.school` and point it at the Vercel project (plus defensive domains per brief: the120.ca, 120.school).
- [ ] **Mailbox**: set up `admissions@the120.school` — the footer and sign-up flow already reference it.
- [ ] **Photography**: source the licensed originals (GT library) — the current hero image is a 2165px extraction and goes slightly soft on retina; also Tin Can product imagery and a few Toronto shots.
- [ ] **Mission video**: the hero's "Watch the mission" link is a placeholder until a video (and its Canadian intro card) exists.
- [ ] **Tin Can partnership**: confirm logo/co-marketing rights before the brand appears beyond the current legal line.

## 🟡 Build queue (code — unblocked or waiting on the above)

- [ ] Handoff-integration branch: five-groups home, four group pages, serif/blue identity, $3k/$15k tuition → Vercel preview for the design decision.
- [ ] Supabase wiring (auth + dossier persistence) — **waiting on the Supabase project above**; V1 currently stores everything in the browser (localStorage).
- [ ] Book-a-call buttons → real scheduling link — **waiting on the booking link above**.
- [ ] Admin review queue (dossier queue, status changes, notes) — after Supabase.
- [ ] Remaining pages from the brief's site map: How It Works, The Full Program, Our Advisors, Intensives, full Tuition page, full FAQ page.
- [ ] CASL-consented nurture email flow — needs an email provider decision (e.g. Resend, Customer.io).
- [ ] Self-host the two Google fonts (build currently fetches them at build time).

## ✅ Done

- Homepage per brief v4: hero, three pillars, TimeBack Simulator, key dates, testimonials, tuition card, FAQ, CTA band, press/compliance footer.
- Join flow: account modal with CASL express consent + income brackets (local state).
- Parent dashboard + dossier builder: add children, subjects, workshop catalog, project pitch, completeness meter, status stepper, submit-for-review, printable dossier (localStorage V1).
- Responsive pass (iPhone/tablet/desktop, no overflows), hover/interaction polish, high-end join modal.
- Deployed: GitHub → Vercel auto-deploy on every push to `master`.
