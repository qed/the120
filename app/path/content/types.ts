/**
 * Content package types (T1 Unit 3).
 *
 * Plain module — no `server-only`, no `"use server"`. The parser these types
 * describe must be reusable by a `tsx` build script, and `import "server-only"`
 * throws under tsx (transitively). Retrofitting that later means touching every
 * importer, so it is decided here.
 */

export type PhaseKey = "SELL" | "BUILD" | "VALIDATE" | "GROW" | "SCALE";

/** Grade bands, matching the program's book tracks. */
export type Band = "g3_5" | "g6_8" | "g9_12";

export const BANDS: readonly Band[] = ["g3_5", "g6_8", "g9_12"] as const;

/**
 * How a band variant reads in the source markdown, and what it means.
 *
 * The curriculum uses five shapes, not the three a naive parser expects:
 *   `- **3–5:** …`         a single band
 *   `- **6–8/9–12:** …`    one line covering two bands
 *   `- **6–8:** As written.` a SENTINEL meaning "identical to the base text",
 *                            not a variant — 15 of these exist, and storing the
 *                            literal string would show a Grade 7 child the words
 *                            "As written." where their instruction belongs
 *   `- All bands: …`       guidance for every band, sometimes carrying an inline
 *                          addendum ("as written; **9–12** adds …")
 *   (line absent)          identical across bands, per the curriculum's own rule
 */
export type UnitTask = {
  /** `phase.criterion.task`, e.g. "1.2.4". Stable across program versions. */
  id: string;
  /** Sequence within the criterion, 1-based. */
  seq: number;
  title: string;
  body: string;
  /** The binary line a verifying adult answers yes or no to. */
  doneWhen: string;
  /**
   * Per-band overrides. Absent means "identical across bands" — which is the
   * common case: variants exist on roughly half the tasks.
   */
  bandVariants: Partial<Record<Band, string>>;
  /**
   * An `All bands:` note. Kept separate rather than copied into all three
   * variants, because these frequently contain an inline band addendum
   * ("as written; **9–12** adds …"). Splitting that into per-band text would
   * fabricate wording the curriculum never wrote; showing the note as a note
   * is faithful.
   */
  allBandsNote?: string;
  /** True when this task's Done-when line closes its criterion. */
  completesCriterion: boolean;
};

export type Criterion = {
  /** `phase.criterion`, e.g. "1.2". */
  id: string;
  seq: number;
  /** The published pass criterion, as the curriculum states it. */
  passCriterion: string;
  tasks: UnitTask[];
};

export type Phase = {
  /** "01".."05", zero-padded as the curriculum and program page render it. */
  num: string;
  key: PhaseKey;
  /** The phase's one-verb promise, e.g. "Learn to confidently sell anything." */
  subtitle: string;
  seq: number;
  criteria: Criterion[];
};

/**
 * Declared totals for a program version. Ingestion asserts the parse against
 * these; a mismatch fails loudly rather than shipping a silently short package.
 *
 * Totals live here, per version, rather than as constants in code — so a
 * curriculum revision ships a new manifest and a new generated module, not a
 * validator edit.
 */
export type ProgramManifest = {
  versionId: string;
  label: string;
  phases: number;
  criteria: number;
  tasks: number;
  /** Per-phase task counts, in phase order. 2026-27 is 25/26/24/25/25. */
  tasksPerPhase: number[];
};

export type ProgramContent = {
  versionId: string;
  phases: Phase[];
};

/** Everything a task view needs for one band, already resolved. */
export type ResolvedTask = UnitTask & {
  band: Band;
  /** The band-specific line, if this task has one. */
  variant?: string;
};
