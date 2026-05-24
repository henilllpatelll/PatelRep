/* Engineering — Work Orders list with detail drawer slide-in */

function WorkOrdersScreen() {
  const cols = [
    { key: 'open',   title: 'Open',        n: 6, rows: [
      { id: '1142', t: 'Ice machine leak', loc: 'BOH', age: '38m', pri: 'high', tags: ['plumbing','urgent'], by: 'Jordan L.' },
      { id: '1140', t: 'AC blowing warm', loc: 'R-207', age: '1h',  pri: 'high', tags: ['hvac','recurring'], by: 'Front desk', ai: 'Recurring in 207/209 zone' },
      { id: '1139', t: 'TV remote replacement', loc: 'R-405', age: '2h', pri: 'low', tags: ['guest-room'], by: 'Maria V.' },
      { id: '1138', t: 'Pool gate latch loose', loc: 'Pool', age: '4h', pri: 'med', tags: ['safety'], by: 'Joel K.' },
      { id: '1135', t: 'Hallway light flicker', loc: 'F2', age: 'yest', pri: 'med', tags: ['electrical'], by: 'Auto' },
      { id: '1133', t: 'Mini-fridge noisy 318', loc: 'R-318', age: '2d', pri: 'low', tags: ['guest-room'], by: 'Tina A.' },
    ]},
    { key: 'progress', title: 'In progress', n: 3, rows: [
      { id: '1141', t: 'Replace fan-coil belt', loc: 'R-209', age: '22m', pri: 'high', tags: ['hvac'], by: 'Ravi P.', assignee: 'Ravi Patel', active: true },
      { id: '1137', t: 'Re-caulk tub', loc: 'R-301', age: '1h', pri: 'med', tags: ['plumbing'], by: 'Ravi P.', assignee: 'Ravi Patel' },
      { id: '1130', t: 'PM — Boiler flush', loc: 'MEC', age: '3h', pri: 'med', tags: ['pm','quarterly'], by: 'Auto', assignee: 'Diego N.' },
    ]},
    { key: 'review', title: 'Review',      n: 2, rows: [
      { id: '1136', t: 'Elevator chime fixed', loc: 'East', age: '5h', pri: 'med', tags: ['electrical'], by: 'Ravi P.', assignee: 'Ravi Patel' },
      { id: '1132', t: 'Pool pump primed', loc: 'Pool', age: '1d', pri: 'high', tags: ['pool','safety'], by: 'Diego N.', assignee: 'Diego Nuñez' },
    ]},
    { key: 'done',   title: 'Completed',   n: 14, rows: [
      { id: '1131', t: 'Replace deadbolt 412', loc: 'R-412', age: '3h', pri: 'high', tags: ['safety'], by: 'Ravi P.' },
      { id: '1129', t: 'WiFi router reboot F3', loc: 'F3', age: '5h', pri: 'low', tags: ['it'], by: 'Auto' },
      { id: '1128', t: 'Replace 4 light bulbs', loc: 'Lobby', age: '1d', pri: 'low', tags: ['electrical'], by: 'Diego N.' },
    ]},
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Engineering"
        title="Work orders"
        meta={
          <>
            <Pill tone="alert" size="md" icon="alert"><Mono>2</Mono> high priority</Pill>
            <Pill tone="caution" size="md" icon="clock"><Mono>3</Mono> in progress</Pill>
            <Pill tone="ai" size="md" icon="spark"><Mono>4</Mono> AI predicted</Pill>
          </>
        }
        actions={
          <>
            <Btn variant="outline" icon="filter" size="md">Filters</Btn>
            <Btn variant="outline" icon="list" size="md">List</Btn>
            <Btn variant="ai" icon="spark" size="md">AI triage</Btn>
            <Btn variant="primary" icon="plus" size="md">New WO</Btn>
          </>
        }
        tabs={[
          { label: 'Board', active: true },
          { label: 'List', count: 25 },
          { label: 'PM schedule', count: 8 },
          { label: 'Predictions', count: 4 },
          { label: 'Assets', count: 142 },
        ]}
      />
      <div style={{ padding: '18px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 380px', gap: 14, minHeight: 600 }}>
        {cols.map((col) => (
          <div key={col.key} style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-lg)',
            display: 'flex', flexDirection: 'column',
            minHeight: 0,
          }}>
            <div style={{
              padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: '1px solid var(--line-2)',
            }}>
              <StatusDot tone={col.key === 'open' ? 'dirty' : col.key === 'progress' ? 'progress' : col.key === 'review' ? 'clean' : 'ready'} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{col.title}</span>
              <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{col.n}</Mono>
              <span style={{ flex: 1 }} />
              <button style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', padding: 2 }}>
                <Icon name="plus" size={12} />
              </button>
            </div>
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {col.rows.map((r) => <WOCard key={r.id} {...r} />)}
              <button style={{
                background: 'transparent', border: '1px dashed var(--line)',
                borderRadius: 8, padding: '6px', fontSize: 11.5, color: 'var(--ink-3)',
              }}>
                + Add work order
              </button>
            </div>
          </div>
        ))}

        {/* Drawer — open detail */}
        <WODrawer />
      </div>
    </div>
  );
}

function WOCard({ id, t, loc, age, pri, tags, by, ai, active, assignee }) {
  const priTone = pri === 'high' ? 'alert' : pri === 'med' ? 'caution' : 'neutral';
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 8,
      border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
      boxShadow: active ? '0 0 0 2px var(--accent-soft)' : 'none',
      padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 6,
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Pill tone={priTone} size="sm">{pri}</Pill>
        <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)', marginLeft: 'auto' }}>WO-{id}</Mono>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.35, fontWeight: 500, color: 'var(--ink)' }}>{t}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--ink-3)' }}>
        <Icon name="pin" size={10} color="var(--ink-4)" />
        <Mono>{loc}</Mono>
        <span style={{ marginLeft: 'auto' }}>{age}</span>
      </div>
      {ai && (
        <div style={{
          background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
          color: 'var(--ai)', fontSize: 10.5,
          padding: '3px 6px', borderRadius: 5,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <Icon name="spark" size={9} stroke={2.4} /> {ai}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {tags.slice(0, 2).map(tag => (
          <span key={tag} style={{
            fontSize: 10, color: 'var(--ink-3)',
            background: 'var(--surface-3)', padding: '1px 5px', borderRadius: 3,
          }}>#{tag}</span>
        ))}
        {assignee && <Avatar name={assignee} size={18} style={{ marginLeft: 'auto' }} />}
      </div>
    </div>
  );
}

function WODrawer() {
  return (
    <aside style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-lg)',
      display: 'flex', flexDirection: 'column',
      boxShadow: 'var(--shadow-md)',
      overflow: 'hidden', minHeight: 0,
    }}>
      <div style={{
        padding: '13px 16px', borderBottom: '1px solid var(--line-2)',
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <Pill tone="alert" size="md">high</Pill>
        <Mono style={{ fontSize: 12, color: 'var(--ink-3)' }}>WO-1141</Mono>
        <span style={{ flex: 1 }} />
        <button style={{ background: 'transparent', border: 'none', padding: 2, color: 'var(--ink-3)' }}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div style={{ padding: '16px 16px 8px' }}>
        <h2 style={{
          margin: 0, fontFamily: 'var(--font-display)', fontSize: 22,
          fontWeight: 400, lineHeight: 1.2, letterSpacing: -0.2,
        }}>Replace fan-coil belt</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          <Icon name="pin" size={12} />
          <Mono>R-209</Mono>
          <span>·</span>
          <span>HVAC zone B</span>
          <span style={{ marginLeft: 'auto' }}>opened 22m ago</span>
        </div>
      </div>

      {/* AI insight callout */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{
          background: 'var(--ai-soft)',
          border: '1px solid var(--ai-line)',
          borderRadius: 10, padding: '12px 13px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <AILabel confidence={88}>Insight</AILabel>
          </div>
          <p style={{
            margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
            fontSize: 14.5, lineHeight: 1.45, color: 'var(--ink)',
          }}>
            Same fan-coil zone as <strong style={{ fontStyle: 'normal' }}>WO-1140 (R-207)</strong>. Symptoms suggest belt wear. <span style={{ fontFamily: 'var(--font-sans)', fontStyle: 'normal', background: 'var(--ai-soft)' }}>Recommend pre-emptive belt swap on adjacent units.</span>
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn variant="ai" size="sm" icon="check">Add adjacent WOs</Btn>
            <Btn variant="ghost" size="sm">View signals</Btn>
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px',
          fontSize: 12.5,
        }}>
          <span style={{ color: 'var(--ink-3)' }}>Reporter</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Avatar name="Jordan Lee" size={18} /> Jordan Lee · inspection
          </span>
          <span style={{ color: 'var(--ink-3)' }}>Assignee</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Avatar name="Ravi Patel" size={18} /> Ravi Patel
          </span>
          <span style={{ color: 'var(--ink-3)' }}>Asset</span>
          <span><Mono>FCU-209-B</Mono> · Carrier 40MAH · 2019</span>
          <span style={{ color: 'var(--ink-3)' }}>Category</span>
          <span>HVAC · Mechanical</span>
          <span style={{ color: 'var(--ink-3)' }}>Est. cost</span>
          <span><Mono>$84</Mono> parts · 1.5h labor</span>
          <span style={{ color: 'var(--ink-3)' }}>Due</span>
          <span style={{ color: 'var(--alert)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="alert" size={11} /> Today · before 4pm
          </span>
        </div>
      </div>

      {/* Activity timeline */}
      <div style={{ padding: '0 16px 12px' }}>
        <SectionLabel>Timeline</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 1, background: 'var(--line)' }} />
          {[
            { t: '22m', d: 'WO opened from inspection · auto-priority HIGH', i: 'plus', c: 'var(--ink-3)' },
            { t: '20m', d: 'AI: matched recurring pattern in fan-coil zone B', i: 'spark', c: 'var(--ai)' },
            { t: '18m', d: 'Assigned to Ravi Patel', i: 'user', c: 'var(--ink-3)' },
            { t: '15m', d: 'Ravi: "On the way, need 1.5h"', i: 'message', c: 'var(--ink-3)' },
            { t: 'now', d: 'In progress · belt removed', i: 'wrench', c: 'var(--accent)' },
          ].map((e, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '7px 0', position: 'relative',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', background: 'var(--surface)',
                border: `1.5px solid ${e.c}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, color: e.c,
              }}>
                <Icon name={e.i} size={10} stroke={2.5} />
              </span>
              <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-2)' }}>
                {e.d}
              </div>
              <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{e.t}</Mono>
            </div>
          ))}
        </div>
      </div>

      {/* Photos */}
      <div style={{ padding: '0 16px 12px' }}>
        <SectionLabel hint="2 attached">Photos</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              aspectRatio: '1.2', borderRadius: 7, border: '1px solid var(--line)',
              background: `repeating-linear-gradient(${45 + i * 30}deg, var(--surface-3) 0 8px, var(--surface-2) 8px 16px)`,
              position: 'relative',
            }}>
              {i < 2 && <span style={{
                position: 'absolute', top: 5, right: 5,
                fontFamily: 'var(--font-mono)', fontSize: 9, color: '#fff',
                background: 'rgba(0,0,0,0.5)', padding: '1px 5px', borderRadius: 3,
              }}>{i === 0 ? 'belt' : 'unit'}</span>}
              {i === 2 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                  <Icon name="camera" size={16} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div style={{
        marginTop: 'auto', padding: 14,
        borderTop: '1px solid var(--line-2)',
        display: 'flex', flexDirection: 'column', gap: 9,
      }}>
        <div style={{
          background: 'var(--surface-2)', border: '1px solid var(--line)',
          borderRadius: 9, padding: '7px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="message" size={13} color="var(--ink-3)" />
          <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>Add update or @mention…</span>
          <Icon name="camera" size={13} color="var(--ink-3)" />
          <Icon name="send" size={12} color="var(--accent)" />
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <Btn variant="outline" size="md" full>Mark review</Btn>
          <Btn variant="primary" size="md" full icon="check">Resolve</Btn>
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { WorkOrdersScreen, WOCard, WODrawer });
