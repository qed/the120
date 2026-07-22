/**
 * Serializable view props shared by the Unit 14 journey surfaces (server pages
 * resolve these; client views render them). Plain data only — everything here
 * crosses the RSC boundary.
 *
 * Lives in lib/ — the components import their view-model types FROM the data
 * layer, never the reverse (the Unit 14 review caught journey-loader importing
 * types from components/, inverting the dependency direction).
 */

import type { PhaseKey } from "@/app/path/content/types";
import type { CriterionStatus } from "@/app/path/lib/now-card-rules";
import type { EvidenceKind } from "@/app/path/lib/evidence-rules";
import type { TaskState } from "@/app/path/lib/transition-table";

/** One evidence item as the task surface renders it. The loader maps
 *  evidence-loader's EvidenceReadRow into this shape; EvidenceList renders it. */
export type EvidenceItemView = {
  id: string;
  kind: EvidenceKind;
  /** Signed-download URL for the main object (from the stored row). Null for
   *  log/link/redacted. */
  url: string | null;
  /** Signed-download URL for a video's poster frame. */
  posterUrl: string | null;
  contentType: string | null;
  caption: string | null;
  linkUrl: string | null;
  /** kind='log' rows, for the read-only render. */
  logRows: Record<string, unknown>[];
  redactedAt: string | null;
  addedAfterVerification: boolean;
};

export type JourneyCriterionCard = {
  id: string;
  /** 1-based order within the phase. */
  seq: number;
  /** Short display title (the pass criterion's lead clause). */
  title: string;
  detail: string | null;
  status: CriterionStatus;
  verifiedCount: number;
  taskTotal: number;
};

export type JourneyPhaseCard = {
  num: string;
  key: PhaseKey;
  status: "locked" | "active" | "complete";
  tasksVerified: number;
  tasksTotal: number;
  criteriaComplete: number;
  criteria: JourneyCriterionCard[];
};

export type NowCardData = {
  taskId: string;
  criterionId: string;
  criterionTitle: string;
  title: string;
  body: string;
  doneWhen: string;
  variant: string | null;
  state: TaskState;
  phaseKey: PhaseKey;
  liveMoment: boolean;
  pinned: boolean;
  /** Task order within its criterion, for "step N of M". */
  seq: number;
  taskTotal: number;
};
