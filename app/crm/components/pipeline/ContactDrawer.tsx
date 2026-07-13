"use client";

/**
 * Contact drawer (brief §7, alphahub's crown jewel restyled): 920px
 * slide-over, URL-driven via `?family={id}`, back/Escape closes, full-screen
 * sheet below 768px. Body renders the co-pilot card first (Unit 8, per §7),
 * then the activity timeline; the aside carries signals/concerns/heat.
 */

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FamilyDetail } from "@/app/crm/lib/queries";
import { useFocusTrap } from "@/app/crm/components/useFocusTrap";
import DrawerHeader from "./DrawerHeader";
import DrawerAside from "./DrawerAside";
import ActivityTimeline from "./ActivityTimeline";
import CopilotCard from "./CopilotCard";

export default function ContactDrawer({ detail }: { detail: FamilyDetail }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("family");
    const qs = params.toString();
    router.push(`/crm/pipeline${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  useFocusTrap(panelRef, true, close);

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-crm-ink/25"
        onClick={close}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.name || "Family"} — family record`}
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-crm-line bg-white shadow-[0_4px_18px_rgba(19,20,22,0.14)] md:w-[920px]"
      >
        <DrawerHeader detail={detail} onClose={close} />

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col md:flex-row">
            <div className="min-w-0 flex-1 space-y-6 p-6">
              <CopilotCard copilot={detail.copilot} familyId={detail.id} />
              <ActivityTimeline entries={detail.timeline} />
            </div>
            <div className="border-t border-crm-line bg-crm-card md:w-[360px] md:flex-none md:border-l md:border-t-0">
              <DrawerAside detail={detail} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
