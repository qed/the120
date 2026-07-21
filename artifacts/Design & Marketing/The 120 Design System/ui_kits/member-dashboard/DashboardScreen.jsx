// The 120 member dashboard — recreation. Sidebar + dossier cards + seat pipeline.
const { Wordmark, Button, StatusPill, Kicker, DisplayHeading } = window.The120DesignSystem_cdb8b7;

const KIDS = [
  { name: "Maya Okafor", meta: "Grade 5 · Cottingham Jr PS", status: "SUBMITTED", tone: "blue", pct: 100, canSubmit: false },
  { name: "Theo Okafor", meta: "Grade 3 · Cottingham Jr PS", status: "DRAFT", tone: "neutral", pct: 45, canSubmit: false },
];

const PIPELINE = ["ACCOUNT", "DOSSIER", "CALL", "ASSESSMENT", "OFFER", "MEMBER"];

function SideBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      textAlign: "left", fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: active ? 600 : 400,
      color: active ? "#fff" : "rgba(255,255,255,0.7)", background: active ? "rgba(255,255,255,0.12)" : "transparent",
      border: "none", borderRadius: 8, padding: "9px 12px", cursor: "pointer",
    }}>{children}</button>
  );
}

function KidCard({ kid }) {
  return (
    <div style={{ background: "var(--crm-card)", border: "1px solid var(--crm-line)", borderRadius: "var(--radius-card)", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-0.01em" }}>{kid.name}</span>
          <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>{kid.meta}</span>
        </div>
        <StatusPill tone={kid.tone}>{kid.status}</StatusPill>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.1em", color: "var(--muted)" }}>DOSSIER COMPLETENESS</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink)" }}>{kid.pct}%</span>
        </div>
        <div style={{ height: 7, background: "#e0ddd7", borderRadius: 100, overflow: "hidden" }}>
          <div style={{ width: kid.pct + "%", height: "100%", background: kid.pct === 100 ? "var(--green)" : "var(--crm-blue)" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button variant="ink" style={{ background: "var(--crm-blue)" }}>Edit dossier</Button>
        <Button variant="ghost">View dossier</Button>
        {kid.pct === 100 ? <Button variant="primary">Submit for review</Button> : null}
      </div>
    </div>
  );
}

function DashboardApp() {
  const [view, setView] = React.useState("overview");
  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--ink)", minHeight: "100vh", display: "grid", gridTemplateColumns: "250px 1fr", background: "var(--crm-bg)" }}>
      {/* sidebar */}
      <div style={{ background: "var(--crm-blue)", padding: "26px 22px", display: "flex", flexDirection: "column", gap: 28, boxSizing: "border-box" }}>
        <Wordmark tone="light" sublabel="TORONTO" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SideBtn active={view === "overview"} onClick={() => setView("overview")}>Overview</SideBtn>
          <SideBtn active={view === "catalog"} onClick={() => setView("catalog")}>Workshop catalog</SideBtn>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "rgba(255,255,255,0.6)" }}>YOUR KIDS</span>
          {KIDS.map((k) => <SideBtn key={k.name}>{k.name.split(" ")[0]}</SideBtn>)}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Ada Okafor</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)" }}>113 OF 120 SEATS REMAIN</span>
        </div>
      </div>

      {/* main */}
      <div style={{ padding: "36px 44px", maxWidth: 1080, boxSizing: "border-box" }}>
        {view === "overview" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <DisplayHeading as="h1" size={36}>Welcome back, Ada.</DisplayHeading>
              <span style={{ fontSize: 15, color: "var(--ink-soft)" }}>Build each child's dossier, then submit it for review. We'll take it from there.</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {KIDS.map((k) => <KidCard key={k.name} kid={k} />)}
            </div>
            <div style={{ border: "1.5px dashed #c9c6c0", borderRadius: "var(--radius-card)", padding: "22px 28px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>Add another child</span>
              <Button variant="ink" style={{ background: "var(--crm-blue)" }}>Add child</Button>
            </div>
            {/* seat pipeline */}
            <div style={{ background: "var(--crm-blue)", borderRadius: "var(--radius-card)", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
              <Kicker tone="blush">THE PATH TO A SEAT</Kicker>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {PIPELINE.map((p, i) => (
                  <span key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.06em", padding: "6px 12px", borderRadius: 100, background: i <= 1 ? "var(--white)" : "rgba(255,255,255,0.14)", color: i <= 1 ? "var(--crm-blue)" : "rgba(255,255,255,0.75)" }}>{p}</span>
                    {i < PIPELINE.length - 1 ? <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>→</span> : null}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <DisplayHeading as="h1" size={36}>Workshop catalog</DisplayHeading>
            <span style={{ fontSize: 15, color: "var(--ink-soft)" }}>Browse the year's workshops and add them to a child's dossier. Catalog view is a stub in this kit.</span>
          </div>
        )}
      </div>
    </div>
  );
}

window.DashboardApp = DashboardApp;
