"use client";

/**
 * Dossier detail — right pane (plan Unit 5; brief §6 / Admin.dc.html):
 * red mono CANDIDATE DOSSIER kicker, Georgia name, meta + completeness %,
 * payment strip, two bone info cards (ACADEMICS / PARENT), the blue PROJECT
 * PITCH card (Georgia italic on #F7F6F3), INTERESTS & EVIDENCE, GROUP
 * ASSIGNMENT chips, MOVE CANDIDATE stage chips, TEAM NOTES textarea.
 *
 * Print (documented v1): the parent dashboard's printable dossier is
 * parent-authed, so the PRINT button simply `window.print()`s this pane —
 * the CRM chrome and queue pane carry `print:hidden`/`no-print`, and every
 * interactive section here is `no-print`, so what prints is the dossier
 * content itself (globals.css `@media print` conventions).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  GROUP_LABELS,
  GROUPS,
  REVIEW_STATUS_LABELS,
  type Group,
  type ReviewStatus,
} from "@/app/crm/lib/constants";
import { academicComplete, planLabel } from "@/app/dashboard/data";
import type { DossierItem } from "@/app/crm/lib/queries";
import { moveCandidate, saveReviewNotes } from "@/app/crm/lib/actions/reviews";
import { fmtDay } from "@/app/crm/lib/dates";
import { useToast } from "@/app/crm/components/Toast";
import { BTN_PRIMARY, BTN_SECONDARY, Chip } from "@/app/crm/components/pipeline/atoms";
import { ReviewPill } from "./QueueList";
import PaymentStrip from "./PaymentStrip";
import GroupChips from "./GroupChips";

/** The five chips staff can move a candidate to (drafts never show here). */
const MOVE_STAGES: ReviewStatus[] = [
  "submitted",
  "in_review",
  "invited",
  "offered",
  "member",
];

const KICKER_RED =
  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-red";
const KICKER_FAINT =
  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-faint";

/** "The Makers" for a valid parent pick; "" for unset/garbage slugs. */
const parentPickLabel = (slug: string) =>
  (GROUPS as readonly string[]).includes(slug)
    ? `The ${GROUP_LABELS[slug as Group]}`
    : "";

function InfoCard({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-crm-line bg-crm-card px-[18px] py-3.5">
      <span className={KICKER_RED}>{kicker}</span>
      <span className="text-[14px] leading-relaxed text-crm-ink">{children}</span>
    </div>
  );
}

export default function DossierDetail({ item }: { item: DossierItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const [moving, setMoving] = useState(false);
  const [notes, setNotes] = useState(item.reviewNotes);
  const [savingNotes, setSavingNotes] = useState(false);

  const move = async (stage: ReviewStatus) => {
    if (stage === item.reviewStatus) return;
    // Light confirm on MEMBER — it flips the family's pipeline stage.
    if (
      stage === "member" &&
      !window.confirm(
        `Make ${item.name} a Member of the 120? This flips the family's pipeline stage to MEMBER.`
      )
    ) {
      return;
    }

    setMoving(true);
    const result = await moveCandidate({
      childId: item.childId,
      reviewStatus: stage,
    });
    setMoving(false);
    if (result.success) {
      toast("success", `Moved to ${REVIEW_STATUS_LABELS[stage]}`);
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to move the candidate.");
    }
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    const result = await saveReviewNotes({ childId: item.childId, notes });
    setSavingNotes(false);
    if (result.success) {
      toast("success", "Notes saved");
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to save the notes.");
    }
  };

  // Same predicate as the parent DossierPreview: entries with any subject
  // content render; a stray blank entry never renders as a bare "—" line.
  const academics = item.academics.filter(
    (a) => academicComplete(a) || a.subject.trim() !== ""
  );

  const meta = [
    item.grade != null ? `Grade ${item.grade}` : null,
    item.school || null,
    item.submittedAt ? `submitted ${fmtDay(item.submittedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-[18px]">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
            Candidate dossier
          </span>
          <span className="font-serif text-[28px] leading-tight tracking-[-0.01em] text-crm-ink">
            {item.name}
          </span>
          <span className="text-[13.5px] text-crm-muted">{meta}</span>
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-crm-faint">
            Dossier {item.completeness}% complete
            {item.birthYear ? ` · born ${item.birthYear}` : ""}
          </span>
        </div>
        <div className="flex flex-none flex-col items-end gap-2.5">
          <ReviewPill status={item.reviewStatus} />
          <button
            type="button"
            onClick={() => window.print()}
            className={`${BTN_SECONDARY} no-print`}
            title="Print this dossier (the queue and chrome stay off the page)"
          >
            Print
          </button>
        </div>
      </div>

      {/* payment strip (brief §6 addition) */}
      <PaymentStrip deposits={item.deposits} reviewStatus={item.reviewStatus} />

      {/* info cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InfoCard kicker="Academics">
          {academics.length > 0 ? (
            academics.map((a, i) => (
              <span key={i} className="block">
                {a.subject || "—"}
                {planLabel(a.plan) ? ` — ${planLabel(a.plan)}` : ""}
                {a.goal ? (
                  <span className="block text-[12.5px] text-crm-muted">
                    {a.goal}
                  </span>
                ) : null}
              </span>
            ))
          ) : item.subjects.length > 0 ? (
            // Legacy pre-cutover rows: the old joined subjects list.
            item.subjects.join(", ")
          ) : (
            "—"
          )}
        </InfoCard>
        <InfoCard kicker="Parent">
          {item.parentName}
          {item.parentEmail ? ` · ${item.parentEmail}` : ""}
          {item.parentPhone ? (
            <span className="block text-[12.5px] text-crm-muted">
              {item.parentPhone}
            </span>
          ) : null}
        </InfoCard>
      </div>

      {/* project pitch — the one loud element on this screen */}
      <div className="flex flex-col gap-2 rounded-[12px] bg-crm-blue px-[22px] py-[18px]">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-blush">
          Project pitch
        </span>
        <p className="font-serif text-[16px] italic leading-normal text-crm-card">
          {item.projectPitch ? `“${item.projectPitch}”` : "—"}
        </p>
      </div>

      {/* interests & evidence */}
      <div className="flex flex-col gap-1.5">
        <span className={KICKER_FAINT}>Interests &amp; evidence</span>
        <p className="text-[13.5px] leading-relaxed text-crm-muted">
          {item.interests || "—"}
        </p>
        {item.testScores && (
          <p className="text-[13.5px] leading-relaxed text-crm-muted">
            {item.testScores}
          </p>
        )}
        {item.workshops.length > 0 && (
          <p className="text-[13.5px] leading-relaxed text-crm-muted">
            Workshops: {item.workshops.join(" · ")}
          </p>
        )}
        {item.portfolioLinks && (
          <p className="break-words text-[13.5px] leading-relaxed text-crm-muted">
            Portfolio: {item.portfolioLinks}
          </p>
        )}
      </div>

      {/* group assignment (brief §6 addition) */}
      <div className="no-print flex flex-col gap-2.5 rounded-[12px] border border-crm-line bg-crm-card px-[18px] py-4">
        <span className={KICKER_RED}>Group assignment</span>
        {parentPickLabel(item.parentGroupSlug) && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted">
            Parent picked: {parentPickLabel(item.parentGroupSlug)}
          </span>
        )}
        <GroupChips childId={item.childId} group={item.group} />
      </div>

      {/* move candidate */}
      <div className="no-print flex flex-col gap-2.5 rounded-[12px] border border-crm-line bg-crm-card px-[18px] py-4">
        <span className={KICKER_RED}>Move candidate</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Move candidate">
          {MOVE_STAGES.map((stage) => (
            <Chip
              key={stage}
              active={item.reviewStatus === stage}
              disabled={moving}
              onClick={() => move(stage)}
            >
              {REVIEW_STATUS_LABELS[stage]}
            </Chip>
          ))}
        </div>
      </div>

      {/* team notes */}
      <div className="no-print flex flex-col gap-1.5">
        <label htmlFor="dossier-team-notes" className={KICKER_FAINT}>
          Team notes
        </label>
        <textarea
          id="dossier-team-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={8000}
          disabled={savingNotes}
          placeholder="Assessment scheduling, call outcomes, flags…"
          className="w-full resize-y rounded-[10px] border border-crm-line2 bg-white px-3.5 py-3 text-[14px] leading-relaxed text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={saveNotes}
            disabled={savingNotes || notes === item.reviewNotes}
            className={BTN_PRIMARY}
          >
            {savingNotes ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>
    </div>
  );
}
