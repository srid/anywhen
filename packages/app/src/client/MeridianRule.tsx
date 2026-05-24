// The meridian rule: a 24-hour hairline with twelve hour-ticks, and a single
// accent dot at the current local time. The dot moves once per minute, never
// glows, never carries a number. It says "time passes; nothing is owed" —
// the eternalist UI's quietest gesture.
//
// Self-contained: owns the clock signal and the tick geometry. App.tsx renders
// it as a sibling to the brand colophon, the same way the meridian SVG used
// to live inline.

import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 1440; // 60 × 24

// Returns minutes elapsed since local midnight — the dividend in the nowX
// formula. Range: [0, MINUTES_PER_DAY).
const minutesSinceMidnight = (d: Date): number => d.getHours() * 60 + d.getMinutes();

// SVG canvas width in user units. Appears in the viewBox, the baseline x2,
// and the nowX formula — defined once so a resize touches one line.
const SVG_W = 240;

// SVG x-distance between hour-ticks. 12 intervals span SVG_W (one per 2 h).
const TICK_STEP = SVG_W / 12;

// Thirteen tick indices (0..12). Each renders at x = i × TICK_STEP.
// Module-scope: time-invariant constant, no reactive identity.
const TICK_POSITIONS = Array.from({ length: 13 }, (_, i) => i);

export function MeridianRule() {
  const [now, setNow] = createSignal(new Date());
  onMount(() => {
    const t = setInterval(() => setNow(new Date()), MINUTE_MS);
    onCleanup(() => clearInterval(t));
  });
  // nowX maps minutes-since-midnight onto the SVG_W axis. Memoized so the
  // two circles that share cx={nowX()} compute it once per minute tick.
  const nowX = createMemo(() => (minutesSinceMidnight(now()) / MINUTES_PER_DAY) * SVG_W);
  return (
    <svg class="meridian" viewBox={`0 0 ${SVG_W} 12`} preserveAspectRatio="none" aria-hidden="true">
      <line
        x1="0"
        y1="6"
        x2={SVG_W}
        y2="6"
        stroke="currentColor"
        stroke-width="0.5"
        opacity="0.5"
      />
      <For each={TICK_POSITIONS}>
        {(i) => {
          // Major ticks every 3 positions = every 6 hours (each tick = 2 h).
          const major = i % 3 === 0;
          return (
            <line
              x1={i * TICK_STEP}
              x2={i * TICK_STEP}
              y1={major ? 2 : 4}
              y2={major ? 10 : 8}
              stroke="currentColor"
              stroke-width={major ? 0.8 : 0.5}
              opacity={major ? 0.7 : 0.4}
            />
          );
        }}
      </For>
      <circle data-testid="meridian-now-tick" cx={nowX()} cy="6" r="2.2" fill="var(--accent)" />
      <circle
        cx={nowX()}
        cy="6"
        r="4.5"
        fill="none"
        stroke="var(--accent)"
        stroke-width="0.6"
        opacity="0.32"
      />
    </svg>
  );
}
