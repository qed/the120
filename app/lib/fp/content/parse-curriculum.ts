/**
 * Curriculum markdown → typed content package (T1 Unit 3).
 *
 * PLAIN MODULE. No `server-only`, no `"use server"`. The build script
 * (`scripts/build-path-content.ts`) runs this under `tsx`, where
 * `import "server-only"` throws — transitively, so a single guarded import
 * anywhere in this file's dependency graph breaks the build.
 *
 * The failure mode that matters here is a SILENT under-parse: a task quietly
 * missing, a variant quietly empty. Nothing at runtime would notice, and the
 * first symptom would be a child reading the wrong instruction. So every
 * structural expectation throws rather than skips, and the counts are asserted
 * against a manifest (see `manifest.ts`).
 */

import type {
  Band,
  Criterion,
  Phase,
  PhaseKey,
  ProgramContent,
  UnitTask,
} from "./types";

/* ── line shapes ───────────────────────────────────────────────────────────
 * Note the two different dashes: headers use an EM dash (—, U+2014) while band
 * ranges use an EN dash (–, U+2013). Mixing them up silently matches nothing.
 */

const PHASE_RE = /^# Phase (\d{2}) · ([A-Z]+) — \*(.+?)\*\s*$/;
const CRITERION_RE = /^## Criterion (\d+\.\d+) — (.+?)\s*$/;
const TASK_RE = /^\*\*(\d+\.\d+\.\d+) — (.+?)\*\*\s*(.*)$/;
const DONE_WHEN_RE = /^\*Done when:\*\s*(.+?)\s*$/;

/**
 * A band bullet. Captures the range label so combined forms survive:
 *   `- **3–5:** …`  `- **6–8/9–12:** …`  `- **3–5/6–8:** …`
 */
const BAND_RE = /^- \*\*([0-9–/]+):\*\*\s*(.+?)\s*$/;

/** `- All bands: …` — guidance for every band, kept as a note (see types.ts). */
const ALL_BANDS_RE = /^- All bands:\s*(.+?)\s*$/i;

/**
 * "As written." is a SENTINEL meaning "identical to the base text", not a
 * variant. 15 tasks carry it on the 6–8 line. Storing it verbatim would show a
 * Grade 7 child the words "As written." where their instruction belongs.
 */
const AS_WRITTEN_RE = /^as written\.?$/i;

/**
 * Structural marker on the Done-when line of a criterion's final task.
 *
 * Matches on the PREFIX, not an exact sentence. The source carries two
 * wordings: 24 read "**This completes the criterion.**" and the very last task
 * of the program (5.5.5) reads "**This completes the criterion — and The
 * Path.**". An exact-match regex flagged 24 of 25 and left raw markdown inside
 * the one Done-when line that closes the whole year — the single task where
 * `completesCriterion` matters most.
 */
const COMPLETES_RE = /\s*\*\*This completes the criterion\b[^*]*\*\*\s*$/;

const BAND_LABELS: Record<string, Band> = {
  "3–5": "g3_5",
  "6–8": "g6_8",
  "9–12": "g9_12",
};

const PHASE_KEYS: readonly PhaseKey[] = [
  "SELL",
  "BUILD",
  "VALIDATE",
  "GROW",
  "SCALE",
];

/** Maps a bullet's range label ("6–8/9–12") to the bands it applies to. */
function bandsForLabel(label: string, taskId: string): Band[] {
  const bands = label.split("/").map((part) => {
    const band = BAND_LABELS[part.trim()];
    if (!band) {
      throw new Error(
        `Task ${taskId}: unrecognised band label "${part}" in "${label}". ` +
          `Known labels: ${Object.keys(BAND_LABELS).join(", ")}.`
      );
    }
    return band;
  });
  return bands;
}

type TaskDraft = {
  id: string;
  title: string;
  bodyParts: string[];
  doneWhen?: string;
  bandVariants: Partial<Record<Band, string>>;
  allBandsNote?: string;
  completesCriterion: boolean;
};

function finishTask(draft: TaskDraft, seq: number): UnitTask {
  if (!draft.doneWhen) {
    throw new Error(
      `Task ${draft.id} has no "*Done when:*" line. Every task ends in a ` +
        `binary line a verifying adult answers yes or no to — a task without ` +
        `one cannot be verified and must not ship.`
    );
  }
  const body = draft.bodyParts.join(" ").replace(/\s+/g, " ").trim();
  if (!body) {
    throw new Error(`Task ${draft.id} has an empty body.`);
  }
  return {
    id: draft.id,
    seq,
    title: draft.title,
    body,
    doneWhen: draft.doneWhen,
    bandVariants: draft.bandVariants,
    ...(draft.allBandsNote ? { allBandsNote: draft.allBandsNote } : {}),
    completesCriterion: draft.completesCriterion,
  };
}

/**
 * Parse the home-study curriculum brief.
 *
 * @param source raw markdown (CRLF or LF — both are normalised)
 * @param versionId the ProgramVersion this content belongs to, e.g. "2026-27"
 */
export function parseCurriculum(
  source: string,
  versionId: string
): ProgramContent {
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  const phases: Phase[] = [];
  let phase: Phase | undefined;
  let criterion: Criterion | undefined;
  let draft: TaskDraft | undefined;

  const flushTask = () => {
    if (!draft || !criterion) return;
    criterion.tasks.push(finishTask(draft, criterion.tasks.length + 1));
    draft = undefined;
  };

  const flushCriterion = () => {
    flushTask();
    if (criterion && phase) {
      if (criterion.tasks.length === 0) {
        throw new Error(`Criterion ${criterion.id} parsed with zero tasks.`);
      }
      phase.criteria.push(criterion);
    }
    criterion = undefined;
  };

  const flushPhase = () => {
    flushCriterion();
    if (phase) phases.push(phase);
    phase = undefined;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    const phaseMatch = PHASE_RE.exec(line);
    if (phaseMatch) {
      flushPhase();
      const [, num, key, subtitle] = phaseMatch;
      const seq = phases.length + 1;
      const expectedKey = PHASE_KEYS[seq - 1];
      if (key !== expectedKey) {
        throw new Error(
          `Phase ${num}: expected key ${expectedKey} at position ${seq}, got ${key}.`
        );
      }
      // `key` is already narrowed to PhaseKey by the equality guard above — no
      // cast. If that guard is ever weakened, this line should stop compiling
      // rather than silently assert the type.
      phase = { num, key, subtitle: subtitle.trim(), seq, criteria: [] };
      continue;
    }

    // Symmetric with the criterion guard below: a malformed phase header would
    // otherwise fall through silently, its criteria would attach to the
    // previous phase, and the failure would surface much later as a confusing
    // "Criterion out of sequence: expected 1.6, got 2.1".
    if (line.startsWith("# Phase")) {
      throw new Error(
        `Malformed phase header: "${line}". Expected "# Phase 0N · KEY — *subtitle*" ` +
          `(em dash U+2014, middot separator).`
      );
    }

    const criterionMatch = CRITERION_RE.exec(line);
    if (criterionMatch) {
      if (!phase) {
        throw new Error(
          `Criterion ${criterionMatch[1]} appears before any phase header.`
        );
      }
      flushCriterion();
      const [, id, passCriterion] = criterionMatch;
      const expectedId = `${phase.seq}.${phase.criteria.length + 1}`;
      if (id !== expectedId) {
        throw new Error(
          `Criterion out of sequence: expected ${expectedId}, got ${id}. ` +
            `Criteria are numbered in the order the published pass criteria appear.`
        );
      }
      criterion = { id, seq: phase.criteria.length + 1, passCriterion, tasks: [] };
      continue;
    }

    // A malformed criterion header still has to be caught — otherwise its
    // tasks silently attach to the previous criterion and the totals still add
    // up to 125.
    if (line.startsWith("## Criterion")) {
      throw new Error(
        `Malformed criterion header: "${line}". Expected "## Criterion N.N — <pass criterion>".`
      );
    }

    const taskMatch = TASK_RE.exec(line);
    if (taskMatch) {
      if (!criterion) {
        throw new Error(
          `Task ${taskMatch[1]} appears outside any criterion.`
        );
      }
      flushTask();
      const [, id, title, rest] = taskMatch;
      const expectedId = `${criterion.id}.${criterion.tasks.length + 1}`;
      if (id !== expectedId) {
        throw new Error(
          `Task out of sequence: expected ${expectedId}, got ${id}.`
        );
      }
      draft = {
        id,
        title: title.trim(),
        bodyParts: rest ? [rest.trim()] : [],
        bandVariants: {},
        completesCriterion: false,
      };
      continue;
    }

    if (!draft) continue;

    const doneMatch = DONE_WHEN_RE.exec(line);
    if (doneMatch) {
      const text = doneMatch[1];
      draft.completesCriterion = COMPLETES_RE.test(text);
      draft.doneWhen = text.replace(COMPLETES_RE, "").trim();
      continue;
    }

    const allBandsMatch = ALL_BANDS_RE.exec(line);
    if (allBandsMatch) {
      draft.allBandsNote = allBandsMatch[1].trim();
      continue;
    }

    const bandMatch = BAND_RE.exec(line);
    if (bandMatch) {
      const [, label, text] = bandMatch;
      const value = text.trim();
      // The sentinel means inheritance; an empty bullet is a source typo.
      // Either way, leaving the band absent is what makes resolveVariant()
      // fall through to the base text — storing "" would look like a variant
      // to every downstream `Object.keys(bandVariants).length` check.
      if (!value || AS_WRITTEN_RE.test(value)) continue;
      for (const band of bandsForLabel(label, draft.id)) {
        draft.bandVariants[band] = value;
      }
      continue;
    }

    // Continuation prose for the current task, before its Done-when line.
    if (line && !line.startsWith("-") && !draft.doneWhen) {
      draft.bodyParts.push(line.trim());
    }
  }

  flushPhase();

  if (phases.length === 0) {
    throw new Error(
      "No phases parsed. Check the source is the curriculum brief and that " +
        "phase headers read '# Phase 0N · KEY — *subtitle*' with an em dash."
    );
  }

  return { versionId, phases };
}

/**
 * The band-specific line for a task, or undefined when the task is identical
 * across bands (the common case — variants exist on roughly half of them).
 *
 * Callers render the base text when this returns undefined, and should surface
 * `task.allBandsNote` separately when present.
 */
export function resolveVariant(task: UnitTask, band: Band): string | undefined {
  return task.bandVariants[band];
}
