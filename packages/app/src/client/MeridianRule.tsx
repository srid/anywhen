// The meridian rule: a 24-hour hairline with twelve hour-ticks, and a single
// accent dot at the current local time. The dot moves once per minute, never
// glows, never carries a number. It says "time passes; nothing is owed" —
// the eternalist UI's quietest gesture.
//
// Self-contained: owns the clock signal and the tick geometry. App.tsx renders
// it as a sibling to the brand colophon, the same way the meridian SVG used
// to live inline.

import { createSignal, For, onCleanup, onMount } from "solid-js";

// Minutes since local midnight, in [0, 1440). Drives the now-tick's x-offset
// along the rule.
const minutesSinceMidnight = (d: Date): number => d.getHours() * 60 + d.getMinutes();

// Granularity of the now-tick refresh. One minute is the unit the dot moves
// in; updating any faster would be invisible, slower would let the dot drift
// behind the wall clock long enough to notice.
const MINUTE_MS = 60_000;

// Twelve hour-ticks on the rule (every two hours over a 24-hour day) plus
// the closing tick at x=240. Module-scope: a time-invariant constant has no
// reactive identity and shouldn't be reallocated each render.
const TICK_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function MeridianRule() {
  const [now, setNow] = createSignal(new Date());
  onMount(() => {
    const t = setInterval(() => setNow(new Date()), MINUTE_MS);
    onCleanup(() => clearInterval(t));
  });
  // Rule spans x=0..240 over a 24-hour day; ticks every 2 hours; majors every
  // 6 hours (a quarter-day). The now-tick rides the same 0..240 axis.
  const nowX = () => (minutesSinceMidnight(now()) / 1440) * 240;
  return (
    <svg class="meridian" viewBox="0 0 240 12" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="6" x2="240" y2="6" stroke="currentColor" stroke-width="0.5" opacity="0.5" />
      <For each={TICK_POSITIONS}>
        {(i) => {
          const major = i % 3 === 0;
          return (
            <line
              x1={i * 20}
              x2={i * 20}
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
