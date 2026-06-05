/* mobile-kit.jsx — refined shared mobile chrome + the AI-hero vocabulary.
   Reuses Phone / MobileHeader from screen-mobile.jsx. Top-level fns are global. */

// ─── CopilotHero — the signature "AI front and center" block ─────────────────
// tone: 'dark' (ink bg, paper text — the big moment) | 'violet' (ai-soft inline nudge)
function CopilotHero({ kicker = 'Copilot', tone = 'dark', confidence, children, actions, foot }) {
  const dark = tone === 'dark';
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: dark ? 'var(--ink)' : 'var(--ai-soft)',
      color: dark ? 'var(--paper)' : 'var(--ink)',
      border: dark ? 'none' : '1px solid var(--ai-line)',
      borderRadius: 16, padding: '15px 17px 16px',
    }}>
      {/* faint spark wash */}
      <div style={{
        position: 'absolute', top: -40, right: -30, width: 150, height: 150,
        background: `radial-gradient(circle, ${dark ? 'rgba(179,156,224,0.18)' : 'rgba(74,44,143,0.07)'} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, position: 'relative' }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: dark ? 'var(--accent)' : 'var(--ai)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="spark" size={12} color="#fff" stroke={2.4} />
        </span>
        <span style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase',
          color: dark ? 'rgba(241,237,228,0.7)' : 'var(--ai)',
        }}>{kicker}</span>
        {confidence != null && (
          <span style={{
            marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
            color: dark ? 'rgba(241,237,228,0.6)' : 'var(--ai)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ready)' }} /> {confidence}% sure
          </span>
        )}
      </div>
      <p style={{
        margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400,
        fontSize: 19, lineHeight: 1.38, letterSpacing: -0.2, position: 'relative',
        color: dark ? 'var(--paper)' : 'var(--ink)',
      }}>{children}</p>
      {actions && <div style={{ display: 'flex', gap: 7, marginTop: 15, position: 'relative', flexWrap: 'wrap' }}>{actions}</div>}
      {foot && (
        <div style={{
          marginTop: 11, paddingTop: 10, position: 'relative',
          borderTop: `1px solid ${dark ? 'rgba(241,237,228,0.12)' : 'var(--ai-line)'}`,
          fontSize: 10.5, fontFamily: 'var(--font-mono)',
          color: dark ? 'rgba(241,237,228,0.5)' : 'var(--ink-3)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>{foot}</div>
      )}
    </div>
  );
}

// Button styled for use on a dark CopilotHero
function HeroBtn({ children, icon, primary, onDark = true }) {
  return (
    <button style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 36, padding: '0 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
      border: 'none', lineHeight: 1,
      background: primary ? 'var(--accent)' : (onDark ? 'rgba(255,255,255,0.1)' : 'var(--surface)'),
      color: primary ? '#fff' : (onDark ? 'var(--paper)' : 'var(--ink)'),
    }}>
      {icon && <Icon name={icon} size={14} stroke={2.2} />}
      {children}
    </button>
  );
}

// ─── Segmented filter chips ──────────────────────────────────────────────────
function Segmented({ items, scroll }) {
  return (
    <div style={{
      display: 'flex', gap: 6,
      overflowX: scroll ? 'auto' : 'visible',
      paddingBottom: scroll ? 2 : 0,
    }}>
      {items.map((it, i) => (
        <span key={i} style={{
          padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap',
          background: it.active ? 'var(--ink)' : 'var(--surface)',
          color: it.active ? 'var(--paper)' : 'var(--ink-2)',
          border: it.active ? '1px solid var(--ink)' : '1px solid var(--line)',
          fontSize: 12.5, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {it.l}
          {it.n != null && <Mono style={{ fontSize: 11, opacity: it.active ? 0.65 : 0.55, fontWeight: 700 }}>{it.n}</Mono>}
        </span>
      ))}
    </div>
  );
}

// ─── Role-aware bottom tab bar ───────────────────────────────────────────────
const ROLE_NAV = {
  housekeeper: [
    { k: 'home', l: 'Home', i: 'grid' },
    { k: 'rooms', l: 'My rooms', i: 'bed' },
    { k: 'copilot', l: 'Copilot', i: 'spark', special: true },
    { k: 'tasks', l: 'Tasks', i: 'check' },
    { k: 'me', l: 'Me', i: 'user' },
  ],
  inspector: [
    { k: 'home', l: 'Home', i: 'grid' },
    { k: 'inspect', l: 'Inspect', i: 'shield' },
    { k: 'copilot', l: 'Copilot', i: 'spark', special: true },
    { k: 'tasks', l: 'Tasks', i: 'check' },
    { k: 'me', l: 'Me', i: 'user' },
  ],
  engineer: [
    { k: 'home', l: 'Home', i: 'grid' },
    { k: 'orders', l: 'Orders', i: 'wrench' },
    { k: 'copilot', l: 'Copilot', i: 'spark', special: true },
    { k: 'assets', l: 'Assets', i: 'package' },
    { k: 'me', l: 'Me', i: 'user' },
  ],
};

function RoleTabBar({ role = 'housekeeper', active = 'home' }) {
  const items = ROLE_NAV[role];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'var(--surface)', borderTop: '1px solid var(--line)',
      paddingBottom: 16, paddingTop: 9,
      display: 'flex', justifyContent: 'space-around',
    }}>
      {items.map(it => {
        const on = active === it.k;
        if (it.special) return (
          <div key={it.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? 'var(--ai)' : 'var(--ink-3)', fontSize: 10, fontWeight: 500 }}>
            <span style={{
              width: 40, height: 40, borderRadius: '50%', background: 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-md)', marginTop: -18, border: '3px solid var(--surface)',
            }}>
              <Icon name="spark" size={17} color="var(--accent)" stroke={2.4} />
            </span>
            <span>{it.l}</span>
          </div>
        );
        return (
          <div key={it.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: on ? 'var(--accent)' : 'var(--ink-3)', fontSize: 10, fontWeight: 500 }}>
            <Icon name={it.i} size={20} stroke={on ? 2.2 : 1.7} />
            <span>{it.l}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Generic list row with leading tile / avatar ─────────────────────────────
function Row({ lead, title, sub, right, tone, onDim, accent }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid var(--${tone ? tone + '-line' : 'line'})`,
      borderLeft: accent ? `3px solid var(--${accent})` : undefined,
      borderRadius: 12, padding: '11px 13px',
      display: 'flex', alignItems: 'center', gap: 12,
      opacity: onDim ? 0.56 : 1,
    }}>
      {lead}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.35 }}>{sub}</div>}
      </div>
      {right && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// ─── Progress ring ───────────────────────────────────────────────────────────
function Ring({ value, total, size = 88, tone = 'accent', center }) {
  const r = (size - 14) / 2;
  const circ = r * 2 * Math.PI;
  const frac = total ? value / total : value / 100;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--${tone})`} strokeWidth="7"
          strokeDasharray={`${circ * frac} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {center}
      </div>
    </div>
  );
}

// ─── Bottom sheet scaffold (renders inside a Phone) ──────────────────────────
function Sheet({ kicker, kickerTone = 'accent', title, sub, children, footer, dimContent }) {
  return (
    <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 1, background: 'var(--paper)', padding: '16px 18px', opacity: 0.4, pointerEvents: 'none' }}>{dimContent}</div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,24,21,0.34)' }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'var(--surface)', borderRadius: '22px 22px 0 0',
        boxShadow: '0 -12px 40px rgba(26,24,21,0.2)',
        padding: '10px 20px 24px', display: 'flex', flexDirection: 'column', gap: 15, maxHeight: '90%',
      }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--line)', alignSelf: 'center' }} />
        <div>
          {kicker && <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: `var(--${kickerTone})` }}>{kicker}</div>}
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 26, lineHeight: 1.12, letterSpacing: -0.4 }}>{title}</h1>
          {sub && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{sub}</p>}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

// ─── Round icon button ───────────────────────────────────────────────────────
function IconBtn({ icon, tone, size = 36 }) {
  return (
    <button style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: tone ? `var(--${tone}-soft)` : 'var(--surface)',
      border: `1px solid var(--${tone ? tone + '-line' : 'line'})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: tone ? `var(--${tone})` : 'var(--ink-2)',
    }}>
      <Icon name={icon} size={size > 40 ? 18 : 16} stroke={1.9} />
    </button>
  );
}

Object.assign(window, { CopilotHero, HeroBtn, Segmented, RoleTabBar, Row, Ring, Sheet, IconBtn });
