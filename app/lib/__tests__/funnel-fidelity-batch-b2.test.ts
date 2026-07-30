import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DOOR_ARCH_CLASSES,
  DOOR_BLURBS,
  DOORS_SUBHEAD,
  SKIN_ROOT_CLASSES,
  doorsModel,
} from "@/app/lib/funnel/miniapp-rules";
import { COMPOSE_UI_COPY } from "@/app/lib/funnel/compose-rules";
import {
  APPLICATION_REGISTER_CLASSES,
  CLIMB_BULLETS,
  CLIMB_CAPTION,
  CLIMB_HEADING,
  emittedCopy,
  revealModel,
} from "@/app/lib/funnel/reveal-rules";
import {
  ARRIVAL_SCREEN,
  arrivalCeremonyTitle,
} from "@/app/lib/funnel/arrival-rules";
import { GROUP_SLUGS } from "@/app/lib/site";

/**
 * Unit 10 BATCH B2 of the First Profit fidelity pass (audit:
 * docs/plans/2026-07-29-fp-fidelity-audit.md — drift 7's register-flip
 * half, 10, 11, 13, and escalation rulings E2 [the FULL Path DS on the
 * mini-app] + E5 [the arrival acceptance-letter ceremony]). Copy and class
 * decisions live in rules modules and are pinned by value; the JSX wiring
 * is pinned by source scan, because `environment: "node"` has no renderer.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SHELL = "app/start/child/[childId]/MiniAppShell.tsx";
const ARRIVAL = "app/start/arrival/ArrivalFlow.tsx";

/* ─────────────── E2: the Path DS register, wired ─────────────── */

describe("E2: the mini-app renders the FULL Path DS register", () => {
  const shell = stripComments(read(SHELL));

  it("the skin root carries the Path body face alongside canvas and ink", () => {
    expect(SKIN_ROOT_CLASSES.hq).toBe("bg-hq-canvas text-hq-ink font-path-body");
    expect(SKIN_ROOT_CLASSES.trail).toBe("bg-trail-canvas text-trail-ink font-path-body");
  });

  it("the application-register islands flip the type register back", () => {
    // The reveal close strip (and anything sharing the literal) returns to
    // the site body face inside the skin subtree.
    expect(APPLICATION_REGISTER_CLASSES).toContain("font-display");
  });

  it("the shell imports the ported DS components, not hand-rolled lookalikes", () => {
    expect(shell).toContain('from "@/app/fp/components/system/Button"');
    expect(shell).toContain('from "@/app/fp/components/system/Seal"');
    expect(shell).toContain('from "@/app/fp/components/system/phases"');
  });

  it("step headings are the Path display face, never the application register's", () => {
    // Every skinned-step heading swapped to font-path-display; the old
    // font-display headings are gone from the shell.
    expect(shell).toMatch(/font-path-display/);
    expect(shell).not.toMatch(/<h1 className="[^"]*\bfont-display\b/);
  });
});

describe("drift 7 (register-flip half): the handoff CTA renders in the child's skin", () => {
  const shell = stripComments(read(SHELL));
  const handoff = shell.slice(shell.indexOf("function Handoff("));

  it("the CTA is the DS Button in the child's skin", () => {
    expect(handoff).toMatch(/<Button skin=\{skin\} size="lg" onClick=\{onNext\}/);
  });

  it("the red application pill never appears on this side of the seam", () => {
    expect(handoff).not.toContain("bg-red");
  });
});

/* ─────────────── drift 10: the doors screen ─────────────── */

describe("drift 10: doors — arch chip, kicker, blurbs, subhead", () => {
  it("the subhead is the prototype's, byte for byte", () => {
    expect(DOORS_SUBHEAD).toBe(
      "Every founder in The 120 belongs to one group. Behind your door: two ready-to-run starting points, and room for your own idea."
    );
  });

  it("kickers spell GROUP 0n · CATEGORY in position order, arch numerals 1-5", () => {
    const doors = doorsModel({ hintSlug: null, isFirstChild: true, confirmedSlug: null });
    expect(doors.map((d) => d.kicker)).toEqual([
      "GROUP 01 · SPORT",
      "GROUP 02 · ENTREPRENEURSHIP",
      "GROUP 03 · SERVICE",
      "GROUP 04 · CREATIVE",
      "GROUP 05 · GIFTED & TALENTED",
    ]);
    expect(doors.map((d) => d.archNumeral)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("every door carries both band-register blurbs, verbatim from the prototype", () => {
    expect(DOOR_BLURBS.athletes.trail).toBe(
      "You train seriously. Turn your sport into a real season business."
    );
    expect(DOOR_BLURBS.athletes.hq).toBe(
      "Train seriously, compete seriously, and think like a pro."
    );
    expect(DOOR_BLURBS.founders.trail).toBe(
      "Start something real. Customers, money, lessons you keep."
    );
    expect(DOOR_BLURBS.founders.hq).toBe(
      "Start something real. Customers, revenue, lessons learned."
    );
    expect(DOOR_BLURBS.givers.trail).toBe(
      "Lead real service. Raise real money for a cause you pick."
    );
    expect(DOOR_BLURBS.givers.hq).toBe(
      "Lead real service. Projects that change a corner of the city."
    );
    expect(DOOR_BLURBS.makers.trail).toBe(
      "You already make things. Get paid for the things you make."
    );
    expect(DOOR_BLURBS.makers.hq).toBe(
      "Art, film, music, invention. A real body of work, shipped."
    );
    expect(DOOR_BLURBS.scholars.trail).toBe(
      "You love big questions. Fund a real study and run it."
    );
    expect(DOOR_BLURBS.scholars.hq).toBe(
      "Accelerated academics. Mastery with no ceiling."
    );
    // Copy rules: no em dashes in any blurb.
    for (const slug of GROUP_SLUGS) {
      expect(DOOR_BLURBS[slug].trail).not.toContain("—");
      expect(DOOR_BLURBS[slug].hq).not.toContain("—");
    }
  });

  it("every door has arch-chip classes, complete literals in a phase colour", () => {
    for (const slug of GROUP_SLUGS) {
      const cls = DOOR_ARCH_CLASSES[slug];
      expect(cls).toMatch(/border-phase-\w+ text-phase-\w+ bg-phase-\w+\/15/);
      expect(cls).not.toMatch(/\$\{|`/);
    }
    // Five doors, five DIFFERENT phase colours.
    expect(new Set(Object.values(DOOR_ARCH_CLASSES)).size).toBe(5);
  });

  it("the shell renders chip, kicker, blurb, and subhead from the rules", () => {
    const shell = stripComments(read(SHELL));
    expect(shell).toContain("{DOORS_SUBHEAD}");
    expect(shell).toContain("DOOR_ARCH_CLASSES[door.slug]");
    expect(shell).toContain("{door.archNumeral}");
    expect(shell).toContain("{DOOR_BLURBS[door.slug][skin]}");
    // The arch silhouette: rounded arch top over a near-square base.
    expect(shell).toContain("rounded-t-[19px] rounded-b-[4px]");
  });
});

/* ─────────────── drift 13: the compose page ─────────────── */

describe("drift 13: compose — loading state, page shape, controls, gold note, CTA", () => {
  const shell = stripComments(read(SHELL));

  it("the chrome copy is the prototype's, and clean under the copy rules", () => {
    expect(COMPOSE_UI_COPY.loadingTitle).toBe("Shaping your project…");
    expect(COMPOSE_UI_COPY.loadingBody).toBe(
      "Your words are becoming a company page. A few seconds."
    );
    expect(COMPOSE_UI_COPY.offerLabel).toBe("The Offer");
    expect(COMPOSE_UI_COPY.customersLabel).toBe("First Customers");
    expect(COMPOSE_UI_COPY.productLabel).toBe("Product v1");
    expect(COMPOSE_UI_COPY.whyLabel).toBe("Why am I building this?");
    expect(COMPOSE_UI_COPY.pitchLabel).toBe("The pitch");
    expect(COMPOSE_UI_COPY.goldNote).toBe(
      "This project is yours. You can change it any time, and you can hold up to five. Founders pivot. That's normal here."
    );
    expect(COMPOSE_UI_COPY.cta).toBe("See your first 3 tasks (out of 25) →");
    for (const copy of Object.values(COMPOSE_UI_COPY)) {
      expect(copy, copy).not.toContain("—");
      expect(copy.toLowerCase(), copy).not.toMatch(/\bfail(ed|ure)?\b/);
    }
  });

  it("the loading state is the pulsing logo tile, first compose only", () => {
    expect(shell).toMatch(/!composeView && pending &&/);
    expect(shell).toMatch(/animate-pulse[^>]*>\s*<Image src="\/path-logo\.svg"/);
    expect(shell).toContain("{COMPOSE_UI_COPY.loadingTitle}");
    expect(shell).toContain("{COMPOSE_UI_COPY.loadingBody}");
  });

  it("the composed project renders as a PAGE with per-section edit icons, not a bare form", () => {
    // 2026-07-30: the business name is an always-editable field styled as
    // the heading (placeholder for the null state), the pitch renders as
    // prose, and all FOUR cards render — The Offer / First Customers /
    // Product v1 / Why am I building this? (the latter two off the composed
    // row's quiz answers). The editable sections each carry their own edit
    // icon in the upper right.
    expect(shell).toContain('aria-label="Business name"');
    expect(shell).toMatch(/value=\{composeDraft\.name\}/);
    expect(shell).toContain('placeholder="Name your company"');
    expect(shell).toContain("{COMPOSE_UI_COPY.offerLabel}");
    expect(shell).toContain("{COMPOSE_UI_COPY.customersLabel}");
    expect(shell).toContain("{COMPOSE_UI_COPY.productLabel}");
    expect(shell).toContain("{COMPOSE_UI_COPY.whyLabel}");
    expect(shell).toContain("composeView.quizAnswers.what");
    expect(shell).toContain("composeView.quizAnswers.spark");
    // One icon per editable section, exactly one section editing at a time.
    expect(shell).toMatch(/sectionEditButton\("description", COMPOSE_UI_COPY\.pitchLabel\)/);
    expect(shell).toMatch(/sectionEditButton\("offer", COMPOSE_UI_COPY\.offerLabel\)/);
    expect(shell).toMatch(/sectionEditButton\("customers", COMPOSE_UI_COPY\.customersLabel\)/);
    expect(shell).toMatch(/setEditingSection\(\(s\) => \(s === section \? null : section\)\)/);
  });

  it("the bottom controls are retired (2026-07-30): no Edit This, no Start over, no regeneration", () => {
    expect(shell).not.toContain("Shape it again");
    expect(shell).not.toContain("regenerateProjectAction");
    expect(shell).not.toContain("Edit This");
    expect(shell).not.toContain("Start over");
  });

  it("the interstitial is gone: Shape my project composes directly; the no-view arm is recovery only", () => {
    expect(shell).not.toContain("Time to make it real");
    expect(shell).toMatch(/go\(stepNeighbour\("quiz", "next"\)\);\s*if \(!composeView && !isLocked\) buildProject\(\);/);
  });

  it("the gold founders-pivot note and the (out of 25) CTA render", () => {
    expect(shell).toContain("border-gold-leaf/30 bg-gold-leaf/10");
    expect(shell).toContain("{COMPOSE_UI_COPY.goldNote}");
    expect(shell).toContain("COMPOSE_UI_COPY.cta}");
  });
});

/* ─────────────── quiz (screen 7): placeholders + parent-assist banner ─────────────── */

describe("screen 7: suggestions stay placeholders; Trail gets the assist banner", () => {
  const shell = stripComments(read(SHELL));

  it("suggestions render as placeholder text, never as a pre-typed value", () => {
    expect(shell).toContain("placeholder={q.suggestion[band]}");
    expect(shell).toMatch(/value=\{answers\[q\.id\] \?\? ""\}/);
    expect(shell).not.toMatch(/value=\{[^}]*suggestion/);
  });

  it("the parent-assist line renders as the SELL-tinted banner", () => {
    expect(shell).toContain("border-phase-sell/25 bg-phase-sell/10");
    expect(shell).toMatch(/\{parentAssist\(confirmedSlug as GroupSlug, quizBandForGrade\(child\.grade\)\)\}/);
  });
});

/* ─────────────── drift 11: the reveal climb ─────────────── */

describe("drift 11 + E2: the reveal climb — seals, bullets, captions", () => {
  const shell = stripComments(read(SHELL));

  it("the narrative bullets are the prototype's, phase by phase", () => {
    expect(CLIMB_HEADING).toBe("Four months from now...");
    expect(CLIMB_BULLETS.map((b) => b.phase)).toEqual(["SELL", "BUILD", "VALIDATE"]);
    const sentences = CLIMB_BULLETS.map((b) => `${b.before}${b.phase}${b.after}`);
    expect(sentences).toEqual([
      "In SELL, you learned to confidently sell anything.",
      "In BUILD, you built a real product, put it in front of real people, and used feedback to make it better.",
      "Next, in VALIDATE, you'll learn how to prove what customers really want, a timeless, transferable lifelong skill.",
    ]);
  });

  it('the caption speaks the mandated idiom: "unit tasks complete"', () => {
    expect(CLIMB_CAPTION).toBe("57 of 125 unit tasks complete, every one verified");
    expect(CLIMB_CAPTION).toContain("unit tasks complete");
    expect(CLIMB_CAPTION.toLowerCase()).not.toContain("sealed");
  });

  it("bullets and caption ride emittedCopy, so the R63 sweep reaches them", () => {
    const model = revealModel({
      project: {
        name: "Test Co",
        description: "A test project.",
        offerSketch: "A thing.",
        firstCustomerHypothesis: null,
      },
      band: "b68",
      skin: "hq",
      group: "founders",
    });
    const copy = emittedCopy(model);
    expect(copy).toContain(CLIMB_CAPTION);
    expect(copy).toContain(CLIMB_HEADING);
    expect(copy).toContain("In SELL, you learned to confidently sell anything.");
  });

  it("complete phases carry the DS Seal; projected bars stay dashed", () => {
    // The Seal renders ONLY behind the complete guard, in the child's skin.
    expect(shell).toMatch(
      /phase\.state === "complete" && \(\s*<Seal phase=\{key\} skin=\{skin\}/
    );
    // Dashed finish is driven by the rules' dashed flag, not re-derived.
    expect(shell).toMatch(/phase\.dashed \? "border-dashed/);
    // Bars are phase-coloured through the DS colour helpers.
    expect(shell).toMatch(/backgroundColor: phaseColor\(key\)/);
    expect(shell).toMatch(/phaseColorAlpha\(key, 0\.07\)/);
  });

  it("the shell renders heading, bullets, and caption from the rules", () => {
    expect(shell).toContain("{CLIMB_HEADING}");
    expect(shell).toContain("{CLIMB_CAPTION}");
    expect(shell).toMatch(/CLIMB_BULLETS\.map/);
  });

  it("the application-register close strip survives, register seam intact", () => {
    expect(shell).toContain("APPLICATION_REGISTER_CLASSES");
    expect(shell).toContain("{model.cta}");
    // 2026-07-30: the parents line and download-card button are retired,
    // and the CTA advances straight to basics — never the dashboard.
    expect(shell).not.toContain("model.parentLine");
    expect(shell).toMatch(/onClick=\{\(\) => go\("basics"\)\}/);
  });
});

/* ─────────────── E5: the arrival ceremony (ready state only) ─────────────── */

describe("E5: the arrival acceptance-letter ceremony", () => {
  const flow = stripComments(read(ARRIVAL));

  it('"{name}, you\'re in." with a safe fallback, no dangling comma', () => {
    expect(arrivalCeremonyTitle("Maya")).toBe("Maya, you're in.");
    expect(arrivalCeremonyTitle("  Theo  ")).toBe("Theo, you're in.");
    expect(arrivalCeremonyTitle("")).toBe("You're in.");
    expect(arrivalCeremonyTitle("   ")).toBe("You're in.");
  });

  it("the ceremony copy exists in the rules, em-dash-free", () => {
    expect(ARRIVAL_SCREEN.ready.keysLabel).toBe("YOUR KEYS");
    // Not the prototype's "Login email": W16 bans sign-in language, and the
    // arrival copy sweep enforces it — the row states the fact only.
    expect(ARRIVAL_SCREEN.ready.emailRowLabel).toBe("Email");
    expect(ARRIVAL_SCREEN.ready.forwardingCardLabel).toBe("Mail forwarding");
    expect(ARRIVAL_SCREEN.ready.calendarNote).toBe(
      "Your $250 seat deposit stays fully refundable until September 30, 2026."
    );
    expect(ARRIVAL_SCREEN.ready.cta).toBe("Go to my new dashboard →");
    for (const copy of [
      ARRIVAL_SCREEN.ready.keysLabel,
      ARRIVAL_SCREEN.ready.emailRowLabel,
      ARRIVAL_SCREEN.ready.forwardingCardLabel,
      ARRIVAL_SCREEN.ready.calendarNote,
      ARRIVAL_SCREEN.ready.cta,
    ]) {
      expect(copy, copy).not.toContain("—");
    }
  });

  it("READY renders the ceremony: stamped tile, Georgia display, red CTA", () => {
    // The stamped logo tile on ink.
    expect(flow).toMatch(/rounded-\[18px\] bg-ink[^>]*>\s*<Image src="\/path-logo\.svg"/);
    // The display heading is Georgia (.display), through the rules title.
    expect(flow).toMatch(/className="display[^"]*"[^>]*>\s*\{arrivalCeremonyTitle\(firstName\)\}/);
    // The keys card, the forwarding card, the calendar note, the red CTA.
    expect(flow).toContain("{ARRIVAL_SCREEN.ready.keysLabel}");
    expect(flow).toContain("{ARRIVAL_SCREEN.ready.emailRowLabel}");
    expect(flow).toContain("{ARRIVAL_SCREEN.ready.forwardingCardLabel}");
    expect(flow).toContain("{ARRIVAL_SCREEN.ready.calendarNote}");
    expect(flow).toMatch(/bg-red[^"]*"\s*>\s*\{ARRIVAL_SCREEN\.ready\.cta\}/);
  });

  it("the ceremony applies to READY only — waiting/timeout states keep W16's honest copy", () => {
    // One ceremony heading, inside the ready branch.
    expect((flow.match(/arrivalCeremonyTitle\(/g) ?? []).length).toBe(1);
    // The poll driver and the non-terminal states are untouched.
    expect(flow).toContain("{ARRIVAL_SCREEN.timeout.title}");
    expect(flow).toContain("{ARRIVAL_SCREEN.timeout.retry}");
    expect(flow).toContain("{ARRIVAL_SCREEN.provisioning.title}");
    expect(flow).toContain("{ARRIVAL_SCREEN.settingUp.title}");
    expect(flow).toMatch(/pollStep\(\{/);
    expect(flow).toContain("ARRIVAL_POLL_INTERVAL_MS");
  });

  it("the address fact still renders, from the SAME payload — presentation only", () => {
    expect(flow).toContain('data-testid="student-email"');
    expect(flow).toContain("{view.email}");
    expect(flow).toContain("{ARRIVAL_SCREEN.ready.body}");
  });
});
