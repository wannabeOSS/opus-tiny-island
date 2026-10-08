import type { ReactNode, Ref } from "react";
import type { ToolKind } from "../lib/tools";
import type { WeatherKind } from "../lib/world";

export const INK = "#24332f";
const PAPER = "#fff7e8";

type P = { size?: number; className?: string };

/** Draws `shapes` twice: thick ink underneath, paper on top, so overlapping parts share one outline. */
function Outlined({ children, fill = PAPER, w = 3 }: { children: ReactNode; fill?: string; w?: number }) {
  return (
    <>
      <g fill={INK} stroke={INK} strokeWidth={w} strokeLinejoin="round">
        {children}
      </g>
      <g fill={fill}>{children}</g>
    </>
  );
}

function Svg({ size = 28, className, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

const line = { fill: "none", stroke: INK, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/* ---------------- hands ---------------- */
export function HandOpen(p: P) {
  return (
    <Svg {...p}>
      <Outlined>
        <rect x="8.5" y="14" width="15" height="13.5" rx="6" />
        <rect x="9" y="6.5" width="3.6" height="12" rx="1.8" />
        <rect x="12.7" y="4.5" width="3.6" height="13" rx="1.8" />
        <rect x="16.4" y="5" width="3.6" height="12.5" rx="1.8" />
        <rect x="20.1" y="7.5" width="3.4" height="10.5" rx="1.7" />
        <rect x="5.7" y="15" width="3.6" height="9" rx="1.8" transform="rotate(-40 7.5 19.5)" />
      </Outlined>
      <path d="M12.7 15.5v-3M16.4 15.5v-3.5M20.1 15.5v-2.5" stroke={INK} strokeWidth="1" strokeLinecap="round" opacity="0.45" />
    </Svg>
  );
}

export function HandPoint(p: P) {
  return (
    <Svg {...p}>
      <Outlined>
        <rect x="9" y="14" width="14.5" height="13.5" rx="6" />
        <rect x="10" y="2.5" width="3.8" height="16" rx="1.9" />
        <rect x="13.8" y="11.2" width="3.6" height="7" rx="1.8" />
        <rect x="17.4" y="11.8" width="3.6" height="6.5" rx="1.8" />
        <rect x="20.6" y="13" width="3.2" height="5.5" rx="1.6" />
        <rect x="6.2" y="16" width="3.6" height="7.5" rx="1.8" transform="rotate(-40 8 19.5)" />
      </Outlined>
    </Svg>
  );
}

export function HandGrab(p: P) {
  return (
    <Svg {...p}>
      <Outlined>
        <rect x="8.5" y="14" width="15" height="13.5" rx="6" />
        <rect x="9" y="8.5" width="3.6" height="9" rx="1.8" />
        <rect x="12.7" y="7" width="3.6" height="10" rx="1.8" />
        <rect x="16.4" y="7.5" width="3.6" height="9.5" rx="1.8" />
        <rect x="20.1" y="9.5" width="3.4" height="8" rx="1.7" />
        <rect x="5.7" y="15.5" width="3.6" height="8" rx="1.8" transform="rotate(-30 7.5 19.5)" />
      </Outlined>
    </Svg>
  );
}

export function HandFist(p: P) {
  return (
    <Svg {...p}>
      <Outlined>
        <rect x="8.5" y="12.5" width="15" height="15" rx="6" />
        <rect x="9" y="10" width="3.8" height="6.5" rx="1.9" />
        <rect x="12.7" y="9.2" width="3.8" height="6.5" rx="1.9" />
        <rect x="16.4" y="9.5" width="3.8" height="6.5" rx="1.9" />
        <rect x="20" y="10.5" width="3.5" height="6" rx="1.75" />
        <rect x="6.5" y="17" width="10" height="3.8" rx="1.9" />
      </Outlined>
    </Svg>
  );
}

/* ---------------- tools ---------------- */
const BLADES = ["#f2c14e", "#ff8a7a", "#6fc3ff", "#6fe09a"];

/** The spinning part of the pinwheel, around (16, 12.5); exposed so the cursor can turn it. */
export function PinwheelRotor({ angle = 0, gRef }: { angle?: number; gRef?: Ref<SVGGElement> }) {
  return (
    <g ref={gRef} transform={`rotate(${angle} 16 12.5)`}>
      {BLADES.map((c, i) => (
        <path
          key={c}
          d="M16 12.5L16 3.2c3.6 0 6.2 2.6 6.2 5.6z"
          transform={`rotate(${i * 90} 16 12.5)`}
          fill={c}
          stroke={INK}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ))}
      <circle cx="16" cy="12.5" r="1.7" fill={PAPER} stroke={INK} strokeWidth="1.3" />
    </g>
  );
}

export function Pinwheel({ rotorRef, ...p }: P & { rotorRef?: Ref<SVGGElement> }) {
  return (
    <Svg {...p}>
      <path d="M16.4 14l3.8 15" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M16.4 14l3.8 15" stroke="#c99a62" strokeWidth="1.6" strokeLinecap="round" />
      <PinwheelRotor gRef={rotorRef} />
    </Svg>
  );
}

export function PocketCloud(p: P) {
  return (
    <Svg {...p}>
      <path d="M8.5 19.5h15a4.2 4.2 0 0 0 .6-8.3 6.2 6.2 0 0 0-11.8-1.3 4.8 4.8 0 0 0-3.8 9.6z" fill="#f4f7fb" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="13.6" cy="14.6" r="0.9" fill={INK} />
      <circle cx="18.6" cy="14.6" r="0.9" fill={INK} />
      <path d="M15 16.6c.7.6 1.6.6 2.3 0" stroke={INK} strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M11 23l-1 3M16 23l-1 3.6M21 23l-1 3" stroke="#3f9fd8" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function SunMirror(p: P) {
  return (
    <Svg {...p}>
      <path d="M17.5 18.5l7.8 8.6" stroke={INK} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M17.5 18.5l7.8 8.6" stroke="#a8754a" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="13" cy="13" r="8.4" fill="#e9b85b" stroke={INK} strokeWidth="1.8" />
      <circle cx="13" cy="13" r="5.8" fill="#d9f0f6" stroke={INK} strokeWidth="1.2" />
      <path d="M10.2 11.6c.6-1.5 1.8-2.4 3.3-2.6" stroke={PAPER} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M26.5 3.5v4M24.5 5.5h4" stroke="#f2a93b" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

export function BubbleWand(p: P) {
  return (
    <Svg {...p}>
      <path d="M5.5 28.5l9.2-10.2" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M5.5 28.5l9.2-10.2" stroke="#a78bff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18.6" cy="13.6" r="5.4" fill="none" stroke={INK} strokeWidth="3.6" />
      <circle cx="18.6" cy="13.6" r="5.4" fill="#e9f6ff" fillOpacity="0.55" stroke="#a78bff" strokeWidth="1.8" />
      <circle cx="26" cy="5.6" r="2.8" fill="#eaf7ff" stroke="#5aa7d8" strokeWidth="1.3" />
      <circle cx="27.4" cy="12.2" r="1.6" fill="#f6edff" stroke="#a78bff" strokeWidth="1.1" />
      <path d="M24.8 4.6c.4-.5.9-.8 1.5-.9" stroke={PAPER} strokeWidth="0.9" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function SeedBomb(p: P) {
  return (
    <Svg {...p}>
      <path d="M16 11.5c0-2.6 1-4.6 2.8-6" stroke="#4f8a3a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M16.6 9.2c-3-.4-4.8-2.2-4.9-4.6 2.8.1 4.6 1.7 4.9 4.6z" fill="#7cc35a" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M18 7.6c1.8-2.3 4.3-3 6.4-2.1-1 2.4-3.4 3.3-6.4 2.1z" fill="#9bd36f" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="16" cy="19.5" r="8.6" fill="#b98b5e" stroke={INK} strokeWidth="1.8" />
      <circle cx="12.4" cy="17.4" r="1" fill="#f08aa8" />
      <circle cx="18.8" cy="22.6" r="1" fill="#e9c46a" />
      <circle cx="19.6" cy="16.4" r="0.9" fill="#6fae4a" />
      <circle cx="13.6" cy="23.2" r="0.8" fill="#6fae4a" />
      <path d="M10.6 15.2c1-1.4 2.3-2.2 3.8-2.5" stroke="#d9b48a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function Conch(p: P) {
  return (
    <Svg {...p}>
      <Outlined fill="#f6d2bb" w={3.4}>
        <path d="M26.5 4l-2.8 4.6c-6.2.2-12.6 3.8-16 10.2-1.4 2.8-.6 5.6 1.8 6.9l3.6 1.8c5.6.6 11-2.6 13.4-8.4 1.2-3.2 1.2-6.6.2-9.6z" />
        <path d="M12.8 11.6l-.6-3.4 2.6 2.3zM17.6 9.4l.2-3.4 2 2.9zM22.2 8.6l1.4-3 .9 3.3z" />
      </Outlined>
      <path d="M9.4 18.6c2.8.3 5.6 2.2 7 5.4-2.2 1.8-5 2.4-7.6 1.6-2.2-1.4-2-4.6.6-7z" fill="#f49ac1" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M23.7 8.6c1 2.6.8 5.6-.6 8.2M19.6 10.2c.4 2.6-.2 5.4-1.8 7.6" stroke="#c98f74" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export const TOOL_ICON: Record<ToolKind, (p: P) => ReactNode> = {
  hand: HandOpen,
  pinwheel: Pinwheel,
  cloud: PocketCloud,
  mirror: SunMirror,
  bubbles: BubbleWand,
  seedbomb: SeedBomb,
  conch: Conch,
};

/* ---------------- weather ---------------- */
const cloudPath = "M9 23h14a4.6 4.6 0 0 0 .7-9.1 6.6 6.6 0 0 0-12.6-1.4A5.2 5.2 0 0 0 9 23z";

export function WeatherIcon({ kind, ...p }: P & { kind: WeatherKind }) {
  return (
    <Svg {...p}>
      {kind === "clear" && (
        <>
          <circle cx="16" cy="16" r="5.6" fill="#f2c14e" stroke={INK} strokeWidth="1.8" />
          <path d="M16 4.5v3M16 24.5v3M4.5 16h3M24.5 16h3M7.9 7.9l2.1 2.1M22 22l2.1 2.1M7.9 24.1l2.1-2.1M22 10l2.1-2.1" {...line} />
        </>
      )}
      {kind === "cloudy" && (
        <>
          <circle cx="21" cy="11" r="4" fill="#f2c14e" stroke={INK} strokeWidth="1.6" />
          <path d={cloudPath} fill={PAPER} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        </>
      )}
      {kind === "rain" && (
        <>
          <path d={cloudPath} transform="translate(0 -4)" fill="#dfe7ea" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M11 23l-1.5 4M16 23l-1.5 4M21 23l-1.5 4" {...line} stroke="#3d8c86" />
        </>
      )}
      {kind === "storm" && (
        <>
          <path d={cloudPath} transform="translate(0 -4)" fill="#b8c0c8" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M16.5 19l-3 5h4l-2.5 5" fill="none" stroke="#e9a72a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === "fog" && <path d="M5 11c3-2 6-2 9 0s6 2 9 0M7 17c3-2 6-2 9 0s6 2 9 0M5 23c3-2 6-2 9 0s6 2 9 0" {...line} />}
      {kind === "snow" && (
        <>
          <path d="M16 5v22M6.5 10.5l19 11M6.5 21.5l19-11" {...line} stroke="#5d8fb3" />
          <path d="M13.5 6.5L16 9l2.5-2.5M13.5 25.5L16 23l2.5 2.5" {...line} stroke="#5d8fb3" />
        </>
      )}
    </Svg>
  );
}

/* ---------------- chrome ---------------- */
export function Speaker({ muted, ...p }: P & { muted: boolean }) {
  return (
    <Svg {...p}>
      <path d="M6 13h4l6-5v16l-6-5H6z" fill={PAPER} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {muted ? (
        <path d="M20.5 12.5l7 7M27.5 12.5l-7 7" {...line} />
      ) : (
        <>
          <path d="M20 12.5c1.6 2 1.6 5 0 7" {...line} />
          <path d="M23.5 9.5c3.2 3.8 3.2 9.2 0 13" {...line} />
        </>
      )}
    </Svg>
  );
}

export function Notebook(p: P) {
  return (
    <Svg {...p}>
      <rect x="8" y="5" width="17" height="22" rx="2.5" fill={PAPER} stroke={INK} strokeWidth="1.8" />
      <path d="M12 5v22" stroke={INK} strokeWidth="1.4" />
      <path d="M15 11h6.5M15 15h6.5M15 19h4" stroke="#3d8c86" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 9h3.5M6 14h3.5M6 19h3.5M6 24h3.5" {...line} strokeWidth={1.4} />
    </Svg>
  );
}

export function Close(p: P) {
  return (
    <Svg {...p}>
      <path d="M9 9l14 14M23 9L9 23" {...line} strokeWidth={2} />
    </Svg>
  );
}

export function Seashell(p: P) {
  return (
    <Svg {...p}>
      <path d="M16 26c-6 0-10-4-10-9 0-4 3-8 10-11 7 3 10 7 10 11 0 5-4 9-10 9z" fill="#f6d9c8" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 26V8M11 25l2-15M21 25l-2-15M7.5 21l4.5-9M24.5 21L20 12" stroke={INK} strokeWidth="1" opacity="0.5" />
    </Svg>
  );
}
