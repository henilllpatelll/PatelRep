/* mobile-ops.jsx — Engineer home + refined Work Order, Inspector queue. */

// ═══ ENGINEER · Home ═════════════════════════════════════════════════════════
function EngHome() {
  const orders = [
    { id: 'WO-1141', t: 'Replace fan-coil belt', loc: 'R-209 · zone B', pri: 'HIGH', tone: 'alert', m: '22m', prog: true },
    { id: 'WO-1138', t: 'Reseat toilet flange', loc: 'R-144', pri: 'MED', tone: 'caution', m: 'queued' },
    { id: 'WO-1135', t: 'Pool pump pressure check', loc: 'Mech room', pri: 'LOW', tone: 'info', m: 'queued' },
  ];
  return (
    <Phone height={812} label="Engineer Home">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="Tue · May 26 · Maintenance" title="Morning, Dev." right={<IconBtn icon="bell" />} left={<Avatar name="Dev Patel" size={34} />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CopilotHero
            kicker="Failure prediction"
            confidence={88}
            actions={<><HeroBtn icon="wrench" primary>Pre-empt belt swap</HeroBtn><HeroBtn>Dismiss</HeroBtn></>}
            foot={<><Icon name="trend" size={11} /> 3 zone-B coils trending · same vibration signature</>}
          >
            Units <strong style={{ fontStyle: 'normal' }}>211 & 213</strong> are showing the same belt wear as 209. Swapping all three this morning avoids a likely guest-facing failure by Friday.
          </CopilotHero>

          {/* day stats */}
          <div style={{ display: 'flex', gap: 9 }}>
            {[{ v: '3', l: 'open orders' }, { v: '1', l: 'PM due', tone: 'caution' }, { v: '2', l: 'closed today', tone: 'ready' }].map((s, i) => (
              <div key={i} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color: s.tone ? `var(--${s.tone})` : 'var(--ink)' }}>{s.v}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* PM due nudge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--caution-soft)', border: '1px solid var(--caution-line)', borderRadius: 12, padding: '12px 14px' }}>
            <IconBtn icon="cal" tone="caution" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Quarterly HVAC filters due</div>
              <div style={{ fontSize: 11.5, color: 'var(--caution)', marginTop: 2 }}>14 units · scheduled today</div>
            </div>
            <Icon name="chevronR" size={16} color="var(--caution)" />
          </div>

          <div>
            <SectionLabel hint="3 open" action={<span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>All orders</span>}>Work orders</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orders.map((o, i) => (
                <Row key={i}
                  lead={<IconBtn icon="wrench" tone={o.prog ? 'accent' : undefined} size={46} />}
                  title={<><Mono style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>{o.id}</Mono><Pill tone={o.tone} size="sm">{o.pri}</Pill></>}
                  sub={<><strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{o.t}</strong> · {o.loc}</>}
                  right={o.prog ? <Pill tone="progress" size="sm" icon="clock">{o.m}</Pill> : <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{o.m}</Mono>}
                />
              ))}
            </div>
          </div>
        </div>
        <RoleTabBar role="engineer" active="home" />
      </div>
    </Phone>
  );
}

// ═══ ENGINEER · Work order (refined) ═════════════════════════════════════════
function EngWorkOrder() {
  const steps = [
    { l: 'Power off unit · LOTO applied', d: true },
    { l: 'Remove access panel', d: true },
    { l: 'Belt removed (photo)', d: true },
    { l: 'Install new belt', now: true },
    { l: 'Verify tension', d: false },
    { l: 'Power on · test airflow', d: false },
  ];
  return (
    <Phone height={812} label="Work Order">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader
          left={<button style={{ background: 'transparent', border: 'none', padding: 4 }}><Icon name="chevronR" size={18} style={{ transform: 'rotate(180deg)' }} /></button>}
          right={<Pill tone="alert" size="sm">HIGH</Pill>}
          title="WO-1141" sub="In progress · 22m" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 116px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 27, lineHeight: 1.12, letterSpacing: -0.4 }}>Replace fan-coil belt</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
              <Icon name="pin" size={13} /> <Mono>R-209 · zone B</Mono>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-4)' }} />
              <Avatar name="Dev Patel" size={18} /> You
            </div>
          </div>

          <CopilotHero tone="violet" kicker="Insight" confidence={88} actions={<><HeroBtn onDark={false} icon="plus">Create 2 linked WOs</HeroBtn></>}>
            Same zone as WO-1140. Recommend a pre-emptive belt swap on adjacent units <strong style={{ fontStyle: 'normal' }}>211 & 213</strong> while you're in there.
          </CopilotHero>

          <div>
            <SectionLabel hint="3 of 6 done">Steps</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {steps.map((c, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', minHeight: 50, borderTop: i > 0 ? '1px solid var(--line-2)' : 'none', background: c.now ? 'var(--accent-soft)' : 'transparent' }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, border: c.now ? '2px solid var(--accent)' : '1.5px solid var(--line)', background: c.d ? 'var(--ready)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {c.d && <Icon name="check" size={13} color="#fff" stroke={3} />}
                  </span>
                  <span style={{ fontSize: 14, flex: 1, textDecoration: c.d ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>{c.l}</span>
                  {c.now && <Pill tone="accent" size="sm">now</Pill>}
                </label>
              ))}
            </div>
          </div>

          {/* parts */}
          <div>
            <SectionLabel>Parts used</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
              <IconBtn icon="package" size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>Fan-coil belt · A-4L360</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>2 in stock after this</div>
              </div>
              <Mono style={{ fontSize: 12, color: 'var(--ink-2)' }}>×1</Mono>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="outline" size="lg" icon="camera" full>Photo</Btn>
            <Btn variant="outline" size="lg" icon="message" full>Note</Btn>
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 18px 26px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
          <Btn variant="primary" size="lg" icon="check" full>Complete step · Install belt</Btn>
        </div>
      </div>
    </Phone>
  );
}

// ═══ INSPECTOR · Queue (refined, AI fast-track hero) ═════════════════════════
function InspectorQueue() {
  const queue = [
    { num: '103', cleaner: 'Maria Vega', done: '12m ago', note: 'Standard checkout · 28m', ai: 92, vip: false },
    { num: '107', cleaner: 'Maria Vega', done: '23m ago', note: 'Touch-up only', ai: 96, vip: false },
    { num: '115', cleaner: 'Tina Aoki', done: '26m ago', note: 'VIP arrival · 3pm', ai: 71, vip: true },
    { num: '203', cleaner: 'Carlos Ruiz', done: '31m ago', note: 'Long stay · day 9', ai: 64, vip: false },
  ];
  const aiTone = (n) => n >= 90 ? 'ready' : n >= 75 ? 'caution' : 'alert';
  return (
    <Phone height={812} label="Inspection Queue">
      <div style={{ height: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column' }}>
        <MobileHeader big sub="Tue · Day shift" title="Inspections" right={<IconBtn icon="filter" />} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 104px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CopilotHero
            kicker="Fast-track"
            confidence={94}
            actions={<><HeroBtn icon="check" primary>Review &amp; pass 2</HeroBtn><HeroBtn>Not now</HeroBtn></>}
            foot={<><Icon name="shield" size={11} /> Both match the standard on every photo</>}
          >
            <strong style={{ fontStyle: 'normal' }}>103</strong> and <strong style={{ fontStyle: 'normal' }}>107</strong> look clean. Skim the photos and pass them in one tap — focus your time on the VIP (115).
          </CopilotHero>

          {/* summary split */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1 }}>14</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>passed</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>94 avg · 1 reopened</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-2)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1 }}>4</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>in queue</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ready)', marginTop: 4 }}>2 likely pass</div>
            </div>
          </div>

          <Segmented scroll items={[{ l: 'To inspect', n: 4, active: true }, { l: 'Passed', n: 14 }, { l: 'Reopened', n: 1 }, { l: 'VIP', n: 1 }]} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {queue.map((q, i) => (
              <Row key={i}
                lead={<RoomNumberTile num={q.num} status="clean" size={48} showDot={false} />}
                title={<><span style={{ fontSize: 13.5, fontWeight: 500 }}>{q.cleaner}</span>{q.vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}</>}
                sub={<>Done {q.done} · {q.note}</>}
                right={<>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: `var(--${aiTone(q.ai)})` }}>
                    <Icon name="spark" size={9} stroke={2.4} /> <Mono style={{ fontWeight: 600 }}>{q.ai}%</Mono>
                  </span>
                  <Icon name="chevronR" size={15} color="var(--ink-4)" />
                </>}
              />
            ))}
          </div>
        </div>
        <RoleTabBar role="inspector" active="inspect" />
      </div>
    </Phone>
  );
}

Object.assign(window, { EngHome, EngWorkOrder, InspectorQueue });
