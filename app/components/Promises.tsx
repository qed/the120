const promises = [
  {
    title: "Shatter the ceiling",
    body: "Mastery-based, no artificial grade caps. When your kid is ready for more, they get more — today, not next year.",
  },
  {
    title: "Love learning more than vacation",
    body: "Joyful intensity, not busywork. Members leave the intensives wishing they were longer.",
  },
  {
    title: "Master real life skills",
    body: "One shipped project a year, a real advisor, and a tribe that holds them to a higher bar.",
  },
];

export default function Promises() {
  return (
    <section className="border-b border-line bg-paper-2">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-24">
        <p className="eyebrow">Three promises</p>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          {promises.map((p, i) => (
            <div key={p.title} className="border-t-2 border-red pt-5">
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
              <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-ink">
                {p.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-ink-soft">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
