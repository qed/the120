"use client";

import { childName, statusMeta, workshopById, type Child } from "./data";

export default function DossierPreview({
  child,
  onBack,
}: {
  child: Child;
  onBack: () => void;
}) {
  const grade = child.grade === "" ? "—" : `Grade ${child.grade}`;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      {/* controls — hidden when printing */}
      <div className="no-print mb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="font-mono text-xs uppercase tracking-[0.12em] text-muted hover:text-ink"
        >
          ← Back to editor
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex h-11 items-center justify-center rounded-full bg-blue px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-blue-dark"
        >
          Print / Save as PDF
        </button>
      </div>

      {/* printable profile */}
      <article className="overflow-hidden rounded-3xl border border-line bg-white print:rounded-none print:border-0">
        <header className="flex items-center gap-5 border-b border-line bg-paper-2 p-8 print:bg-white">
          <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-full border border-line-strong bg-white text-2xl text-muted">
            {child.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={child.photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-display">{(child.firstName[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-red">
              A candidate for the 120
            </p>
            <h2 className="mt-1 truncate font-display text-3xl font-bold tracking-tight text-ink">
              {childName(child)}
            </h2>
            <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-muted">
              {grade}
              {child.birthYear ? ` · b. ${child.birthYear}` : ""}
              {child.currentSchool ? ` · ${child.currentSchool}` : ""}
            </p>
          </div>
        </header>

        <div className="grid gap-8 p-8 sm:grid-cols-2">
          <Block title="Subjects to accelerate">
            {child.subjects.length ? (
              <div className="flex flex-wrap gap-2">
                {child.subjects.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-blue px-3 py-1 font-mono text-xs uppercase tracking-[0.08em] text-white"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <Empty />
            )}
          </Block>

          <Block title="Workshop interests">
            {child.workshopIds.length ? (
              <ul className="space-y-1 text-sm text-ink-soft">
                {child.workshopIds.map((id) => (
                  <li key={id}>{workshopById(id)?.title ?? id}</li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Block>

          <Block title="Interests" full>
            {child.interests ? <p className="text-sm leading-6 text-ink-soft">{child.interests}</p> : <Empty />}
          </Block>

          <Block title="Year-long project idea" full>
            {child.projectPitch ? (
              <p className="text-sm leading-6 text-ink-soft">{child.projectPitch}</p>
            ) : (
              <Empty />
            )}
          </Block>

          {child.testScores && (
            <Block title="Scores & assessments" full>
              <p className="whitespace-pre-line text-sm leading-6 text-ink-soft">{child.testScores}</p>
            </Block>
          )}

          {child.portfolioLinks && (
            <Block title="Portfolio" full>
              <p className="break-words text-sm leading-6 text-ink-soft">{child.portfolioLinks}</p>
            </Block>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-8 py-5 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
          <span>The 120 · GT Toronto — dossier</span>
          <span className="text-red">{statusMeta(child.status).label}</span>
        </footer>
      </article>
    </div>
  );
}

function Block({
  title,
  full,
  children,
}: {
  title: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm italic text-muted">Not yet added</p>;
}
