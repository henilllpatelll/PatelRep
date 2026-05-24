/* Mobile screens — floor-staff focused. Each renders inside a 390-width phone frame. */

// ─── Phone frame (no real device, just web mobile chrome) ────────────────────
function Phone({ children, label, height = 780, statusbarTheme = 'light' }) {
  const dark = statusbarTheme === 'dark';
  return (
    <div style={{
      width: 390, height,
      background: dark ? '#0f0e0c' : 'var(--paper)',
      borderRadius: 38, overflow: 'hidden',
      boxShadow: '0 20px 50px rgba(26,24,21,0.18), 0 4px 12px rgba(26,24,21,0.08), 0 0 0 1px var(--line)',
      border: '8px solid #1a1815',
      position: 'relative',
    }}>
      {/* Status bar */}
      <div style={{
        height: 44, padding: '0 24px 0 30px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: dark ? '#fff' : 'var(--ink)',
        fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)',
      }}>
        <span>9:42</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><path d="M1 7h2v3H1zm4-2h2v5H5zm4-2h2v7H9zm4-2h2v9h-2z"/></svg>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 5a6 6 0 0 1 12 0M3 7a3 3 0 0 1 8 0M6.5 9a.5.5 0 0 1 1 0"/></svg>
          <svg width="22" height="11" viewBox="0 0 22 11" fill="none"><rect x="0.5" y="0.5" width="18" height="10" rx="2" stroke="currentColor"/><rect x="2" y="2" width="14" height="7" rx="1" fill="currentColor"/><rect x="19" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor"/></svg>
        </div>
      </div>
      {children}
      {/* Home indicator */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        width: 130, height: 4, borderRadius: 2,
        background: dark ? 'rgba(255,255,255,0.4)' : 'rgba(26,24,21,0.3)',
      }} />
    </div>
  );
}

function MobileHeader({ title, sub, left, right, big }) {
  return (
    <div style={{
      padding: big ? '8px 18px 18px' : '8px 18px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--paper)',
      borderBottom: '1px solid var(--line-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {left || <div style={{ width: 32 }} />}
        <div style={{ flex: 1, textAlign: left ? 'left' : 'center' }}>
          {!big && <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>}
          {!big && sub && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
        </div>
        {right || <div style={{ width: 32 }} />}
      </div>
      {big && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-3)', marginBottom: 4 }}>{sub}</div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 30, lineHeight: 1.1, letterSpacing: -0.4, color: 'var(--ink)',
          }}>{title}</h1>
        </div>
      )}
    </div>
  );
}

function MobileTabBar({ active = 'rooms' }) {
  const items = [
    { k: 'home', l: 'Home', i: 'grid' },
    { k: 'rooms', l: 'My rooms', i: 'bed' },
    { k: 'tasks', l: 'Tasks', i: 'check' },
    { k: 'copilot', l: 'Copilot', i: 'spark', special: true },
    { k: 'me', l: 'Me', i: 'user' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'var(--surface)',
      borderTop: '1px solid var(--line)',
      paddingBottom: 16, paddingTop: 8,
      display: 'flex', justifyContent: 'space-around',
    }}>
      {items.map(it => (
        <div key={it.k} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          color: active === it.k ? (it.special ? 'var(--ai)' : 'var(--accent)') : 'var(--ink-3)',
          fontSize: 10, fontWeight: 500,
        }}>
          {it.special ? (
            <span style={{
              width: 38, height: 38, borderRadius: '50%',
              background: 'var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--shadow-md)', marginTop: -16,
              border: '3px solid var(--surface)',
            }}>
              <Icon name="spark" size={16} color="var(--accent)" stroke={2.4} />
            </span>
          ) : (
            <Icon name={it.i} size={20} stroke={active === it.k ? 2.2 : 1.7} />
          )}
          <span>{it.l}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Mobile screens ──────────────────────────────────────────────────────────
function MobileLogin() {
  return (
    <Phone height={780} label="Login">
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', padding: 24, gap: 22,
        position: 'relative', height: 'calc(100% - 44px)',
      }}>
        <Logo />
        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Sign in</div>
          <h1 style={{
            margin: '10px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 32, lineHeight: 1.1, letterSpacing: -0.5,
          }}>Welcome back.</h1>
          <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Sign in to start your shift.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
          <Input label="Email" value="maria@lonestarinn.com" icon="mail" />
          <Input label="Password" value="••••••••" icon="key" type="password" />
        </div>
        <Btn variant="dark" size="lg" full iconRight="arrowR">Sign in</Btn>
        <Btn variant="outline" size="lg" full icon="phone">Sign in with phone</Btn>
        <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
          New to PatelRep? <a href="#" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Get the invite link</a>
        </div>
      </div>
    </Phone>
  );
}

function MobileHome() {
  return (
    <Phone height={780} label="Housekeeper Home">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          big
          sub="Tue · May 26 · Day shift"
          title="Hi Maria — 7 to go."
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Stat ring */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ position: 'relative', width: 88, height: 88 }}>
              <svg width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="36" fill="none" stroke="var(--surface-3)" strokeWidth="7" />
                <circle cx="44" cy="44" r="36" fill="none" stroke="var(--accent)" strokeWidth="7"
                  strokeDasharray={`${36 * 2 * Math.PI * 5 / 12} ${36 * 2 * Math.PI}`}
                  strokeLinecap="round" transform="rotate(-90 44 44)" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1 }}>5</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>of 12</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>You're ahead by 3 min</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>22m avg · target 25m</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Pill tone="ready" size="sm">on pace</Pill>
                <Pill tone="caution" size="sm" icon="star">1 VIP</Pill>
              </div>
            </div>
          </div>

          {/* AI nudge */}
          <div style={{
            background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
            borderRadius: 14, padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <AILabel>Heads up</AILabel>
            </div>
            <p style={{
              margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 15, lineHeight: 1.4,
            }}>
              Room <strong style={{ fontStyle: 'normal' }}>105</strong> is a long-stay deep clean — Mia approved moving it to tomorrow morning.
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <Btn variant="ai" size="sm" icon="check">Got it</Btn>
              <Btn variant="ghost" size="sm">Keep today</Btn>
            </div>
          </div>

          {/* Up next */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1 }}>Up next</span>
              <span style={{ fontSize: 11, color: 'var(--accent)' }}>See all 7</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { num: '108', t: 'King · Stay', s: 'progress', m: '12m in', a: 'guest still in — knock first' },
                { num: '112', t: 'Queen · Checkout', s: 'dirty', m: 'next up', a: null },
                { num: '115', t: 'Suite · VIP arrival', s: 'dirty', m: 'before 3pm', a: 'extra pillows, fresh fruit', vip: true },
              ].map((r, i) => (
                <div key={i} style={{
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 12, padding: '12px 13px',
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: 'var(--surface-2)', border: '1px solid var(--line-2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>{r.num}</Mono>
                    <StatusDot tone={r.s} size={5} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{r.t}</span>
                      {r.vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}
                    </div>
                    {r.a && <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 3 }}>{r.a}</div>}
                  </div>
                  <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{r.m}</Mono>
                </div>
              ))}
            </div>
          </div>
        </div>
        <MobileTabBar active="home" />
      </div>
    </Phone>
  );
}

function MobileRoomDetail() {
  return (
    <Phone height={780} label="Room Detail">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          left={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="chevronR" size={18} style={{ transform: 'rotate(180deg)' }} /></button>}
          right={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="message" size={18} /></button>}
          title="Room 115"
          sub="Suite · VIP arrival"
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Hero status */}
          <div style={{
            background: 'var(--accent)', color: '#fff',
            borderRadius: 16, padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 1 }}>115</div>
              <Pill tone="neutral" size="sm" style={{ background: 'rgba(255,255,255,0.18)', borderColor: 'transparent', color: '#fff' }}>RUSH · VIP</Pill>
            </div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>Mr. Marcus Bell · arr. 2:30 PM</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Btn variant="dark" size="md" style={{ background: 'rgba(0,0,0,0.4)', borderColor: 'transparent' }} full>Open · Start clean</Btn>
            </div>
          </div>

          {/* AI prep */}
          <div style={{
            background: 'var(--ink)', color: 'var(--paper)',
            borderRadius: 14, padding: '14px 16px',
          }}>
            <AILabel>Pre-set</AILabel>
            <p style={{
              margin: '10px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 16, lineHeight: 1.45,
            }}>
              Mr. Bell stays 4–6× a year. Last visit he asked for <strong style={{ fontStyle: 'normal' }}>extra pillows</strong> and <strong style={{ fontStyle: 'normal' }}>still water (no carbonation)</strong>.
            </p>
          </div>

          {/* Checklist */}
          <div>
            <SectionLabel>VIP checklist · 6 items</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {[
                { l: 'Standard clean complete', d: true },
                { l: '2 extra pillows on bed', d: true },
                { l: 'Still water (4 bottles)', d: false, ai: true },
                { l: 'Welcome card (anniversary)', d: false, ai: true },
                { l: 'Adjust thermostat to 70°', d: false },
                { l: 'Photo audit', d: false },
              ].map((c, i) => (
                <label key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: '13px 14px',
                  borderTop: i > 0 ? '1px solid var(--line-2)' : 'none',
                  background: c.d ? 'transparent' : 'transparent',
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6,
                    border: '1.5px solid var(--line)',
                    background: c.d ? 'var(--ready)' : 'var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {c.d && <Icon name="check" size={13} color="#fff" stroke={3} />}
                  </span>
                  <span style={{
                    fontSize: 14, color: 'var(--ink)', flex: 1,
                    textDecoration: c.d ? 'line-through' : 'none',
                    textDecorationColor: 'var(--ink-4)',
                  }}>{c.l}</span>
                  {c.ai && <AILabel>AI</AILabel>}
                </label>
              ))}
            </div>
          </div>

          {/* Action grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <Btn variant="outline" size="lg" icon="wrench" full>Report issue</Btn>
            <Btn variant="outline" size="lg" icon="camera" full>Add photo</Btn>
            <Btn variant="outline" size="lg" icon="package" full>Lost item</Btn>
            <Btn variant="outline" size="lg" icon="spark" full>Ask copilot</Btn>
          </div>
        </div>
        <MobileTabBar active="rooms" />
      </div>
    </Phone>
  );
}

function MobileMyRooms() {
  const rooms = [
    { num: '108', t: 'King · Stay', s: 'progress', m: '12m', vip: false },
    { num: '112', t: 'Queen · Checkout', s: 'dirty', m: 'next', vip: false },
    { num: '115', t: 'Suite · VIP', s: 'dirty', m: '3pm', vip: true },
    { num: '118', t: 'King · Stay', s: 'dirty', m: 'flex', vip: false },
    { num: '122', t: 'Double · Long stay', s: 'dirty', m: 'flex', vip: false, ai: true },
    { num: '101', t: 'King · Done', s: 'inspected', m: '✓', vip: false },
    { num: '102', t: 'King · Done', s: 'inspected', m: '✓', vip: false },
    { num: '103', t: 'Queen · Done', s: 'clean', m: 'await', vip: false },
  ];
  return (
    <Phone height={780} label="My Rooms">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          big
          sub="Tue · 12 rooms today"
          title="My rooms"
        />
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {[
            { l: 'All', n: 12, active: true },
            { l: 'To do', n: 7 },
            { l: 'Done', n: 5 },
            { l: 'VIPs', n: 1 },
          ].map((f, i) => (
            <span key={i} style={{
              padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap',
              background: f.active ? 'var(--ink)' : 'var(--surface)',
              color: f.active ? 'var(--paper)' : 'var(--ink-2)',
              border: f.active ? '1px solid var(--ink)' : '1px solid var(--line)',
              fontSize: 12, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>{f.l} <Mono style={{ fontSize: 11, opacity: 0.7, fontWeight: 700 }}>{f.n}</Mono></span>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 100px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rooms.map((r, i) => (
            <div key={i} style={{
              background: 'var(--surface)', border: `1px solid var(--${r.s === 'inspected' ? 'ready-line' : r.s === 'progress' ? 'info-line' : 'line'})`,
              borderRadius: 12, padding: '11px 13px',
              display: 'flex', alignItems: 'center', gap: 12,
              opacity: r.s === 'inspected' || r.s === 'clean' ? 0.55 : 1,
            }}>
              <div style={{
                width: 50, height: 50, borderRadius: 10,
                background: r.s === 'inspected' ? 'var(--ready-soft)' :
                            r.s === 'progress' ? 'var(--alert-soft)' :
                            r.s === 'clean' ? 'var(--info-soft)' :
                            r.s === 'pickup' ? 'var(--caution-soft)' :
                            r.s === 'dirty' ? 'var(--alert-soft)' :
                            'var(--surface-2)',
                border: `1px solid var(--${r.s === 'inspected' ? 'ready-line' : r.s === 'progress' ? 'alert-line' : r.s === 'clean' ? 'info-line' : r.s === 'pickup' ? 'caution-line' : r.s === 'dirty' ? 'alert-line' : 'line'})`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <Mono style={{ fontSize: 15, fontWeight: 600 }}>{r.num}</Mono>
                <StatusDot tone={r.s} size={5} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.t}</span>
                  {r.vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}
                </div>
                {r.ai && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, color: 'var(--ai)', marginTop: 4,
                  }}>
                    <Icon name="spark" size={9} stroke={2.4} /> AI suggests move to tomorrow
                  </span>
                )}
              </div>
              <Mono style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 32, textAlign: 'right' }}>{r.m}</Mono>
            </div>
          ))}
        </div>
        <MobileTabBar active="rooms" />
      </div>
    </Phone>
  );
}

function MobileCopilot() {
  return (
    <Phone height={780} label="Copilot" statusbarTheme="dark">
      <div style={{ height: 'calc(100% - 44px)', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Header */}
        <div style={{ padding: '8px 18px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{ background: 'transparent', border: 'none', color: 'var(--paper)' }}>
            <Icon name="x" size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Copilot</div>
            <div style={{ fontSize: 11, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>claude-sonnet-3.5 · $0.011</div>
          </div>
          <button style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--paper)', padding: 7, borderRadius: 8 }}>
            <Icon name="doc" size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* AI message */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6, marginBottom: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="spark" size={11} color="#fff" stroke={2.4} />
              </span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Good morning, Maria</span>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18, lineHeight: 1.4 }}>
              You have <strong style={{ fontStyle: 'normal' }}>7 rooms left</strong> today. Your VIP (115) needs to be ready before 3 PM. Want me to walk through it?
            </p>
          </div>

          {/* Suggestion chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {[
              'Walk me through 115',
              'What\'s in my queue?',
              'Log an issue',
              'How am I pacing today?',
            ].map((s, i) => (
              <span key={i} style={{
                fontSize: 12, padding: '7px 11px', borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>{s}</span>
            ))}
          </div>

          {/* User message */}
          <div style={{ alignSelf: 'flex-end', maxWidth: 280 }}>
            <div style={{
              background: 'var(--accent)', borderRadius: 14, borderTopRightRadius: 4,
              padding: '10px 13px', fontSize: 14, lineHeight: 1.4,
            }}>
              115 was a long stay — anything special I should know?
            </div>
          </div>

          {/* AI reply */}
          <div style={{ alignSelf: 'flex-start', maxWidth: 320 }}>
            <div style={{
              background: 'rgba(255,255,255,0.05)', borderRadius: 14, borderTopLeftRadius: 4,
              padding: '12px 14px', fontSize: 14, lineHeight: 1.5,
            }}>
              Mr. Bell stays a few times a year. He likes <strong>extra pillows</strong> and <strong>still water</strong>. His anniversary was last visit — the front desk has a card to drop off.
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 10.5, opacity: 0.5, fontFamily: 'var(--font-mono)' }}>From guest history · folio #GP-2241</span>
            </div>
          </div>
        </div>

        {/* Composer */}
        <div style={{
          padding: '12px 18px 24px',
          background: 'rgba(255,255,255,0.04)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 9,
        }}>
          <button style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: 'var(--paper)', padding: 9, borderRadius: 999 }}>
            <Icon name="phone" size={16} />
          </button>
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 999,
            padding: '10px 14px', fontSize: 13, opacity: 0.6,
          }}>Ask anything…</div>
          <button style={{ background: 'var(--accent)', border: 'none', color: '#fff', padding: 9, borderRadius: 999 }}>
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </Phone>
  );
}

function MobileGuestRequest() {
  return (
    <Phone height={780} label="Guest Request">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          left={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="chevronR" size={18} style={{ transform: 'rotate(180deg)' }} /></button>}
          right={<Pill tone="alert" size="sm" icon="alert">BREACH</Pill>}
          title="GR-440"
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1 }}>Room 301 · 12 min ago</div>
            <h1 style={{
              margin: '8px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400,
              fontSize: 26, lineHeight: 1.15, letterSpacing: -0.4,
            }}>AC not cooling — set to 68 but reading 74°</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
              <Avatar name="Sara Lin" size={22} />
              <span style={{ fontSize: 12.5 }}>Sara Lin</span>
              <Pill tone="neutral" size="sm">phone</Pill>
            </div>
          </div>

          <div style={{
            background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
            borderRadius: 14, padding: '14px 16px',
          }}>
            <AILabel confidence={91}>Service recovery</AILabel>
            <p style={{
              margin: '10px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 15.5, lineHeight: 1.45,
            }}>
              Same fan-coil zone B as 207/209. Suggested: <strong style={{ fontStyle: 'normal' }}>move to 412 (king ready)</strong> + WO for 301.
            </p>
            <Btn variant="ai" size="md" icon="check" full style={{ marginTop: 12 }}>Apply suggestion</Btn>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Btn variant="outline" size="lg" full icon="wrench" style={{ justifyContent: 'flex-start' }}>Create work order</Btn>
            <Btn variant="outline" size="lg" full icon="key" style={{ justifyContent: 'flex-start' }}>Offer room move</Btn>
            <Btn variant="outline" size="lg" full icon="phone" style={{ justifyContent: 'flex-start' }}>Call guest back</Btn>
            <Btn variant="outline" size="lg" full icon="star" style={{ justifyContent: 'flex-start' }}>Add comp to folio</Btn>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function MobileWorkOrder() {
  return (
    <Phone height={780} label="Work Order">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          left={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="chevronR" size={18} style={{ transform: 'rotate(180deg)' }} /></button>}
          right={<Pill tone="alert" size="sm">HIGH</Pill>}
          title="WO-1141"
          sub="In progress · 22m"
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 120px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 26, lineHeight: 1.15, letterSpacing: -0.4,
          }}>Replace fan-coil belt</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <Icon name="pin" size={12} /> <Mono>R-209 · zone B</Mono>
          </div>

          <div style={{
            background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
            borderRadius: 14, padding: '12px 14px',
          }}>
            <AILabel confidence={88}>Insight</AILabel>
            <p style={{
              margin: '8px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 14.5, lineHeight: 1.4,
            }}>
              Same zone as WO-1140. Recommend pre-emptive belt swap on adjacent units 211 & 213.
            </p>
          </div>

          <div>
            <SectionLabel>Steps</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {[
                { l: 'Power off unit · LOTO applied', d: true },
                { l: 'Remove access panel', d: true },
                { l: 'Belt removed (photo)', d: true },
                { l: 'Install new belt', d: false, now: true },
                { l: 'Verify tension', d: false },
                { l: 'Power on · test airflow', d: false },
              ].map((c, i) => (
                <label key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: '13px 14px',
                  borderTop: i > 0 ? '1px solid var(--line-2)' : 'none',
                  background: c.now ? 'var(--accent-soft)' : 'transparent',
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6,
                    border: c.now ? '2px solid var(--accent)' : '1.5px solid var(--line)',
                    background: c.d ? 'var(--ready)' : 'var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {c.d && <Icon name="check" size={13} color="#fff" stroke={3} />}
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1, textDecoration: c.d ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>{c.l}</span>
                  {c.now && <Pill tone="accent" size="sm">now</Pill>}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="outline" size="lg" icon="camera" full>Photo</Btn>
            <Btn variant="outline" size="lg" icon="message" full>Note</Btn>
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 18px 26px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
          <Btn variant="primary" size="lg" icon="check" full>Mark step done</Btn>
        </div>
      </div>
    </Phone>
  );
}

Object.assign(window, { Phone, MobileLogin, MobileHome, MobileRoomDetail, MobileMyRooms, MobileCopilot, MobileGuestRequest, MobileWorkOrder });
