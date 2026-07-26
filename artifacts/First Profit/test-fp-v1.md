# First Profit (`/fp`) — Test Roadmap v1

**Purpose.** Get First Profit from "all units merged" to "ready to hand to the WF team for final pre-live testing."
**Status of the build:** all 11 units merged (PRs #48–#58); the `/path` → `/fp` rename is **live in production** as of 2026-07-24.

## How to use this document

**Every test has a number.** Report bugs by that number — e.g. *"3.15.4 failed"* — so nothing is ambiguous.

```
  3 . 15 . 4
  │    │    └── item within the section
  │    └─────── section (PWA / install)
  └──────────── level (1 = smoke, 2 = single thread, 3 = long list)
```

| Level | Who runs it | Time | Goal |
|---|---|---|---|
| **1 — Smoke** | Peter | ~15 min | Is anything obviously broken? Stop-the-line checks. |
| **2 — The single thread** | Peter (demo-able on a big screen) | ~45 min | One continuous story: new cohort → guide signs in → participants added → work verified → the room's board fills in live. |
| **3 — The long list** | Intern | ~1–2 days | Every category, every edge case, flagged before the WF team sees it. |

**Section index**

| | Level 1 | | Level 2 | | Level 3 |
|---|---|---|---|---|---|
| 1.1 | Rename took | 2.1 | Create cohort | 3.1 | The rename |
| 1.2 | Three doors | 2.2 | Add a guide | 3.2 | Auth & access |
| 1.3 | Board on screen | 2.3 | Mint big-screen URL | 3.3 | Guide invites |
| 1.4 | Check-in works | 2.4 | Guide signs in | 3.4 | Cohorts & switcher |
| 1.5 | Nothing on fire | 2.5 | Populate participants | 3.5 | Board tokens & big screen |
| | | 2.6 | Verify work | 3.6 | The board's numbers |
| | | 2.7 | First Dollar 🔔 | 3.7 | Check-in mechanics |
| | | 2.8 | Batch check-in | 3.8 | Batch check-in |
| | | 2.9 | Board review | 3.9 | Navigation & search |
| | | 2.10 | Close the thread | 3.10 | Quick-create |
| | | | | 3.11 | Bulk import |
| | | | | 3.12 | Offline |
| | | | | 3.13 | Staff ops |
| | | | | 3.14 | Student & parent side |
| | | | | 3.15 | PWA / install |
| | | | | 3.16 | Performance & scale |
| | | | | 3.17 | Security & privacy |
| | | | | 3.18 | Copy & polish |

---

## Before you start

**URLs** (production, `https://the120.school`):

| Surface | URL |
|---|---|
| Staff ops | `/fp/fw/ops` |
| Guide surface | `/fp/fw` |
| Guide sign-in | `/fp/fw/sign-in` |
| **Big screen (board)** | `/fp/fw/board/<token>` ← minted in 2.3 |
| Student/parent sign-in | `/fp/sign-in` |
| Parent dashboard | `/fp/family` |
| Staff CRM (must be unaffected) | `/crm` |

**Terminal parity.** Every staff action is also available from a terminal — useful to set up fast or to verify what the UI claims:
```
npm run fw            # prints the full command list
npm run fw -- cohorts
npm run fw -- board --cohort <uuid>
```

**Existing rehearsal data** (already in production — safe to explore, do **not** delete):

| Cohort | ID | Contents |
|---|---|---|
| `rehearsal-unit9` | `596dd02a-40fe-4a3d-8f82-8c0ffdb0d942` | 90 students, all locked — the projector-legibility cohort |
| `rehearsal-unit4` | `80901a06-…` | ~30 students, one anonymized |
| `rehearsal-unit4-second` | `b3ecea2f-…` | 4 imported, incl. 2 returners |
| `unit5-verify` | `b3e0738f-…` | undeletable (audit rows) |

Guide login for rehearsal: `rehearsal.guide@the120.invalid` — password in `scripts/.fw-rehearsal.local.txt` (gitignored).

**How to flag.** For each item: ✅ works / ⚠️ works-but-odd / ❌ broken. For ⚠️ and ❌ record:

> **ID** · what you did · what you expected · what happened · URL · rough time

---

# LEVEL 1 — Big, obvious things (Peter, ~15 min)

Stop-the-line checks. If any fail, don't bother with Levels 2–3 until fixed.

## 1.1 The rename actually took

- [ ] **1.1.1** `https://the120.school/fp/sign-in` loads and says **First Profit** (not "First Profit")
- [ ] **1.1.2** `https://the120.school/path/sign-in` **redirects** to `/fp/sign-in` (old links still work)
- [ ] **1.1.3** `https://the120.school/path/fw` redirects to `/fp/fw`
- [ ] **1.1.4** Browser tab titles say **First Profit** (e.g. "Sign in — First Profit")
- [ ] **1.1.5** `/crm` still loads normally and looks untouched
- [ ] **1.1.6** Marketing site (`/`, `/scholars`, `/tuition`) unchanged and **not** branded First Profit

> Already verified in production: `/fp/sign-in` returns 200 with First Profit branding, and `/path/fw/board/<tok>?x=1` redirects to `/fp/fw/board/…` preserving sub-path and query. Re-confirm in a real browser.

## 1.2 The three doors open

- [ ] **1.2.1** **Staff:** `/fp/fw/ops` — cohort list visible
- [ ] **1.2.2** **Guide:** `/fp/fw/sign-in` — asks for **email + password** (not a child's first name)
- [ ] **1.2.3** **Student:** `/fp/sign-in` — asks for **name + password**, with a Student/Parent toggle
- [ ] **1.2.4** Signed out, `/fp/fw/cohort/anything` sends you to the **guide** door, not the student door

## 1.3 The board shows up on a screen

- [ ] **1.3.1** Open a board URL (mint one in 2.3, or `npm run fw -- board --cohort 596dd02a-40fe-4a3d-8f82-8c0ffdb0d942`)
- [ ] **1.3.2** Renders full-screen: legible grid, an XP number, no browser chrome needed
- [ ] **1.3.3** **No per-child scores anywhere** — hard product rule
- [ ] **1.3.4** Keeps updating on its own (~4 s polling) without a refresh

## 1.4 A check-in works end to end

- [ ] **1.4.1** As a guide: student → task → tap **Checkmark**
- [ ] **1.4.2** Control updates and the view **stays put** (no auto-jump to the next student)
- [ ] **1.4.3** Tap **Undo** — it reverts
- [ ] **1.4.4** Within a few seconds the board reflects the change

## 1.5 Nothing is on fire

- [ ] **1.5.1** No error screens or blank pages anywhere you clicked
- [ ] **1.5.2** No obviously broken layout on an iPad (the guide's real device)
- [ ] **1.5.3** Vercel runtime errors for the last hour — should be empty

---

# LEVEL 2 — The single thread (Peter, ~45 min, big-screen demo)

One continuous story. **This is the flow to run on a big screen** — 2.3 gives you the URL to project; from 2.6 on, the audience watches the board fill in live as you tap.

> **Tip:** two devices. A laptop/iPad for the guide surface, the big screen for the board. Tap on the iPad; let the room watch the board.

## 2.1 Create a new cohort (staff) — `/fp/fw/ops`

- [ ] **2.1.1** Create a cohort with a recognizable slug, e.g. `demo-2026-07`
- [ ] **2.1.2** Set **start** and **end** date/time
- [ ] **2.1.3** Pick the **time zone** explicitly
- [ ] **2.1.4** Save — cohort appears in the list
- [ ] **2.1.5** Window is shown back to you **in the time zone you chose** (not UTC, not browser-local)

**Flag if:** times shift, the time zone is ignored, or it saves without a window.

*Terminal:* `npm run fw -- cohort-create --slug demo-2026-07 --start 2026-07-25 --start-time 09:00 --end 2026-07-27 --end-time 17:00 --tz America/Toronto`

## 2.2 Add a guide and get them a login

- [ ] **2.2.1** Add a guide by email (one you can receive at, or reuse the rehearsal guide)
- [ ] **2.2.2** An invite link is generated
- [ ] **2.2.3** Guide appears in the cohort's guide list as **unclaimed**

*Terminal:* `npm run fw -- guide-add --cohort <uuid> --email guide@example.com`

## 2.3 Mint the big-screen URL 📺

- [ ] **2.3.1** Mint a **board token** for the cohort
- [ ] **2.3.2** Copy `https://the120.school/fp/fw/board/<token>`
- [ ] **2.3.3** **Open it on the big screen now** — before any students exist
- [ ] **2.3.4** Empty state looks intentional: no students, XP zero, no errors, no endless spinner

*Terminal:* `npm run fw -- token-mint --cohort <uuid>` (add `--force` to replace a live one)

> ⚠️ **Demo warning:** re-minting **kills the old URL immediately**. If the screen goes blank mid-demo, someone re-minted — paste the new URL.

## 2.4 Guide claims their login and signs in

- [ ] **2.4.1** Open the invite link (ideally on the demo iPad)
- [ ] **2.4.2** Set a password, land signed in on `/fp/fw`
- [ ] **2.4.3** One cohort → **no** picker. Several → you must **explicitly pick**; there is deliberately no default
- [ ] **2.4.4** As this guide, open `/crm` → must **404**. Guides never reach staff tools

## 2.5 Populate the participants

Do **both** — they exercise different paths.

**2.5a — Bulk import (the real Boston path)**
- [ ] **2.5.1** Prepare a small CSV (first, last, and grade *or* band), ~8 rows
- [ ] **2.5.2** Run a **dry run** — previews rows, creates nothing
- [ ] **2.5.3** Run it for real; roster shows the imported students
- [ ] **2.5.4** Per-row report appears; a bad row is rejected individually, never killing the file
- [ ] **2.5.5** Re-run the same file → mints **nothing new**

*Terminal:* `npm run fw -- import --cohort <uuid> --file roster.csv --dry-run` then without `--dry-run`

**2.5b — Quick-create a walk-in (kid standing at your table)**
- [ ] **2.5.6** Quick-create one student: first, last, band
- [ ] **2.5.7** Try to submit **without** ticking the attestation ("family has seen the program notice") → **blocked**
- [ ] **2.5.8** Tick it, submit → student created and you land in their task tree, ready to tap

## 2.6 Verify work (the main loop) — *watch the big screen*

- [ ] **2.6.1** Pick a student from the roster → open a **task**
- [ ] **2.6.2** Reading-rule banner appears ("anywhere it says a parent — that's you")
- [ ] **2.6.3** Dismiss it, then confirm you can **re-open** it
- [ ] **2.6.4** Tap **Checkmark** → 👀 board updates
- [ ] **2.6.5** Tap **Not-yet** on another task → 👀 board reflects it (wanted data, not a failure)
- [ ] **2.6.6** Tap **Not-yet again** on that same task → allowed; records a repeat attempt
- [ ] **2.6.7** Tap **Undo** on the first task → 👀 board **retracts** that line
- [ ] **2.6.8** After each tap the view stays put with an updated control, plus a clear next-student affordance
- [ ] **2.6.9** Board catches up within ~5 s each time

## 2.7 The First Dollar moment 🔔 — *the demo highlight*

Task **1.2.4** is the first-dollar task.

- [ ] **2.7.1** Open a student's task **1.2.4** → tap **Checkmark**
- [ ] **2.7.2** A **confirmation** appears naming the student ("this rings the bell")
- [ ] **2.7.3** Confirm it
- [ ] **2.7.4** 👀 Board celebrates — the First Dollar moment fires
- [ ] **2.7.5** The First Dollar **counter** increments

**Flag if:** the bell fires with no confirmation, or the confirm doesn't name the student.

## 2.8 Batch check-in

- [ ] **2.8.1** On one task, multi-select other students (**max 3 total**, including the one you started from)
- [ ] **2.8.2** Try to add a 4th → refused/reported, not silently dropped
- [ ] **2.8.3** Submit → 👀 board updates for all of them
- [ ] **2.8.4** Already-decided students are **skipped and named**
- [ ] **2.8.5** If the batch includes 1.2.4, the confirm fires **once**, naming **every** selected student

## 2.9 What the room sees (board review on the big screen)

- [ ] **2.9.1** Grid legible **from across the room**
- [ ] **2.9.2** Cohort **XP total** prominent — and it's the **room's** number (this weekend's work)
- [ ] **2.9.3** **First Dollar counter** visible beside it
- [ ] **2.9.4** Ticker shows recent moments
- [ ] **2.9.5** **No per-child scores** anywhere
- [ ] **2.9.6** Duplicate names distinguishable
- [ ] **2.9.7** Nothing on screen would embarrass a kid

## 2.10 Close the thread

- [ ] **2.10.1** Sign the guide out cleanly
- [ ] **2.10.2** As staff, revoke the board token → the projected URL stops working
- [ ] **2.10.3** Cohort data still intact in `/fp/fw/ops`

**✅ If all ten steps pass, the core product works.** Hand Level 3 to the intern.

---

# LEVEL 3 — The long list (intern, ~1–2 days)

Work top to bottom. Flag **everything** odd, even if minor — small weirdness on a projector in front of 90 kids is not minor. Don't fix anything; just record it against its ID.

**Use `rehearsal-unit9` (`596dd02a-40fe-4a3d-8f82-8c0ffdb0d942`, 90 students)** for anything about scale or legibility.

## 3.1 The rename (`/path` → `/fp`)

- [ ] **3.1.1** Old URLs redirect: `/path`, `/path/sign-in`, `/path/family`, `/path/now`, `/path/review`, `/path/notifications`, `/path/fw`, `/path/fw/ops`, `/path/fw/board/<token>`
- [ ] **3.1.2** Redirect preserves the **query string**: `/path/fw/board/<tok>?x=1` → `/fp/fw/board/<tok>?x=1`
- [ ] **3.1.3** Deep sub-paths survive: `/path/task/1.2.4` → `/fp/task/1.2.4`
- [ ] **3.1.4** No page anywhere still displays "First Profit" (titles, headings, nav, buttons, emails, errors, empty states)
- [ ] **3.1.5** Known-tricky strings: day-one welcome screen; "still being set up" empty state; HQ dashboard section header; "child already has an account" error; "already belongs to another family" invite error; PWA update toast; install prompt; offline page
- [ ] **3.1.6** Emails say First Profit (parent invite, guide invite, notifications) and link to `/fp/…`
- [ ] **3.1.7** `/crm` completely untouched — spot-check several pages
- [ ] **3.1.8** Marketing pages unaffected and not installable as First Profit
- [ ] **3.1.9** `/fpology`-style URLs (share the `/fp` prefix but aren't under it) aren't treated as app routes

## 3.2 Auth & access

- [ ] **3.2.1** Signed out, every `/fp/*` page sends you to `/fp/sign-in`
- [ ] **3.2.2** Signed out, every `/fp/fw/*` page sends you to `/fp/fw/sign-in` (the **guide** door)
- [ ] **3.2.3** A **student** session cannot reach guide surfaces
- [ ] **3.2.4** A **guide** session cannot reach `/crm` (404)
- [ ] **3.2.5** A guide granted cohort A cannot act on cohort B
- [ ] **3.2.6** Staff (admin + active staff row) can act as a guide in an `fw` cohort
- [ ] **3.2.7** Staff whose row is deactivated loses access even with a valid session
- [ ] **3.2.8** Session expiry mid-use lands you on the **right** door for where you were
- [ ] **3.2.9** Sign-out clears the session (back button doesn't restore it)

## 3.3 Guide invites

- [ ] **3.3.1** Invite link works on first use
- [ ] **3.3.2** Same link used **twice** → dead-link message, not a crash
- [ ] **3.3.3** Expired invite (>14 days) → dead-link message
- [ ] **3.3.4** Staff **re-issue** produces a working link and the **old link stops working**
- [ ] **3.3.5** Hammering the claim endpoint gets rate-limited
- [ ] **3.3.6** A claimed guide shows as claimed in the staff list
- [ ] **3.3.7** Guide accounts never carry admin rights

## 3.4 Cohorts & the switcher

- [ ] **3.4.1** Create cohorts with windows in several time zones — displayed times match what was entered
- [ ] **3.4.2** Cohort with **no window** behaves sensibly, and token minting is refused
- [ ] **3.4.3** Single-cohort guide → **no** picker shown
- [ ] **3.4.4** Multi-cohort guide → must pick explicitly at session start; **no default**
- [ ] **3.4.5** The pick **persists** on that device across reloads
- [ ] **3.4.6** Switching cohorts **resets** the drill-down
- [ ] **3.4.7** A returner in two cohorts is handled correctly in both
- [ ] **3.4.8** Board tokens mintable only for `fw` cohorts, never a Path cohort

## 3.5 Board tokens & the big screen

- [ ] **3.5.1** Mint → URL works
- [ ] **3.5.2** **Re-mint kills the previous URL** (confirm the old one dies)
- [ ] **3.5.3** Revoke → URL stops working with a sensible page, not a raw crash
- [ ] **3.5.4** Garbage token → clean 404, revealing nothing about whether the cohort exists
- [ ] **3.5.5** Token expiry = cohort end **+ 6 hours**; an expired token stops working
- [ ] **3.5.6** Board page **and** its data feed are both no-store and noindex
- [ ] **3.5.7** Board works with **no session at all** (a projector never signs in)
- [ ] **3.5.8** Board survives a network blip — stale indicator, never a blank screen
- [ ] **3.5.9** Board open 30+ min — no memory creep, no drift, still polling

## 3.6 The board's numbers (semantics — read carefully)

- [ ] **3.6.1** Grid cells are **record-to-date** — a returner's earlier work shows already filled
- [ ] **3.6.2** Hero **XP** is **this weekend only** — opens at zero on day one, even for returners
- [ ] **3.6.3** First Dollar **counter** is weekend-scoped too
- [ ] **3.6.4** Ticker lines **retract** when a check-in is undone
- [ ] **3.6.5** **No per-child XP or score anywhere** (hard rule)
- [ ] **3.6.6** Duplicate names get a tiebreaker so two "Maya C." are distinguishable
- [ ] **3.6.7** An **anonymized** student's work still counts in totals, but their name is gone from grid and ticker
- [ ] **3.6.8** XP math right: a verified task's weight comes from its phase (Sell=1 … Scale=5) — spot-check by hand
- [ ] **3.6.9** 90-student cohort on a real projector: rows legible, order stable, no pagination surprises

## 3.7 Check-in mechanics (the heart)

- [ ] **3.7.1** Checkmark on a locked task → works (no gating; every FW task is tappable)
- [ ] **3.7.2** Checkmark on an already-verified task → no-op, **no second bell**
- [ ] **3.7.3** Not-yet on a fresh task → recorded
- [ ] **3.7.4** **Not-yet again** on the same task → records a repeat attempt (the struggle signal — wanted)
- [ ] **3.7.5** Undo from verified → returns to locked
- [ ] **3.7.6** Undo from not-yet → returns to locked
- [ ] **3.7.7** Undo on an already-locked task → harmless no-op
- [ ] **3.7.8** Verified → Not-yet directly → refused, told to undo first
- [ ] **3.7.9** Double-tap the same button fast → **one** result, not two
- [ ] **3.7.10** After any tap the view **stays in place** with an updated control
- [ ] **3.7.11** A failed tap looks clearly different from a queued one
- [ ] **3.7.12** Two guides acting on the same student at once → no lost updates, no duplicate events

## 3.8 Batch check-in

- [ ] **3.8.1** Select 2 students + primary = 3 → works
- [ ] **3.8.2** Exceeding **3 total** → refused and **reported**, never silently dropped
- [ ] **3.8.3** Batch where some are already decided → those are **skipped and named**
- [ ] **3.8.4** Batch including 1.2.4 → confirm fires **once**, naming **every** selected student
- [ ] **3.8.5** Batch partially fails → you're told exactly who succeeded and who didn't
- [ ] **3.8.6** Undo works individually afterward

## 3.9 Navigation, search, reading rule

- [ ] **3.9.1** Roster search finds students by first or last name
- [ ] **3.9.2** **Typo tolerance** — "Mya" finds "Maya"
- [ ] **3.9.3** Duplicate names distinguishable in the roster
- [ ] **3.9.4** Resume chips show where a student left off
- [ ] **3.9.5** Task tree shows all 5 phases; nothing gated
- [ ] **3.9.6** Reading-rule banner is dismissible **per device** and can be **re-opened**
- [ ] **3.9.7** Both reading-rule clauses read correctly (parent = you; seeing it is enough)
- [ ] **3.9.8** Deep-linking straight to a task URL works
- [ ] **3.9.9** Back button behaves sanely throughout

## 3.10 Quick-create (walk-ins)

- [ ] **3.10.1** Attestation unticked → submission **blocked**; try to bypass it in the form → still refused server-side
- [ ] **3.10.2** Created student is immediately usable (account + membership + task tree all real)
- [ ] **3.10.3** Duplicate name → handled with a confirm, not a silent duplicate
- [ ] **3.10.4** A student who already exists in another cohort → surfaces as a possible match
- [ ] **3.10.5** Accented / hyphenated / apostrophe names ("José", "Anne-Marie", "O'Brien") work
- [ ] **3.10.6** Very long names don't break the layout
- [ ] **3.10.7** Empty/whitespace names → refused
- [ ] **3.10.8** A failed step offers **retry in place** — never a dead-end tree

## 3.11 Bulk import

- [ ] **3.11.1** Clean CSV imports fully
- [ ] **3.11.2** **Dry run** changes nothing (verify no accounts created)
- [ ] **3.11.3** **Re-running the same file mints nothing new**
- [ ] **3.11.4** One bad row → that row rejected, the rest import
- [ ] **3.11.5** Missing columns / wrong headers → clear message, not a crash
- [ ] **3.11.6** Grade→band conversion right; explicit band also works
- [ ] **3.11.7** Out-of-range grade → flagged
- [ ] **3.11.8** Duplicate rows within one file → deduped
- [ ] **3.11.9** Import **exceptions list** shows unresolved rows; resolve and dismiss both work
- [ ] **3.11.10** Big file (~90 rows) completes without timing out
- [ ] **3.11.11** Interrupted mid-import → re-run finishes cleanly, no duplicates
- [ ] **3.11.12** Empty file / header-only file → sensible message
- [ ] **3.11.13** Weird CSV: quoted fields containing commas, trailing blank lines, CRLF vs LF, UTF-8 accents, a stray quote

## 3.12 Offline (the venue-wifi reality) — **test on a real iPad**

- [ ] **3.12.1** Airplane mode → app **still navigates** (roster, student, task)
- [ ] **3.12.2** Taps while offline are **queued**, with a visible count
- [ ] **3.12.3** Indicator shows all three states: **n queued / syncing / synced**
- [ ] **3.12.4** Reconnect → queue drains automatically, board catches up
- [ ] **3.12.5** Sign-out **offline with queued taps** → refused, count shown
- [ ] **3.12.6** Sign-out **online with queued taps** → asked to drain first
- [ ] **3.12.7** After a clean drain, sign-out works and clears residue
- [ ] **3.12.8** Offline **quick-create** → replaced by the written procedure, which says **search the roster first**
- [ ] **3.12.9** Offline correction (undo → not-yet on the same task) replays in order, not collapsed
- [ ] **3.12.10** Undoing **another guide's** check-in offline → rejected to staff, visible in the reject list
- [ ] **3.12.11** Private browsing / storage disabled → **persistent** warning that this device can't capture offline
- [ ] **3.12.12** Kill the app mid-outage and reopen → queue survives
- [ ] **3.12.13** A tap made offline shows the **pending** state when you revisit the task (not a stale "untouched")
- [ ] **3.12.14** First Dollar earned during an outage → counts on drain, but **no screen bell** (the physical bell already rang)
- [ ] **3.12.15** A permanently failing item stops auto-retrying (~8 attempts) and offers manual retry; copy stops promising automatic send
- [ ] **3.12.16** 20-minute outage drill: ~15 taps offline, reconnect, verify **every one** landed and the board matches

## 3.13 Staff ops

- [ ] **3.13.1** Cohort list shows all cohorts with their windows
- [ ] **3.13.2** Guide list shows claimed/unclaimed, with grant/revoke
- [ ] **3.13.3** Revoking a guide takes effect immediately
- [ ] **3.13.4** **Replay-reject list**: shows student, task, reason in plain language; resolve/dismiss works; defaults to open items
- [ ] **3.13.5** **Anonymize** requires typing the student's name to confirm
- [ ] **3.13.6** After anonymizing: name gone from roster/grid/ticker, but their **events still count** in totals
- [ ] **3.13.7** An anonymized student can't be found by searching their old name
- [ ] **3.13.8** The freed email address is **never** re-used for a different child with the same name
- [ ] **3.13.9** Match resolution (same kid across cohorts) links correctly
- [ ] **3.13.10** Every staff action is re-checked server-side (a guide-level session can't drive an ops action)

## 3.14 Student & parent side (First Profit surfaces — the rename touched these)

- [ ] **3.14.1** Student sign-in works; lands on their journey
- [ ] **3.14.2** Parent sign-in works; lands on `/fp/family`
- [ ] **3.14.3** Parent dashboard lists children correctly
- [ ] **3.14.4** Task view, evidence capture, and submit still work
- [ ] **3.14.5** Review queue works for a parent
- [ ] **3.14.6** Notifications page loads; links go to `/fp/…`
- [ ] **3.14.7** Parent invite email → link works → co-parent accepted
- [ ] **3.14.8** Onboarding / add-a-founder flow works, incl. the Grades 3–12 message
- [ ] **3.14.9** Offline page renders styled, says First Profit, and its "Try again" goes to `/fp`

## 3.15 PWA / install

- [ ] **3.15.1** Add to Home Screen on iOS → icon says **First Profit**
- [ ] **3.15.2** Launching from the icon opens **standalone** (no browser chrome)
- [ ] **3.15.3** Scope is `/fp` — navigating in-app stays standalone
- [ ] **3.15.4** A device that installed **before** the rename: the old icon may drop to a browser tab → **re-add to home screen** fixes it. Confirm **no data is lost** (queued taps survive)
- [ ] **3.15.5** App update toast appears on a new deploy and reloads cleanly when tapped
- [ ] **3.15.6** Offline fallback page appears when there's no network

## 3.16 Performance & scale

- [ ] **3.16.1** Board with 90 students loads in a couple of seconds
- [ ] **3.16.2** Tap → board update comfortably under ~5 s
- [ ] **3.16.3** Roster search on 90 students feels instant
- [ ] **3.16.4** Board left open an hour stays responsive
- [ ] **3.16.5** Several guides + a board polling simultaneously → no visible slowdown
- [ ] **3.16.6** iPad on slow/flaky wifi → still usable, no half-rendered screens

## 3.17 Security & privacy spot-checks

- [ ] **3.17.1** Board URL leaks nothing beyond first name + initial
- [ ] **3.17.2** Board is not indexable (noindex) and not cacheable (no-store)
- [ ] **3.17.3** Guessing or altering a board token gets you nothing
- [ ] **3.17.4** A guide can't read another cohort's roster by editing the URL
- [ ] **3.17.5** Student emails never displayed on the board or any projected surface
- [ ] **3.17.6** No child's full last name appears on the projected board
- [ ] **3.17.7** Signed-out access to an authed URL never flashes content before redirecting

## 3.18 Copy, polish, and the little things

- [ ] **3.18.1** No lorem ipsum, TODO, or placeholder text anywhere
- [ ] **3.18.2** Every error message says what to do next, not just what went wrong
- [ ] **3.18.3** Empty states (no students, no cohorts, no rejects) look intentional
- [ ] **3.18.4** Buttons show a pending state while working, and never double-submit
- [ ] **3.18.5** Nothing important conveyed by colour alone (projector colours shift)
- [ ] **3.18.6** Tap targets comfortable on an iPad, one-handed
- [ ] **3.18.7** Landscape **and** portrait both work on iPad
- [ ] **3.18.8** Long names / long task titles don't overflow or clip
- [ ] **3.18.9** Date and time formats consistent and unambiguous
- [ ] **3.18.10** Consistent terminology — First Profit, cohort, guide, check-in (no leftover jargon)

---

## Reporting back

Group findings by severity, each line led by its **ID**:

1. **Blockers** (❌) — must fix before the WF team sees it
2. **Should-fix** (⚠️) — noticeable, especially anything visible on the projector
3. **Nice-to-have** — polish for later
4. **Confusing but not broken** — if it confused you, it'll confuse a guide at 9 a.m. on a Saturday

*Example:* `3.12.5 ❌ — signed out with 4 queued taps while in airplane mode; expected a refusal with the count; got signed out and the queue was gone. iPad, /fp/fw, ~10:15.`

---

## Known and expected — do **not** flag these

- Internal names still containing "path" — the IndexedDB store `path-offline-queue`, service-worker caches `path-sw-*`, the file `path.webmanifest`, cron routes `/api/cron/path-*`. **Deliberately unchanged**; renaming them would wipe every installed device's saved work.
- Code comments and file/symbol names still saying "Path" (`PathShell`, `font-path-*`). Not user-visible.
- `"First Profit 1.0 — 2026-27"` as a curriculum **version label** — content versioning, intentionally deferred.
- Two test files failing locally with a missing `artifacts/First Profit/…` file — pre-existing repo issue, unrelated to the app.
- Not-yet taps are **good data**, not failures. Guides should be encouraged to use them.
