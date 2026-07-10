"use client";

/**
 * SVG boss sprites — flat, cute, animatable. If a generated PNG exists at
 * /raiders/boss-<id>.png it's used instead (set `useImage`).
 */
export default function BossSprite({
  id,
  size = 260,
  useImage = false,
}: {
  id: string;
  size?: number;
  useImage?: boolean;
}) {
  if (useImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={`/raiders/boss-${id}.png`}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: "contain", imageRendering: "auto" }}
        draggable={false}
      />
    );
  }
  const S = { width: size, height: size };
  switch (id) {
    case "clank":
      return (
        <svg viewBox="0 0 200 200" {...S} aria-hidden>
          {/* antenna */}
          <line x1="100" y1="18" x2="100" y2="40" stroke="#9ca3af" strokeWidth="4" />
          <circle cx="100" cy="14" r="6" fill="#22d3ee" />
          {/* head */}
          <circle cx="100" cy="72" r="34" fill="#4b5563" />
          <rect x="76" y="58" width="48" height="26" rx="8" fill="#1f2937" />
          <circle cx="90" cy="71" r="6" fill="#4ade80" className="mr-eye" />
          <circle cx="110" cy="71" r="6" fill="#4ade80" className="mr-eye" />
          {/* body */}
          <rect x="62" y="108" width="76" height="62" rx="14" fill="#6b7280" />
          <rect x="62" y="108" width="76" height="30" rx="14" fill="#7b8494" />
          {/* core */}
          <circle cx="100" cy="140" r="15" fill="#22d3ee">
            <animate attributeName="r" values="15;17;15" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* arms */}
          <rect x="42" y="116" width="16" height="44" rx="8" fill="#9ca3af" />
          <rect x="142" y="116" width="16" height="44" rx="8" fill="#9ca3af" />
        </svg>
      );
    case "gloop":
      return (
        <svg viewBox="0 0 200 200" {...S} aria-hidden>
          <path
            d="M100 34 C 150 34 172 86 168 124 C 165 156 138 172 100 172 C 62 172 35 156 32 124 C 28 86 50 34 100 34 Z"
            fill="#65a30d"
          >
            <animate
              attributeName="d"
              dur="3s"
              repeatCount="indefinite"
              values="M100 34 C 150 34 172 86 168 124 C 165 156 138 172 100 172 C 62 172 35 156 32 124 C 28 86 50 34 100 34 Z;
                      M100 40 C 154 40 176 90 170 126 C 166 158 138 176 100 176 C 62 176 34 158 30 126 C 24 90 46 40 100 40 Z;
                      M100 34 C 150 34 172 86 168 124 C 165 156 138 172 100 172 C 62 172 35 156 32 124 C 28 86 50 34 100 34 Z"
            />
          </path>
          <path d="M60 60 C 80 44 120 44 140 60 C 120 52 80 52 60 60 Z" fill="#84cc16" />
          <circle cx="78" cy="92" r="16" fill="#fff" />
          <circle cx="122" cy="92" r="16" fill="#fff" />
          <circle cx="81" cy="95" r="7" fill="#1c1917" />
          <circle cx="119" cy="95" r="7" fill="#1c1917" />
          <path d="M76 128 Q 100 150 124 128 L 124 136 Q 100 158 76 136 Z" fill="#b91c1c" />
          <rect x="94" y="126" width="12" height="12" rx="2" fill="#fff" />
        </svg>
      );
    case "magmar":
      return (
        <svg viewBox="0 0 200 200" {...S} aria-hidden>
          <polygon points="100,20 138,42 156,84 150,130 120,168 80,168 50,130 44,84 62,42" fill="#292524" />
          <polygon points="100,34 130,50 144,86 138,124 114,156 86,156 62,124 56,86 70,50" fill="#44403c" />
          {/* magma cracks */}
          <path d="M84 60 L 96 84 L 84 108 L 98 136" stroke="#f97316" strokeWidth="6" fill="none" strokeLinecap="round">
            <animate attributeName="stroke" values="#f97316;#fbbf24;#f97316" dur="1.6s" repeatCount="indefinite" />
          </path>
          <path d="M118 58 L 108 86 L 122 112" stroke="#ef4444" strokeWidth="5" fill="none" strokeLinecap="round" />
          {/* eyes */}
          <polygon points="78,74 94,70 92,82" fill="#fbbf24" />
          <polygon points="122,74 106,70 108,82" fill="#fbbf24" />
          {/* fists */}
          <polygon points="36,120 58,112 62,138 42,146" fill="#292524" />
          <polygon points="164,120 142,112 138,138 158,146" fill="#292524" />
        </svg>
      );
    case "vex":
    default:
      return (
        <svg viewBox="0 0 200 200" {...S} aria-hidden>
          <rect x="58" y="52" width="84" height="64" rx="12" fill="#374151" />
          <rect x="70" y="66" width="60" height="22" rx="6" fill="#111827" />
          <circle cx="88" cy="77" r="6" fill="#ef4444">
            <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="112" cy="77" r="6" fill="#ef4444" />
          {/* torso */}
          <rect x="66" y="120" width="68" height="48" rx="10" fill="#4b5563" />
          <circle cx="100" cy="144" r="13" fill="#60a5fa">
            <animate attributeName="r" values="13;15;13" dur="1.8s" repeatCount="indefinite" />
          </circle>
          {/* cannon arm */}
          <rect x="128" y="126" width="52" height="20" rx="10" fill="#1f2937" />
          <circle cx="182" cy="136" r="12" fill="#0ea5e9" />
          <rect x="20" y="126" width="42" height="20" rx="10" fill="#6b7280" />
        </svg>
      );
  }
}
