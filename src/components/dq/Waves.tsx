import { useId } from "react";

/**
 * Signature flowing-wave decoration. Pure SVG ribbons made of many thin parallel strokes,
 * coloured by theme tokens (--wave-1/2/3, --wave-fill, --wave-glow). Always decorative:
 * aria-hidden, pointer-events-none, painted behind content.
 */

type Band = {
  y: number; // baseline in viewBox units
  amp: number; // wave amplitude
  freq: number; // number of full sine cycles across the width
  phase: number;
  lines: number; // strokes in the ribbon
  spread: number; // vertical gap between strokes
  twist: number; // phase shift per stroke (ribbon twisting)
  tilt: number; // rise/fall across the width
  tone: "a" | "b" | "c";
  opacity?: number;
  glow?: boolean;
};

function linePoints(b: Band, i: number, w: number, steps = 64) {
  const pts: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const x = (s / steps) * w;
    const t = x / w;
    const y = b.y + b.tilt * t + b.amp * Math.sin(2 * Math.PI * b.freq * t + b.phase + i * b.twist) + i * b.spread * (1 + 0.35 * Math.sin(Math.PI * t * 1.3 + b.phase));
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts;
}

function ribbon(b: Band, w: number) {
  const lines = Array.from({ length: b.lines }, (_, i) => "M" + linePoints(b, i, w).join(" L"));
  const first = linePoints(b, 0, w);
  const last = linePoints(b, b.lines - 1, w).reverse();
  const area = "M" + first.join(" L") + " L" + last.join(" L") + " Z";
  const mid = "M" + linePoints(b, Math.floor(b.lines / 2), w).join(" L");
  return { lines, area, mid };
}

function WaveSvg({ bands, w, h, className, drift = false, strokeWidth = 1 }: { bands: Band[]; w: number; h: number; className?: string; drift?: boolean; strokeWidth?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" fill="none" style={{ opacity: "var(--wave-strength)" }}>
      <defs>
        {(["a", "b", "c"] as const).map((tone) => {
          const [c1, c2] = tone === "a" ? ["var(--wave-1)", "var(--wave-2)"] : tone === "b" ? ["var(--wave-2)", "var(--wave-3)"] : ["var(--wave-3)", "var(--wave-1)"];
          return (
            <linearGradient key={tone} id={`${id}s${tone}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
              <stop offset="0%" stopColor={c1} stopOpacity="0" />
              <stop offset="22%" stopColor={c1} stopOpacity="0.9" />
              <stop offset="62%" stopColor={c2} stopOpacity="1" />
              <stop offset="100%" stopColor={c2} stopOpacity="0.05" />
            </linearGradient>
          );
        })}
        <linearGradient id={`${id}f`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
          <stop offset="0%" stopColor="var(--wave-fill)" stopOpacity="0" />
          <stop offset="45%" stopColor="var(--wave-fill)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--wave-fill)" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {bands.map((b, bi) => {
        const r = ribbon(b, w);
        return (
          <g key={bi} opacity={b.opacity ?? 1} className={drift ? (bi % 2 ? "wave-drift-rev" : "wave-drift") : undefined}>
            <path d={r.area} fill={`url(#${id}f)`} />
            {b.glow !== false && <path d={r.mid} stroke="var(--wave-glow)" strokeOpacity="0.09" strokeWidth={26} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
            {r.lines.map((d, i) => (
              <path key={i} d={d} stroke={`url(#${id}s${b.tone})`} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeOpacity={(0.25 + 0.75 * Math.sin((Math.PI * (i + 0.5)) / b.lines)).toFixed(2)} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

const W = 1440;
const H = 900;

/** One composition per section so each page gets its own flow. */
const COMPOSITIONS: Record<string, Band[]> = {
  dashboard: [
    { y: 70, amp: 46, freq: 0.85, phase: 0.4, lines: 18, spread: 5, twist: 0.1, tilt: 70, tone: "a" },
    { y: 120, amp: 30, freq: 1.2, phase: 2.2, lines: 8, spread: 7, twist: 0.06, tilt: -40, tone: "c", opacity: 0.55, glow: false },
    { y: 720, amp: 70, freq: 0.7, phase: 2.6, lines: 16, spread: 6, twist: 0.12, tilt: -150, tone: "b" },
  ],
  sources: [
    { y: 110, amp: 60, freq: 0.6, phase: 1.3, lines: 16, spread: 6, twist: 0.14, tilt: -60, tone: "a" },
    { y: 780, amp: 55, freq: 0.9, phase: 0.2, lines: 12, spread: 7, twist: 0.08, tilt: -90, tone: "c", opacity: 0.8 },
  ],
  rules: [
    { y: 40, amp: 40, freq: 1.1, phase: 3.1, lines: 14, spread: 5, twist: 0.09, tilt: 120, tone: "b" },
    { y: 640, amp: 80, freq: 0.55, phase: 1.1, lines: 18, spread: 5, twist: 0.13, tilt: 120, tone: "a", opacity: 0.85 },
  ],
  runs: [
    { y: 90, amp: 55, freq: 0.75, phase: 4.2, lines: 16, spread: 6, twist: -0.11, tilt: 40, tone: "a" },
    { y: 760, amp: 45, freq: 1.3, phase: 0.8, lines: 10, spread: 8, twist: 0.07, tilt: -60, tone: "b", opacity: 0.75 },
  ],
  explorer: [
    { y: 150, amp: 35, freq: 1.4, phase: 0.6, lines: 12, spread: 6, twist: 0.06, tilt: -100, tone: "c" },
    { y: 820, amp: 65, freq: 0.6, phase: 2.9, lines: 16, spread: 5, twist: 0.12, tilt: -130, tone: "a", opacity: 0.85 },
  ],
  history: [
    { y: 60, amp: 70, freq: 0.5, phase: 5.1, lines: 18, spread: 5, twist: 0.1, tilt: 90, tone: "b" },
    { y: 700, amp: 40, freq: 1.0, phase: 1.7, lines: 12, spread: 7, twist: -0.08, tilt: 60, tone: "a", opacity: 0.7 },
  ],
  reports: [
    { y: 100, amp: 50, freq: 0.95, phase: 2.0, lines: 18, spread: 5, twist: 0.12, tilt: -30, tone: "a" },
    { y: 150, amp: 34, freq: 1.5, phase: 0.3, lines: 8, spread: 8, twist: 0.05, tilt: -30, tone: "c", opacity: 0.5, glow: false },
    { y: 760, amp: 60, freq: 0.8, phase: 4.0, lines: 14, spread: 6, twist: 0.1, tilt: -110, tone: "b", opacity: 0.85 },
  ],
  settings: [
    { y: 130, amp: 45, freq: 0.7, phase: 3.6, lines: 14, spread: 6, twist: 0.1, tilt: -50, tone: "c" },
    { y: 800, amp: 50, freq: 0.65, phase: 0.9, lines: 14, spread: 6, twist: 0.1, tilt: -80, tone: "a", opacity: 0.75 },
  ],
};

export function compositionFor(path: string) {
  if (path === "/") return "dashboard";
  const seg = path.split("/")[1];
  return seg in COMPOSITIONS ? seg : "dashboard";
}

/** Full-page wave layer, fixed behind all page content. */
export function PageWaves({ path }: { path: string }) {
  const key = compositionFor(path);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <WaveSvg key={key} bands={COMPOSITIONS[key]} w={W} h={H} drift className="wave-fade-in absolute -left-[4%] top-0 h-full w-[108%]" strokeWidth={1.1} />
    </div>
  );
}

const SIDEBAR_BANDS: Band[] = [
  { y: 120, amp: 26, freq: 0.9, phase: 0.5, lines: 12, spread: 4, twist: 0.12, tilt: -40, tone: "a" },
  { y: 170, amp: 18, freq: 1.4, phase: 2.4, lines: 7, spread: 5, twist: 0.08, tilt: -20, tone: "c", opacity: 0.6, glow: false },
];
export function SidebarWaves() {
  return <WaveSvg bands={SIDEBAR_BANDS} w={260} h={240} className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-60 w-full" />;
}

const HEADER_BANDS: Band[] = [
  { y: 30, amp: 12, freq: 1.2, phase: 1.1, lines: 9, spread: 2.4, twist: 0.12, tilt: 6, tone: "a", glow: false },
];
export function HeaderWaves() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(90deg,transparent_10%,black_55%,black_80%,transparent)]">
      <WaveSvg bands={HEADER_BANDS} w={1440} h={64} className="absolute inset-0 h-full w-full opacity-70" />
    </div>
  );
}
