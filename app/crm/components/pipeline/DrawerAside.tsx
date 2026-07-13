"use client";

/**
 * Drawer aside, 360px (brief §7, P1 scope): About (identity from the parents
 * row when linked — display-only + LINKED ACCOUNT badge; editable form for
 * leads via `updateContact`, Decision 4 authority rule), private notes
 * (Georgia italic), and the CASL consent block. Signals/concerns/heat
 * editing arrive in Unit 8.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilyDetail } from "@/app/crm/lib/queries";
import { addNote, updateContact } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import { fmtDay } from "@/app/crm/lib/dates";
import {
  SOURCES,
  SOURCE_LABELS,
  type Source,
} from "@/app/crm/lib/constants";
import { BTN_PRIMARY, BTN_SECONDARY } from "./atoms";

const KICKER =
  "font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted";

const INPUT =
  "w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13px] text-crm-ink focus:border-crm-blue focus:outline-none disabled:opacity-50";

const FIELD_LABEL =
  "mb-0.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-crm-faint";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className={FIELD_LABEL}>{label}</span>
      <span className="block break-words text-[13px] text-crm-ink">
        {value || <span className="text-crm-faint">—</span>}
      </span>
    </div>
  );
}

function AboutCard({ detail }: { detail: FamilyDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(detail.name);
  const [email, setEmail] = useState(detail.email ?? "");
  const [phone, setPhone] = useState(detail.phone);
  const [spouse, setSpouse] = useState(detail.spouseName);
  const [area, setArea] = useState(detail.area ?? "");
  const [source, setSource] = useState(detail.source);
  const [referral, setReferral] = useState(detail.referralCode);

  const cancel = () => {
    setName(detail.name);
    setEmail(detail.email ?? "");
    setPhone(detail.phone);
    setSpouse(detail.spouseName);
    setArea(detail.area ?? "");
    setSource(detail.source);
    setReferral(detail.referralCode);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updateContact({
      familyId: detail.id,
      fields: {
        parentName: name,
        email,
        phone,
        spouseName: spouse,
        area,
        ...(SOURCES.includes(source as Source)
          ? { source: source as Source }
          : {}),
        referralCode: referral,
      },
    });
    setSaving(false);
    if (result.success) {
      toast("success", "Contact updated");
      setEditing(false);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to update.");
    }
  };

  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className={KICKER}>About</h3>
        {detail.parentLinked ? (
          <span
            title="Identity comes from the live parent account — edits happen there."
            className="rounded-full bg-crm-blush px-2 py-[3px] font-mono text-[9px] tracking-[0.08em] text-crm-ink"
          >
            LINKED ACCOUNT
          </span>
        ) : editing ? null : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-blue hover:underline"
          >
            Edit
          </button>
        )}
      </div>

      {editing && !detail.parentLinked ? (
        <div className="mt-3 space-y-2.5">
          {error && (
            <p className="text-[11.5px] leading-snug text-crm-red">{error}</p>
          )}
          <div>
            <label className={FIELD_LABEL}>Name</label>
            <input
              className={INPUT}
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Email</label>
            <input
              className={INPUT}
              type="email"
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Phone</label>
            <input
              className={INPUT}
              type="tel"
              value={phone}
              maxLength={30}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Spouse</label>
            <input
              className={INPUT}
              value={spouse}
              maxLength={200}
              onChange={(e) => setSpouse(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Area</label>
            <input
              className={INPUT}
              value={area}
              maxLength={100}
              onChange={(e) => setArea(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Source</label>
            <select
              className={INPUT}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={saving}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Referral code</label>
            <input
              className={INPUT}
              value={referral}
              maxLength={40}
              onChange={(e) => setReferral(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              className={BTN_PRIMARY}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancel}
              className={BTN_SECONDARY}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <Row label="Email" value={detail.email} />
          <Row label="Phone" value={detail.phone} />
          <Row label="Spouse" value={detail.spouseName} />
          <Row label="Area" value={detail.area} />
          <Row
            label="Source"
            value={SOURCE_LABELS[detail.source as Source] ?? detail.source}
          />
          <Row label="Referral" value={detail.referralCode} />
        </div>
      )}
    </section>
  );
}

function NotesCard({ detail }: { detail: FamilyDetail }) {
  const router = useRouter();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    const result = await addNote({ familyId: detail.id, body });
    setSaving(false);
    if (result.success) {
      toast("success", "Note added");
      setBody("");
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to add the note.");
    }
  };

  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <h3 className={KICKER}>Private notes</h3>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        placeholder="A quiet note for the two of you…"
        aria-label="New private note"
        className="mt-2.5 min-h-[88px] w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 font-serif text-[14px] italic leading-relaxed text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none"
        disabled={saving}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
          Notes land in the timeline
        </span>
        <button
          type="button"
          onClick={submit}
          className={BTN_PRIMARY}
          disabled={saving || !body.trim()}
        >
          {saving ? "Adding…" : "Add note"}
        </button>
      </div>
    </section>
  );
}

function ConsentCard({ detail }: { detail: FamilyDetail }) {
  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <h3 className={KICKER}>CASL consent</h3>
      <div className="mt-2.5 space-y-1 text-[12.5px] leading-relaxed">
        {detail.consentRevokedAt ? (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-red">
              Revoked {fmtDay(detail.consentRevokedAt)}
            </p>
            {detail.consentAt && (
              <p className="text-crm-muted">
                Was given {fmtDay(detail.consentAt)}
                {detail.consentSource ? ` · ${detail.consentSource}` : ""}
              </p>
            )}
            <p className="text-crm-muted">Do not email this family.</p>
          </>
        ) : detail.consentGiven ? (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-green">
              ✓ Given{detail.consentAt ? ` ${fmtDay(detail.consentAt)}` : ""}
            </p>
            {detail.consentSource && (
              <p className="text-crm-muted">Source · {detail.consentSource}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-amber">
              No CASL
            </p>
            <p className="text-crm-muted">
              Private notes only — never emailed until consent is recorded.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export default function DrawerAside({ detail }: { detail: FamilyDetail }) {
  return (
    <div className="space-y-4 p-5">
      <AboutCard key={`about-${detail.id}-${detail.parentLinked}`} detail={detail} />
      <NotesCard detail={detail} />
      <ConsentCard detail={detail} />
    </div>
  );
}
