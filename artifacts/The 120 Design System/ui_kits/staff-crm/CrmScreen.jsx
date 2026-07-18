// The 120 staff CRM — recreation. Chrome + tabs; Dossier queue (two-pane) and Pipeline (table).
const { StatusPill, HeatPips, FilterChip, PitchCard, Button, Kicker, DisplayHeading } = window.The120DesignSystem_cdb8b7;

const DOSSIERS = [
  { name: "Maya Okafor", meta: "Grade 5 · Cottingham Jr PS", date: "JUL 14", status: "SUBMITTED", tone: "blue",
    subjects: "Math, Writing, Science", parent: "Ada Okafor · Leaside",
    pitch: "A city-wide chess ladder for kids who can't afford coaching — run out of three libraries by spring.",
    interests: "Provincial chess (U12, 3rd). Codes small game bots. Reads two grades up.", scores: "MAP Math 99th · Reading 96th." },
  { name: "Sofia Marchetti", meta: "Grade 4 · Rosedale JPS", date: "JUL 13", status: "IN REVIEW", tone: "blue",
    subjects: "Math, Reading", parent: "Elena Marchetti · Rosedale",
    pitch: "A short documentary about the ravine behind our school and the people who clean it.",
    interests: "Films on an old iPhone; edits herself. Junior rowing.", scores: "MAP Math 94th · Reading 98th." },
  { name: "Dev Patel", meta: "Grade 6 · North York", date: "JUL 12", status: "OFFERED", tone: "red",
    subjects: "Math, Science, History", parent: "Rohan Patel · North York",
    pitch: "A solar phone charger kids can build for $8, with a printed guide for a classroom set.",
    interests: "Robotics club captain. Sells 3D prints at markets.", scores: "MAP Math 99th · Science 97th." },
];

const QUEUE_FILTERS = ["ALL", "SUBMITTED", "IN REVIEW", "INVITED", "OFFERED", "MEMBER"];
const STAGE_BTNS = ["SUBMITTED", "IN REVIEW", "INVITED TO ASSESSMENT", "OFFERED A SEAT", "MEMBER OF THE 120"];

const PIPELINE_ROWS = [
  { fam: "Okafor", kids: "2 kids · Leaside", stage: "DOSSIER SUBMITTED", tone: "blue", heat: 4, source: "AMB-RANA", concerns: ["time-commitment"], consent: true, touch: "2d", touchTone: "var(--green)", next: "Call them — submitted, no call yet." },
  { fam: "Marchetti", kids: "1 kid · Rosedale", stage: "CALL HELD", tone: "blue", heat: 4, source: "info-session", concerns: ["price-value"], consent: true, touch: "5d", touchTone: "var(--green)", next: "Send T+1 recap + deposit link." },
  { fam: "Patel", kids: "1 kid · North York", stage: "DEPOSIT PAID", tone: "red", heat: 5, source: "math-contest", concerns: [], consent: true, touch: "1d", touchTone: "var(--green)", next: "Founding welcome — ask for one intro." },
  { fam: "Nguyen", kids: "2 kids · Beaches", stage: "ACCOUNT CREATED", tone: "neutral", heat: 3, source: "facebook-group", concerns: ["screen-time", "socialization"], consent: true, touch: "9d", touchTone: "var(--amber)", next: "Dossier nudge — the dossier is the application." },
  { fam: "Awad", kids: "1 kid · Midtown", stage: "INTERESTED", tone: "neutral", heat: 2, source: "coffee-intro", concerns: ["selectivity-anxiety"], consent: false, touch: "16d", touchTone: "var(--red)", next: "Cold — one last info-session invite." },
];

function Chrome({ tab, setTab }) {
  return (
    <header>
      <div style={{ background: "var(--crm-blue)", padding: "14px 28px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "var(--red)", color: "#fff", fontWeight: 700, fontSize: 15, letterSpacing: "-0.04em", padding: "5px 8px", lineHeight: 1 }}>120</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", color: "var(--paper)" }}>The 120</span>
        </span>
        <span style={{ width: 1, height: 20, background: "rgba(255,255,255,0.24)" }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "rgba(255,255,255,0.75)" }}>ADMISSIONS · CRM</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", color: "var(--ink)", background: "var(--blush)", padding: "4px 10px", borderRadius: 100 }}>STAFF ONLY</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.06em", color: "rgba(255,255,255,0.75)" }}>7 SEATS FILLED · 113 REMAIN</span>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "10px 28px", background: "var(--white)", borderBottom: "1px solid var(--crm-line)" }}>
        {["Dashboard", "Pipeline", "Dossiers", "Library"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
            padding: "7px 14px", borderRadius: 100, cursor: "pointer", border: "none",
            background: tab === t ? "var(--crm-blue)" : "transparent", color: tab === t ? "#fff" : "var(--ink-soft)",
          }}>{t}</button>
        ))}
      </div>
    </header>
  );
}

function DossierQueue() {
  const [sel, setSel] = React.useState(0);
  const [filter, setFilter] = React.useState("ALL");
  const d = DOSSIERS[sel];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", minHeight: "calc(100vh - 108px)" }}>
      {/* queue */}
      <div style={{ padding: "26px 28px", display: "flex", flexDirection: "column", gap: 16, borderRight: "1px solid var(--crm-line)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <DisplayHeading as="h1" size={28}>Dossier queue</DisplayHeading>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" }}>3 OF 3 DOSSIERS</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {QUEUE_FILTERS.map((f) => <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</FilterChip>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DOSSIERS.map((row, i) => (
            <button key={row.name} onClick={() => setSel(i)} style={{
              display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
              padding: "14px 16px", borderRadius: "var(--radius-card-crm)", boxSizing: "border-box",
              background: i === sel ? "var(--white)" : "transparent",
              border: i === sel ? "1px solid var(--crm-blue)" : "1px solid var(--crm-line)",
              boxShadow: i === sel ? "var(--shadow-selected)" : "none", fontFamily: "var(--font-sans)",
            }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 15.5 }}>{row.name}</span>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{row.meta}</span>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>{row.date}</span>
                <StatusPill tone={row.tone}>{row.status}</StatusPill>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div style={{ padding: "26px 28px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Kicker size={10}>CANDIDATE DOSSIER</Kicker>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: "-0.01em" }}>{d.name}</span>
            <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{d.meta}</span>
          </div>
          <StatusPill tone={d.tone}>{d.status}</StatusPill>
        </div>
        {/* payment + group strip */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "#fff", background: "var(--green)", padding: "5px 11px", borderRadius: 100 }}>$250 PAID · JUL 20</span>
          <a href="#" style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "var(--ink-soft)" }}>OPEN IN STRIPE →</a>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--muted)" }}>GROUP</span>
          <StatusPill tone="neutral">SCHOLARS</StatusPill>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[["SUBJECTS", d.subjects], ["PARENT", d.parent]].map(([k, v]) => (
            <div key={k} style={{ background: "var(--crm-card)", border: "1px solid var(--crm-line)", borderRadius: "var(--radius-card-crm)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
              <Kicker size={9.5}>{k}</Kicker>
              <span style={{ fontSize: 14 }}>{v}</span>
            </div>
          ))}
        </div>
        <PitchCard kicker="PROJECT PITCH">{d.pitch}</PitchCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Kicker size={9.5} tone="muted">INTERESTS & EVIDENCE</Kicker>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-soft)", margin: 0 }}>{d.interests}</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-soft)", margin: 0 }}>{d.scores}</p>
        </div>
        <div style={{ background: "var(--crm-card)", border: "1px solid var(--crm-line)", borderRadius: "var(--radius-card-crm)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <Kicker size={9.5}>MOVE CANDIDATE</Kicker>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STAGE_BTNS.map((b, i) => (
              <span key={b} style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.04em", padding: "8px 13px", borderRadius: 100, cursor: "pointer",
                background: i === 1 ? "var(--crm-blue)" : "var(--white)", color: i === 1 ? "#fff" : "var(--ink-soft)",
                border: i === 1 ? "1px solid var(--crm-blue)" : "1px solid var(--crm-line-2)",
              }}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineTable() {
  return (
    <div style={{ padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <DisplayHeading as="h1" size={28}>Family pipeline</DisplayHeading>
        <Button variant="primary">Add family</Button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <FilterChip active>ALL STAGES</FilterChip><FilterChip>NEEDS ATTENTION</FilterChip><FilterChip>AMBASSADOR</FilterChip><FilterChip>NO CASL</FilterChip>
      </div>
      <div style={{ background: "var(--white)", border: "1px solid var(--crm-line)", borderRadius: "var(--radius-card-crm)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              {["Family", "Stage", "Heat", "Source", "Consent", "Last touch", "Next action"].map((h) => (
                <th key={h} style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.1em", color: "var(--muted)", fontWeight: 500, padding: "12px 16px", borderBottom: "1px solid var(--crm-line)" }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PIPELINE_ROWS.map((r) => (
              <tr key={r.fam} style={{ borderBottom: "1px solid var(--crm-line)" }}>
                <td style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 100, background: "var(--paper-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>{r.fam[0]}</span>
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 600 }}>{r.fam}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.kids}</span>
                    </span>
                  </div>
                </td>
                <td style={{ padding: "14px 16px" }}><StatusPill tone={r.tone}>{r.stage}</StatusPill></td>
                <td style={{ padding: "14px 16px" }}><HeatPips value={r.heat} /></td>
                <td style={{ padding: "14px 16px" }}><span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: r.source.startsWith("AMB") ? "var(--red)" : "var(--ink-soft)" }}>{r.source}</span></td>
                <td style={{ padding: "14px 16px" }}>{r.consent ? <span style={{ color: "var(--green)", fontWeight: 600 }}>✓</span> : <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#fff", background: "var(--amber)", padding: "3px 8px", borderRadius: 100 }}>NO CASL</span>}</td>
                <td style={{ padding: "14px 16px" }}><span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: r.touchTone }}>{r.touch}</span></td>
                <td style={{ padding: "14px 16px", maxWidth: 220, color: "var(--ink-soft)", fontSize: 12.5 }}>{r.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CrmApp() {
  const [tab, setTab] = React.useState("Dossiers");
  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--ink)", minHeight: "100vh", background: "var(--crm-bg)" }}>
      <Chrome tab={tab} setTab={setTab} />
      {tab === "Pipeline" ? <PipelineTable /> : <DossierQueue />}
    </div>
  );
}

window.CrmApp = CrmApp;
