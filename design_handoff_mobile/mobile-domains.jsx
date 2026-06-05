/* mobile-domains.jsx — cross-role screens: Notifications, Lost & Found,
   Scheduling, SOP library + detail, Profile/Me. */

// ═══ NOTIFICATIONS / alerts feed ═════════════════════════════════════════════
function NotificationsScreen() {
  const groups = [
    { when: 'Just now', items: [
      { ai: true, title: 'Service recovery — Room 301', body: 'AC complaint matches zone B. Suggested: move guest to 412 + open WO.', tone: 'ai', time: '2m', cta: 'Apply' },
      { icon: 'alert', title: 'GR-440 breaching SLA', body: 'Guest request open 12 min · 301', tone: 'alert', time: '3m' },
    ]},
    { when: 'Earlier today', items: [
      { icon: 'shield', title: '208 reopened by inspector', body: 'Bathroom re-check · back to Tina', tone: 'caution', time: '1h' },
      { icon: 'star', title: 'VIP arrival flagged — 115', body: 'Mr. Bell · arr. 2:30 PM · prep list ready', tone: 'accent', time: '1h' },
      { icon: 'check', title: 'WO-1138 closed', body: 'Toilet flange reseated · R-144', tone: 'ready', time: '2h' },
      { icon: 'package', title: 'Lost item matched', body: 'Found phone charger → guest in 214', tone: 'info', time: '3h' },
    ]},
  ];
  return (
    <Phone height={812} label="Notifications">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="2 need action" title="Alerts" right={<span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>Mark read</span>} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.1, textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }}>{g.when}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map((n, i) => n.ai ? (
                  <div key={i} style={{ background: 'var(--ink)', color: 'var(--paper)', borderRadius: 14, padding: '14px 15px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: -30, right: -20, width: 120, height: 120, background: 'radial-gradient(circle, rgba(179,156,224,0.2) 0%, transparent 70%)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, position: 'relative' }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="spark" size={11} color="#fff" stroke={2.4} /></span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(241,237,228,0.7)' }}>Copilot alert</span>
                      <Mono style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(241,237,228,0.5)' }}>{n.time}</Mono>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, position: 'relative' }}>{n.title}</div>
                    <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'rgba(241,237,228,0.75)', position: 'relative' }}>{n.body}</p>
                    <div style={{ display: 'flex', gap: 7, marginTop: 12, position: 'relative' }}>
                      <HeroBtn icon="check" primary>{n.cta}</HeroBtn>
                      <HeroBtn>Open</HeroBtn>
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 13px', display: 'flex', gap: 12 }}>
                    <IconBtn icon={n.icon} tone={n.tone} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{n.title}</span>
                        <Mono style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{n.time}</Mono>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.4 }}>{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  );
}

// ═══ LOST & FOUND · list ═════════════════════════════════════════════════════
function LostFound() {
  const items = [
    { t: 'iPhone charger · white', loc: 'Found in 214', when: '10m ago', tone: 'ai', match: 'Matched to guest in 214' },
    { t: 'Reading glasses', loc: 'Found in lobby', when: '1h ago', tone: 'caution', status: 'Unclaimed · 1 day' },
    { t: 'Blue cardigan', loc: 'Found in 118', when: '3h ago', tone: 'caution', status: 'Unclaimed · 1 day' },
    { t: "Child's stuffed bear", loc: 'Found in 207', when: 'Yesterday', tone: 'info', status: 'Guest notified' },
    { t: 'Phone charger · black', loc: 'Found in pool area', when: '2 days ago', tone: 'neutral', status: 'Expires in 28 days', dim: true },
  ];
  return (
    <Phone height={812} label="Lost & Found">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="5 items held" title="Lost & found" right={<IconBtn icon="search" />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 100px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CopilotHero tone="violet" kicker="Match found" confidence={89} actions={<><HeroBtn onDark={false} icon="send">Notify guest</HeroBtn><HeroBtn onDark={false}>View</HeroBtn></>}>
            The white charger found in <strong style={{ fontStyle: 'normal' }}>214</strong> likely belongs to the guest who just checked out — they're still on property.
          </CopilotHero>

          <Segmented scroll items={[{ l: 'All', n: 5, active: true }, { l: 'Unclaimed', n: 2 }, { l: 'Matched', n: 1 }, { l: 'Returned', n: 12 }]} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => (
              <Row key={i} onDim={it.dim}
                lead={<IconBtn icon="package" tone={it.tone !== 'neutral' ? it.tone : undefined} size={46} />}
                title={<span style={{ fontSize: 13.5, fontWeight: 500 }}>{it.t}</span>}
                sub={<>{it.loc} · {it.when}{(it.match || it.status) && <><br /><span style={{ color: it.match ? 'var(--ai)' : 'var(--ink-3)', fontWeight: it.match ? 500 : 400 }}>{it.match || it.status}</span></>}</>}
                right={<Icon name="chevronR" size={15} color="var(--ink-4)" />}
              />
            ))}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 18px 26px', background: 'linear-gradient(transparent, var(--paper) 30%)' }}>
          <Btn variant="dark" size="lg" icon="camera" full>Log a found item</Btn>
        </div>
      </div>
    </Phone>
  );
}

// ═══ SCHEDULING · my shifts ══════════════════════════════════════════════════
function Scheduling() {
  const week = [
    { d: 'Mon', n: 25, shift: 'Day · 7–3', tone: 'info', off: false },
    { d: 'Tue', n: 26, shift: 'Day · 7–3', tone: 'accent', today: true },
    { d: 'Wed', n: 27, shift: 'Day · 7–3', tone: 'info' },
    { d: 'Thu', n: 28, shift: 'Off', off: true },
    { d: 'Fri', n: 29, shift: 'Day · 7–3', tone: 'info' },
    { d: 'Sat', n: 30, shift: 'Eve · 3–11', tone: 'caution' },
    { d: 'Sun', n: 31, shift: 'Off', off: true },
  ];
  return (
    <Phone height={812} label="Scheduling">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="May 25–31" title="My shifts" right={<IconBtn icon="cal" />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 28px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {/* today highlight */}
          <div style={{ background: 'var(--accent)', color: '#fff', borderRadius: 16, padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 }}>Today · Tue May 26</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1, marginTop: 9 }}>7:00 – 3:00</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>Day shift</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Pill tone="neutral" size="md" style={{ background: 'rgba(255,255,255,0.18)', borderColor: 'transparent', color: '#fff' }} icon="bed">12 rooms</Pill>
              <Pill tone="neutral" size="md" style={{ background: 'rgba(255,255,255,0.18)', borderColor: 'transparent', color: '#fff' }} icon="users">Floor 1</Pill>
            </div>
          </div>

          <CopilotHero tone="violet" kicker="Coverage tip" actions={<><HeroBtn onDark={false} icon="users">Offer to cover</HeroBtn></>}>
            Saturday's evening shift is light — picking up <strong style={{ fontStyle: 'normal' }}>2 hrs</strong> would put you at full-time hours this week.
          </CopilotHero>

          <div>
            <SectionLabel>This week</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {week.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderTop: i > 0 ? '1px solid var(--line-2)' : 'none', background: w.today ? 'var(--accent-soft)' : 'transparent' }}>
                  <div style={{ width: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{w.d}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1.1, color: w.today ? 'var(--accent)' : 'var(--ink)' }}>{w.n}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: w.off ? 'var(--ink-4)' : 'var(--ink)' }}>{w.shift}</div>
                  </div>
                  {!w.off && <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--${w.tone})` }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

// ═══ SOP LIBRARY · browse ════════════════════════════════════════════════════
function SOPLibrary() {
  const cats = [
    { l: 'Housekeeping', n: 24, icon: 'bed', tone: 'accent' },
    { l: 'Engineering', n: 18, icon: 'wrench', tone: 'info' },
    { l: 'Front desk', n: 12, icon: 'building', tone: 'caution' },
    { l: 'Safety', n: 9, icon: 'shield', tone: 'alert' },
  ];
  const recent = [
    { t: 'VIP arrival prep', cat: 'Housekeeping', steps: 8 },
    { t: 'Deep clean — long stay', cat: 'Housekeeping', steps: 14 },
    { t: 'Fan-coil belt replacement', cat: 'Engineering', steps: 6 },
  ];
  return (
    <Phone height={812} label="SOP Library">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="63 procedures" title="How-to" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* search → AI ask */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px' }}>
            <Icon name="search" size={15} color="var(--ink-3)" />
            <span style={{ fontSize: 13.5, color: 'var(--ink-4)', flex: 1 }}>Ask "how do I…"</span>
            <AILabel>AI</AILabel>
          </div>

          <CopilotHero tone="violet" kicker="Suggested for today" actions={<><HeroBtn onDark={false} icon="arrowR">Open guide</HeroBtn></>}>
            You've got a VIP arrival — here's the <strong style={{ fontStyle: 'normal' }}>VIP prep</strong> checklist, tailored to Mr. Bell's past requests.
          </CopilotHero>

          <div>
            <SectionLabel>Categories</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {cats.map((c, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
                  <IconBtn icon={c.icon} tone={c.tone} size={38} />
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 10 }}>{c.l}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{c.n} procedures</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Recently viewed</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recent.map((r, i) => (
                <Row key={i}
                  lead={<IconBtn icon="doc" size={42} />}
                  title={<span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.t}</span>}
                  sub={<>{r.cat} · {r.steps} steps</>}
                  right={<Icon name="chevronR" size={15} color="var(--ink-4)" />}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

// ═══ SOP DETAIL ══════════════════════════════════════════════════════════════
function SOPDetail() {
  const steps = [
    { l: 'Confirm arrival time & guest profile', d: true },
    { l: 'Standard clean to inspection grade', d: true },
    { l: 'Place 2 extra pillows on bed', now: true, note: 'Mr. Bell prefers firm' },
    { l: 'Stock 4 bottles still water (no carbonation)', ai: true },
    { l: 'Set thermostat to 70°F', d: false },
    { l: 'Welcome card from front desk', ai: true },
    { l: 'Photo audit — submit to inspector', d: false },
  ];
  return (
    <Phone height={812} label="SOP Detail">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          left={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="chevronR" size={18} style={{ transform: 'rotate(180deg)' }} /></button>}
          right={<IconBtn icon="star" />}
          title="VIP arrival prep" sub="Housekeeping · 8 steps" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
            <Icon name="clock" size={13} /> ~12 min added to standard
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-4)' }} />
            <Icon name="doc" size={13} /> Updated Apr 2026
          </div>

          <CopilotHero tone="violet" kicker="Tailored for 115" actions={<><HeroBtn onDark={false} icon="spark">Ask about this guest</HeroBtn></>}>
            I've pre-filled this for <strong style={{ fontStyle: 'normal' }}>Mr. Bell</strong> from his last 5 stays — the highlighted steps are his specific preferences.
          </CopilotHero>

          <div>
            <SectionLabel hint="2 of 7 done">Steps</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {steps.map((c, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '13px 14px', borderTop: i > 0 ? '1px solid var(--line-2)' : 'none', background: c.now ? 'var(--accent-soft)' : 'transparent' }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, marginTop: 1, border: c.now ? '2px solid var(--accent)' : '1.5px solid var(--line)', background: c.d ? 'var(--ready)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {c.d && <Icon name="check" size={13} color="#fff" stroke={3} />}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, textDecoration: c.d ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>{c.l}</span>
                      {c.ai && <AILabel>AI</AILabel>}
                    </div>
                    {c.note && <div style={{ fontSize: 11.5, color: 'var(--accent)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="spark" size={9} stroke={2.4} /> {c.note}</div>}
                  </div>
                  {c.now && <Pill tone="accent" size="sm">now</Pill>}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

// ═══ PROFILE / ME ════════════════════════════════════════════════════════════
function Profile() {
  const rows = [
    { icon: 'cal', l: 'My schedule', r: 'Day · 7–3' },
    { icon: 'trend', l: 'My stats', r: '22m avg' },
    { icon: 'doc', l: 'Pay & hours', r: '32h this wk' },
    { icon: 'bell', l: 'Notifications', r: 'On' },
    { icon: 'settings', l: 'Language', r: 'English' },
    { icon: 'shield', l: 'Help & safety', r: null },
  ];
  return (
    <Phone height={812} label="Profile">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader title="Me" right={<IconBtn icon="settings" />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 2px' }}>
            <Avatar name="Maria Vega" size={58} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, lineHeight: 1.1 }}>Maria Vega</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>Housekeeper · Lone Star Inn</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Pill tone="ready" size="sm" icon="check">94 quality</Pill>
                <Pill tone="accent" size="sm" icon="star">Top pace</Pill>
              </div>
            </div>
          </div>

          {/* streak / month stats */}
          <div style={{ display: 'flex', gap: 9 }}>
            {[{ v: '128', l: 'rooms this month' }, { v: '96%', l: 'first-pass', tone: 'ready' }, { v: '21d', l: 'streak', tone: 'accent' }].map((s, i) => (
              <div key={i} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 12px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, lineHeight: 1, color: s.tone ? `var(--${s.tone})` : 'var(--ink)' }}>{s.v}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.3 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* settings list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderTop: i > 0 ? '1px solid var(--line-2)' : 'none' }}>
                <Icon name={r.icon} size={17} color="var(--ink-3)" />
                <span style={{ fontSize: 14, flex: 1 }}>{r.l}</span>
                {r.r && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.r}</span>}
                <Icon name="chevronR" size={15} color="var(--ink-4)" />
              </div>
            ))}
          </div>

          <Btn variant="outline" size="lg" icon="logout" full style={{ color: 'var(--ink-2)' }}>Sign out</Btn>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>PatelRep v2.4 · build 1182</div>
        </div>
        <RoleTabBar role="housekeeper" active="me" />
      </div>
    </Phone>
  );
}

Object.assign(window, { NotificationsScreen, LostFound, Scheduling, SOPLibrary, SOPDetail, Profile });
