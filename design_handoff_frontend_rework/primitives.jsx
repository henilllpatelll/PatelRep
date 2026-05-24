/* Shared UI primitives for PatelRep mocks */

const { useState, useEffect, useRef, useMemo } = React;

// ─── Icon library (line-based, 16px default) ────────────────────────────────
const ICONS = {
  bed: 'M3 17v-5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5M3 17h18M3 17v3M21 17v3M6 9V7a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2',
  wrench: 'M14.7 6.3a4 4 0 1 0-5.4 5.4l-6 6a2 2 0 0 0 2.8 2.8l6-6a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.4-2.4 2.4-2.4z',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.8 2.8M15.2 15.2 18 18M6 18l2.8-2.8M15.2 8.8 18 6',
  check: 'M5 12l4 4 10-10',
  alert: 'M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  plus: 'M12 5v14M5 12h14',
  arrowR: 'M5 12h14M13 5l7 7-7 7',
  arrowD: 'M19 12l-7 7-7-7M12 5v14',
  chevronR: 'M9 18l6-6-6-6',
  chevronD: 'M6 9l6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  menu: 'M3 12h18M3 6h18M3 18h18',
  building: 'M3 21h18M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16',
  trend: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  trendDown: 'M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6',
  drop: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3M15.5 7.5l-3 3',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15',
  mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z',
  cal: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  settings: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  battery: 'M22 11v2M17 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  thermometer: 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

function Icon({ name, size = 16, stroke = 1.6, color = "currentColor", style }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      {d.split('M').filter(Boolean).map((seg, i) => (
        <path key={i} d={'M' + seg.trim()} />
      ))}
    </svg>
  );
}

// ─── Generic primitives ──────────────────────────────────────────────────────
function Pill({ children, tone = 'neutral', size = 'md', icon, style }) {
  const tones = {
    neutral:  { bg: 'var(--surface-3)', fg: 'var(--ink-2)', bd: 'var(--line)' },
    dirty:    { bg: 'var(--alert-soft)', fg: 'var(--alert)', bd: 'var(--alert-line)' },
    progress: { bg: 'var(--alert-soft)', fg: 'var(--alert)', bd: 'var(--alert-line)', striped: true },
    clean:    { bg: 'var(--info-soft)', fg: 'var(--info)', bd: 'var(--info-line)' },
    ready:    { bg: 'var(--ready-soft)', fg: 'var(--ready)', bd: 'var(--ready-line)' },
    ooo:      { bg: 'var(--surface-3)', fg: 'var(--ink-3)', bd: 'var(--line)' },
    pickup:   { bg: 'var(--caution-soft)', fg: 'var(--caution)', bd: 'var(--caution-line)' },
    accent:   { bg: 'var(--accent-soft)', fg: 'var(--accent)', bd: 'var(--accent-line)' },
    ai:       { bg: 'var(--ai-soft)', fg: 'var(--ai)', bd: 'var(--ai-line)' },
    alert:    { bg: 'var(--alert-soft)', fg: 'var(--alert)', bd: 'var(--alert-line)' },
    caution:  { bg: 'var(--caution-soft)', fg: 'var(--caution)', bd: 'var(--caution-line)' },
    info:     { bg: 'var(--info-soft)', fg: 'var(--info)', bd: 'var(--info-line)' },
  };
  const t = tones[tone] || tones.neutral;
  const sz = {
    sm: { padding: '2px 7px', fontSize: 10.5, lineHeight: '14px', borderRadius: 999 },
    md: { padding: '3px 9px', fontSize: 11.5, lineHeight: '16px', borderRadius: 999 },
    lg: { padding: '5px 11px', fontSize: 12.5, lineHeight: '18px', borderRadius: 999 },
  }[size];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: t.striped
        ? `repeating-linear-gradient(135deg, ${t.bg.replace('var(--alert-soft)', 'var(--alert-soft)')} 0 5px, color-mix(in oklab, var(--alert) 22%, var(--surface)) 5px 10px)`
        : t.bg,
      color: t.fg,
      border: `1px solid ${t.bd}`,
      fontWeight: 500, letterSpacing: 0.02,
      whiteSpace: 'nowrap',
      ...sz, ...style,
    }}>
      {icon && <Icon name={icon} size={size === 'sm' ? 10 : 11} stroke={2} />}
      {children}
    </span>
  );
}

function StatusDot({ tone = 'neutral', size = 8 }) {
  const colors = {
    neutral: 'var(--ink-3)',
    dirty: 'var(--alert)',
    progress: 'var(--alert)',
    clean: 'var(--info)',
    ready: 'var(--ready)',
    ooo: 'var(--ink-4)',
    pickup: 'var(--caution)',
    accent: 'var(--accent)',
    ai: 'var(--ai)',
  };
  return <span style={{
    display: 'inline-block', width: size, height: size,
    borderRadius: '50%', background: colors[tone],
  }} />;
}

function Btn({ children, variant = 'secondary', size = 'md', icon, iconRight, full, style, onClick }) {
  const variants = {
    primary:   { bg: 'var(--accent)', fg: 'var(--accent-ink)', bd: 'var(--accent)' },
    secondary: { bg: 'var(--surface)', fg: 'var(--ink)', bd: 'var(--line)' },
    ghost:     { bg: 'transparent', fg: 'var(--ink-2)', bd: 'transparent' },
    dark:      { bg: 'var(--ink)', fg: 'var(--paper)', bd: 'var(--ink)' },
    outline:   { bg: 'transparent', fg: 'var(--ink)', bd: 'var(--line)' },
    ai:        { bg: 'var(--ai-soft)', fg: 'var(--ai)', bd: 'var(--ai-line)' },
  };
  const sizes = {
    sm: { padding: '5px 10px', fontSize: 12, height: 28, borderRadius: 7, iconSize: 13 },
    md: { padding: '7px 12px', fontSize: 13, height: 34, borderRadius: 8, iconSize: 14 },
    lg: { padding: '10px 16px', fontSize: 14, height: 42, borderRadius: 10, iconSize: 16 },
  };
  const v = variants[variant];
  const s = sizes[size];
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: 6, width: full ? '100%' : undefined,
      background: v.bg, color: v.fg, border: `1px solid ${v.bd}`,
      padding: s.padding, fontSize: s.fontSize, height: s.height, borderRadius: s.borderRadius,
      fontWeight: 500, lineHeight: 1, letterSpacing: 0.01,
      ...style,
    }}>
      {icon && <Icon name={icon} size={s.iconSize} stroke={2} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.iconSize} stroke={2} />}
    </button>
  );
}

function Card({ children, style, padding = 16, hover, accent, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      padding,
      boxShadow: 'var(--shadow-sm)',
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      ...style,
    }}>
      {children}
    </div>
  );
}

// Small header section used widely
function SectionLabel({ children, hint, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.1, color: 'var(--ink-3)' }}>
          {children}
        </span>
        {hint && <span style={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{hint}</span>}
      </div>
      {action}
    </div>
  );
}

// AI label — small violet badge with spark glyph
function AILabel({ children = 'AI', confidence }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--ai-soft)', color: 'var(--ai)',
      border: '1px solid var(--ai-line)',
      fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      padding: '2px 6px 2px 5px', borderRadius: 4,
    }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg>
      {children}
      {confidence != null && <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, opacity: 0.7 }}>{confidence}%</span>}
    </span>
  );
}

// Mono number/code label
function Mono({ children, style }) {
  return <span style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: '"tnum"', ...style }}>{children}</span>;
}

// Bar — small progress
function Bar({ value, max = 100, tone = 'accent', height = 4 }) {
  const colors = {
    accent: 'var(--accent)',
    ready: 'var(--ready)',
    caution: 'var(--caution)',
    alert: 'var(--alert)',
    info: 'var(--info)',
    ai: 'var(--ai)',
  };
  return (
    <div style={{
      height, background: 'var(--surface-3)',
      borderRadius: height / 2, overflow: 'hidden', width: '100%',
    }}>
      <div style={{
        height: '100%', width: `${Math.min(100, (value / max) * 100)}%`,
        background: colors[tone],
        borderRadius: height / 2,
      }} />
    </div>
  );
}

// Spark-style stat tile
function Stat({ label, value, unit, delta, deltaTone = 'ready', icon, hint }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)', padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 96,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-3)' }}>
          {label}
        </span>
        {icon && <Icon name={icon} size={14} color="var(--ink-4)" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1, color: 'var(--ink)', fontWeight: 400 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{unit}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        {delta && (
          <Pill tone={deltaTone} size="sm" icon={deltaTone === 'alert' || deltaTone === 'caution' ? 'trendDown' : 'trend'}>
            {delta}
          </Pill>
        )}
        {hint && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</span>}
      </div>
    </div>
  );
}

// Make available
// ─── Status tint helper (used everywhere a room number appears) ─────────────
const ROOM_TONES = {
  dirty:     { bg: 'var(--alert-soft)',   bd: 'var(--alert-line)',   fg: 'var(--alert)' },
  progress:  { bg: 'var(--alert-soft)',   bd: 'var(--alert-line)',   fg: 'var(--alert)', striped: true },
  clean:     { bg: 'var(--info-soft)',    bd: 'var(--info-line)',    fg: 'var(--info)' },
  inspected: { bg: 'var(--ready-soft)',   bd: 'var(--ready-line)',   fg: 'var(--ready)' },
  pickup:    { bg: 'var(--caution-soft)', bd: 'var(--caution-line)', fg: 'var(--caution)' },
  ooo:       { bg: 'var(--surface-3)',    bd: 'var(--line)',         fg: 'var(--ink-3)' },
};

function roomTone(status) { return ROOM_TONES[status] || ROOM_TONES.inspected; }
function roomBg(tone) {
  return tone.striped
    ? 'repeating-linear-gradient(135deg, var(--alert-soft) 0 6px, color-mix(in oklab, var(--alert) 20%, var(--surface)) 6px 12px)'
    : tone.bg;
}

// Small square tile that shows a room number tinted by its status.
function RoomNumberTile({ num, status = 'inspected', size = 44, showDot = true, radius }) {
  const tone = roomTone(status);
  return (
    <div style={{
      width: size, height: size,
      borderRadius: radius != null ? radius : (size >= 40 ? 10 : 8),
      background: roomBg(tone),
      border: `1px solid ${tone.bd}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 1, flexShrink: 0,
    }}>
      <Mono style={{ fontSize: size >= 40 ? 14 : 13, fontWeight: 600, color: 'var(--ink)' }}>{num}</Mono>
      {showDot && <StatusDot tone={status === 'inspected' ? 'ready' : status} size={5} />}
    </div>
  );
}

Object.assign(window, {
  Icon, Pill, StatusDot, Btn, Card, SectionLabel, AILabel, Mono, Bar, Stat,
  ROOM_TONES, roomTone, roomBg, RoomNumberTile,
});
