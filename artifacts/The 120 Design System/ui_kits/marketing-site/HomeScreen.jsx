// The 120 marketing home — recreation composing DS primitives.
// Exposes MarketingApp on window for index.html.
const { Wordmark, Button, SeatsDot, Kicker, DisplayHeading, GroupCard, StatCard, FeatureCard, FaqItem } = window.The120DesignSystem_cdb8b7;

const GROUPS = [
  { category: "ATHLETES", name: "The Athletes", blurb: "Train seriously, compete seriously, and think like a pro." },
  { category: "ENTREPRENEURS", name: "The Founders", blurb: "Start something real. Customers, revenue, lessons learned." },
  { category: "CREATIVE", name: "The Makers", blurb: "Art, film, music, invention. A real body of work, shipped." },
  { category: "GIFTED & TALENTED", name: "The Scholars", blurb: "Accelerated academics. Mastery with no ceiling.", cta: "ENROLLING NOW · GT TORONTO →" },
  { category: "SERVICE", name: "The Givers", blurb: "Lead real service. Projects that change a corner of the city." },
];

const FAQS = [
  { q: "What is the Tin Can?", a: "A screen-free phone with the 120 Address Book — the network in your kid's pocket, without the internet." },
  { q: "How many hours a week?", a: "3–5 hours a week, alongside any school. Membership is designed to sit beside whatever your child already does." },
  { q: "What does it cost?", a: "$3,000 CAD a year for Membership, or $15,000 for the Full Academic Core with TimeBack. Every group is enrolling now." },
];

function Nav({ onJoin }) {
  return (
    <header style={{ position: "sticky", top: 18, zIndex: 50, margin: "18px 20px 0" }}>
      <div style={{ borderRadius: "var(--radius-card)", background: "var(--white)", boxShadow: "var(--shadow-nav)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 22px" }}>
        <Wordmark tone="dark" sublabel="TORONTO" />
        <span style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {["The Gauntlet", "Tuition", "FAQ"].map((l) => (
            <a key={l} href="#" style={{ fontSize: 14, color: "var(--ink)" }}>{l}</a>
          ))}
          <Button variant="ghost">Book a call</Button>
          <Button variant="primary" onClick={onJoin}>Join the 120</Button>
        </span>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ position: "relative", minHeight: 620, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden", marginTop: -92 }}>
      <img src="../../assets/hero-science.webp" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "72% 32%", zIndex: -2 }} />
      <div style={{ position: "absolute", inset: 0, zIndex: -1, background: "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)" }} />
      <div style={{ padding: "176px 44px 40px" }}>
        <h1 className="display" style={{ maxWidth: 820, fontSize: 60, color: "#fff", margin: 0 }}>
          <span style={{ display: "block" }}>Build your network.</span>
          <span className="accent-blush" style={{ display: "block" }}>Top 1% academics.</span>
          <span style={{ display: "block" }}>Super interesting projects.</span>
          <span style={{ display: "block" }}>Ages 8–17.</span>
        </h1>
        <div style={{ margin: "26px 0 18px", height: 1, maxWidth: 820, background: "rgba(255,255,255,0.45)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
          <span style={{ maxWidth: 680, fontSize: 18, lineHeight: 1.5, color: "#fff" }}>
            Athletes, founders, makers, scholars, givers: Toronto's most motivated and engaged kids, ages 8–17, building interesting lives together.
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap" }}>
            FOUNDING COHORT · FALL 2026 · TORONTO
          </span>
        </div>
      </div>
    </section>
  );
}

function Section({ children, style }) {
  return <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "0 44px", ...style }}>{children}</div>;
}

function MarketingApp() {
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [faq, setFaq] = React.useState(0);
  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--ink)", background: "var(--paper)" }}>
      <Nav onJoin={() => setJoinOpen(true)} />
      <Hero />

      {/* intro + seats */}
      <Section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 32, padding: "44px", flexWrap: "wrap" }}>
        <p style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.6, color: "var(--ink-soft)", margin: 0 }}>
          The 120 is a selective network of 120 kids across five groups. Your child finds people with the same core interests, and different ones, in a cohort where everyone is building something. 3–5 hours a week, alongside any school.
        </p>
        <SeatsDot remaining={113} />
      </Section>

      {/* five groups */}
      <section style={{ background: "var(--blue)", padding: "80px 44px" }}>
        <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Kicker tone="blush">FIVE GROUPS · ONE NETWORK</Kicker>
              <DisplayHeading tone="dark" size={44}>Every kid needs <em style={{ fontStyle: "italic", color: "var(--blush)" }}>their people</em></DisplayHeading>
            </div>
            <span style={{ maxWidth: 380, fontSize: 15, lineHeight: 1.6, color: "rgba(255,255,255,0.75)" }}>120 seats across 5 groups. Book a call or join today.</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14 }}>
            {GROUPS.map((g) => <GroupCard key={g.name} {...g} />)}
          </div>
        </div>
      </section>

      {/* membership 3 things */}
      <Section style={{ padding: "88px 44px", display: "flex", flexDirection: "column", gap: 40 }}>
        <DisplayHeading size={42}>Membership is <em style={{ fontStyle: "italic", color: "var(--red)" }}>3 things</em></DisplayHeading>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {[
            ["01 · THE NETWORK", "The people and the Tin Can", "A screen-free phone with the 120 Address Book, and a cohort of kids who all take their thing seriously."],
            ["02 · THE PROJECT", "A year-long build", "A mentored project — a venture, a season, a body of work — demoed at the quarterly Toronto intensives."],
            ["03 · THE CRAFT", "Accelerated academics", "Math through Math Academy, or the Full Academic Core with TimeBack — paced to your kid, never the average."],
          ].map(([k, t, b]) => (
            <div key={k} style={{ borderTop: "2px solid var(--ink)", paddingTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <Kicker>{k}</Kicker>
              <div style={{ fontWeight: 600, fontSize: 21, letterSpacing: "-0.01em" }}>{t}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft)" }}>{b}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* proof strip */}
      <section style={{ background: "var(--ink)", padding: "72px 44px" }}>
        <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 20, alignItems: "start" }}>
          <FeatureCard image="../../assets/project-robotics.webp" index="01" title="The year-long project" body="A mentored project demoed to the whole network at the quarterly Toronto intensives — a venture, a season, a film, a service program." />
          <StatCard value="1400" accent="+" label="SAT BY 8TH GRADE" note="2 Hour Learning network results." />
          <StatCard value="120" label="SEATS · ONE COHORT" note="Founding year, Fall 2026, Toronto." />
        </div>
      </section>

      {/* tuition teaser */}
      <Section style={{ padding: "88px 44px", display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start" }}>
        <DisplayHeading size={42}>Two prices. <em style={{ fontStyle: "italic", color: "var(--red)" }}>Two ways in.</em></DisplayHeading>
        <p style={{ maxWidth: 720, fontSize: 17, lineHeight: 1.6, color: "var(--ink-soft)", margin: 0 }}>
          $3,000 CAD a year for Membership with math through Math Academy, or $15,000 for the Full Academic Core with TimeBack. Every group is enrolling now.
        </p>
        <Button variant="ghost">See tuition →</Button>
      </Section>

      {/* FAQ */}
      <Section style={{ padding: "0 44px 88px", maxWidth: 900, margin: "0 auto" }}>
        <Kicker>COMMON QUESTIONS</Kicker>
        <div style={{ marginTop: 20 }}>
          {FAQS.map((f, i) => (
            <FaqItem key={i} question={f.q} open={faq === i} onToggle={() => setFaq(faq === i ? -1 : i)}>{f.a}</FaqItem>
          ))}
        </div>
      </Section>

      {/* CTA band */}
      <section style={{ background: "var(--red)", padding: "88px 44px", textAlign: "center" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>
          <DisplayHeading tone="dark" size={52} style={{ color: "#fff" }}>Come join the network. <em style={{ fontStyle: "italic", color: "var(--blush)" }}>Come join the 120.</em></DisplayHeading>
          <span style={{ fontSize: 17, color: "rgba(255,255,255,0.9)" }}>113 of 120 seats remain for the founding cohort.</span>
          <div style={{ display: "flex", gap: 14 }}>
            <Button variant="white" onClick={() => setJoinOpen(true)}>Join the 120</Button>
            <Button variant="ghostLight">Book a call</Button>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer style={{ background: "var(--blue)", padding: "48px 44px 36px" }}>
        <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
            <Wordmark tone="light" />
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {["The groups", "Parents", "Tuition", "FAQ", "Sign in"].map((l) => (
                <a key={l} href="#" style={{ fontSize: 13, color: "var(--muted)" }}>{l}</a>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.25)", paddingTop: 20 }}>
            <span style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,0.7)" }}>© 2026 The 120 · A learning centre. Not an accredited school. TIN CAN is a trademark of Tin Can Untechnologies, Inc.</span>
          </div>
        </div>
      </footer>

      {joinOpen ? <JoinModal onClose={() => setJoinOpen(false)} /> : null}
    </div>
  );
}

function JoinModal({ onClose }) {
  const { TextField, Select, Checkbox } = window.The120DesignSystem_cdb8b7;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(19,20,22,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--white)", borderRadius: "var(--radius-card)", padding: 40, maxWidth: 560, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <Kicker>SECURE YOUR CANDIDACY · FALL 2026</Kicker>
        <DisplayHeading size={28}>Create your family account</DisplayHeading>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <TextField label="First name" placeholder="Jordan" />
          <TextField label="Last name" placeholder="Ng" />
          <TextField label="Email" placeholder="parent@email.com" />
          <Select label="Child's grade" options={["Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"]} />
        </div>
        <Checkbox>Yes — I consent to receive email and SMS updates from The 120. I can unsubscribe at any time.</Checkbox>
        <Button variant="primary" block onClick={onClose}>Join the 120</Button>
      </div>
    </div>
  );
}

window.MarketingApp = MarketingApp;
