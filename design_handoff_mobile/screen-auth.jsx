/* Auth + Onboarding + Settings screens */

// ─── Login (full bleed, no shell) ───────────────────────────────────────────
function LoginScreen() {
  return (
    <div style={{
      width: '100%', height: '100%', minHeight: 720,
      background: 'var(--paper)',
      display: 'grid', gridTemplateColumns: '1fr 1.1fr',
    }}>
      {/* Left — form */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        padding: '40px 60px',
      }}>
        <Logo />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 380 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase',
            color: 'var(--ink-3)', marginBottom: 14,
          }}>Operator sign in</div>
          <h1 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 44, lineHeight: 1.05, letterSpacing: -0.8, color: 'var(--ink)',
          }}>
            Welcome back to <em style={{ fontStyle: 'italic' }}>your hotel</em>.
          </h1>
          <p style={{
            margin: '14px 0 28px', fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            Sign in to keep the floor running smoothly. The AI has prepared your morning briefing.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Email" value="mia@lonestarinn.com" icon="mail" />
            <Input label="Password" value="••••••••••••" icon="key" type="password" trailingHint="Show" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-2)' }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: '1.5px solid var(--line)', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={10} color="#fff" stroke={3} />
                </span>
                Keep me signed in
              </label>
              <a href="#" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>Forgot password?</a>
            </div>
            <Btn variant="dark" size="lg" full iconRight="arrowR" style={{ marginTop: 10 }}>Sign in</Btn>
            <div style={{ position: 'relative', textAlign: 'center', margin: '12px 0' }}>
              <span style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--line)' }} />
              <span style={{ position: 'relative', background: 'var(--paper)', padding: '0 14px', fontSize: 11.5, color: 'var(--ink-3)' }}>or</span>
            </div>
            <Btn variant="outline" size="lg" full icon="mail">Single sign-on (Google)</Btn>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', marginTop: 14 }}>
              First time here? <a href="#" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Set up your hotel</a>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
          v2.1.0 · status: <span style={{ color: 'var(--ready)' }}>operational</span> · build 7f3a92
        </div>
      </div>

      {/* Right — hero/illustration */}
      <div style={{
        background: 'var(--ink)', color: 'var(--paper)',
        padding: '40px 50px', position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 55%), radial-gradient(circle at 10% 90%, var(--ready) 0%, transparent 50%)',
          opacity: 0.22,
        }} />
        <div style={{ position: 'relative', display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between' }}>
          {/* Top quote */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: 0.6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.4 }}>
            <Icon name="spark" size={11} color="var(--accent)" stroke={2.4} />
            Lone Star Inn · Austin TX
          </div>

          {/* Faux dashboard preview */}
          <div style={{
            background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--r-lg)', padding: 22, margin: '40px 0',
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>This morning · 9:42</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.6, marginBottom: 4 }}>Rooms ready by 3pm</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 56, lineHeight: 1, fontWeight: 400 }}>52</span>
                  <span style={{ fontSize: 18, opacity: 0.5 }}>/ 87</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7cd6c5', fontFamily: 'var(--font-mono)' }}>+6 vs forecast</span>
                </div>
                <div style={{ height: 4, marginTop: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: '60%', height: '100%', background: 'var(--accent)' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['78% occ', '24m clean', '6 WOs', '3 VIPs'].map((s, i) => (
                  <span key={i} style={{
                    fontSize: 11, padding: '4px 9px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                    fontFamily: 'var(--font-mono)',
                  }}>{s}</span>
                ))}
              </div>
            </div>
          </div>

          <blockquote style={{
            margin: 0, fontFamily: 'var(--font-display)', fontStyle: 'italic',
            fontSize: 22, lineHeight: 1.4, maxWidth: 480, position: 'relative',
          }}>
            "It's like having a second supervisor on the floor — quietly catching the things we'd miss."
            <footer style={{
              marginTop: 14, fontStyle: 'normal',
              fontFamily: 'var(--font-sans)', fontSize: 12, opacity: 0.6,
              textTransform: 'uppercase', letterSpacing: 1.2,
            }}>
              <Mono>Sandeep R.</Mono> · GM, Bluebonnet Suites
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, icon, type = 'text', trailingHint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 9, padding: '9px 12px',
      }}>
        {icon && <Icon name={icon} size={14} color="var(--ink-3)" />}
        <span style={{ fontSize: 14, color: 'var(--ink)', flex: 1, fontFamily: type === 'password' ? 'var(--font-mono)' : 'inherit' }}>{value}</span>
        {trailingHint && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{trailingHint}</span>}
      </div>
    </label>
  );
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
function OnboardingScreen() {
  return (
    <div style={{
      width: '100%', minHeight: 720, background: 'var(--paper)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top progress */}
      <div style={{
        padding: '20px 40px',
        display: 'flex', alignItems: 'center', gap: 14,
        borderBottom: '1px solid var(--line)',
        background: 'var(--paper)',
      }}>
        <Logo />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {[
              { l: 'Hotel basics', done: true },
              { l: 'Floors & rooms', done: true },
              { l: 'Staff & roles', active: true },
              { l: 'Integrations' },
              { l: 'Go live' },
            ].map((s, i, a) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: s.done ? 'var(--ready)' : s.active ? 'var(--accent)' : 'var(--surface)',
                    color: s.done || s.active ? '#fff' : 'var(--ink-3)',
                    border: s.done || s.active ? 'none' : '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                  }}>{s.done ? <Icon name="check" size={11} color="#fff" stroke={3} /> : i + 1}</span>
                  <span style={{
                    fontSize: 12.5, color: s.active ? 'var(--ink)' : 'var(--ink-3)',
                    fontWeight: s.active ? 600 : 400,
                  }}>{s.l}</span>
                </div>
                {i < a.length - 1 && <div style={{ width: 36, height: 1, background: s.done ? 'var(--ready)' : 'var(--line)', margin: '0 12px' }} />}
              </React.Fragment>
            ))}
          </div>
        </div>
        <Btn variant="ghost" size="sm">Save & exit</Btn>
      </div>

      <div style={{ flex: 1, padding: '40px 60px', maxWidth: 980, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 30 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Step 3 of 5</div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 38, letterSpacing: -0.5, color: 'var(--ink)' }}>
            Add your team
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 540 }}>
            Add housekeepers, engineers, and supervisors. They'll get a text invite to set up the mobile app — no IT required.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 30 }}>
          {/* Form area */}
          <div>
            <Card padding={0}>
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--line-2)' }}>
                <Icon name="users" size={14} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Your team</span>
                <Mono style={{ fontSize: 11, color: 'var(--ink-3)' }}>4 added</Mono>
                <Btn variant="ghost" size="sm" icon="plus" style={{ marginLeft: 'auto' }}>Add</Btn>
              </div>
              {[
                { n: 'Maria Vega', r: 'Housekeeper', p: '+1 512 ••• 2241' },
                { n: 'Tina Aoki', r: 'Housekeeper', p: '+1 512 ••• 8330' },
                { n: 'Ravi Patel', r: 'Engineer', p: '+1 512 ••• 7705' },
                { n: 'Alex Marquez', r: 'Front desk', p: '+1 512 ••• 1192' },
              ].map((p, i) => (
                <div key={i} style={{ padding: '12px 18px', borderTop: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={p.n} size={30} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.n}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.p}</div>
                  </div>
                  <Pill tone="neutral" size="sm">{p.r}</Pill>
                  <Btn variant="ghost" size="sm">Edit</Btn>
                </div>
              ))}
              <div style={{
                margin: 16, padding: 16, border: '1px dashed var(--line)', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="doc" size={16} color="var(--ink-3)" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Or upload a CSV</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Name, phone, role — we'll handle the rest</div>
                </div>
                <Btn variant="outline" size="sm">Upload</Btn>
              </div>
            </Card>

            <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" size="lg">← Back</Btn>
              <Btn variant="dark" size="lg" iconRight="arrowR">Continue · 4 invites</Btn>
            </div>
          </div>

          {/* AI helper */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'var(--ink)', color: 'var(--paper)',
              borderRadius: 'var(--r-lg)', padding: '18px 20px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 20%, var(--accent) 0%, transparent 55%)', opacity: 0.22 }} />
              <div style={{ position: 'relative' }}>
                <AILabel>Helper</AILabel>
                <p style={{
                  margin: '10px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
                  fontSize: 16, lineHeight: 1.5,
                }}>
                  Independent Texas hotels with 87 rooms typically run with <strong style={{ fontStyle: 'normal' }}>5–6 housekeepers, 2 engineers, 2 front desk</strong> for full coverage.
                </p>
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                  Your staffing so far covers <strong>~64%</strong> of forecasted demand. Add 1–2 more housekeepers for full weekend coverage.
                </div>
              </div>
            </div>
            <Card>
              <SectionLabel>What invitees see</SectionLabel>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <Icon name="phone" size={14} color="var(--ink-3)" style={{ marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                  A text from <strong>+1 (512) 555-0142</strong>:<br />
                  <em style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>"Lone Star Inn invited you to PatelRep. Tap to set up your phone."</em>
                </p>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ─── Settings (single page) ─────────────────────────────────────────────────
function SettingsScreen() {
  return (
    <div>
      <PageHeader
        eyebrow="Organization"
        title="Settings"
        subtitle="Hotel profile, integrations, AI behavior, billing — manage how PatelRep runs."
        tabs={[
          { label: 'Hotel profile', active: true },
          { label: 'Roles & permissions' },
          { label: 'AI behavior' },
          { label: 'Integrations', count: 3 },
          { label: 'Billing' },
          { label: 'Audit log' },
        ]}
      />
      <div style={{ padding: '18px 32px', display: 'grid', gridTemplateColumns: '220px 1fr 320px', gap: 24 }}>
        <aside>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Sections</div>
          {[
            { l: 'Hotel basics', active: true },
            { l: 'Brand & display' },
            { l: 'Room types' },
            { l: 'Shift templates' },
            { l: 'SLAs & escalation' },
            { l: 'Notifications' },
            { l: 'Localization' },
            { l: 'Danger zone' },
          ].map((s, i) => (
            <div key={i} style={{
              padding: '8px 12px',
              fontSize: 13, fontWeight: s.active ? 600 : 400,
              background: s.active ? 'var(--surface)' : 'transparent',
              border: s.active ? '1px solid var(--line)' : '1px solid transparent',
              color: s.active ? 'var(--ink)' : 'var(--ink-2)',
              borderRadius: 7,
            }}>{s.l}</div>
          ))}
        </aside>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <SectionLabel>Hotel basics</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 8 }}>
              <Input label="Hotel name" value="Lone Star Inn" icon="building" />
              <Input label="Address" value="2401 S Lamar Blvd, Austin TX" icon="pin" />
              <Input label="Time zone" value="America/Chicago (CDT)" icon="clock" />
              <Input label="Currency" value="USD" icon="trend" />
              <Input label="Front desk phone" value="+1 (512) 555-0142" icon="phone" />
              <Input label="GM email" value="joel@lonestarinn.com" icon="mail" />
            </div>
          </Card>
          <Card>
            <SectionLabel hint="87 rooms · 3 floors">Property</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 8 }}>
              {['King', 'Queen', 'Double', 'Suite'].map((rt, i) => (
                <div key={i} style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{rt}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                    <Mono style={{ fontSize: 20, fontWeight: 500 }}>{[36, 28, 16, 7][i]}</Mono>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>rooms · {[28, 26, 24, 38][i]}m clean</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionLabel hint="3 connected">Integrations</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {[
                { l: 'Opera Cloud · PMS', s: 'Reservations & folios · two-way sync', status: 'connected', last: '2 min ago' },
                { l: 'Stripe · Billing', s: '$99/mo base + AI credit true-up', status: 'connected', last: 'last invoice Apr 28' },
                { l: 'Resend · Email', s: 'Daily GM summary, guest comms', status: 'connected', last: '32 sent today' },
                { l: 'Twilio · SMS', s: 'Staff invites & on-call alerts', status: 'available' },
                { l: 'Slack · Notifications', s: 'Pipe ops alerts to a channel', status: 'available' },
              ].map((it, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 10, border: '1px solid var(--line-2)', borderRadius: 9,
                  background: it.status === 'connected' ? 'var(--surface)' : 'var(--surface-2)',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: 'var(--surface-3)', border: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 600, color: 'var(--ink-2)',
                  }}>{it.l[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{it.l}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{it.s}</div>
                  </div>
                  {it.status === 'connected' ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{it.last}</span>
                      <Pill tone="ready" size="sm" icon="check">connected</Pill>
                    </>
                  ) : (
                    <Btn variant="outline" size="sm">Connect</Btn>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Billing card */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <SectionLabel hint="This month">Plan & billing</SectionLabel>
            <div style={{
              marginTop: 8, padding: '14px 16px',
              background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>$99</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>base / month</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>+ $0.02/AI credit · cap $2.50/room</div>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Base', '$99.00'],
                ['AI credits (May to date)', '$18.40'],
                ['Estimated total', '$117.40'],
                ['Cap remaining', '$199.10'],
              ].map(([l, v], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: i === 2 ? 'var(--ink)' : 'var(--ink-2)' , fontWeight: i === 2 ? 600 : 400 }}>
                  <span>{l}</span>
                  <Mono>{v}</Mono>
                </div>
              ))}
            </div>
            <Btn variant="outline" size="md" full style={{ marginTop: 14 }}>View invoices</Btn>
          </Card>
          <Card>
            <SectionLabel>AI behavior</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
              {[
                { l: 'Auto-suggestions in workflows', on: true },
                { l: 'Auto-create WO from complaints', on: false },
                { l: 'Auto-summarize shift handoffs', on: true },
                { l: 'Voice input on mobile', on: true },
              ].map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{
                    width: 30, height: 18, borderRadius: 999,
                    background: t.on ? 'var(--accent)' : 'var(--line)',
                    position: 'relative',
                  }}>
                    <span style={{ position: 'absolute', top: 2, left: t.on ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{t.l}</span>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen, OnboardingScreen, SettingsScreen, Input });
