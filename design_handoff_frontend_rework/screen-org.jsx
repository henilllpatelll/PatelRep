/* Org screens — Staff, Scheduling, Reports */

// ─── Staff ───────────────────────────────────────────────────────────────────
function StaffScreen() {
  const people = [
    { name: 'Mia Patel',     role: 'Supervisor',       dept: 'Housekeeping', shift: 'Day', hire: '2 yr', pace: 22, status: 'on-shift' },
    { name: 'Maria Vega',    role: 'Housekeeper',      dept: 'Housekeeping', shift: 'Day', hire: '4 yr', pace: 22, status: 'on-shift' },
    { name: 'Tina Aoki',     role: 'Housekeeper',      dept: 'Housekeeping', shift: 'Day', hire: '2 yr', pace: 28, status: 'on-shift' },
    { name: 'Carlos Ruiz',   role: 'Housekeeper',      dept: 'Housekeeping', shift: 'Day', hire: '1 yr', pace: 24, status: 'on-shift' },
    { name: 'Beatrix Khan',  role: 'Housekeeper',      dept: 'Housekeeping', shift: 'Day', hire: '4 mo', pace: 31, status: 'on-shift', risk: true },
    { name: 'Jordan Lee',    role: 'Inspector',        dept: 'Housekeeping', shift: 'Day', hire: '5 yr', pace: 5,  status: 'on-shift' },
    { name: 'Ravi Patel',    role: 'Engineer',         dept: 'Engineering',  shift: 'Day', hire: '6 yr', pace: 38, status: 'on-shift' },
    { name: 'Diego Nuñez',   role: 'Engineer',         dept: 'Engineering',  shift: 'Day', hire: '3 yr', pace: 42, status: 'on-shift' },
    { name: 'Joel Kim',      role: 'Chief Engineer',   dept: 'Engineering',  shift: 'Day', hire: '8 yr', pace: '—', status: 'on-shift' },
    { name: 'Alex Marquez',  role: 'Front Desk',       dept: 'Front Desk',   shift: 'Day', hire: '3 yr', pace: '—', status: 'on-shift' },
    { name: 'Hana Kim',      role: 'Housekeeper',      dept: 'Housekeeping', shift: 'PM',  hire: '1 yr', pace: 26, status: 'off' },
    { name: 'Pablo Soto',    role: 'Night Engineer',   dept: 'Engineering',  shift: 'Night', hire: '2 yr', pace: 44, status: 'off' },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Organization"
        title="Staff"
        meta={
          <>
            <Pill tone="ready" size="md" icon="check"><Mono>10</Mono> on shift</Pill>
            <Pill tone="info" size="md"><Mono>14</Mono> total active</Pill>
            <Pill tone="caution" size="md" icon="alert"><Mono>1</Mono> coaching flag</Pill>
          </>
        }
        actions={
          <>
            <Btn variant="outline" size="md" icon="filter">Filters</Btn>
            <Btn variant="outline" size="md" icon="cal">Schedule</Btn>
            <Btn variant="primary" size="md" icon="plus">Invite</Btn>
          </>
        }
        tabs={[
          { label: 'Roster', count: 14, active: true },
          { label: 'Roles', count: 6 },
          { label: 'Performance' },
          { label: 'Onboarding', count: 2 },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        <Card padding={0}>
          <div style={{
            padding: '10px 16px',
            display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 80px 1fr',
            gap: 14, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-3)',
            borderBottom: '1px solid var(--line)',
          }}>
            <span>Person</span><span>Role · Dept</span><span>Shift · Tenure</span><span>Pace</span><span>Status</span>
          </div>
          {people.map((p, i) => (
            <div key={i} style={{
              padding: '12px 16px',
              display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 80px 1fr',
              gap: 14, alignItems: 'center',
              borderBottom: '1px solid var(--line-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar name={p.name} size={32} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.name.toLowerCase().replace(' ', '.')}@lonestarinn.com</div>
                </div>
              </div>
              <div style={{ fontSize: 12.5 }}>
                <div>{p.role}</div>
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{p.dept}</div>
              </div>
              <div style={{ fontSize: 12.5 }}>
                <div>{p.shift}</div>
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{p.hire}</div>
              </div>
              <div>
                {typeof p.pace === 'number' ? (
                  <Mono style={{ fontSize: 12, color: p.risk ? 'var(--caution)' : 'var(--ink)' }}>{p.pace}m</Mono>
                ) : (
                  <Mono style={{ fontSize: 12, color: 'var(--ink-4)' }}>—</Mono>
                )}
              </div>
              <div>
                {p.status === 'on-shift' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ready)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ready)' }} />
                    On shift
                  </span>
                )}
                {p.status === 'off' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-4)' }} />
                    Off
                  </span>
                )}
                {p.risk && (
                  <Pill tone="caution" size="sm" style={{ marginLeft: 6 }}>coach</Pill>
                )}
              </div>
            </div>
          ))}
        </Card>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            background: 'var(--ink)', color: 'var(--paper)',
            borderRadius: 'var(--r-lg)', padding: '16px 18px',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 90% 20%, var(--accent) 0%, transparent 50%)', opacity: 0.2 }} />
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <Icon name="spark" size={12} color="var(--accent)" stroke={2.4} />
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>Coaching insight</span>
              </div>
              <p style={{
                margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
                fontSize: 15.5, lineHeight: 1.5,
              }}>
                <strong style={{ fontStyle: 'normal' }}>Beatrix Khan</strong> is averaging 9 min over on King checkouts after 4 months. Same-shift pairing with Maria for 1 week typically lifts pace by 7m.
              </p>
              <Btn variant="primary" size="sm" icon="users" style={{ marginTop: 12 }}>Schedule pairing</Btn>
            </div>
          </div>
          <Card padding={0}>
            <div style={{ padding: '14px 16px 10px' }}>
              <SectionLabel hint="By department">Headcount</SectionLabel>
            </div>
            {[
              ['Housekeeping', 7, 'var(--accent)'],
              ['Engineering', 4, 'var(--ready)'],
              ['Front desk', 2, 'var(--caution)'],
              ['Leadership', 1, 'var(--info)'],
            ].map(([n, c, color], i) => (
              <div key={i} style={{ padding: '9px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{n}</span>
                <Mono style={{ fontSize: 12, fontWeight: 600 }}>{c}</Mono>
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Scheduling ──────────────────────────────────────────────────────────────
function SchedulingScreen() {
  const days = ['Mon 26', 'Tue 27', 'Wed 28', 'Thu 29', 'Fri 30', 'Sat 31', 'Sun 1'];
  const ppl = [
    { name: 'Maria Vega',    role: 'HK', sched: ['D','D','D','OFF','D','D','D'] },
    { name: 'Tina Aoki',     role: 'HK', sched: ['D','D','OFF','D','D','D','D'] },
    { name: 'Carlos Ruiz',   role: 'HK', sched: ['D','D','D','D','D','OFF','OFF'] },
    { name: 'Beatrix Khan',  role: 'HK', sched: ['D','D','D','D','OFF','D','D'] },
    { name: 'Hana Kim',      role: 'HK', sched: ['PM','PM','PM','PM','OFF','PM','PM'] },
    { name: 'Jordan Lee',    role: 'IN', sched: ['D','D','D','D','D','D','OFF'] },
    { name: 'Ravi Patel',    role: 'EN', sched: ['D','D','D','D','D','OFF','OFF'] },
    { name: 'Diego Nuñez',   role: 'EN', sched: ['D','D','OFF','D','D','D','D'] },
    { name: 'Pablo Soto',    role: 'EN', sched: ['N','N','N','OFF','N','N','N'] },
    { name: 'Alex Marquez',  role: 'FD', sched: ['D','D','D','D','OFF','D','D'] },
  ];
  const cellStyle = (s) => {
    if (s === 'OFF') return { background: 'var(--surface-2)', color: 'var(--ink-4)', border: '1px dashed var(--line)' };
    if (s === 'PM') return { background: 'var(--caution-soft)', color: 'var(--caution)', border: '1px solid var(--caution-line)' };
    if (s === 'N') return { background: 'var(--ai-soft)', color: 'var(--ai)', border: '1px solid var(--ai-line)' };
    return { background: 'var(--ready-soft)', color: 'var(--ready)', border: '1px solid var(--ready-line)' };
  };

  // Demand forecast bars (hours per day)
  const demand = [42, 38, 36, 40, 52, 58, 48];
  const coverage = [38, 38, 32, 36, 40, 50, 44];

  return (
    <div>
      <PageHeader
        eyebrow="Organization"
        title="Scheduling"
        subtitle="Weekly shift planner with AI-forecasted demand. Drag shifts to rebalance. Auto-generate from forecast in one tap."
        actions={
          <>
            <Btn variant="outline" size="md" icon="cal">May 26 — Jun 1</Btn>
            <Btn variant="outline" size="md" icon="users">By role</Btn>
            <Btn variant="ai" size="md" icon="spark">AI auto-fill</Btn>
            <Btn variant="primary" size="md" icon="check">Publish</Btn>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
        <Card padding={0}>
          {/* Demand strip */}
          <div style={{
            display: 'grid', gridTemplateColumns: '170px repeat(7, 1fr)',
            background: 'var(--surface-2)', borderBottom: '1px solid var(--line)',
          }}>
            <div style={{
              padding: '10px 14px', fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)',
              textTransform: 'uppercase', letterSpacing: 1,
              display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <Icon name="spark" size={11} color="var(--ai)" stroke={2.4} />
              Forecast
            </div>
            {demand.map((d, i) => (
              <div key={i} style={{ padding: '8px 8px 10px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{d}h</Mono>
                <div style={{ width: '100%', height: 4 }}>
                  <Bar value={d} max={60} tone={d > coverage[i] ? 'caution' : 'ready'} height={3} />
                </div>
                {d > coverage[i] && <span style={{ fontSize: 9.5, color: 'var(--caution)', fontFamily: 'var(--font-mono)' }}>+{d - coverage[i]}h short</span>}
              </div>
            ))}
          </div>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '170px repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--ink-3)' }}></div>
            {days.map((d, i) => (
              <div key={i} style={{
                padding: '10px 8px', borderLeft: '1px solid var(--line)',
                fontSize: 11.5, fontWeight: 600, textAlign: 'center',
                color: i === 0 ? 'var(--accent)' : 'var(--ink-2)',
              }}>{d}</div>
            ))}
          </div>
          {/* Rows */}
          {ppl.map((p, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '170px repeat(7, 1fr)',
              borderBottom: '1px solid var(--line-2)',
              alignItems: 'stretch',
            }}>
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <Avatar name={p.name} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{p.role}</div>
                </div>
              </div>
              {p.sched.map((s, j) => (
                <div key={j} style={{
                  padding: 6, borderLeft: '1px solid var(--line-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    ...cellStyle(s),
                    borderRadius: 6, padding: '6px 0', textAlign: 'center',
                    width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600,
                  }}>{s}</div>
                </div>
              ))}
            </div>
          ))}
        </Card>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionLabel hint="Color key">Shift legend</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { l: 'Day · 7am-3pm', s: 'D', tone: 'ready' },
                { l: 'PM · 2pm-10pm', s: 'PM', tone: 'caution' },
                { l: 'Night · 10pm-7am', s: 'N', tone: 'ai' },
                { l: 'Off', s: 'OFF', tone: 'neutral' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    ...cellStyle(item.s),
                    width: 36, padding: '3px 0', textAlign: 'center',
                    borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  }}>{item.s}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{item.l}</span>
                </div>
              ))}
            </div>
          </Card>
          <div style={{
            background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
            borderRadius: 'var(--r-lg)', padding: '14px 16px',
          }}>
            <AILabel confidence={87}>Demand fit</AILabel>
            <p style={{
              margin: '10px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
              fontSize: 15, lineHeight: 1.5, color: 'var(--ai)',
            }}>
              You're <strong style={{ fontStyle: 'normal' }}>8 hours short on Saturday</strong>. Tina or Carlos historically picks up Saturday overtime. Add 1 PM-shift housekeeper.
            </p>
            <Btn variant="ai" size="sm" icon="plus" style={{ marginTop: 10 }}>Suggest fill</Btn>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────────────
function ReportsScreen() {
  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Reports"
        subtitle="ROI, labor, guest satisfaction, AI usage. Every report is a one-click PDF or scheduled email."
        actions={
          <>
            <Btn variant="outline" size="md" icon="cal">May 2026</Btn>
            <Btn variant="outline" size="md" icon="filter">Compare</Btn>
            <Btn variant="primary" size="md" icon="doc">Export PDF</Btn>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          <Stat label="Hours saved" value="142" unit="h" delta="+12%" deltaTone="ready" icon="clock" />
          <Stat label="Cost avoided" value="$3.4k" delta="+$420 vs Apr" deltaTone="ready" icon="trend" />
          <Stat label="Clean time" value="24m" delta="−3m vs target" deltaTone="ready" icon="bed" />
          <Stat label="Guest NPS" value="62" delta="+8" deltaTone="ready" icon="star" />
          <Stat label="AI ROI" value="11.4x" delta="vs spend" deltaTone="ready" icon="spark" />
        </div>

        {/* Big chart */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22 }}>Labor saved vs forecast</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>By day · May 2026 · Housekeeping + Engineering</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn variant="outline" size="sm">By dept</Btn>
              <Btn variant="dark" size="sm">By day</Btn>
              <Btn variant="outline" size="sm">By role</Btn>
            </div>
          </div>
          <ChartMock />
        </Card>

        {/* Grid of mini reports */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { t: 'Clean time by housekeeper', s: 'Maria leads · 22m avg', n: '6 staff' },
            { t: 'WO resolution time', s: 'High-pri 38m avg', n: '25 WOs' },
            { t: 'Guest request SLA', s: '92% on time', n: '142 reqs' },
            { t: 'AI spend per room', s: '$1.84 of $2.50 cap', n: '87 rooms' },
            { t: 'Predicted vs reactive', s: '11 prevented · $2.4k', n: 'last 30d' },
            { t: 'PM compliance', s: '94% on schedule', n: '8 PMs' },
          ].map((r, i) => (
            <Card key={i}>
              <SectionLabel hint={r.n} action={<Btn variant="ghost" size="sm" iconRight="arrowR">Open</Btn>}>{r.t}</SectionLabel>
              <div style={{ marginTop: 8, fontSize: 14.5, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>{r.s}</div>
              <div style={{ marginTop: 12, height: 32, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                {Array.from({ length: 14 }).map((_, j) => (
                  <div key={j} style={{
                    flex: 1,
                    height: `${20 + ((j * 31 + i * 17) % 80)}%`,
                    background: j === 13 ? 'var(--accent)' : 'var(--surface-3)',
                    borderRadius: 2,
                  }} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { StaffScreen, SchedulingScreen, ReportsScreen });
