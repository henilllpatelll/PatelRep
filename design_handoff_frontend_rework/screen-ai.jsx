/* AI Copilot screen + SOP Library */

function AICopilotScreen() {
  const messages = [
    { who: 'user', text: 'Why is room 207 still showing dirty?' },
    { who: 'ai', text: '207 is dirty because Beatrix is 9 minutes over on 312 (King checkout). She was slotted to move to 207 next but is still working.', sources: ['Housekeeping board · live', 'Beatrix\'s history'], suggestions: ['Move 207 to Carlos (1 floor away, capacity 2)', 'Mark 207 as flex / leave with Beatrix', 'Snooze for 10 min'] },
    { who: 'user', text: 'AC complaints on 2nd floor — anything I should know?' },
    { who: 'ai', text: 'Two AC complaints overnight on floor 2 — both in zone B (207 and 209). Same fan-coil unit. Symptom (warm air despite setpoint) matches belt wear. 88% match to historic failure pattern.', sources: ['WO-1140 · 1141', 'Asset FCU-209-B history', 'PM schedule'], cite: 'Engineering · Predictions', suggestions: ['Open WO for belt replacement', 'Check belt on adjacent units (211, 213)', 'Schedule zone B PM'] },
  ];
  const suggestions = [
    'Show me checkouts running late',
    'Which rooms need to be ready by 3pm?',
    'AC issues this week',
    'Reassign Beatrix\'s remaining rooms',
    'Cost of reactive vs preventive on fan-coils',
    'Tomorrow\'s forecast vs today',
  ];
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        eyebrow="Intelligence"
        title="Copilot"
        subtitle="Ask anything about your hotel — rooms, staff, work orders, history. Grounded on your data, citing sources."
        actions={
          <>
            <Btn variant="outline" size="md" icon="doc">History</Btn>
            <Btn variant="outline" size="md" icon="settings">Model</Btn>
          </>
        }
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, flex: 1 }}>
        {/* Chat thread */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
          {messages.map((m, i) => (
            m.who === 'user' ? (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{
                  maxWidth: 540, background: 'var(--ink)', color: 'var(--paper)',
                  borderRadius: 14, borderTopRightRadius: 4,
                  padding: '11px 14px', fontSize: 14, lineHeight: 1.45,
                }}>
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'var(--ai)', color: '#fff', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="spark" size={14} stroke={2.4} />
                </div>
                <div style={{ flex: 1, maxWidth: 620 }}>
                  <div style={{
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 14, borderTopLeftRadius: 4,
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-sm)',
                  }}>
                    <p style={{
                      margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
                      fontSize: 17, lineHeight: 1.5, color: 'var(--ink)',
                    }}>
                      {m.text}
                    </p>
                    {/* Sources */}
                    {m.sources && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                        {m.sources.map((s, j) => (
                          <span key={j} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 11, color: 'var(--ink-3)',
                            background: 'var(--surface-2)', border: '1px solid var(--line-2)',
                            padding: '3px 8px', borderRadius: 999,
                          }}>
                            <Icon name="doc" size={10} /> {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Suggestions */}
                  {m.suggestions && (
                    <div style={{
                      marginTop: 10,
                      background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                      borderRadius: 12, padding: '10px 12px',
                    }}>
                      <div style={{
                        fontSize: 10.5, fontWeight: 600, color: 'var(--ai)',
                        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
                      }}>Suggested actions</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {m.suggestions.map((s, j) => (
                          <button key={j} style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: '5px 6px', borderRadius: 6, textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 7,
                            fontSize: 13, color: 'var(--ink)',
                          }}>
                            <Icon name="arrowR" size={11} color="var(--ai)" />
                            <span style={{ flex: 1 }}>{s}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, fontSize: 11, color: 'var(--ink-3)' }}>
                    <Mono>claude-sonnet-3.5</Mono>
                    <span>·</span>
                    <Mono>1,847 tokens · $0.011</Mono>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <button style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' }}>👍</button>
                      <button style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' }}>👎</button>
                      <button style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 11 }}>Copy</button>
                    </span>
                  </div>
                </div>
              </div>
            )
          ))}

          {/* Composer */}
          <div style={{
            position: 'sticky', bottom: 16, marginTop: 'auto',
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 14, boxShadow: 'var(--shadow-md)',
            padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name="message" size={14} color="var(--ink-3)" />
              <span style={{ fontSize: 14, color: 'var(--ink-2)', flex: 1 }}>What needs attention right now?</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)',
                background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--line)',
              }}>⌘ ⏎</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Btn variant="outline" size="sm" icon="building">Lone Star Inn</Btn>
              <Btn variant="outline" size="sm" icon="cal">Today</Btn>
              <Btn variant="ghost" size="sm" icon="plus">Attach</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="ghost" size="sm">Clear</Btn>
              <Btn variant="primary" size="sm" iconRight="send">Ask</Btn>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card padding={0}>
            <div style={{ padding: '14px 16px 10px' }}>
              <SectionLabel hint="Try one">Examples</SectionLabel>
            </div>
            <div style={{ padding: '0 8px 8px' }}>
              {suggestions.map((s, i) => (
                <button key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 10px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 12.5, color: 'var(--ink)', textAlign: 'left',
                  borderRadius: 7,
                }}>
                  <Icon name="arrowR" size={11} color="var(--accent)" />
                  <span style={{ flex: 1 }}>{s}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <SectionLabel hint="This week">Credit usage</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '6px 0' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1 }}>$18.40</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>of $217.50 cap</span>
            </div>
            <Bar value={18.4} max={217.5} tone="ai" height={5} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
              <span>87 rooms × $2.50</span>
              <Mono>8.5%</Mono>
            </div>
          </Card>
          <Card padding={0}>
            <div style={{ padding: '14px 16px 10px' }}>
              <SectionLabel>Recent</SectionLabel>
            </div>
            {[
              ['Reassign late checkouts', '14m'],
              ['Quarterly PM plan', '2h'],
              ['Linen par tonight', 'yest'],
            ].map(([t, ago], i) => (
              <div key={i} style={{ padding: '9px 16px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                <Icon name="message" size={12} color="var(--ink-3)" />
                <span style={{ flex: 1 }}>{t}</span>
                <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{ago}</Mono>
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// ─── SOP Library ─────────────────────────────────────────────────────────────
function SOPLibraryScreen() {
  const docs = [
    { t: 'Standard checkout clean', cat: 'Housekeeping', v: 'v4.2', updated: '14 d ago', author: 'Mia P.', status: 'fresh' },
    { t: 'Inspection criteria · all room types', cat: 'Housekeeping', v: 'v2.1', updated: '32 d', author: 'Mia P.', status: 'fresh' },
    { t: 'Ice machine descale procedure', cat: 'Engineering', v: 'v1.0', updated: '11 mo', author: 'Joel K.', status: 'stale', ai: 'AI suggests refresh — manufacturer updated procedure' },
    { t: 'Pool chemistry test', cat: 'Safety', v: 'v3.0', updated: '5 mo', author: 'Joel K.', status: 'fresh' },
    { t: 'Lost & found 30-day disposition', cat: 'Front desk', v: 'v1.2', updated: '2 mo', author: 'Alex M.', status: 'fresh' },
    { t: 'Fan coil belt replacement', cat: 'Engineering', v: 'v2.3', updated: '4 mo', author: 'Ravi P.', status: 'fresh' },
    { t: 'VIP arrival prep — extended', cat: 'Front desk', v: 'v1.0', updated: '8 mo', author: 'Alex M.', status: 'review', ai: 'Used by AI 47 times this month' },
  ];
  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="SOP library"
        subtitle="Searchable, AI-grounded standard operating procedures. Staff can ask the copilot any procedural question and get the right answer with a citation."
        actions={
          <>
            <Btn variant="outline" icon="filter" size="md">Filter</Btn>
            <Btn variant="ai" icon="spark" size="md">Generate from incident</Btn>
            <Btn variant="primary" icon="plus" size="md">New SOP</Btn>
          </>
        }
        tabs={[
          { label: 'All', count: 47, active: true },
          { label: 'Housekeeping', count: 18 },
          { label: 'Engineering', count: 15 },
          { label: 'Front desk', count: 9 },
          { label: 'Safety', count: 5 },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }}>
        {/* List */}
        <Card padding={0}>
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <Icon name="search" size={13} color="var(--ink-3)" />
            <input type="text" placeholder="Search by title, category, or keyword…" style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
            }} />
            <Mono style={{ fontSize: 10, color: 'var(--ink-3)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--line)' }}>⌘K</Mono>
          </div>
          {docs.map((d, i) => (
            <div key={i} style={{
              padding: '12px 16px', borderTop: '1px solid var(--line-2)',
              display: 'flex', flexDirection: 'column', gap: 6,
              background: i === 2 ? 'var(--accent-soft)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="doc" size={14} color="var(--ink-3)" />
                <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{d.t}</span>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>{d.v}</Mono>
                {d.status === 'fresh' && <Pill tone="ready" size="sm">fresh</Pill>}
                {d.status === 'stale' && <Pill tone="alert" size="sm">stale</Pill>}
                {d.status === 'review' && <Pill tone="caution" size="sm">review</Pill>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink-3)' }}>
                <Pill tone="neutral" size="sm">{d.cat}</Pill>
                <span>Updated {d.updated}</span>
                <span>·</span>
                <span>by {d.author}</span>
              </div>
              {d.ai && (
                <div style={{
                  background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
                  color: 'var(--ai)', fontSize: 11.5,
                  padding: '4px 8px', borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 5, width: 'fit-content',
                }}>
                  <Icon name="spark" size={10} stroke={2.4} /> {d.ai}
                </div>
              )}
            </div>
          ))}
        </Card>

        {/* Preview */}
        <Card padding={0}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Pill tone="alert" size="sm">stale</Pill>
              <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>v1.0 · 11 months old</Mono>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>SOP-029</span>
            </div>
            <h2 style={{
              margin: '8px 0 4px', fontFamily: 'var(--font-display)',
              fontWeight: 400, fontSize: 22, letterSpacing: -0.2,
            }}>Ice machine descale procedure</h2>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
              By Joel K. · Used 14× this year · Linked to 6 work orders
            </div>
          </div>

          {/* AI refresh prompt */}
          <div style={{ padding: 16 }}>
            <div style={{
              background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
              borderRadius: 10, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <AILabel confidence={84}>Refresh suggested</AILabel>
              </div>
              <p style={{
                margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
                fontSize: 15, lineHeight: 1.45,
              }}>
                Hoshizaki updated their descale procedure last quarter — your SOP is missing the new <strong style={{ fontStyle: 'normal' }}>10-min rinse cycle</strong>. Want me to draft the update?
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <Btn variant="ai" size="sm" icon="spark">Draft refresh</Btn>
                <Btn variant="ghost" size="sm">Mark current</Btn>
              </div>
            </div>
          </div>

          {/* Body preview */}
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Prerequisites</SectionLabel>
              <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                <li>Power off & unplug</li>
                <li>Descaler · approved brand list <Mono>(ER-DC-3)</Mono></li>
                <li>Bucket, gloves, eye protection</li>
              </ul>
            </div>
            <div>
              <SectionLabel hint="6 steps">Procedure</SectionLabel>
              <ol style={{ margin: 0, padding: '0 0 0 20px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                <li>Drain reservoir into bucket. Inspect color.</li>
                <li>Mix descaler 1:4 with cold water.</li>
                <li>Run cleaning cycle (model-specific button).</li>
                <li>Wait 20 minutes.</li>
                <li>Triple-rinse with fresh water.</li>
                <li>Sanitize ice bin separately.</li>
              </ol>
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <Btn variant="outline" size="md" icon="doc">Open full</Btn>
              <Btn variant="outline" size="md" icon="message">Ask copilot</Btn>
              <Btn variant="primary" size="md" icon="wrench" style={{ marginLeft: 'auto' }}>Create WO</Btn>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { AICopilotScreen, SOPLibraryScreen });
