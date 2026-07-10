"use client";

import type { TrianglePair } from "../game/problems";

/** Render the two triangles with tick marks (sides) and arcs (angles). */
export default function TriangleFigure({ pair }: { pair: TrianglePair }) {
  return (
    <div className="flex items-center justify-center gap-8">
      <Tri sides={pair.a.sides} marks={pair.a.marks} flip={false} rotate={pair.a.rotate} />
      <Tri sides={pair.b.sides} marks={pair.b.marks} flip rotate={pair.b.rotate} />
    </div>
  );
}

function Tri({
  sides,
  marks,
  flip,
  rotate = 0,
}: {
  sides: [number, number, number];
  marks: string[];
  flip: boolean;
  rotate?: number;
}) {
  // Build a triangle from side lengths (scaled to fit ~150x110 box)
  const [a, b, c] = sides;
  // place A at origin, B at (c, 0); C from law of cosines
  const cosA = (b * b + c * c - a * a) / (2 * b * c);
  const angA = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const C = { x: b * Math.cos(angA), y: -b * Math.sin(angA) };
  const pts = [
    { x: 0, y: 0 },
    { x: c, y: 0 },
    C,
  ];
  // normalize into viewbox
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const w = Math.max(...pts.map((p) => p.x)) - minX;
  const h = Math.max(...pts.map((p) => p.y)) - minY;
  const scale = Math.min(140 / w, 100 / h);
  const P = pts.map((p) => ({
    x: (p.x - minX) * scale + 8,
    y: (p.y - minY) * scale + 8,
  }));
  const view = { w: w * scale + 16, h: h * scale + 16 };

  const mid = (i: number, j: number) => ({
    x: (P[i].x + P[j].x) / 2,
    y: (P[i].y + P[j].y) / 2,
  });
  // side k is opposite vertex k: side0 = P1-P2, side1 = P0-P2, side2 = P0-P1
  const sidePairs: [number, number][] = [
    [1, 2],
    [0, 2],
    [0, 1],
  ];

  return (
    <svg
      viewBox={`0 0 ${view.w} ${view.h}`}
      width={view.w}
      height={view.h}
      style={{ transform: `${flip ? "scaleX(-1) " : ""}rotate(${rotate}deg)` }}
      aria-hidden
    >
      <polygon
        points={P.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="rgba(34,211,238,0.12)"
        stroke="#7dd3fc"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {marks.map((m) => {
        const kind = m[0]; // 's' side tick | 'A' angle arc
        const idx = Number(m[1]);
        if (kind === "s") {
          const [i, j] = sidePairs[idx];
          const c0 = mid(i, j);
          const dx = P[j].x - P[i].x;
          const dy = P[j].y - P[i].y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * 6;
          const ny = (dx / len) * 6;
          return (
            <line
              key={m}
              x1={c0.x - nx}
              y1={c0.y - ny}
              x2={c0.x + nx}
              y2={c0.y + ny}
              stroke="#fbbf24"
              strokeWidth="3"
              strokeLinecap="round"
            />
          );
        }
        // angle arc at vertex idx
        const v = P[idx];
        return (
          <circle
            key={m}
            cx={v.x}
            cy={v.y}
            r="10"
            fill="none"
            stroke="#f472b6"
            strokeWidth="2.5"
            strokeDasharray="4 3"
          />
        );
      })}
    </svg>
  );
}
