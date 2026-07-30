"use client";

import type { TrianglePair } from "../game/problems";

const VIEW_W = 160;
const VIEW_H = 140;
const DRAW_W = 100;
const DRAW_H = 76;

type Point = { x: number; y: number };

function arcPath(points: Point[], vertexIdx: number, radius: number): string {
  const neighborPairs: [number, number][] = [
    [1, 2],
    [0, 2],
    [0, 1],
  ];
  const vertex = points[vertexIdx];
  const [firstIdx, secondIdx] = neighborPairs[vertexIdx];
  let start = Math.atan2(
    points[firstIdx].y - vertex.y,
    points[firstIdx].x - vertex.x
  );
  let end = Math.atan2(
    points[secondIdx].y - vertex.y,
    points[secondIdx].x - vertex.x
  );
  let delta = (end - start + Math.PI * 2) % (Math.PI * 2);
  if (delta > Math.PI) {
    [start, end] = [end, start];
    delta = (end - start + Math.PI * 2) % (Math.PI * 2);
  }

  const from = {
    x: vertex.x + Math.cos(start) * radius,
    y: vertex.y + Math.sin(start) * radius,
  };
  const to = {
    x: vertex.x + Math.cos(start + delta) * radius,
    y: vertex.y + Math.sin(start + delta) * radius,
  };
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
}

/** Responsive marked triangles for SSS/SAS/ASA/AAS recognition. */
export default function TriangleFigure({ pair }: { pair: TrianglePair }) {
  return (
    <div
      role="img"
      aria-label="Two triangles with matching side and angle markings"
      className="grid w-full min-w-0 grid-cols-2 items-center justify-items-center gap-1.5 sm:gap-4"
    >
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
  // Build the triangle from its side lengths and center it in a padded,
  // fixed view box. Rotation inside that box cannot alter card layout.
  const [a, b, c] = sides;
  const cosA = (b * b + c * c - a * a) / (2 * b * c);
  const angA = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const raw = [
    { x: 0, y: 0 },
    { x: c, y: 0 },
    { x: b * Math.cos(angA), y: -b * Math.sin(angA) },
  ];
  const minX = Math.min(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => point.y));
  const width = Math.max(...raw.map((point) => point.x)) - minX;
  const height = Math.max(...raw.map((point) => point.y)) - minY;
  const scale = Math.min(DRAW_W / width, DRAW_H / height);
  const scaledW = width * scale;
  const scaledH = height * scale;
  const points = raw.map((point) => ({
    x: (point.x - minX) * scale - scaledW / 2,
    y: (point.y - minY) * scale - scaledH / 2,
  }));

  const midpoint = (i: number, j: number) => ({
    x: (points[i].x + points[j].x) / 2,
    y: (points[i].y + points[j].y) / 2,
  });
  // Side k is opposite vertex k.
  const sidePairs: [number, number][] = [
    [1, 2],
    [0, 2],
    [0, 1],
  ];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-auto w-full max-w-[132px] overflow-visible sm:max-w-[160px]"
      aria-hidden="true"
    >
      <g transform={`translate(${VIEW_W / 2} ${VIEW_H / 2}) rotate(${rotate}) scale(${flip ? -1 : 1} 1)`}>
        <polygon
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="rgba(34,211,238,0.12)"
          stroke="#7dd3fc"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {marks.map((mark) => {
          const kind = mark[0];
          const idx = Number(mark[1]);
          if (kind === "s") {
            const [i, j] = sidePairs[idx];
            const center = midpoint(i, j);
            const dx = points[j].x - points[i].x;
            const dy = points[j].y - points[i].y;
            const length = Math.hypot(dx, dy) || 1;
            const tx = dx / length;
            const ty = dy / length;
            const nx = (-dy / length) * 5;
            const ny = (dx / length) * 5;
            const count = idx + 1;
            return (
              <g key={mark}>
                {Array.from({ length: count }, (_, tick) => {
                  const offset = (tick - (count - 1) / 2) * 7;
                  const x = center.x + tx * offset;
                  const y = center.y + ty * offset;
                  return (
                    <line
                      key={tick}
                      x1={x - nx}
                      y1={y - ny}
                      x2={x + nx}
                      y2={y + ny}
                      stroke="#fbbf24"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            );
          }

          // One/two/three true interior arcs distinguish corresponding angles.
          return (
            <g key={mark}>
              {Array.from({ length: idx + 1 }, (_, arc) => (
                <path
                  key={arc}
                  d={arcPath(points, idx, 9 + arc * 5)}
                  fill="none"
                  stroke="#f472b6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
