/* Housekeeping screens — Room Status Board, Assignments, Inspections */
const { useState: _useStateHK } = React;

// ─── Room card (desktop board) ──────────────────────────────────────────────
function RoomCard({ num, status, type, assignee, mins, risk, vip, note }) {
  const tones = {
    dirty:     { bg: 'var(--alert-soft)',   border: 'var(--alert-line)',   fg: 'var(--alert)' },
    progress:  { bg: 'var(--alert-soft)',   border: 'var(--alert-line)',   fg: 'var(--alert)', striped: true },
    clean:     { bg: 'var(--info-soft)',    border: 'var(--info-line)',    fg: 'var(--info)' },
    inspected: { bg: 'var(--ready-soft)',   border: 'var(--ready-line)',   fg: 'var(--ready)' },
    pickup:    { bg: 'var(--caution-soft)', border: 'var(--caution-line)', fg: 'var(--caution)' },
    ooo:       { bg: 'var(--surface-3)',    border: 'var(--line)',         fg: 'var(--ink-3)' },
  };
  const labels = {
    dirty: 'Vacant dirty', progress: 'Occupied', clean: 'Clean', inspected: 'Ready', pickup: 'Pickup', ooo: 'OOO',
  };
  const t = tones[status];
  return (
    <div style={{
      background: t.striped
        ? 'repeating-linear-gradient(135deg, var(--surface) 0 6px, var(--alert-soft) 6px 12px)'
        : 'var(--surface)',
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      padding: '11px 12px',
      display: 'flex', flexDirection: 'column', gap: 7,
      minHeight: 116, position: 'relative',
    }}>
      {/* Top bar — colored status strip */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: t.fg, borderRadius: '12px 12px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Mono style={{ fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>{num}</Mono>
        {vip && <Pill tone="accent" size="sm" icon="star">VIP</Pill>}
        {risk && <span title="At risk" style={{
          marginLeft: 'auto', width: 16, height: 16, borderRadius: 4, background: 'var(--ai-soft)',
          color: 'var(--ai)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--ai-line)',
        }}><Icon name="spark" size={10} stroke={2.4} /></span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{type}</div>
      <div style={{ marginTop: 'auto' }}>
        <Pill tone={status} size="sm" icon={status === 'progress' ? 'user' : status === 'inspected' ? 'check' : null}>
          {labels[status]}{mins && status === 'progress' ? ` · ${mins}` : ''}
        </Pill>
      </div>
      {assignee && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Avatar name={assignee} size={18} />
          <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>{assignee.split(' ')[0]}</span>
        </div>
      )}
    </div>
  );
}

// ─── Room Status Board ──────────────────────────────────────────────────────
function HousekeepingBoard() {
  // Mock data
  const F1 = [
    { num: '101', status: 'inspected', type: 'King', assignee: 'Maria V.' },
    { num: '102', status: 'inspected', type: 'King', assignee: 'Maria V.' },
    { num: '103', status: 'clean', type: 'Queen', assignee: 'Maria V.' },
    { num: '104', status: 'progress', type: 'King', assignee: 'Maria V.', mins: '12m' },
    { num: '105', status: 'pickup', type: 'Double', risk: true },
    { num: '106', status: 'dirty', type: 'King', assignee: 'Tina A.' },
    { num: '107', status: 'inspected', type: 'King' },
    { num: '108', status: 'progress', type: 'Suite', assignee: 'Tina A.', mins: '8m', vip: true },
    { num: '109', status: 'inspected', type: 'King' },
    { num: '110', status: 'ooo', type: 'King' },
    { num: '111', status: 'dirty', type: 'Queen' },
    { num: '112', status: 'inspected', type: 'King' },
  ];
  const F2 = [
    { num: '201', status: 'inspected', type: 'King' },
    { num: '202', status: 'inspected', type: 'King' },
    { num: '203', status: 'clean', type: 'Queen', assignee: 'Carlos R.' },
    { num: '204', status: 'inspected', type: 'King' },
    { num: '205', status: 'dirty', type: 'Queen' },
    { num: '206', status: 'inspected', type: 'King' },
    { num: '207', status: 'dirty', type: 'King', risk: true },
    { num: '208', status: 'inspected', type: 'King' },
    { num: '209', status: 'dirty', type: 'Queen', risk: true },
    { num: '210', status: 'progress', type: 'Suite', assignee: 'Beatrix K.', mins: '31m' },
    { num: '211', status: 'inspected', type: 'King' },
    { num: '212', status: 'pickup', type: 'King' },
  ];
  const F3 = [
    { num: '301', status: 'dirty', type: 'King' },
    { num: '302', status: 'dirty', type: 'King' },
    { num: '303', status: 'dirty', type: 'King' },
    { num: '304', status: 'dirty', type: 'Queen' },
    { num: '305', status: 'dirty', type: 'Suite', vip: true },
    { num: '306', status: 'dirty', type: 'King' },
    { num: '307', status: 'progress', type: 'King', assignee: 'Carlos R.', mins: '4m' },
    { num: '308', status: 'inspected', type: 'King' },
    { num: '309', status: 'inspected', type: 'King' },
    { num: '310', status: 'inspected', type: 'King' },
    { num: '311', status: 'dirty', type: 'King' },
    { num: '312', status: 'progress', type: 'King', assignee: 'Beatrix K.', mins: '34m', risk: true },
  ];

  const filters = [
    { l: 'All', n: 87, active: true, tone: null },
    { l: 'Vacant dirty', n: 14, tone: 'dirty' },
    { l: 'Occupied', n: 9, tone: 'progress' },
    { l: 'Clean', n: 6, tone: 'clean' },
    { l: 'Ready', n: 52, tone: 'inspected' },
    { l: 'Pickup', n: 3, tone: 'pickup' },
    { l: 'OOO', n: 3, tone: 'ooo' },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Housekeeping"
        title="Room status board"
        meta={
          <>
            <Pill tone="ready" size="md" icon="check"><Mono>52 ready</Mono></Pill>
            <Pill tone="progress" size="md" icon="user"><Mono>9 occupied</Mono></Pill>
            <Pill tone="dirty" size="md" icon="alert"><Mono>14 vacant dirty</Mono></Pill>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ready)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ready)' }} /> Live · synced 12s ago
            </span>
          </>
        }
        actions={
          <>
            <Btn variant="outline" icon="filter" size="md">Filters</Btn>
            <Btn variant="outline" icon="grid" size="md">View</Btn>
            <Btn variant="dark" icon="users" size="md">Assign mode</Btn>
          </>
        }
      />

      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        {/* Main board */}
        <div>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 7, marginBottom: 18, flexWrap: 'wrap' }}>
            {filters.map((f, i) => (
              <button key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: f.active ? 'var(--ink)' : 'var(--surface)',
                color: f.active ? 'var(--paper)' : 'var(--ink-2)',
                border: f.active ? '1px solid var(--ink)' : '1px solid var(--line)',
                padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              }}>
                {f.tone && <StatusDot tone={f.tone} size={7} />}
                {f.l}
                <Mono style={{ fontSize: 11, opacity: 0.7, fontWeight: 600 }}>{f.n}</Mono>
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--ai-soft)', color: 'var(--ai)',
              border: '1px solid var(--ai-line)',
              padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
            }}>
              <Icon name="spark" size={11} stroke={2.4} /> At risk
              <Mono style={{ fontSize: 11, fontWeight: 700 }}>4</Mono>
            </button>
          </div>

          {/* Floors */}
          {[['Floor 1', F1, '12 rooms'], ['Floor 2', F2, '12 rooms'], ['Floor 3', F3, '12 rooms']].map(([title, rooms, hint]) => (
            <div key={title} style={{ marginBottom: 24 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10,
                paddingBottom: 8, borderBottom: '1px dashed var(--line-2)',
              }}>
                <h3 style={{
                  margin: 0, fontFamily: 'var(--font-display)', fontSize: 20,
                  fontWeight: 400, color: 'var(--ink)', letterSpacing: -0.2,
                }}>{title}</h3>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{hint}</Mono>
                <span style={{ flex: 1 }} />
                <button style={{
                  background: 'transparent', border: 'none', color: 'var(--ink-3)',
                  fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <Icon name="chevronD" size={12} /> Collapse
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                {rooms.map(r => <RoomCard key={r.num} {...r} />)}
              </div>
            </div>
          ))}
        </div>

        {/* AI Predictions sidebar */}
        <aside style={{ position: 'sticky', top: 16, alignSelf: 'flex-start' }}>
          <PredictionSidebar />
        </aside>
      </div>
    </div>
  );
}

function PredictionSidebar() {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'linear-gradient(180deg, var(--ai-soft), var(--surface))',
        padding: '14px 16px', borderBottom: '1px solid var(--line-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <AILabel>Predictions</AILabel>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>updated 2m</span>
        </div>
        <p style={{
          margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
          fontSize: 17, lineHeight: 1.4, color: 'var(--ink)',
        }}>
          4 rooms likely to need attention before 3pm check-in.
        </p>
      </div>
      <div>
        {[
          { room: '312', kind: 'Running over', detail: '34m elapsed · 12m above average', conf: 91, action: 'Reassign 313/314 to Maria' },
          { room: '207', kind: 'AC complaint risk', detail: 'Same zone as 209 · 2nd this week', conf: 88, action: 'Pre-emptive WO' },
          { room: '418', kind: 'VIP pre-set', detail: 'Returning guest · extra pillows', conf: 99, action: 'Mark pickup' },
          { room: '105', kind: 'Deep clean signal', detail: 'Long stay day 6 of 9', conf: 64, action: 'Suggest tomorrow' },
        ].map((p, i) => (
          <div key={i} style={{
            padding: '13px 16px', borderTop: '1px solid var(--line-2)',
            display: 'flex', flexDirection: 'column', gap: 7,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mono style={{ fontSize: 13, fontWeight: 600 }}>{p.room}</Mono>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{p.kind}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ai)', fontWeight: 600 }}>{p.conf}%</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{p.detail}</div>
            <button style={{
              background: 'var(--surface-2)', border: '1px solid var(--line-2)',
              borderRadius: 6, padding: '6px 9px',
              fontSize: 11.5, color: 'var(--ink)', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer',
            }}>
              <Icon name="arrowR" size={11} color="var(--accent)" />
              <span style={{ color: 'var(--ink)' }}>{p.action}</span>
            </button>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between' }}>
        <Btn variant="ghost" size="sm">Dismiss all</Btn>
        <Btn variant="ai" size="sm" icon="check">Apply 4</Btn>
      </div>
    </div>
  );
}

// ─── Assignments view ────────────────────────────────────────────────────────
function AssignmentsView() {
  const houseks = [
    { name: 'Maria Vega',   load: 14, capacity: 14, mins: 22, status: 'on-pace', rooms: ['101','102','103','104','105','106','107','108','109','110','111','112','113','114'] },
    { name: 'Tina Aoki',    load: 13, capacity: 14, mins: 28, status: 'on-pace', rooms: ['115','116','117','118','119','120','121','201','202','203','204','205','206'] },
    { name: 'Carlos Ruiz',  load: 13, capacity: 14, mins: 24, status: 'on-pace', rooms: ['207','208','209','210','211','212','301','302','303','304','305','306','307'] },
    { name: 'Beatrix Khan', load: 12, capacity: 14, mins: 31, status: 'over',    rooms: ['308','309','310','311','312','313','314','315','316','317','318','319'] },
    { name: 'Unassigned',   load: 4,  capacity: 0,  mins: '—', status: 'unassigned', rooms: ['320','321','322','323'] },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Housekeeping · Today"
        title="Assignments"
        subtitle="Drag rooms between housekeepers. AI suggests optimal pairing based on floor proximity, room type, and historic clean time."
        actions={
          <>
            <Btn variant="outline" size="md" icon="cal">Tue, May 26</Btn>
            <Btn variant="ai" size="md" icon="spark">AI auto-assign</Btn>
            <Btn variant="primary" size="md" icon="check">Publish</Btn>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {houseks.map((h, i) => (
            <Card padding={0} key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line-2)' }}>
                {h.name !== 'Unassigned' ? <Avatar name={h.name} size={36} /> : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                    <Icon name="user" size={14} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{h.name}</span>
                    {h.status === 'over' && <Pill tone="caution" size="sm" icon="alert">over load</Pill>}
                    {h.status === 'unassigned' && <Pill tone="alert" size="sm">unassigned</Pill>}
                  </div>
                  {h.name !== 'Unassigned' && (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                      <Mono>{h.mins}m</Mono> avg clean · capacity <Mono>{h.capacity}</Mono>
                    </div>
                  )}
                </div>
                <div style={{ width: 180 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--ink-3)' }}>Load</span>
                    <Mono>{h.load}{h.capacity ? `/${h.capacity}` : ''}</Mono>
                  </div>
                  <Bar value={h.load} max={Math.max(h.capacity, 1)} tone={h.status === 'over' ? 'caution' : h.status === 'unassigned' ? 'alert' : 'ready'} height={4} />
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {h.rooms.map((r) => (
                  <span key={r} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                    background: 'var(--surface-2)', border: '1px solid var(--line)',
                    padding: '4px 9px', borderRadius: 6, color: 'var(--ink)',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                    {r}
                  </span>
                ))}
                <button style={{
                  fontSize: 12, color: 'var(--ink-3)', background: 'transparent',
                  border: '1px dashed var(--line)', padding: '4px 9px', borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  <Icon name="plus" size={11} /> Add
                </button>
              </div>
            </Card>
          ))}
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            background: 'var(--ink)', color: 'var(--paper)',
            borderRadius: 'var(--r-lg)', padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon name="spark" size={12} color="var(--accent)" stroke={2.4} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>AI insight</span>
            </div>
            <p style={{
              margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 16, lineHeight: 1.4,
            }}>
              Pairing <strong style={{ fontStyle: 'normal' }}>Beatrix with Maria on floor 1</strong> would lift average clean time by 11% — Beatrix runs 9 minutes over on King checkouts.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={{
                background: 'var(--accent)', color: 'var(--accent-ink)',
                border: 'none', borderRadius: 7, padding: '7px 11px',
                fontSize: 12, fontWeight: 500,
              }}>Apply suggestion</button>
              <button style={{
                background: 'transparent', color: 'var(--paper)',
                border: '1px solid rgba(255,255,255,0.2)', borderRadius: 7, padding: '7px 11px',
                fontSize: 12,
              }}>Dismiss</button>
            </div>
          </div>
          <Card>
            <SectionLabel hint="Today">Summary</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[['Total rooms', '56'], ['Assigned', '52'], ['Unassigned', '4'], ['Est. labor', '21h 30m'], ['Forecast', '20h 50m'], ['Variance', '+40m']].map(([l, v], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--ink-3)' }}>{l}</span>
                  <Mono style={{ fontWeight: 500 }}>{v}</Mono>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Inspections ─────────────────────────────────────────────────────────────
function InspectionsView() {
  const queue = [
    { num: '103', cleaner: 'Maria Vega', completed: '12 min ago', notes: 'Standard checkout · 28m', score: null, status: 'pending' },
    { num: '107', cleaner: 'Maria Vega', completed: '23 min ago', notes: 'Touch-up only', score: null, status: 'pending' },
    { num: '203', cleaner: 'Carlos Ruiz', completed: '31 min ago', notes: 'Long stay · day 9', score: null, status: 'pending' },
    { num: '102', cleaner: 'Maria Vega', completed: '54 min ago', notes: '', score: 97, status: 'passed' },
    { num: '101', cleaner: 'Maria Vega', completed: '1h ago', notes: '', score: 94, status: 'passed' },
    { num: '208', cleaner: 'Tina Aoki', completed: '1h ago', notes: 'Bathroom re-check needed', score: 78, status: 'reopened' },
  ];

  const checklist = [
    { area: 'Bedroom', items: ['Linens crisp & aligned', 'Pillows angle-set', 'Nightstand cleared', 'TV remote sanitized'] },
    { area: 'Bathroom', items: ['Mirror streak-free', 'Tub & grout', 'Towels rolled', 'Amenities stocked'] },
    { area: 'Floor', items: ['Vacuumed', 'Baseboards dusted'] },
    { area: 'Touch points', items: ['Door handles', 'Light switches', 'Thermostat'] },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Housekeeping"
        title="Inspections"
        subtitle="Pass, reopen, or flag rooms after housekeeping completes. AI compares photo + checklist signals to your hotel's standard."
        actions={
          <>
            <Btn variant="outline" icon="camera" size="md">Photo audit</Btn>
            <Btn variant="dark" icon="plus" size="md">Random check</Btn>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 24 }}>
        <Card padding={0}>
          <div style={{ padding: '14px 16px 10px' }}>
            <SectionLabel hint={`${queue.filter(q => q.status === 'pending').length} pending`}>Queue</SectionLabel>
          </div>
          {queue.map((q, i) => (
            <div key={i} style={{
              padding: '12px 16px', borderTop: '1px solid var(--line-2)',
              display: 'flex', alignItems: 'center', gap: 12,
              background: q.status === 'reopened' ? 'var(--alert-soft)' : i === 0 ? 'var(--accent-soft)' : 'transparent',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'var(--surface)', border: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Mono style={{ fontSize: 14, fontWeight: 600 }}>{q.num}</Mono>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{q.cleaner}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  Done {q.completed}{q.notes ? ' · ' + q.notes : ''}
                </div>
              </div>
              {q.status === 'pending' && <Pill tone="caution" size="sm">to inspect</Pill>}
              {q.status === 'passed' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Pill tone="ready" size="sm" icon="check">passed</Pill>
                  <Mono style={{ fontSize: 12, color: 'var(--ready)' }}>{q.score}</Mono>
                </span>
              )}
              {q.status === 'reopened' && <Pill tone="alert" size="sm" icon="alert">reopened</Pill>}
            </div>
          ))}
        </Card>

        {/* Active inspection */}
        <Card padding={0}>
          <div style={{
            padding: '14px 16px',
            background: 'var(--surface-2)', borderBottom: '1px solid var(--line-2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Mono style={{ fontSize: 22, fontWeight: 600 }}>103</Mono>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Queen · Standard checkout</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>By Maria Vega · cleaned in 28m</div>
              </div>
              <Pill tone="info" size="md" icon="clock">12m ago</Pill>
            </div>
            <div style={{
              marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
              borderRadius: 9, padding: '8px 11px',
            }}>
              <Icon name="spark" size={12} color="var(--ai)" stroke={2.4} />
              <span style={{ fontSize: 12, color: 'var(--ai)', flex: 1 }}>
                AI pre-check: <strong>92% confidence pass</strong> · linens crisp, surfaces clean. Slight smudge on mirror (photo 2).
              </span>
            </div>
          </div>

          {/* Photos */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)' }}>
            <SectionLabel hint="4 of 12">Photos by Maria</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { l: 'bed', tone: 'ready' },
                { l: 'mirror · smudge?', tone: 'caution' },
                { l: 'bath', tone: 'ready' },
                { l: 'floor', tone: 'ready' },
              ].map((p, i) => (
                <div key={i} style={{
                  aspectRatio: '1', borderRadius: 8, border: '1px solid var(--line)',
                  background: `repeating-linear-gradient(135deg, var(--surface-3) 0 8px, var(--surface-2) 8px 16px)`,
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', bottom: 5, left: 5, right: 5,
                    background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 5,
                    padding: '2px 5px', fontSize: 9.5, display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <StatusDot tone={p.tone} size={5} />
                    {p.l}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Checklist */}
          <div style={{ padding: '14px 16px' }}>
            <SectionLabel hint="14 items">Checklist</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {checklist.map((c, ci) => (
                <div key={ci}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{c.area}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {c.items.map((it, ii) => {
                      const isMirror = it.includes('Mirror');
                      return (
                        <label key={ii} style={{
                          display: 'flex', alignItems: 'center', gap: 9,
                          padding: '6px 8px',
                          borderRadius: 6,
                          background: isMirror ? 'var(--caution-soft)' : 'transparent',
                        }}>
                          <span style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: '1.5px solid var(--line)',
                            background: !isMirror ? 'var(--ready)' : 'var(--surface)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {!isMirror && <Icon name="check" size={10} color="#fff" stroke={3} />}
                          </span>
                          <span style={{ fontSize: 12.5, flex: 1, color: 'var(--ink)', textDecoration: !isMirror ? 'line-through' : 'none', textDecorationColor: 'var(--ink-4)' }}>{it}</span>
                          {isMirror && <Pill tone="caution" size="sm">re-check</Pill>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: 14, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8 }}>
            <Btn variant="outline" size="md" full icon="x">Reopen</Btn>
            <Btn variant="primary" size="md" full icon="check">Pass · Mark ready</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { HousekeepingBoard, AssignmentsView, InspectionsView, RoomCard, PredictionSidebar });
