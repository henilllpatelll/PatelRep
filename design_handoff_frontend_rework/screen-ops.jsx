/* Ops screens — Tasks, Guest Requests, Logbook, Lost & Found */

// ─── Tasks ────────────────────────────────────────────────────────────────
function TasksScreen() {
  const groups = [
    { label: 'Overdue', tone: 'alert', items: [
      { t: 'Refill pool chemicals', from: 'Joel K.', by: 'Diego', due: 'Today 9am', tags: ['pool','safety'], p: 'high' },
      { t: 'Order new pillow inserts (qty 24)', from: 'AI', by: 'Mia', due: 'Yesterday', tags: ['housekeeping','inventory'], p: 'med', ai: true },
    ]},
    { label: 'Today', tone: 'caution', items: [
      { t: 'Inspect 312, 313, 314 after Beatrix', from: 'You', by: 'Jordan', due: '11:30 AM', tags: ['housekeeping'], p: 'med' },
      { t: 'Call Otis re: elevator chime', from: 'You', by: 'Ravi', due: '1 PM', tags: ['vendor'], p: 'low' },
      { t: 'VIP arrival prep · 418 Mr. Bell', from: 'PMS', by: 'Alex', due: '2:30 PM', tags: ['front-desk','vip'], p: 'high' },
      { t: 'Approve SOP refresh · ice machine', from: 'AI', by: 'Mia', due: '3 PM', tags: ['sop'], p: 'low', ai: true },
    ]},
    { label: 'This week', tone: 'info', items: [
      { t: 'Quarterly fire safety walkthrough', from: 'PM schedule', by: 'Joel', due: 'Thu', tags: ['pm','safety'], p: 'high' },
      { t: 'Renew linen contract', from: 'Mia', by: 'Joel', due: 'Fri', tags: ['vendor'], p: 'med' },
    ]},
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Tasks"
        meta={
          <>
            <Pill tone="alert" size="md" icon="alert"><Mono>2</Mono> overdue</Pill>
            <Pill tone="caution" size="md" icon="clock"><Mono>4</Mono> today</Pill>
            <Pill tone="ai" size="md" icon="spark"><Mono>3</Mono> AI-suggested</Pill>
          </>
        }
        actions={
          <>
            <Btn variant="outline" size="md" icon="filter">Filters</Btn>
            <Btn variant="outline" size="md" icon="users">Assignee</Btn>
            <Btn variant="primary" size="md" icon="plus">New task</Btn>
          </>
        }
        tabs={[
          { label: 'All', count: 18, active: true },
          { label: 'My tasks', count: 5 },
          { label: 'Delegated', count: 7 },
          { label: 'AI suggested', count: 3 },
          { label: 'Done', count: 142 },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                paddingBottom: 8, marginBottom: 6,
                borderBottom: '1px dashed var(--line-2)',
              }}>
                <StatusDot tone={g.tone} />
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{g.label}</h3>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{g.items.length}</Mono>
              </div>
              {g.items.map((it, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: '10px 8px',
                  borderBottom: '1px solid var(--line-2)',
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: 5,
                    border: '1.5px solid var(--line)',
                    flexShrink: 0,
                  }} />
                  <Pill tone={it.p === 'high' ? 'alert' : it.p === 'med' ? 'caution' : 'neutral'} size="sm">{it.p}</Pill>
                  <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, color: 'var(--ink)' }}>{it.t}</span>
                  {it.ai && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 600, color: 'var(--ai)',
                      background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                      padding: '1px 6px', borderRadius: 4, letterSpacing: 0.4,
                    }}>
                      <Icon name="spark" size={9} stroke={2.4} /> AI
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: 5 }}>
                    {it.tags.map(t => (
                      <span key={t} style={{
                        fontSize: 10.5, color: 'var(--ink-3)',
                        background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 3,
                      }}>#{t}</span>
                    ))}
                  </div>
                  <Avatar name={it.by} size={22} />
                  <Mono style={{ fontSize: 11, color: gi === 0 ? 'var(--alert)' : 'var(--ink-3)', minWidth: 72, textAlign: 'right' }}>{it.due}</Mono>
                </div>
              ))}
            </div>
          ))}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionLabel>Quick capture</SectionLabel>
            <div style={{
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '10px 12px',
              fontSize: 13, color: 'var(--ink-3)', marginBottom: 10,
            }}>
              Type or speak — AI parses to a task…
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn variant="ai" size="sm" icon="spark" full>Parse</Btn>
              <Btn variant="outline" size="sm" icon="phone">Voice</Btn>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Try: <em>"have Diego clean the pool filter tomorrow morning before 8"</em>
            </div>
          </Card>
          <Card padding={0}>
            <div style={{ padding: '14px 16px 10px' }}>
              <SectionLabel hint="This week">By assignee</SectionLabel>
            </div>
            {[
              ['Mia P.',     5],
              ['Jordan L.',  3],
              ['Ravi P.',    4],
              ['Alex M.',    3],
              ['Diego N.',   2],
              ['Joel K.',    1],
            ].map(([n, count], i) => (
              <div key={i} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 9 }}>
                <Avatar name={n} size={22} />
                <span style={{ fontSize: 12.5, flex: 1 }}>{n}</span>
                <div style={{ width: 80 }}>
                  <Bar value={count} max={5} tone="accent" height={3} />
                </div>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{count}</Mono>
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Guest Requests ─────────────────────────────────────────────────────────
function GuestRequestsScreen() {
  const reqs = [
    { id: 'GR-441', g: 'Marcus Bell', room: '418', vip: true, req: 'Extra towels & 2 bottled waters', via: 'app', at: '4m ago', sla: '11m', tone: 'caution', status: 'open', ai: 'Frequent guest preference' },
    { id: 'GR-440', g: 'Sara Lin', room: '301', vip: false, req: 'AC not cooling — set to 68 but reads 74', via: 'phone', at: '12m', sla: 'BREACH', tone: 'alert', status: 'open' },
    { id: 'GR-439', g: 'Reyes family', room: '512', vip: false, req: 'Late checkout to 1pm', via: 'text', at: '23m', sla: '7m', tone: 'caution', status: 'assigned', who: 'Alex' },
    { id: 'GR-438', g: 'Olivia Cruz', room: '226', vip: false, req: 'Iron and ironing board', via: 'app', at: '34m', sla: 'ok', tone: 'ready', status: 'assigned', who: 'Maria' },
    { id: 'GR-435', g: 'David Park', room: '109', vip: true, req: 'Anniversary surprise — flowers & champagne', via: 'concierge', at: '1h', sla: 'on track', tone: 'ai', status: 'in-progress', who: 'Alex', ai: 'AI drafted welcome card' },
    { id: 'GR-432', g: 'Hannah Choi', room: '404', vip: false, req: 'Quieter floor request', via: 'app', at: '2h', sla: 'ok', tone: 'ready', status: 'resolved' },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Guest requests"
        subtitle="Every request, every channel, with SLA timers and AI-suggested responses. Service recovery happens before guests complain."
        actions={
          <>
            <Btn variant="outline" size="md" icon="filter">Filters</Btn>
            <Btn variant="ai" size="md" icon="spark">AI service recovery</Btn>
            <Btn variant="primary" size="md" icon="plus">New request</Btn>
          </>
        }
        meta={
          <>
            <Pill tone="alert" size="md" icon="alert">1 SLA breach</Pill>
            <Pill tone="caution" size="md" icon="clock">3 open</Pill>
            <Pill tone="ready" size="md" icon="check">12 resolved · today</Pill>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        <Card padding={0}>
          <div style={{
            padding: '10px 16px',
            display: 'grid', gridTemplateColumns: '60px 1fr 100px 80px 80px',
            gap: 12, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-3)',
            borderBottom: '1px solid var(--line)',
          }}>
            <span>Room</span><span>Request</span><span>Via</span><span>SLA</span><span>Status</span>
          </div>
          {reqs.map((r, i) => (
            <div key={i} style={{
              padding: '12px 16px',
              display: 'grid', gridTemplateColumns: '60px 1fr 100px 80px 80px',
              gap: 12, alignItems: 'center',
              borderBottom: '1px solid var(--line-2)',
              background: r.sla === 'BREACH' ? 'var(--alert-soft)' : 'transparent',
            }}>
              <div>
                <Mono style={{ fontSize: 13, fontWeight: 600 }}>{r.room}</Mono>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <Avatar name={r.g} size={14} />
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 50 }}>{r.g.split(' ')[0]}</span>
                  {r.vip && <Icon name="star" size={9} color="var(--accent)" />}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.req}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{r.id}</Mono>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>· {r.at}</span>
                  {r.who && <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>· assigned {r.who}</span>}
                  {r.ai && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, color: 'var(--ai)', background: 'var(--ai-soft)',
                      border: '1px solid var(--ai-line)', borderRadius: 4, padding: '1px 5px',
                    }}>
                      <Icon name="spark" size={9} stroke={2.4} /> {r.ai}
                    </span>
                  )}
                </div>
              </div>
              <Pill tone="neutral" size="sm">{r.via}</Pill>
              {r.sla === 'BREACH'
                ? <Pill tone="alert" size="sm" icon="alert">BREACH</Pill>
                : <Mono style={{ fontSize: 11.5, color: r.tone === 'caution' ? 'var(--caution)' : 'var(--ink-3)' }}>{r.sla}</Mono>}
              <Pill tone={r.status === 'open' ? 'alert' : r.status === 'resolved' ? 'ready' : 'progress'} size="sm">{r.status}</Pill>
            </div>
          ))}
        </Card>

        {/* Detail */}
        <aside>
          <Card padding={0}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill tone="alert" size="sm">BREACH</Pill>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>GR-440</Mono>
              </div>
              <h2 style={{
                margin: '8px 0 4px', fontFamily: 'var(--font-display)', fontWeight: 400,
                fontSize: 19, lineHeight: 1.25,
              }}>AC not cooling — Room 301</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                <Avatar name="Sara Lin" size={18} /> Sara Lin · phone · 12m ago
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{
                background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                borderRadius: 10, padding: '12px 13px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <AILabel confidence={91}>Service recovery</AILabel>
                </div>
                <p style={{
                  margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
                  fontSize: 14, lineHeight: 1.45,
                }}>
                  Likely same fan-coil issue as 207/209 (zone B). Suggested response: <strong style={{ fontStyle: 'normal' }}>complimentary upgrade to 412 (king · ready) + WO for 301</strong>.
                </p>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <Btn variant="ai" size="sm" icon="check">Apply suggestion</Btn>
                  <Btn variant="ghost" size="sm">Custom</Btn>
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionLabel>Quick actions</SectionLabel>
                <Btn variant="outline" size="md" full icon="wrench" style={{ justifyContent: 'flex-start' }}>Create work order</Btn>
                <Btn variant="outline" size="md" full icon="key" style={{ justifyContent: 'flex-start' }}>Offer room move</Btn>
                <Btn variant="outline" size="md" full icon="phone" style={{ justifyContent: 'flex-start' }}>Call guest back</Btn>
                <Btn variant="outline" size="md" full icon="star" style={{ justifyContent: 'flex-start' }}>Add comp to folio</Btn>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Logbook ─────────────────────────────────────────────────────────────────
function LogbookScreen() {
  const entries = [
    { t: 'AC overnight tickets', when: 'May 25 · 11:42 PM', by: 'Joel K.', body: 'Three guests reported warm rooms on floor 2 between 10–11 PM. Engineering on call took it. Likely zone B fan coil.', tags: ['hvac','overnight'], ai: false },
    { t: 'Day shift summary', when: 'May 25 · 3:15 PM', by: 'AI', body: 'Strong day. 38 checkouts cleared by 1pm, 22m avg clean time (3m under target). One service recovery (Room 207 AC) handled by upgrade. Three high-priority WOs opened, two resolved.', tags: ['summary'], ai: true, generated: true },
    { t: 'Pool incident — minor', when: 'May 25 · 1:48 PM', by: 'Alex M.', body: 'Guest slipped near pool gate, no injuries. Wet floor sign placed. Incident form filed. Pool gate latch follow-up: WO-1138.', tags: ['safety','incident'] },
    { t: 'Linen short — Saturday', when: 'May 24 · 8:30 AM', by: 'Mia P.', body: 'Approaching weekend, par count on king linens at 78 of 110 target. Vendor delivery scheduled Friday. Manage allocation: prioritize VIP arrivals.', tags: ['inventory'] },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Logbook"
        subtitle="Shift-by-shift hand-off log. AI auto-summarizes each shift and flags anything that needs escalation."
        actions={
          <>
            <Btn variant="outline" size="md" icon="filter">Filters</Btn>
            <Btn variant="outline" size="md" icon="cal">May 26</Btn>
            <Btn variant="primary" size="md" icon="plus">Log entry</Btn>
          </>
        }
        tabs={[
          { label: 'All', count: 142, active: true },
          { label: 'Incidents', count: 8 },
          { label: 'Overnight', count: 24 },
          { label: 'AI summaries', count: 32 },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {entries.map((e, i) => (
            <Card key={i} padding={0} style={e.generated ? { borderColor: 'var(--ai-line)', background: 'var(--surface)' } : {}}>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line-2)' }}>
                {e.ai ? (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', background: 'var(--ai)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="spark" size={13} stroke={2.4} />
                  </div>
                ) : (
                  <Avatar name={e.by} size={30} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{e.t}</span>
                    {e.generated && <AILabel>auto</AILabel>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                    {e.by} · {e.when}
                  </div>
                </div>
                <Icon name="chevronD" size={14} color="var(--ink-3)" />
              </div>
              <div style={{ padding: '14px 18px' }}>
                <p style={{
                  margin: 0,
                  fontFamily: e.generated ? 'var(--font-display)' : 'inherit',
                  fontStyle: e.generated ? 'italic' : 'normal',
                  fontSize: e.generated ? 15.5 : 13.5,
                  lineHeight: 1.55, color: 'var(--ink-2)',
                }}>{e.body}</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {e.tags.map(t => (
                    <span key={t} style={{
                      fontSize: 10.5, color: 'var(--ink-3)',
                      background: 'var(--surface-2)', border: '1px solid var(--line-2)',
                      padding: '2px 7px', borderRadius: 4,
                    }}>#{t}</span>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionLabel>Pin to today</SectionLabel>
            <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: '6px 0 10px' }}>
              Things the next shift should know. AI surfaces these on hand-off.
            </p>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.7 }}>
              <li><strong>Floor 2 HVAC zone B</strong> — recurring complaints</li>
              <li>Saturday linen tight — vendor Fri</li>
              <li>Pool gate latch · WO-1138</li>
            </ul>
          </Card>
          <Card padding={0}>
            <div style={{ padding: '14px 16px 8px' }}>
              <SectionLabel>Quick filters</SectionLabel>
            </div>
            {['Last 24h', 'Incidents', 'Overnight only', 'Engineering', 'Housekeeping', 'My entries'].map((f, i) => (
              <div key={i} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{f}</span>
                <Icon name="chevronR" size={12} color="var(--ink-3)" />
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── Lost & Found ────────────────────────────────────────────────────────────
function LostFoundScreen() {
  const items = [
    { id: 'LF-204', t: 'Black wallet w/ID', room: '312', found: 'May 25', by: 'Maria V.', status: 'matched', guest: 'Marcus Bell', exp: '14 d', tone: 'ready' },
    { id: 'LF-203', t: 'Pair of sunglasses (Ray-Ban)', room: 'Pool', found: 'May 25', by: 'Diego N.', status: 'unclaimed', exp: '29 d', tone: 'caution' },
    { id: 'LF-202', t: 'Phone charger (Apple)', room: '108', found: 'May 24', by: 'Tina A.', status: 'unclaimed', exp: '28 d', tone: 'caution' },
    { id: 'LF-201', t: 'Children\'s teddy bear', room: '512', found: 'May 24', by: 'Maria V.', status: 'shipped', guest: 'Reyes family', exp: '—', tone: 'ai', ai: 'Guest contacted via Opera' },
    { id: 'LF-200', t: 'Silver bracelet', room: 'Lobby', found: 'May 23', by: 'Front desk', status: 'unclaimed', exp: '27 d', tone: 'caution' },
    { id: 'LF-198', t: 'Reading glasses + case', room: '204', found: 'May 22', by: 'Carlos R.', status: 'expired', exp: 'donated', tone: 'ooo' },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Lost & Found"
        subtitle="30-day disposition tracking. AI matches found items to recent guests by room and date."
        actions={
          <>
            <Btn variant="outline" size="md" icon="filter">Filters</Btn>
            <Btn variant="ai" size="md" icon="spark">Find matches</Btn>
            <Btn variant="primary" size="md" icon="plus">Log item</Btn>
          </>
        }
        tabs={[
          { label: 'All', count: 38, active: true },
          { label: 'Unclaimed', count: 18 },
          { label: 'Matched', count: 9 },
          { label: 'Shipped', count: 5 },
          { label: 'Expired', count: 6 },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {items.map((it, i) => (
          <Card key={i} padding={0}>
            <div style={{
              aspectRatio: '2', borderTopLeftRadius: 'var(--r-lg)', borderTopRightRadius: 'var(--r-lg)',
              background: `repeating-linear-gradient(${30 + i * 15}deg, var(--surface-3) 0 8px, var(--surface-2) 8px 16px)`,
              position: 'relative', overflow: 'hidden',
              borderBottom: '1px solid var(--line)',
            }}>
              <Pill tone={it.tone} size="sm" style={{ position: 'absolute', top: 10, left: 10 }}>{it.status}</Pill>
              <Mono style={{ position: 'absolute', top: 10, right: 10, fontSize: 10.5, color: 'var(--ink-3)' }}>{it.id}</Mono>
              {it.exp !== '—' && it.exp !== 'donated' && (
                <div style={{
                  position: 'absolute', bottom: 10, left: 10,
                  background: 'rgba(26,24,21,0.85)', color: 'var(--paper)',
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-mono)',
                }}>
                  <Icon name="clock" size={9} stroke={2.4} /> {it.exp} left
                </div>
              )}
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 4 }}>{it.t}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--ink-3)' }}>
                <Mono>{it.room}</Mono>
                <span>·</span>
                <span>{it.found}</span>
                <span>·</span>
                <span>by {it.by}</span>
              </div>
              {it.guest && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12 }}>
                  <Avatar name={it.guest} size={18} />
                  <span style={{ color: 'var(--ink-2)' }}>{it.guest}</span>
                </div>
              )}
              {it.ai && (
                <div style={{
                  marginTop: 8, fontSize: 11, color: 'var(--ai)',
                  background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                  padding: '3px 8px', borderRadius: 5,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  <Icon name="spark" size={9} stroke={2.4} /> {it.ai}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TasksScreen, GuestRequestsScreen, LogbookScreen, LostFoundScreen });
