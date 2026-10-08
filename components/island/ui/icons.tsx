import type { ReactNode } from "react";
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
export function Breeze(p: P) {
  return (
    <Svg {...p}>
      <path d="M3.5 11.5h15a3.6 3.6 0 1 0-3.6-3.6" {...line} />
      <path d="M3.5 17h20a3.6 3.6 0 1 1-3.6 3.6" {...line} />
      <path d="M6.5 22.5h7" {...line} />
      <ellipse cx="25" cy="10" rx="2.6" ry="1.4" transform="rotate(-35 25 10)" fill="#9cc56a" stroke={INK} strokeWidth="1.2" />
    </Svg>
  );
}

export function WateringCan(p: P) {
  return (
    <Svg {...p}>
      <path d="M8.5 14.5c-4.2 0-4.6 7.2 0 7.6" {...line} />
      <path d="M18.4 18l7.2-6.6" {...line} strokeWidth={2.4} />
      <path d="M24.4 8.9l3.4 3.7" {...line} strokeWidth={3.2} />
      <path d="M7.6 13.2h11.6l-1.3 11.4a2 2 0 0 1-2 1.7h-5a2 2 0 0 1-2-1.7z" fill="#8cc7c0" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 17.5h6.5" stroke={PAPER} strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
    </Svg>
  );
}

export function SeedPouch(p: P) {
  return (
    <Svg {...p}>
      <path d="M10.5 13c-3.2 3-4.4 8-2.3 11.2 1.5 2.3 4.6 3.1 7.8 3.1s6.3-.8 7.8-3.1c2.1-3.2.9-8.2-2.3-11.2z" fill="#e8c27a" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10.5 12.8h11M12.5 12.6l-2.2-4.2M16 12.6V8M19.5 12.6l2.2-4.2" {...line} />
      <ellipse cx="13.2" cy="20.5" rx="1.1" ry="0.8" fill={INK} />
      <ellipse cx="17.6" cy="22.4" rx="1.1" ry="0.8" fill={INK} />
      <ellipse cx="18.6" cy="18.2" rx="1.1" ry="0.8" fill={INK} />
    </Svg>
  );
}

export function Crumbs(p: P) {
  return (
    <Svg {...p}>
      <path
        d="M6 16c0-4 4.5-6.5 10-6.5S26 12 26 16c0 1.3-.9 2-2 2v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 22.5V18c-1.1 0-2-.7-2-2z"
        fill="#f0cf94"
        stroke={INK}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M11 15.5c1.5-1.4 3-1.4 4.5 0M16.5 14c1.2-1 2.4-1 3.6 0" stroke="#c99a52" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <circle cx="9.5" cy="28" r="1.1" fill={INK} />
      <circle cx="15" cy="29" r="0.9" fill={INK} />
      <circle cx="21.5" cy="28.2" r="1.2" fill={INK} />
    </Svg>
  );
}

export function Pebbles(p: P) {
  return (
    <Svg {...p}>
      <ellipse cx="16" cy="24" rx="10" ry="4.4" fill="#b9b3a6" stroke={INK} strokeWidth="1.8" />
      <ellipse cx="13.6" cy="17.6" rx="6.4" ry="3.5" fill="#d8d2c4" stroke={INK} strokeWidth="1.8" />
      <ellipse cx="17.6" cy="11.6" rx="4.2" ry="2.7" fill="#a59f92" stroke={INK} strokeWidth="1.8" />
      <path d="M10.8 16.8c1-.6 2.2-.8 3.4-.6" stroke={PAPER} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export function PaperBoat(p: P) {
  return (
    <Svg {...p}>
      <path d="M3 17.5l5.2 7.5h15.6l5.2-7.5z" fill={PAPER} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 17.5l7-11.5 7 11.5z" fill="#f6dfc4" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 6v11.5" stroke={INK} strokeWidth="1" opacity="0.5" />
      <path d="M5 28.5c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0 3 .8 4 .4" stroke="#5aa39b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

export const TOOL_ICON: Record<ToolKind, (p: P) => ReactNode> = {
  hand: HandOpen,
  breeze: Breeze,
  water: WateringCan,
  seeds: SeedPouch,
  crumbs: Crumbs,
  pebble: Pebbles,
  float: PaperBoat,
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
