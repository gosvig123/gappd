/**
 * Brand mark: an audio waveform with a deliberate gap at its centre — the
 * "gap" in gappd, and a nod to captured meeting audio / transcription. Set in
 * a macOS-style rounded tile filled with the brand accent gradient so it sits
 * naturally beside the dock icon and the rest of the calm dark UI. Drawn inline
 * so it stays crisp at any size; colours track theme tokens — see theme.css.
 */
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="gappd-tile" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5e9ce0" />
          <stop offset="1" stopColor="#4d87cf" />
        </linearGradient>
      </defs>
      {/* Rounded app tile */}
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#gappd-tile)" />
      {/* Top sheen — a whisper of light, matching --shell-glow */}
      <rect x="2" y="2" width="28" height="14" rx="8" fill="#ffffff" opacity="0.06" />
      {/* Waveform — tallest bars flank a central gap */}
      <g stroke="var(--color-accent-contrast)" strokeWidth="2" strokeLinecap="round">
        <path d="M8.7 13v6" />
        <path d="M11.2 11v10" />
        <path d="M13.7 9v14" />
        {/* gap */}
        <path d="M18.3 9v14" />
        <path d="M20.8 11v10" />
        <path d="M23.3 13v6" />
      </g>
    </svg>
  )
}
