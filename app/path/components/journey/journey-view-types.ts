/**
 * Serializable view props shared by the Unit 14 journey surfaces (server pages
 * resolve these; client views render them). Plain data only — everything here
 * crosses the RSC boundary.
 */

import type { PhaseKey } from "@/app/path/content/types";
import type { CriterionStatus } from "@/app/path/lib/now-card-rules";
import type { TaskState } from "@/app/path/lib/transition-table";

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
