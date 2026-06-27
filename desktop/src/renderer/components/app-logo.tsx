/**
 * Brand mark: a meeting participant over a sound waveform, set in a solid
 * privacy shield. Drawn inline so it stays crisp at any size; the gradient
 * matches --gradient-accent and the inner marks use theme-light contrast +
 * the secure green — see theme.css.
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
        <linearGradient id="gappd-shield" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5e9ce0" />
          <stop offset="1" stopColor="#4d87cf" />
        </linearGradient>
      </defs>
      {/* Shield */}
      <path
        d="M16 2.5 26.5 6.2V15c0 7.2-4.6 11.6-10.5 13.8C10.1 26.6 5.5 22.2 5.5 15V6.2L16 2.5Z"
        fill="url(#gappd-shield)"
      />
      {/* Participant */}
      <circle cx="16" cy="11" r="2.6" fill="var(--color-accent-contrast)" />
      <path d="M11.8 19C11.8 14.5 20.2 14.5 20.2 19Z" fill="var(--color-accent-contrast)" />
      {/* Sound — live waveform, uneven bars */}
      <g stroke="var(--color-secure)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12.4 21.9v1.4" />
        <path d="M14 20.4v4.4" />
        <path d="M15.6 22.1v1" />
        <path d="M17.2 19.9v5.4" />
        <path d="M18.8 21.2v2.8" />
        <path d="M20.4 22.2v.8" />
      </g>
    </svg>
  )
}
