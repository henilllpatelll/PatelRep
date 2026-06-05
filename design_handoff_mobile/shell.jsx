/* App shell — sidebar, top bar, page header, AI copilot bubble */
const { useState } = React;

const SIDEBAR_GROUPS = [
  {
    label: 'Operations',
    items: [
      { key: 'dashboard',     label: 'Dashboard',      icon: 'grid', count: null },
      { key: 'housekeeping',  label: 'Housekeeping',   icon: 'bed', count: 12 },
      { key: 'engineering',   label: 'Engineering',    icon: 'wrench', count: 6 },
      { key: 'guest-requests',label: 'Guest Requests', icon: 'bell', count: 3, accent: true },
      { key: 'tasks',         label: 'Tasks',          icon: 'check', count: 18 },
      { key: 'logbook',       label: 'Logbook',        icon: 'doc' },
      { key: 'lost-found',    label: 'Lost & Found',   icon: 'package' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { key: 'ai-copilot',    label: 'AI Copilot',     icon: 'spark', tag: 'AI' },
      { key: 'predictions',   label: 'Predictions',    icon: 'trend' },
      { key: 'sop',           label: 'SOP Library',    icon: 'shield' },
      { key: 'reports',       label: 'Reports',        icon: 'list' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { key: 'staff',         label: 'Staff',          icon: 'users' },
      { key: 'scheduling',    label: 'Scheduling',     icon: 'cal' },
      { key: 'settings',      label: 'Settings',       icon: 'settings' },
    ],
  },
];

function Logo({ small }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <div style={{
        width: 28, height: 28,
        background: 'var(--ink)',
        borderRadius: 7,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.1)',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 21V8l8-5 8 5v13" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9 21v-6h6v6" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!small && (
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2, color: 'var(--ink)' }}>PatelRep</div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>v2 · Lone Star Inn</div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ icon, label, count, active, accent, tag }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px',
      borderRadius: 8,
      background: active ? 'var(--surface)' : 'transparent',
      color: active ? 'var(--ink)' : 'var(--ink-2)',
      boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
      fontSize: 13, fontWeight: active ? 500 : 400,
      position: 'relative',
      cursor: 'pointer',
    }}>
      {active && (
        <span style={{
          position: 'absolute', left: -10, top: 8, bottom: 8, width: 3,
          background: 'var(--accent)', borderRadius: 2,
        }} />
      )}
      <Icon name={icon} size={15} color={active ? 'var(--accent)' : 'var(--ink-3)'} />
      <span style={{ flex: 1 }}>{label}</span>
      {tag && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--ai)', letterSpacing: 0.5,
          background: 'var(--ai-soft)', padding: '1px 5px', borderRadius: 3,
          border: '1px solid var(--ai-line)',
        }}>{tag}</span>
      )}
      {count != null && (
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          color: accent ? 'var(--accent)' : 'var(--ink-3)',
          background: accent ? 'var(--accent-soft)' : 'transparent',
          border: accent ? '1px solid var(--accent-line)' : 'none',
          padding: accent ? '1px 6px' : '0',
          borderRadius: 999, minWidth: 16, textAlign: 'center',
        }}>{count}</span>
      )}
    </div>
  );
}

function Sidebar({ active = 'dashboard', width = 232 }) {
  return (
    <aside style={{
      width, flexShrink: 0,
      background: 'var(--paper)',
      borderRight: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      padding: '14px 14px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <Logo />
        <button style={{
          background: 'transparent', border: 'none', padding: 4,
          color: 'var(--ink-3)', borderRadius: 6,
        }}>
          <Icon name="menu" size={14} />
        </button>
      </div>

      {/* Hotel switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10, padding: '8px 10px', marginBottom: 16,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          background: 'linear-gradient(135deg, var(--accent), #8b2f0f)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)',
        }}>L</div>
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Lone Star Inn</div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>87 rooms · Austin</div>
        </div>
        <Icon name="chevronD" size={12} color="var(--ink-3)" />
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        {SIDEBAR_GROUPS.map((g) => (
          <div key={g.label}>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.2,
              color: 'var(--ink-4)', padding: '4px 10px', marginBottom: 2,
            }}>{g.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {g.items.map((it) => (
                <SidebarItem key={it.key} {...it} active={active === it.key} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom: user */}
      <div style={{
        marginTop: 12, paddingTop: 12,
        borderTop: '1px solid var(--line-2)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <Avatar name="Mia Patel" size={28} />
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Mia Patel</div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>Supervisor</div>
        </div>
        <Icon name="logout" size={13} color="var(--ink-3)" />
      </div>
    </aside>
  );
}

function Avatar({ name, size = 32, src }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  // Deterministic warm palette
  const palettes = [
    ['#c2410c', '#fff'],
    ['#0c6e63', '#fff'],
    ['#a16207', '#fff'],
    ['#265d8a', '#fff'],
    ['#7d2855', '#fff'],
    ['#4a2c8f', '#fff'],
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = palettes[hash % palettes.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, letterSpacing: 0.3,
      flexShrink: 0,
    }}>{initials}</div>
  );
}

function TopBar({ title, breadcrumb, actions, search = 'Search rooms, work orders, guests…', kbd }) {
  return (
    <header style={{
      height: 56, borderBottom: '1px solid var(--line)',
      background: 'var(--paper)',
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '0 20px', flexShrink: 0,
    }}>
      {/* Search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 9, padding: '7px 11px', minWidth: 380, flex: '0 1 480px',
      }}>
        <Icon name="search" size={14} color="var(--ink-3)" />
        <span style={{ fontSize: 13, color: 'var(--ink-3)', flex: 1 }}>{search}</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)',
          background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 4,
          border: '1px solid var(--line)',
        }}>⌘K</span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Date pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, color: 'var(--ink-2)',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ready)' }} />
        <span style={{ fontFamily: 'var(--font-mono)' }}>Tue, May 26 · Day shift</span>
      </div>

      <span style={{ width: 1, height: 22, background: 'var(--line)' }} />

      {/* AI copilot trigger */}
      <button style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'var(--ai-soft)', color: 'var(--ai)',
        border: '1px solid var(--ai-line)',
        padding: '5px 10px', height: 32, borderRadius: 8,
        fontSize: 12, fontWeight: 500,
      }}>
        <Icon name="spark" size={13} stroke={2} />
        Ask copilot
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7,
          marginLeft: 4,
        }}>⌘J</span>
      </button>

      {/* Bell */}
      <button style={{
        position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)',
        width: 32, height: 32, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)',
      }}>
        <Icon name="bell" size={14} />
        <span style={{
          position: 'absolute', top: -3, right: -3,
          width: 14, height: 14, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid var(--paper)',
        }}>3</span>
      </button>
    </header>
  );
}

function PageHeader({ eyebrow, title, subtitle, meta, actions, tabs }) {
  return (
    <div style={{
      padding: '24px 32px 0',
      borderBottom: tabs ? 'none' : '1px solid var(--line-2)',
      background: 'var(--paper)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.2,
              color: 'var(--ink-3)', marginBottom: 8,
            }}>{eyebrow}</div>
          )}
          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 34, lineHeight: 1.1, letterSpacing: -0.5,
            color: 'var(--ink)',
          }}>{title}</h1>
          {subtitle && (
            <p style={{
              margin: '8px 0 0', fontSize: 14, color: 'var(--ink-2)',
              maxWidth: 640, lineHeight: 1.45,
            }}>{subtitle}</p>
          )}
          {meta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
            {actions}
          </div>
        )}
      </div>
      {tabs && (
        <div style={{
          display: 'flex', gap: 0, marginTop: 18,
          borderBottom: '1px solid var(--line)',
        }}>
          {tabs.map((t, i) => (
            <div key={i} style={{
              padding: '10px 14px',
              fontSize: 13, fontWeight: t.active ? 600 : 500,
              color: t.active ? 'var(--ink)' : 'var(--ink-3)',
              borderBottom: t.active ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7,
              cursor: 'pointer',
            }}>
              {t.label}
              {t.count != null && (
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  background: t.active ? 'var(--accent-soft)' : 'var(--surface-3)',
                  color: t.active ? 'var(--accent)' : 'var(--ink-3)',
                  padding: '1px 6px', borderRadius: 999,
                }}>{t.count}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// AI Copilot bubble — floating bottom right
function CopilotBubble({ expanded = false }) {
  if (!expanded) {
    return (
      <div style={{
        position: 'absolute', bottom: 22, right: 22,
        background: 'var(--ink)', color: 'var(--paper)',
        borderRadius: 999, padding: '10px 14px 10px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: 'var(--shadow-pop)', cursor: 'pointer',
        fontSize: 13, fontWeight: 500,
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="spark" size={12} color="#fff" stroke={2.4} />
        </span>
        Copilot
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6,
          background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 4,
        }}>⌘J</span>
      </div>
    );
  }
  return (
    <div style={{
      position: 'absolute', bottom: 22, right: 22, width: 360,
      background: 'var(--surface)', borderRadius: 'var(--r-lg)',
      border: '1px solid var(--line)',
      boxShadow: 'var(--shadow-pop)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px',
        background: 'var(--ink)', color: 'var(--paper)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="spark" size={12} color="#fff" stroke={2.4} />
        </span>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Copilot</div>
        <Icon name="x" size={14} color="var(--ink-4)" />
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>3 things you may want to do now</div>
        {[
          { i: 'alert', l: 'Reassign Room 312 — housekeeper running 20 min over', a: 'Reassign' },
          { i: 'wrench', l: 'Open WO for AC complaint in 207 (3rd this week)', a: 'Create' },
          { i: 'spark', l: 'Approve SOP refresh for ice machine descale', a: 'Review' },
        ].map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 9,
            background: 'var(--surface-2)', border: '1px solid var(--line-2)',
            borderRadius: 9, padding: '9px 11px',
          }}>
            <Icon name={s.i} size={13} color="var(--ai)" style={{ marginTop: 1 }} />
            <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{s.l}</div>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>{s.a} →</span>
          </div>
        ))}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px',
          marginTop: 4,
        }}>
          <Icon name="message" size={13} color="var(--ink-3)" />
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)', flex: 1 }}>Ask anything…</span>
          <Icon name="send" size={12} color="var(--accent)" />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, TopBar, PageHeader, Avatar, Logo, CopilotBubble });
