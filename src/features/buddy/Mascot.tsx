import { useId } from "react";

import { withBasePath } from "@/lib/basePath";
import { cn } from "@/lib/utils";

/** What Chobi is up to, shown by its face, arms and antenna. */
export type ChobiMood = "idle" | "thinking" | "waiting" | "happy" | "alert" | "sleeping";

export const MOOD_LABELS: Record<ChobiMood, string> = {
  idle: "Chobi",
  thinking: "Chobi is working",
  waiting: "Chobi needs your answer",
  happy: "Chobi is done",
  alert: "Chobi has something for you",
  sleeping: "Chobi is resting",
};

interface MascotProps {
  mood: ChobiMood;
  /** Rendered size in pixels (square). */
  size?: number;
  /** Plain mode (an organization setting): the logo instead of the character. */
  plain?: boolean;
  /** No idle motion, for small repeated avatars such as chat messages. */
  still?: boolean;
  /** The pointer is on Chobi: it waves hello (only while idle, so a mood still reads). */
  greet?: boolean;
  className?: string;
}

// Arms rotate around their shoulder (the inner top corner of each side bar);
// CSS rotation is clockwise, so a raised left arm is positive, a raised right arm negative.
const ARM_ANGLES: Record<ChobiMood, { left: number; right: number }> = {
  idle: { left: 0, right: 0 },
  thinking: { left: 0, right: -38 },
  waiting: { left: 20, right: -20 },
  happy: { left: 28, right: -28 },
  alert: { left: 55, right: -55 },
  sleeping: { left: -10, right: 10 },
};

const STYLES = `
.chobi-blink { animation: chobi-blink 5s infinite; transform-origin: center; transform-box: fill-box; }
.chobi-bob { animation: chobi-bob 3.2s ease-in-out infinite; }
.chobi-pulse { animation: chobi-pulse 1.1s ease-in-out infinite; }
.chobi-wave { animation: chobi-wave 0.9s ease-in-out infinite; transform-box: fill-box; }
.chobi-arm { transition: transform 280ms cubic-bezier(.3,.7,.3,1.3); transform-box: fill-box; }
.chobi-z { animation: chobi-z 2.4s ease-in-out infinite; }
@keyframes chobi-blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(0.1); } }
@keyframes chobi-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1.2px); } }
@keyframes chobi-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes chobi-wave { 0%, 100% { rotate: 0deg; } 50% { rotate: -14deg; } }
@keyframes chobi-z { 0% { opacity: 0; transform: translate(0, 2px); } 40% { opacity: 1; } 100% { opacity: 0; transform: translate(3px, -4px); } }
.chobi-still .chobi-blink, .chobi-still .chobi-bob, .chobi-still .chobi-pulse, .chobi-still .chobi-wave, .chobi-still .chobi-z { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .chobi-blink, .chobi-bob, .chobi-pulse, .chobi-wave, .chobi-z { animation: none; }
  .chobi-arm { transition: none; }
}`;

/**
 * Chobi, the CHouse buddy (ADR 0025 §6): the logo's three bars as a chibi —
 * the tall middle bar is its head and body, the side bars its arms.
 */
export function Mascot({ mood, size = 48, plain = false, still = false, greet = false, className }: MascotProps): React.JSX.Element {
  const id = useId().replace(/:/g, "");
  if (plain) {
    return <img src={withBasePath("logo.svg")} alt="" width={size} height={size} className={className} draggable={false} />;
  }
  const waving = mood === "happy" || (greet && mood === "idle");
  const arms = waving ? ARM_ANGLES.happy : ARM_ANGLES[mood];
  const antenna = mood === "alert" ? "#ff6b4a" : mood === "waiting" ? "#7dd3fc" : mood === "thinking" ? "#fff6c2" : "#ffe680";
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("overflow-visible", still && "chobi-still", className)}
      data-mood={mood}
      aria-hidden
      focusable={false}
    >
      <style>{STYLES}</style>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFDD33" />
          <stop offset="100%" stopColor="#FF9900" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor={antenna} stopOpacity="0.9" />
          <stop offset="100%" stopColor={antenna} stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className={mood === "sleeping" ? undefined : "chobi-bob"}>
        {/* Left arm (the logo's short bar) */}
        <g className={cn("chobi-arm", waving && "chobi-wave")} style={{ transform: `rotate(${arms.left}deg)`, transformOrigin: "100% 0%" }}>
          <rect x="7" y="34" width="11" height="19" rx="4.5" fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity="0.25" />
        </g>
        {/* Right arm (the logo's middle-height bar) */}
        <g className="chobi-arm" style={{ transform: `rotate(${arms.right}deg)`, transformOrigin: "0% 0%" }}>
          <rect x="46" y="27" width="11" height="26" rx="4.5" fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity="0.25" />
        </g>

        {/* Antenna */}
        <line x1="32" y1="10" x2="32" y2="4" stroke="#FFB31A" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="32" cy="3.4" r="4.5" fill={`url(#${id}-glow)`} className={mood === "thinking" || mood === "alert" || mood === "waiting" ? "chobi-pulse" : undefined} />
        <circle cx="32" cy="3.4" r="1.9" fill={antenna} />

        {/* Head and body (the tall bar) */}
        <rect x="20" y="9" width="24" height="47" rx="8" fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity="0.3" />
        <rect x="23" y="12" width="5" height="16" rx="2.5" fill="#fff" fillOpacity="0.28" />

        <Face mood={mood} />

        {/* Blush */}
        <ellipse cx="24.2" cy="31.5" rx="2.4" ry="1.4" fill="#ff7a8a" fillOpacity="0.55" />
        <ellipse cx="39.8" cy="31.5" rx="2.4" ry="1.4" fill="#ff7a8a" fillOpacity="0.55" />

        {/* Feet */}
        <rect x="23" y="55" width="7" height="3" rx="1.5" fill="#E68A00" />
        <rect x="34" y="55" width="7" height="3" rx="1.5" fill="#E68A00" />
      </g>

      {mood === "sleeping" && (
        <text x="47" y="12" fontSize="8" fontWeight="700" fill="#cbd5e1" className="chobi-z">z</text>
      )}
    </svg>
  );
}

function Face({ mood }: { mood: ChobiMood }): React.JSX.Element {
  const ink = "#2a1d05";
  if (mood === "sleeping") {
    return (
      <g stroke={ink} strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M24.5 26.5 q2.7 1.8 5.4 0" />
        <path d="M34.1 26.5 q2.7 1.8 5.4 0" />
        <path d="M30.5 35 q1.5 0.8 3 0" />
      </g>
    );
  }
  if (mood === "happy") {
    return (
      <g stroke={ink} strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M24.5 27.5 q2.7 -3.2 5.4 0" />
        <path d="M34.1 27.5 q2.7 -3.2 5.4 0" />
        <path d="M28.5 34 q3.5 3.4 7 0" />
      </g>
    );
  }
  // Pupils look up while thinking, straight ahead otherwise; alert eyes are wide.
  const r = mood === "alert" ? 4.1 : 3.6;
  const look = mood === "thinking" ? -1.3 : 0.3;
  return (
    <g>
      <g className="chobi-blink">
        <ellipse cx="27.2" cy="26" rx={r - 0.4} ry={r} fill="#fff" />
        <ellipse cx="36.8" cy="26" rx={r - 0.4} ry={r} fill="#fff" />
        <circle cx="27.6" cy={26 + look} r="2.1" fill={ink} />
        <circle cx="37.2" cy={26 + look} r="2.1" fill={ink} />
        <circle cx="28.4" cy={25 + look} r="0.8" fill="#fff" />
        <circle cx="38" cy={25 + look} r="0.8" fill="#fff" />
      </g>
      {mood === "alert" ? (
        <ellipse cx="32" cy="35" rx="1.7" ry="2" fill={ink} />
      ) : mood === "waiting" ? (
        <path d="M29.5 35 h5" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <path d="M29.3 34 q2.7 2.2 5.4 0" stroke={ink} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      )}
    </g>
  );
}
