/* Dashboards — one per role. Switched via Tweaks panel. */
const { useState: _useStateD } = React;

// ─── Shared bits ─────────────────────────────────────────────────────────────
function GreetingHeader({ name, role, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
      <div>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.2,
          color: 'var(--ink-3)', marginBottom: 8,
        }}>Tuesday · May 26 · 09:42 · Day shift</div>
        <h1 style={{
          margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
          fontSize: 36, lineHeight: 1.05, letterSpacing: -0.5, color: 'var(--ink)',
        }}>
          Good morning, <em style={{ fontStyle: 'italic' }}>{name}</em>.
        </h1>
        <p style={{
          margin: '10px 0 0', fontSize: 14.5, color: 'var(--ink-2)', maxWidth: 580, lineHeight: 1.5,
        }}>{hint}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
        <Btn variant="outline" icon="cal" size="md">Today</Btn>
        <Btn variant="dark" icon="plus" size="md">New task</Btn>
      </div>
    </div>
  );
}

// AI briefing card — featured editorial block at top of supervisor dash
function MorningBriefing() {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-xl)', overflow: 'hidden',
      display: 'grid', gridTemplateColumns: '1.4fr 1fr', minHeight: 220,
      boxShadow: 'var(--shadow-md)',
    }}>
      <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <AILabel confidence={91}>Morning briefing</AILabel>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>Generated 09:30 · Sonnet 3.5</span>
        </div>
        <p style={{
          margin: 0,
          fontFamily: 'var(--font-display)', fontStyle: 'italic',
          fontSize: 22, lineHeight: 1.35, color: 'var(--ink)', letterSpacing: -0.2,
        }}>
          Busy checkout day — <span style={{ fontFamily: 'var(--font-sans)', fontStyle: 'normal', fontWeight: 500, background: 'var(--caution-soft)', padding: '1px 7px', borderRadius: 4 }}>34 departures by noon</span>. Six rooms on floor 3 are clustered and will benefit from <span style={{ fontFamily: 'var(--font-sans)', fontStyle: 'normal', fontWeight: 500 }}>Maria & Tina paired</span>. Two AC complaints overnight in 207/209 — same fan-coil zone, worth a PM walkthrough.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <Btn variant="primary" size="sm" icon="check">Apply 3 suggestions</Btn>
          <Btn variant="ghost" size="sm">Dismiss</Btn>
        </div>
      </div>
      <div style={{
        background: 'var(--ink)', color: 'var(--paper)',
        padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 50%)',
          opacity: 0.25,
        }} />
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4, opacity: 0.6, position: 'relative' }}>Right now</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
          {[
            ['Occupancy', '78%', '+6 vs forecast', 'caution'],
            ['Avg clean time', '24m', '−3m vs 7-day', 'ready'],
            ['Open WOs', '6', '2 high priority', 'alert'],
            ['AI credits', '$18.40', 'cap $217.50', null],
          ].map(([l, v, h, t], i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              paddingBottom: i < 3 ? 9 : 0,
            }}>
              <span style={{ fontSize: 11, opacity: 0.6, flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>{l}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 500 }}>{v}</span>
              <span style={{
                fontSize: 10, opacity: 0.7,
                color: t === 'alert' ? '#ff9d8a' : t === 'ready' ? '#7cd6c5' : t === 'caution' ? '#e6c47d' : 'currentColor',
              }}>{h}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Live ops grid — small live status grid summarized
function LiveOpsStrip() {
  const statuses = [
    { code: 'dirty',     label: 'Vacant dirty', n: 14, tone: 'dirty' },
    { code: 'progress',  label: 'Occupied', n: 9, tone: 'progress' },
    { code: 'clean',     label: 'Clean', n: 6, tone: 'clean' },
    { code: 'inspected', label: 'Ready', n: 52, tone: 'ready' },
    { code: 'pickup',    label: 'Pickup', n: 3, tone: 'pickup' },
    { code: 'ooo',       label: 'OOO', n: 3, tone: 'ooo' },
  ];
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <SectionLabel hint="Real-time">Room status</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        {statuses.map((s) => (
          <div key={s.code} style={{
            padding: '12px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <StatusDot tone={s.tone} />
              <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>{s.label}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1, color: 'var(--ink)' }}>{s.n}</div>
            <div style={{ marginTop: 8 }}>
              <Bar value={s.n} max={52} tone={s.tone === 'ooo' ? 'caution' : s.tone === 'pickup' ? 'caution' : s.tone === 'inspected' ? 'ready' : s.tone === 'dirty' ? 'alert' : s.tone === 'clean' ? 'info' : 'alert'} height={3} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 12, color: 'var(--ink-3)' }}>
        <Icon name="building" size={13} color="var(--ink-3)" />
        <span style={{ fontFamily: 'var(--font-mono)' }}>87 rooms · 3 floors · Updated 23s ago</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ready)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ready)' }} />
          Live
        </span>
      </div>
    </div>
  );
}

// People row — housekeepers progress today
function StaffProgress() {
  const ppl = [
    { name: 'Maria Vega',    role: 'Housekeeper',   done: 11, total: 14, mins: 22 },
    { name: 'Tina Aoki',     role: 'Housekeeper',   done: 9,  total: 13, mins: 28 },
    { name: 'Carlos Ruiz',   role: 'Housekeeper',   done: 8,  total: 13, mins: 24 },
    { name: 'Beatrix Khan',  role: 'Housekeeper',   done: 6,  total: 12, mins: 31, risk: true },
    { name: 'Jordan Lee',    role: 'Inspector',     done: 18, total: 22, mins: 5 },
    { name: 'Ravi Patel',    role: 'Engineer',      done: 3,  total: 5,  mins: '—' },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 0' }}>
        <SectionLabel hint="6 on shift" action={<Btn variant="ghost" size="sm" iconRight="chevronR">All staff</Btn>}>Floor team</SectionLabel>
      </div>
      <div style={{ padding: '4px 8px 8px' }}>
        {ppl.map((p, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 10px', borderRadius: 8,
            background: i % 2 === 1 ? 'var(--surface-2)' : 'transparent',
          }}>
            <Avatar name={p.name} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{p.name}</span>
                {p.risk && <Pill tone="caution" size="sm" icon="alert">running over</Pill>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{p.role} · <Mono>{p.mins}{typeof p.mins === 'number' ? 'm' : ''} avg</Mono></div>
            </div>
            <div style={{ width: 110 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                <Mono>{p.done}/{p.total}</Mono>
                <span>{Math.round((p.done / p.total) * 100)}%</span>
              </div>
              <Bar value={p.done} max={p.total} tone={p.risk ? 'caution' : 'ready'} height={3} />
            </div>
            <Icon name="chevronR" size={14} color="var(--ink-4)" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// AI predictions widget
function PredictionsWidget() {
  const items = [
    { room: '312', kind: 'Late checkout risk', detail: 'Guest historically extends · 73% likely', tone: 'caution', conf: 73 },
    { room: '207', kind: 'Recurring AC complaint', detail: 'Same fan-coil zone as 209 · check belt', tone: 'alert', conf: 88 },
    { room: '418', kind: 'VIP arrival 3pm', detail: 'Frequent guest · prefers extra pillows', tone: 'pickup', conf: 99 },
    { room: '105', kind: 'Long stay deep-clean due', detail: 'Day 6 of 9 · suggest tomorrow AM', tone: 'pickup', conf: 64 },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 0' }}>
        <SectionLabel hint="Next 24h" action={<AILabel>Predictions</AILabel>}>What needs attention</SectionLabel>
      </div>
      <div>
        {items.map((it, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid var(--line-2)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: 'var(--surface-2)', border: '1px solid var(--line-2)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <Mono style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{it.room}</Mono>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{it.kind}</span>
                <Pill tone={it.tone} size="sm">{it.conf}%</Pill>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{it.detail}</div>
            </div>
            <Btn variant="ghost" size="sm" iconRight="arrowR">Review</Btn>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Inbox / Activity feed
function ActivityFeed() {
  const events = [
    { t: '09:38', who: 'Maria Vega', what: 'completed', tgt: '312', icon: 'check', tone: 'ready' },
    { t: '09:31', who: 'AI', what: 'flagged', tgt: '207 — second AC complaint this week', icon: 'spark', tone: 'ai' },
    { t: '09:22', who: 'Front desk', what: 'created request', tgt: 'extra towels · 418', icon: 'bell', tone: 'accent' },
    { t: '09:14', who: 'Jordan Lee', what: 'inspected', tgt: '301, 303, 305', icon: 'shield', tone: 'ready' },
    { t: '09:02', who: 'Ravi Patel', what: 'opened WO #1142', tgt: 'ice machine — leak', icon: 'wrench', tone: 'alert' },
    { t: '08:50', who: 'You', what: 'assigned floor 3 to', tgt: 'Maria + Tina', icon: 'users', tone: null },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 12px' }}>
        <SectionLabel hint="Last hour" action={<Btn variant="ghost" size="sm">View all</Btn>}>Activity</SectionLabel>
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        {events.map((e, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            paddingBottom: 12,
            marginBottom: 12,
            borderBottom: i < events.length - 1 ? '1px dashed var(--line-2)' : 'none',
          }}>
            <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)', minWidth: 38, marginTop: 2 }}>{e.t}</Mono>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: e.tone === 'ai' ? 'var(--ai-soft)' :
                          e.tone === 'ready' ? 'var(--ready-soft)' :
                          e.tone === 'accent' ? 'var(--accent-soft)' :
                          e.tone === 'alert' ? 'var(--alert-soft)' : 'var(--surface-3)',
              color: e.tone === 'ai' ? 'var(--ai)' :
                     e.tone === 'ready' ? 'var(--ready)' :
                     e.tone === 'accent' ? 'var(--accent)' :
                     e.tone === 'alert' ? 'var(--alert)' : 'var(--ink-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon name={e.icon} size={11} stroke={2} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4, flex: 1 }}>
              <strong style={{ color: 'var(--ink)' }}>{e.who}</strong> {e.what} <span style={{ color: 'var(--ink)' }}>{e.tgt}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Supervisor Dashboard — hero ─────────────────────────────────────────────
function SupervisorDashboard() {
  return (
    <div style={{ padding: '24px 32px 90px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GreetingHeader
        name="Mia"
        hint="Six floor-3 cleans cluster between 11–1. Two AC complaints to triage. The AI has 3 suggestions queued."
      />
      <MorningBriefing />
      <LiveOpsStrip />
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
        <StaffProgress />
        <PredictionsWidget />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
        <RoomGridMini />
        <ActivityFeed />
      </div>
    </div>
  );
}

// Mini room grid — visual scan of all rooms
function RoomGridMini() {
  const statuses = ['dirty', 'progress', 'clean', 'inspected', 'pickup', 'ooo'];
  // Deterministic mock: ~87 rooms across 3 floors
  const rooms = [];
  for (let floor = 1; floor <= 3; floor++) {
    for (let n = 1; n <= 29; n++) {
      const num = floor * 100 + n;
      // bias toward inspected
      const r = (num * 17 + floor * 31) % 100;
      let s;
      if (r < 7) s = 'dirty';
      else if (r < 14) s = 'progress';
      else if (r < 22) s = 'clean';
      else if (r < 80) s = 'inspected';
      else if (r < 90) s = 'pickup';
      else s = 'ooo';
      rooms.push({ num, floor, status: s });
    }
  }
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 12px' }}>
        <SectionLabel hint="87 rooms" action={<Btn variant="ghost" size="sm" iconRight="arrowR">Open board</Btn>}>Room map</SectionLabel>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[1, 2, 3].map((f) => (
          <div key={f}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
            }}>
              <span>Floor {f}</span>
              <span style={{ flex: 1, borderTop: '1px dashed var(--line-2)' }} />
              <Mono>29 rooms</Mono>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: 4 }}>
              {rooms.filter(r => r.floor === f).map((r) => {
                // Inspected/Ready: muted (baseline). Action states pop.
                // Vacant dirty: solid red. Occupied: striped red. Clean: blue. Pickup: yellow. OOO: solid gray.
                const map = {
                  inspected: { bg: 'var(--surface-2)',   bd: 'var(--line-2)',     fg: 'var(--ink-3)',  glyph: null },
                  dirty:     { bg: 'var(--alert-soft)',  bd: 'var(--alert-line)', fg: 'var(--alert)',  glyph: null },
                  progress:  { bg: 'var(--alert-soft)',  bd: 'var(--alert-line)', fg: 'var(--alert)',  glyph: null, striped: true },
                  clean:     { bg: 'var(--info-soft)',   bd: 'var(--info-line)',  fg: 'var(--info)',   glyph: null },
                  pickup:    { bg: 'var(--caution-soft)',bd: 'var(--caution-line)',fg:'var(--caution)',glyph: null },
                  ooo:       { bg: 'var(--surface-3)',   bd: 'var(--line)',       fg: 'var(--ink-4)',  glyph: '×' },
                };
                const tone = map[r.status] || map.inspected;
                const statusLabel = {
                  inspected: 'Ready', dirty: 'Vacant dirty', progress: 'Occupied',
                  clean: 'Clean', pickup: 'Pickup', ooo: 'Out of order',
                }[r.status];
                return (
                  <div
                    key={r.num}
                    title={`${r.num} · ${statusLabel}`}
                    style={{
                      height: 22, borderRadius: 4,
                      background: tone.striped
                        ? 'repeating-linear-gradient(135deg, var(--alert-soft) 0 4px, color-mix(in oklab, var(--alert) 30%, var(--surface)) 4px 8px)'
                        : tone.bg,
                      border: `1px solid ${tone.bd}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 2,
                      fontSize: 9.5, fontFamily: 'var(--font-mono)',
                      color: tone.fg, position: 'relative',
                    }}
                  >
                    {tone.glyph && (
                      <span style={{ fontSize: 8, lineHeight: 1, opacity: 0.9 }}>{tone.glyph}</span>
                    )}
                    <span>{r.num % 100}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {/* Inline legend mirrors the live grid so users never need to learn a key */}
      <div style={{
        padding: '10px 16px 14px', borderTop: '1px solid var(--line-2)',
        display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--ink-3)',
      }}>
        {[
          { l: 'Ready',         bg: 'var(--surface-2)',   bd: 'var(--line-2)' },
          { l: 'Clean',         bg: 'var(--info-soft)',   bd: 'var(--info-line)' },
          { l: 'Vacant dirty',  bg: 'var(--alert-soft)',  bd: 'var(--alert-line)' },
          { l: 'Occupied',      striped: true,            bd: 'var(--alert-line)' },
          { l: 'Pickup',        bg: 'var(--caution-soft)', bd: 'var(--caution-line)' },
          { l: 'OOO',           bg: 'var(--surface-3)',   bd: 'var(--line)',       glyph: '×', fg: 'var(--ink-4)' },
        ].map((it, i) => (
          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3,
              background: it.striped
                ? 'repeating-linear-gradient(135deg, var(--alert-soft) 0 3px, color-mix(in oklab, var(--alert) 30%, var(--surface)) 3px 6px)'
                : it.bg,
              border: `1px solid ${it.bd}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 8, color: it.fg || 'transparent', lineHeight: 1,
            }}>{it.glyph}</span>
            <span>{it.l}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Housekeeper Dashboard — mobile-style task focus ─────────────────────────
function HousekeeperDashboard() {
  return (
    <div style={{ padding: '24px 32px 90px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GreetingHeader
        name="Maria"
        hint="12 rooms today, 7 left. You're 3 minutes ahead of your usual pace — nice."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="Rooms today" value="12" delta="7 left" deltaTone="info" icon="bed" />
        <Stat label="Done" value="5" delta="+3 ahead" deltaTone="ready" icon="check" />
        <Stat label="Avg time" value="22m" delta="−3m vs you" deltaTone="ready" icon="clock" />
        <Stat label="Inspect now" value="2" delta="floor 1" deltaTone="caution" icon="shield" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <MyRoomQueue />
        <PredictionsWidget />
      </div>
    </div>
  );
}

function MyRoomQueue() {
  const queue = [
    { num: '108', type: 'King · Stay', status: 'progress', time: '12m in', priority: 'pickup', notes: 'guest still in room — knock first', ai: 'Likely vacant by 11:15' },
    { num: '112', type: 'Queen · Checkout', status: 'dirty', time: 'next up', priority: null, notes: '', ai: null },
    { num: '115', type: 'Suite · VIP arrival', status: 'dirty', time: 'before 3pm', priority: 'rush', notes: 'extra pillows, fresh fruit', ai: 'VIP · prefers extra pillows (history)' },
    { num: '118', type: 'King · Stay', status: 'dirty', time: 'flex', priority: null, notes: '', ai: null },
    { num: '122', type: 'Double · Long stay', status: 'dirty', time: 'flex', priority: null, notes: 'day 6 deep-clean', ai: 'Suggest deep-clean tomorrow AM instead' },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 10px' }}>
        <SectionLabel hint="Today · floor 1" action={<Btn variant="ghost" size="sm">Reorder</Btn>}>My queue</SectionLabel>
      </div>
      <div>
        {queue.map((q, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '12px 16px',
            borderTop: '1px solid var(--line-2)',
            background: i === 0 ? 'var(--accent-soft)' : 'transparent',
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 10,
              background: 'var(--surface)', border: `1px solid var(--${q.status === 'progress' ? 'alert-line' : 'alert-line'})`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}>
              <Mono style={{ fontSize: 14, fontWeight: 600 }}>{q.num}</Mono>
              <StatusDot tone={q.status} size={6} />
              {i === 0 && <span style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--paper)' }}>1</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{q.type}</span>
                {q.priority === 'rush' && <Pill tone="accent" size="sm" icon="zap">rush</Pill>}
                {q.priority === 'pickup' && <Pill tone="pickup" size="sm">pickup</Pill>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{q.time}</span>
              </div>
              {q.notes && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>{q.notes}</div>}
              {q.ai && (
                <div style={{
                  marginTop: 7, display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, color: 'var(--ai)',
                  background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                  borderRadius: 6, padding: '3px 8px', width: 'fit-content',
                }}>
                  <Icon name="spark" size={10} stroke={2.4} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, opacity: 0.7 }}>AI</span>
                  <span>{q.ai}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Engineer Dashboard ──────────────────────────────────────────────────────
function EngineerDashboard() {
  return (
    <div style={{ padding: '24px 32px 90px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GreetingHeader
        name="Ravi"
        hint="5 open work orders, 2 high priority. AI flagged a recurring AC fault on the 207/209 fan-coil zone."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="Open WOs" value="6" delta="2 high" deltaTone="alert" icon="wrench" />
        <Stat label="Avg fix" value="38m" delta="−6m vs 30d" deltaTone="ready" icon="clock" />
        <Stat label="PMs due" value="3" delta="this week" deltaTone="caution" icon="cal" />
        <Stat label="Predicted" value="4" delta="next 72h" deltaTone="caution" icon="trend" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <EngineerWorkList />
        <FailurePredictionsMini />
      </div>
    </div>
  );
}

function EngineerWorkList() {
  const wos = [
    { id: 'WO-1142', t: 'Ice machine leak — back of house', loc: 'BOH', pri: 'high', age: '38m', tone: 'alert' },
    { id: 'WO-1140', t: 'AC blowing warm in 207', loc: 'R-207', pri: 'high', age: '1h', tone: 'alert' },
    { id: 'WO-1139', t: 'TV remote replacement', loc: 'R-405', pri: 'low', age: '2h', tone: 'neutral' },
    { id: 'WO-1138', t: 'Pool gate latch loose', loc: 'Pool', pri: 'med', age: '4h', tone: 'caution' },
    { id: 'WO-1135', t: 'Hallway light flicker', loc: 'F2', pri: 'med', age: 'yest', tone: 'caution' },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 10px' }}>
        <SectionLabel hint="Open" action={<Btn variant="ghost" size="sm">View board</Btn>}>Work orders</SectionLabel>
      </div>
      {wos.map((w, i) => (
        <div key={i} style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{w.id}</Mono>
          <Pill tone={w.tone} size="sm">{w.pri}</Pill>
          <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.t}</span>
          <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{w.loc}</Mono>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', width: 36, textAlign: 'right' }}>{w.age}</span>
        </div>
      ))}
    </Card>
  );
}

function FailurePredictionsMini() {
  const items = [
    { asset: 'Fan coil unit', loc: '207/209 zone', risk: 88, when: '72h', signals: ['2 complaints this week', 'belt overdue', 'amp draw +12%'] },
    { asset: 'Ice machine', loc: 'BOH', risk: 64, when: '5d', signals: ['leak today', 'descale 14d overdue'] },
    { asset: 'Elevator hydraulic', loc: 'East', risk: 41, when: '2w', signals: ['pump cycle +8%'] },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 10px' }}>
        <SectionLabel hint="72h horizon" action={<AILabel>Predictions</AILabel>}>Failure risk</SectionLabel>
      </div>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: '12px 16px', borderTop: '1px solid var(--line-2)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="thermometer" size={14} color="var(--ink-3)" />
            <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{it.asset}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{it.loc}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Bar value={it.risk} max={100} tone={it.risk > 75 ? 'alert' : it.risk > 50 ? 'caution' : 'info'} height={4} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: it.risk > 75 ? 'var(--alert)' : 'var(--ink-2)', fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{it.risk}%</span>
            <Mono style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 32, textAlign: 'right' }}>{it.when}</Mono>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {it.signals.map((s, j) => (
              <span key={j} style={{
                fontSize: 10.5, color: 'var(--ink-3)',
                background: 'var(--surface-2)', border: '1px solid var(--line-2)',
                padding: '1px 7px', borderRadius: 4,
              }}>{s}</span>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ─── Chief Engineer / GM Dashboard — financial + roll-ups ────────────────────
function GMDashboard() {
  return (
    <div style={{ padding: '24px 32px 90px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GreetingHeader
        name="Joel"
        hint="ROI tracking on plan. 4.7-day average labor variance. Two notable risks this week."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="Hours saved (mo)" value="142" unit="h" delta="+12%" deltaTone="ready" icon="clock" />
        <Stat label="Cost avoided" value="$3.4k" delta="+$420 vs Apr" deltaTone="ready" icon="trend" />
        <Stat label="Guest sat (NPS)" value="62" delta="+8" deltaTone="ready" icon="star" />
        <Stat label="AI spend" value="$1.84" unit="/room" delta="cap $2.50" deltaTone="info" icon="spark" />
      </div>
      <Card>
        <SectionLabel hint="May" action={<Btn variant="ghost" size="sm">Open report</Btn>}>Labor variance vs forecast</SectionLabel>
        <ChartMock />
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card padding={0}>
          <div style={{ padding: '14px 16px 10px' }}>
            <SectionLabel hint="Top">Operational risks</SectionLabel>
          </div>
          {[
            ['Fan coil cluster (207/209)', '88% failure risk · est. $2.1k if reactive', 'alert'],
            ['Staff coverage Sat night', 'one housekeeper PTO, no backup', 'caution'],
            ['SOP refresh: ice machine descale', 'last updated 11 mo ago', 'caution'],
          ].map(([t, s, tone], i) => (
            <div key={i} style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="alert" size={14} color={`var(--${tone})`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{s}</div>
              </div>
              <Btn variant="ghost" size="sm" iconRight="arrowR">Resolve</Btn>
            </div>
          ))}
        </Card>
        <ActivityFeed />
      </div>
    </div>
  );
}

// Very simple ascii-style chart (no slop)
function ChartMock() {
  const points = [42, 38, 45, 40, 36, 32, 28, 34, 30, 26, 30, 28, 24, 22];
  const max = 50;
  const fc =   [44, 42, 42, 40, 38, 36, 34, 34, 32, 32, 30, 30, 28, 28];
  return (
    <div style={{ height: 180, padding: '12px 4px 0', position: 'relative' }}>
      <svg width="100%" height="100%" viewBox="0 0 700 160" preserveAspectRatio="none">
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1="0" y1={g * 140 + 10} x2="700" y2={g * 140 + 10} stroke="var(--line-2)" strokeDasharray="2 4" />
        ))}
        {/* Forecast */}
        <polyline
          fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="4 4"
          points={fc.map((v, i) => `${(i / (fc.length - 1)) * 700},${10 + (1 - v / max) * 140}`).join(' ')}
        />
        {/* Actual */}
        <polyline
          fill="none" stroke="var(--accent)" strokeWidth="2.2"
          points={points.map((v, i) => `${(i / (points.length - 1)) * 700},${10 + (1 - v / max) * 140}`).join(' ')}
        />
        {/* Dots */}
        {points.map((v, i) => (
          <circle key={i} cx={(i / (points.length - 1)) * 700} cy={10 + (1 - v / max) * 140} r="2.5" fill="var(--accent)" />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--ink-3)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 2, background: 'var(--accent)' }} /> Actual
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 2, background: 'var(--ink-4)', borderTop: '1px dashed' }} /> Forecast
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>−6.2h variance · saved $186</span>
      </div>
    </div>
  );
}

// ─── Front Desk Dashboard ────────────────────────────────────────────────────
function FrontDeskDashboard() {
  return (
    <div style={{ padding: '24px 32px 90px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <GreetingHeader
        name="Alex"
        hint="34 departures, 41 arrivals, 6 VIPs. Three rooms still need to be ready before 3pm check-in."
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="Arrivals" value="41" delta="6 VIPs" deltaTone="accent" icon="user" />
        <Stat label="Departures" value="34" delta="11 cleared" deltaTone="info" icon="logout" />
        <Stat label="Walk-in inventory" value="13" delta="3 prem" deltaTone="ready" icon="key" />
        <Stat label="Open requests" value="3" delta="2 urgent" deltaTone="alert" icon="bell" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        <ArrivalsList />
        <Card padding={0}>
          <div style={{ padding: '14px 16px 10px' }}>
            <SectionLabel action={<Pill tone="accent" size="sm">3 open</Pill>}>Open guest requests</SectionLabel>
          </div>
          {[
            { i: 'drop', l: 'Extra towels · 418', t: '4m ago', tone: 'caution' },
            { i: 'wrench', l: 'AC adjusting · 207', t: '12m', tone: 'alert' },
            { i: 'mail', l: 'Late checkout req · 312', t: '23m', tone: 'info' },
          ].map((r, i) => (
            <div key={i} style={{ padding: '11px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name={r.i} size={14} color={`var(--${r.tone})`} />
              <span style={{ fontSize: 13, flex: 1 }}>{r.l}</span>
              <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.t}</Mono>
              <Btn variant="ghost" size="sm" iconRight="arrowR">Open</Btn>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function ArrivalsList() {
  const arrivals = [
    { name: 'Marcus Bell', vip: true, room: '418', time: '2:30 PM', notes: 'Frequent · extra pillows', ai: 'Room ready · pre-set' },
    { name: 'Sara Lin', vip: false, room: '301', time: '3:00 PM', notes: '', ai: null },
    { name: 'Reyes family (4)', vip: false, room: '512', time: '3:15 PM', notes: 'Connecting suite', ai: 'Cribs delivered' },
    { name: 'David Park', vip: true, room: '109', time: '3:45 PM', notes: 'Anniversary', ai: 'AI prepared welcome card' },
    { name: 'Olivia Cruz', vip: false, room: '226', time: '4:00 PM', notes: '', ai: null },
  ];
  return (
    <Card padding={0}>
      <div style={{ padding: '14px 16px 10px' }}>
        <SectionLabel hint="Today · 41 total" action={<Btn variant="ghost" size="sm">All arrivals</Btn>}>Upcoming arrivals</SectionLabel>
      </div>
      {arrivals.map((a, i) => (
        <div key={i} style={{
          padding: '12px 16px', borderTop: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Avatar name={a.name} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{a.name}</span>
              {a.vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}
            </div>
            {a.notes && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{a.notes}</div>}
            {a.ai && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: 'var(--ai)', marginTop: 4,
              }}>
                <Icon name="spark" size={10} stroke={2.4} /> {a.ai}
              </span>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <Mono style={{ fontSize: 12, fontWeight: 500 }}>{a.time}</Mono>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>Room {a.room}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

Object.assign(window, {
  SupervisorDashboard, HousekeeperDashboard, EngineerDashboard, GMDashboard, FrontDeskDashboard,
  GreetingHeader, MorningBriefing, LiveOpsStrip,
});
