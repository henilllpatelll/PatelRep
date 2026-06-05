/* mobile-housekeeper.jsx — Housekeeper role. Refined Home (2 layouts) + Tasks (2 layouts). */

// ═══ HOME — Variation A · warm stacked cards ═════════════════════════════════
function HKHomeA() {
  const next = [
    { num: '108', t: 'King · Stay-over', s: 'progress', m: '12m in', note: 'Guest still in — knock first' },
    { num: '112', t: 'Queen · Checkout', s: 'dirty', m: 'next', note: null },
    { num: '115', t: 'Suite · VIP arrival', s: 'dirty', m: 'by 3pm', note: 'Extra pillows · still water', vip: true },
  ];
  return (
    <Phone height={812} label="Home A">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="Tue · May 26 · Day shift" title="Morning, Maria." right={<IconBtn icon="bell" />} left={<Avatar name="Maria Vega" size={34} />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CopilotHero
            kicker="Your smart order"
            confidence={92}
            actions={<><HeroBtn icon="arrowR" primary>Start with 112</HeroBtn><HeroBtn>See the plan</HeroBtn></>}
            foot={<><Icon name="clock" size={11} /> Saves ~18 min vs. room order</>}
          >
            7 rooms left. I'd clean <strong style={{ fontStyle: 'normal' }}>112 → 118 → 122</strong> first while 108's guest is out, then hit your VIP last so it's fresh at check-in.
          </CopilotHero>

          {/* Pace card with ring */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
            <Ring value={5} total={12} tone="accent" center={
              <>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1 }}>5</div>
                <Mono style={{ fontSize: 10, color: 'var(--ink-3)' }}>of 12</Mono>
              </>
            } />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>You're ahead by 3 min</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>22m avg · target 25m</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                <Pill tone="ready" size="sm">on pace</Pill>
                <Pill tone="accent" size="sm" icon="star">1 VIP</Pill>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel hint="3 of 7" action={<span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>See all</span>}>Up next</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {next.map((r, i) => (
                <Row key={i}
                  lead={<RoomNumberTile num={r.num} status={r.s} size={46} />}
                  title={<><span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.t}</span>{r.vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}</>}
                  sub={r.note}
                  right={<Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.m}</Mono>}
                />
              ))}
            </div>
          </div>
        </div>
        <RoleTabBar role="housekeeper" active="home" />
      </div>
    </Phone>
  );
}

// ═══ HOME — Variation B · dark focus / "one thing now" ═══════════════════════
function HKHomeB() {
  return (
    <Phone height={812} label="Home B" statusbarTheme="dark">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column', background: 'var(--ink)' }}>
        {/* header */}
        <div style={{ padding: '6px 20px 16px', color: 'var(--paper)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(241,237,228,0.5)' }}>Tue · Day shift</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 27, lineHeight: 1.1, marginTop: 5 }}>7 to go, Maria.</div>
            </div>
            <span style={{ position: 'relative' }}>
              <IconBtn icon="bell" />
              <span style={{ position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--ink)' }} />
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 104px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Focus card — the one room to do now */}
          <div style={{ background: 'var(--surface)', borderRadius: 18, padding: 18, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <AILabel confidence={92}>Do this now</AILabel>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>1 / 7</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <RoomNumberTile num="112" status="dirty" size={62} radius={14} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Queen · Checkout</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>Guest left 8:40 · est. 24 min</div>
              </div>
            </div>
            <p style={{ margin: '13px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 15, lineHeight: 1.4, color: 'var(--ink-2)' }}>
              Quick turn — start here while 108's guest is still out.
            </p>
            <Btn variant="primary" size="lg" full iconRight="arrowR" style={{ marginTop: 14 }}>Open &amp; start clean</Btn>
          </div>

          {/* queue strip */}
          <div style={{ padding: '2px 4px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(241,237,228,0.45)', marginBottom: 9 }}>Then</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                { num: '118', t: 'King · Stay', m: '2nd', s: 'dirty' },
                { num: '122', t: 'Double · Long stay', m: '3rd', s: 'dirty' },
                { num: '115', t: 'Suite · VIP — keep last', m: 'by 3pm', s: 'dirty', vip: true },
              ].map((r, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px',
                  background: 'rgba(255,255,255,0.05)', borderRadius: 11,
                  border: r.vip ? '1px solid var(--accent-line)' : '1px solid transparent',
                }}>
                  <Mono style={{ fontSize: 14, fontWeight: 600, color: 'var(--paper)', width: 34 }}>{r.num}</Mono>
                  <div style={{ flex: 1, fontSize: 13, color: 'rgba(241,237,228,0.85)' }}>{r.t}</div>
                  {r.vip ? <Pill tone="accent" size="sm" icon="star">VIP</Pill> : <Mono style={{ fontSize: 11, color: 'rgba(241,237,228,0.45)' }}>{r.m}</Mono>}
                </div>
              ))}
            </div>
          </div>

          {/* pace footer */}
          <div style={{ display: 'flex', gap: 9 }}>
            {[{ v: '5', l: 'done' }, { v: '22m', l: 'avg pace' }, { v: '+3m', l: 'ahead', good: true }].map((s, i) => (
              <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '11px 12px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, lineHeight: 1, color: s.good ? 'var(--ready)' : 'var(--paper)' }}>{s.v}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(241,237,228,0.5)', marginTop: 4 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
        <RoleTabBar role="housekeeper" active="home" />
      </div>
    </Phone>
  );
}

// ═══ TASKS — Variation A · timeline grouped by shift moment ══════════════════
function HKTasksA() {
  const groups = [
    { when: 'Now', tone: 'accent', items: [
      { l: 'Restock cart — floor 2', meta: 'Linens low · 6 rooms left', icon: 'package', tone: 'accent' },
    ]},
    { when: 'Before 12:00', tone: 'caution', items: [
      { l: 'Deliver 2 extra towels to 214', meta: 'Guest request · GR-438', icon: 'bed', tone: 'caution', ai: true },
      { l: 'Strip & flip 118', meta: 'Early checkout cleared', icon: 'bed' },
    ]},
    { when: 'This afternoon', tone: 'info', items: [
      { l: 'Deep-clean fridge — 122', meta: 'Long stay · day 9', icon: 'drop' },
      { l: 'Photo audit 115 before VIP', meta: 'Inspector will fast-track', icon: 'camera', ai: true },
    ]},
  ];
  return (
    <Phone height={812} label="Tasks A">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="5 tasks · 1 from a guest" title="My tasks" right={<IconBtn icon="filter" />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <CopilotHero tone="violet" kicker="Heads up" actions={<><HeroBtn onDark={false} icon="check">Reorder for me</HeroBtn></>}>
            The towel drop for <strong style={{ fontStyle: 'normal' }}>214</strong> is on your way to 218 — knock that out next and save a trip.
          </CopilotHero>

          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--${g.tone})` }} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-2)' }}>{g.when}</span>
                <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                {g.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 13px' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, border: '1.5px solid var(--line)', background: 'var(--surface)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{it.l}</span>
                        {it.ai && <AILabel>AI</AILabel>}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>{it.meta}</div>
                    </div>
                    <IconBtn icon={it.icon} tone={it.tone} size={34} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <RoleTabBar role="housekeeper" active="tasks" />
      </div>
    </Phone>
  );
}

// ═══ TASKS — Variation B · priority cards with swipe affordance ══════════════
function HKTasksB() {
  const tasks = [
    { l: 'Restock cart — floor 2', meta: 'Linens low', pri: 'P1', tone: 'alert', icon: 'package', due: 'now' },
    { l: 'Extra towels → 214', meta: 'Guest request GR-438', pri: 'P1', tone: 'alert', icon: 'bed', due: '12:00', ai: true },
    { l: 'Strip & flip 118', meta: 'Early checkout', pri: 'P2', tone: 'caution', icon: 'bed', due: '12:00' },
    { l: 'Deep-clean fridge — 122', meta: 'Long stay day 9', pri: 'P3', tone: 'info', icon: 'drop', due: 'pm' },
    { l: 'Photo audit 115', meta: 'Before VIP arrival', pri: 'P2', tone: 'caution', icon: 'camera', due: '2:30', ai: true },
  ];
  return (
    <Phone height={812} label="Tasks B">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="5 open · 0 overdue" title="My tasks" right={<IconBtn icon="plus" />} />
        <div style={{ padding: '10px 18px 12px', borderBottom: '1px solid var(--line-2)' }}>
          <Segmented scroll items={[{ l: 'All', n: 5, active: true }, { l: 'P1', n: 2 }, { l: 'From guests', n: 1 }, { l: 'AI', n: 2 }, { l: 'Done', n: 3 }]} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {tasks.map((t, i) => (
            <div key={i} style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `3px solid var(--${t.tone})`, borderRadius: 12, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 13 }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, border: '1.6px solid var(--line)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 500 }}>{t.l}</span>
                  {t.ai && <AILabel>AI</AILabel>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Pill tone={t.tone} size="sm">{t.pri}</Pill>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{t.meta}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Icon name={t.icon} size={17} color="var(--ink-4)" />
                <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{t.due}</Mono>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: 'var(--ink-4)', fontSize: 12, marginTop: 4 }}>
            <Icon name="arrowR" size={13} /> Swipe a card to complete
          </div>
        </div>
        <RoleTabBar role="housekeeper" active="tasks" />
      </div>
    </Phone>
  );
}

Object.assign(window, { HKHomeA, HKHomeB, HKTasksA, HKTasksB });
