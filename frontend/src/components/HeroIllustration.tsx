// Original isometric hero illustration — a small "market district": a
// central tower with a floating watchlist panel, flanking monitors running
// candlestick charts, a mobile device, and connecting roads/data-lines.
// Built as inline SVG (no external asset) in the app's own Groww-style
// teal/green palette, via the CSS custom properties so it reflows with
// light/dark theme automatically.
export function HeroIllustration() {
  return (
    <svg viewBox="0 0 760 460" className="mx-auto w-full max-w-[760px]" role="img" aria-label="Isometric illustration of a market watchlist dashboard">
      <defs>
        <linearGradient id="tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="road" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--line-2)" />
          <stop offset="100%" stopColor="var(--line)" />
        </linearGradient>
      </defs>

      {/* road loop */}
      <path d="M60 300 L220 220 L380 300 L540 220 L700 300" stroke="url(#road)" strokeWidth="34" strokeLinecap="round" fill="none" opacity="0.35" />
      <path d="M60 300 L220 220 L380 300 L540 220 L700 300" stroke="var(--surface)" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" fill="none" opacity="0.7" />

      {/* left monitor with candles */}
      <g transform="translate(120,250)">
        <rect x="0" y="0" width="120" height="78" rx="8" fill="var(--surface-2)" stroke="var(--line-2)" />
        <rect x="10" y="10" width="100" height="46" rx="4" fill="var(--ground-2)" />
        {[18, 34, 50, 66, 82, 98].map((x, i) => (
          <rect key={x} x={x} y={18 + (i % 3) * 6} width="6" height={22 - (i % 3) * 6} fill={i % 2 ? "var(--red)" : "var(--green)"} rx="1.5" />
        ))}
        <rect x="50" y="78" width="20" height="14" fill="var(--line-2)" />
      </g>

      {/* right monitor with line chart */}
      <g transform="translate(560,235)">
        <rect x="0" y="0" width="120" height="78" rx="8" fill="var(--surface-2)" stroke="var(--line-2)" />
        <polyline points="10,50 30,38 50,44 70,20 90,28 108,12" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="50" y="78" width="20" height="14" fill="var(--line-2)" />
      </g>

      {/* central tower */}
      <g transform="translate(300,110)">
        <polygon points="80,0 160,40 160,180 80,220 0,180 0,40" fill="url(#tower)" stroke="var(--accent)" strokeOpacity="0.5" />
        <polygon points="80,0 160,40 80,80 0,40" fill="var(--surface)" fillOpacity="0.18" />
        {[0, 1, 2, 3].map((row) => (
          <g key={row}>
            <rect x={16} y={52 + row * 30} width="30" height="18" rx="2" fill="var(--surface)" fillOpacity="0.85" />
            <rect x={94} y={52 + row * 30} width="30" height="18" rx="2" fill="var(--surface)" fillOpacity="0.6" />
          </g>
        ))}
      </g>

      {/* floating watchlist panel above the tower */}
      <g transform="translate(295,20)">
        <rect x="0" y="0" width="170" height="92" rx="12" fill="var(--surface)" stroke="var(--line-2)" style={{ filter: "drop-shadow(0 18px 30px rgba(0,0,0,.18))" }} />
        <rect x="14" y="12" width="70" height="9" rx="3" fill="var(--muted)" opacity="0.5" />
        {["AAPL", "NVDA", "TSLA"].map((sym, i) => (
          <g key={sym} transform={`translate(14, ${30 + i * 20})`}>
            <rect width="8" height="8" rx="2" fill="var(--accent)" />
            <rect x="14" y="0" width="46" height="8" rx="2" fill="var(--ink-2)" opacity="0.55" />
            <rect x="120" y="0" width="34" height="8" rx="2" fill={i === 1 ? "var(--red)" : "var(--green)"} />
          </g>
        ))}
      </g>

      {/* comm towers */}
      <g stroke="var(--muted)" strokeWidth="2" opacity="0.55">
        <line x1="160" y1="150" x2="160" y2="90" />
        <line x1="140" y1="110" x2="180" y2="110" />
        <line x1="145" y1="130" x2="175" y2="130" />
        <circle cx="160" cy="86" r="3" fill="var(--accent)" stroke="none" />
      </g>

      {/* mobile device, bottom right of tower */}
      <g transform="translate(430,260)">
        <rect x="0" y="0" width="44" height="70" rx="7" fill="var(--surface-2)" stroke="var(--line-2)" />
        <rect x="6" y="8" width="32" height="46" rx="2" fill="var(--ground-2)" />
        <polyline points="10,40 16,32 22,36 28,22 34,26" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* small car on the road */}
      <g transform="translate(250,290)">
        <rect x="0" y="4" width="34" height="14" rx="5" fill="var(--surface)" stroke="var(--line-2)" />
        <circle cx="8" cy="18" r="4" fill="var(--muted)" />
        <circle cx="26" cy="18" r="4" fill="var(--muted)" />
      </g>

      {/* motion lines */}
      <g stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round">
        <line x1="40" y1="180" x2="110" y2="150" />
        <line x1="30" y1="200" x2="100" y2="170" />
        <line x1="650" y1="150" x2="720" y2="120" />
        <line x1="640" y1="170" x2="710" y2="140" />
      </g>

      {/* small standing figures for scale */}
      <g fill="var(--ink-2)" opacity="0.7">
        <g transform="translate(175,320)"><circle cx="0" cy="0" r="6" /><rect x="-5" y="6" width="10" height="18" rx="4" /></g>
        <g transform="translate(600,300)"><circle cx="0" cy="0" r="6" /><rect x="-5" y="6" width="10" height="18" rx="4" /></g>
      </g>
    </svg>
  );
}
