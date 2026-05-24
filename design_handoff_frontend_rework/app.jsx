/* PatelRep · Frontend Rework — design canvas root */
const { useState: _useState, useEffect: _useEffect, createContext: _createContext, useContext: _useContext } = React;

// ─── Tweaks context ──────────────────────────────────────────────────────────
const TweaksCtx = _createContext(null);
function useTweaksCtx() { return _useContext(TweaksCtx); }

const ACCENT_OPTIONS = [
  { key: 'terracotta', label: 'Terracotta', hex: '#b8431c' },
  { key: 'teal',       label: 'Deep teal',  hex: '#0c6e63' },
  { key: 'amber',      label: 'Amber',      hex: '#a16207' },
  { key: 'indigo',     label: 'Indigo',     hex: '#3b3490' },
  { key: 'rose',       label: 'Rose',       hex: '#a6263c' },
];

// ─── Desktop shell wrapper for artboards ────────────────────────────────────
function DesktopArtboard({ active, title, sub, children, padded = true }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      background: 'var(--paper)', overflow: 'hidden', position: 'relative',
    }}>
      <Sidebar active={active} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar title={title} sub={sub} />
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
      <CopilotBubble />
    </div>
  );
}

// ─── Dashboard router based on role tweak ────────────────────────────────────
function RoleDashboard() {
  const t = useTweaksCtx();
  switch (t?.role) {
    case 'housekeeper': return <HousekeeperDashboard />;
    case 'engineer': return <EngineerDashboard />;
    case 'gm': return <GMDashboard />;
    case 'chief': return <GMDashboard />;
    case 'front-desk': return <FrontDeskDashboard />;
    case 'supervisor':
    default: return <SupervisorDashboard />;
  }
}

// ─── Top-level App ───────────────────────────────────────────────────────────
function App() {
  const [tweaks, setTweaks] = _useState({
    role: 'supervisor',
    accent: 'terracotta',
    density: 'balanced',
    viewport: 'all', // all | desktop | mobile
  });
  const setTweak = (patch) => setTweaks(prev => ({ ...prev, ...patch }));

  // Apply accent to the document root
  _useEffect(() => {
    const accent = ACCENT_OPTIONS.find(a => a.key === tweaks.accent);
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent.hex);
      // Derived soft + line
      const c = accent.hex;
      // simple soft / line by darkening — but we use known mappings for nicer results
      const soft = {
        terracotta: '#fbe9df', teal: '#d6eae5', amber: '#f5e9cf', indigo: '#e1deef', rose: '#f5d8de',
      }[accent.key];
      const line = {
        terracotta: '#f0c8b3', teal: '#a4cfc7', amber: '#e0c890', indigo: '#bcb6e0', rose: '#e8a8b3',
      }[accent.key];
      document.documentElement.style.setProperty('--accent-soft', soft);
      document.documentElement.style.setProperty('--accent-line', line);
    }
  }, [tweaks.accent]);

  _useEffect(() => {
    document.documentElement.classList.remove('density-comfortable', 'density-balanced', 'density-dense');
    document.documentElement.classList.add(`density-${tweaks.density}`);
  }, [tweaks.density]);

  const showDesktop = tweaks.viewport === 'all' || tweaks.viewport === 'desktop';
  const showMobile  = tweaks.viewport === 'all' || tweaks.viewport === 'mobile';

  return (
    <TweaksCtx.Provider value={{ ...tweaks, setTweak }}>
      <TweaksPanel
        title="Tweaks"
        defaultPosition={{ right: 20, bottom: 20 }}
      >
        <TweakSection label="View">
          <TweakRadio
            label="Role"
            value={tweaks.role}
            onChange={v => setTweak({ role: v })}
            options={[
              { value: 'supervisor', label: 'Supervisor' },
              { value: 'housekeeper', label: 'Housekeeper' },
              { value: 'engineer', label: 'Engineer' },
              { value: 'chief', label: 'Chief / GM' },
              { value: 'front-desk', label: 'Front desk' },
            ]}
          />
          <TweakRadio
            label="Viewport"
            value={tweaks.viewport}
            onChange={v => setTweak({ viewport: v })}
            options={[
              { value: 'all', label: 'Both' },
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' },
            ]}
          />
        </TweakSection>
        <TweakSection label="Style">
          <TweakColor
            label="Accent"
            value={tweaks.accent}
            onChange={v => setTweak({ accent: v })}
            options={ACCENT_OPTIONS.map(a => ({ value: a.key, color: a.hex, label: a.label }))}
          />
          <TweakRadio
            label="Density"
            value={tweaks.density}
            onChange={v => setTweak({ density: v })}
            options={[
              { value: 'comfortable', label: 'Comfy' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'dense', label: 'Dense' },
            ]}
          />
        </TweakSection>
      </TweaksPanel>

      <DesignCanvas>

        {/* ─── FOUNDATIONS ──────────────────────────────────────────────────── */}
        <DCSection id="foundations" title="Foundations" subtitle="System DNA — color, type, components">
          <DCArtboard id="tokens" label="Color & type" width={760} height={780}>
            <FoundationsBoard />
          </DCArtboard>
          <DCArtboard id="components" label="Component primitives" width={760} height={780}>
            <ComponentsBoard />
          </DCArtboard>
        </DCSection>

        {/* ─── AUTH ─────────────────────────────────────────────────────────── */}
        <DCSection id="auth" title="Sign in & onboarding" subtitle="Entry & first-run">
          {showDesktop && (
            <DCArtboard id="login-desktop" label="Login · desktop" width={1440} height={800}>
              <LoginScreen />
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="login-mobile" label="Login · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileLogin /></MobileFrameWrapper>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="onboarding-desktop" label="Onboarding · staff step" width={1440} height={800}>
              <OnboardingScreen />
            </DCArtboard>
          )}
        </DCSection>

        {/* ─── DASHBOARDS ───────────────────────────────────────────────────── */}
        {showDesktop && (
          <DCSection id="dashboards" title="Dashboards" subtitle="One per role — switch via Tweaks">
            <DCArtboard id="dashboard" label="Role dashboard · use Tweaks to switch role" width={1440} height={1880}>
              <DesktopArtboard active="dashboard">
                <RoleDashboard />
              </DesktopArtboard>
            </DCArtboard>
          </DCSection>
        )}

        {/* ─── HOUSEKEEPING ─────────────────────────────────────────────────── */}
        <DCSection id="housekeeping" title="Housekeeping" subtitle="The center of gravity on the floor">
          {showDesktop && (
            <DCArtboard id="hk-board" label="Room status board" width={1440} height={1500}>
              <DesktopArtboard active="housekeeping">
                <HousekeepingBoard />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="hk-assignments" label="Assignments" width={1440} height={900}>
              <DesktopArtboard active="housekeeping">
                <AssignmentsView />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="hk-inspections" label="Inspections" width={1440} height={1050}>
              <DesktopArtboard active="housekeeping">
                <InspectionsView />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="hk-mobile-home" label="Housekeeper home · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileHome /></MobileFrameWrapper>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="hk-mobile-rooms" label="My rooms · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileMyRooms /></MobileFrameWrapper>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="hk-mobile-detail" label="Room detail · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileRoomDetail /></MobileFrameWrapper>
            </DCArtboard>
          )}
        </DCSection>

        {/* ─── ENGINEERING ──────────────────────────────────────────────────── */}
        <DCSection id="engineering" title="Engineering" subtitle="Work orders, drawer, predictions">
          {showDesktop && (
            <DCArtboard id="wo-board" label="Work orders · board + detail drawer" width={1680} height={950}>
              <DesktopArtboard active="engineering">
                <WorkOrdersScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="wo-mobile" label="Work order · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileWorkOrder /></MobileFrameWrapper>
            </DCArtboard>
          )}
        </DCSection>

        {/* ─── INTELLIGENCE ─────────────────────────────────────────────────── */}
        <DCSection id="intelligence" title="AI" subtitle="Copilot, SOPs">
          {showDesktop && (
            <DCArtboard id="copilot" label="AI Copilot" width={1440} height={1000}>
              <DesktopArtboard active="ai-copilot">
                <AICopilotScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="copilot-mobile" label="Copilot · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileCopilot /></MobileFrameWrapper>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="sop" label="SOP library" width={1440} height={1050}>
              <DesktopArtboard active="sop">
                <SOPLibraryScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
        </DCSection>

        {/* ─── OPERATIONS ───────────────────────────────────────────────────── */}
        <DCSection id="operations" title="Operations" subtitle="Tasks, guest requests, logbook, lost & found">
          {showDesktop && (
            <DCArtboard id="tasks" label="Tasks" width={1440} height={1000}>
              <DesktopArtboard active="tasks">
                <TasksScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="guest-req" label="Guest requests" width={1440} height={850}>
              <DesktopArtboard active="guest-requests">
                <GuestRequestsScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showMobile && (
            <DCArtboard id="guest-req-mobile" label="Guest request · mobile" width={406} height={800}>
              <MobileFrameWrapper><MobileGuestRequest /></MobileFrameWrapper>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="logbook" label="Logbook" width={1440} height={1050}>
              <DesktopArtboard active="logbook">
                <LogbookScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
          {showDesktop && (
            <DCArtboard id="lost-found" label="Lost & Found" width={1440} height={950}>
              <DesktopArtboard active="lost-found">
                <LostFoundScreen />
              </DesktopArtboard>
            </DCArtboard>
          )}
        </DCSection>

        {/* ─── ORG ──────────────────────────────────────────────────────────── */}
        {showDesktop && (
          <DCSection id="org" title="Organization" subtitle="People, schedule, reports">
            <DCArtboard id="staff" label="Staff" width={1440} height={1000}>
              <DesktopArtboard active="staff">
                <StaffScreen />
              </DesktopArtboard>
            </DCArtboard>
            <DCArtboard id="schedule" label="Scheduling" width={1440} height={850}>
              <DesktopArtboard active="scheduling">
                <SchedulingScreen />
              </DesktopArtboard>
            </DCArtboard>
            <DCArtboard id="reports" label="Reports" width={1440} height={1180}>
              <DesktopArtboard active="reports">
                <ReportsScreen />
              </DesktopArtboard>
            </DCArtboard>
          </DCSection>
        )}

        {/* ─── SETTINGS ─────────────────────────────────────────────────────── */}
        {showDesktop && (
          <DCSection id="settings" title="Settings" subtitle="Profile · integrations · AI · billing">
            <DCArtboard id="settings-desktop" label="Settings" width={1440} height={1050}>
              <DesktopArtboard active="settings">
                <SettingsScreen />
              </DesktopArtboard>
            </DCArtboard>
          </DCSection>
        )}

      </DesignCanvas>
    </TweaksCtx.Provider>
  );
}

// ─── Wrapper to center mobile phone within an artboard ──────────────────────
function MobileFrameWrapper({ children }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#e8e3dc',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundImage: 'radial-gradient(circle, var(--ink-4) 0.5px, transparent 0.5px)',
      backgroundSize: '14px 14px',
      backgroundPosition: '0 0',
    }}>
      {children}
    </div>
  );
}

// ─── Foundations boards ─────────────────────────────────────────────────────
function FoundationsBoard() {
  return (
    <div style={{ padding: 30, height: '100%', background: 'var(--paper)', overflow: 'auto' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 6 }}>
        Aesthetic
      </div>
      <h1 style={{
        margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400,
        fontSize: 38, letterSpacing: -0.5, color: 'var(--ink)',
      }}>
        Warm operational <em style={{ fontStyle: 'italic' }}>hospitality</em>.
      </h1>
      <p style={{ margin: '12px 0 26px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 560 }}>
        Calm utility for staff on the floor, hospitality warmth for the operators above them.
        Off-white paper, deep charcoal text, a single terracotta accent for action, deep teal
        for ready states, amber for caution. Monospace for codes and times.
      </p>

      {/* Type system */}
      <div style={{ marginBottom: 26 }}>
        <SectionLabel hint="3 families">Type</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, paddingBottom: 12, borderBottom: '1px dashed var(--line-2)' }}>
            <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)', minWidth: 100 }}>IBM Plex Sans</Mono>
            <span style={{ fontSize: 28, fontWeight: 400 }}>The floor team is ready by 3.</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>UI · body · labels</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, paddingBottom: 12, borderBottom: '1px dashed var(--line-2)' }}>
            <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)', minWidth: 100 }}>Instrument Serif</Mono>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontStyle: 'italic' }}>An editorial moment.</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>Headlines · AI quotes</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
            <Mono style={{ fontSize: 10.5, color: 'var(--ink-3)', minWidth: 100 }}>IBM Plex Mono</Mono>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22 }}>R-207 · 24m · $1.84</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>Codes · times · numbers</span>
          </div>
        </div>
      </div>

      {/* Color */}
      <SectionLabel hint="Surfaces + semantic">Color</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { l: 'Paper', v: '#f7f4ee', tone: 'paper' },
          { l: 'Ink', v: '#1a1815', tone: 'ink' },
          { l: 'Line', v: '#e6dfd1' },
          { l: 'Surface 2', v: '#fbf9f4' },
          { l: 'Accent', v: 'var(--accent)', token: true },
          { l: 'Ready', v: '#0c6e63' },
          { l: 'Caution', v: '#a16207' },
          { l: 'Alert', v: '#a6263c' },
          { l: 'Info', v: '#265d8a' },
          { l: 'AI', v: '#4a2c8f' },
          { l: 'Ink-2', v: '#4a4640' },
          { l: 'Ink-3', v: '#807a70' },
        ].map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{
              height: 56, borderRadius: 8, background: s.v,
              border: '1px solid var(--line)',
            }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{s.l}</span>
              <Mono style={{ color: 'var(--ink-3)' }}>{s.v.startsWith('var') ? '—' : s.v}</Mono>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentsBoard() {
  return (
    <div style={{ padding: 30, height: '100%', background: 'var(--paper)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <SectionLabel>Buttons</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Btn variant="primary" icon="plus">Primary</Btn>
          <Btn variant="dark">Dark</Btn>
          <Btn variant="outline">Outline</Btn>
          <Btn variant="secondary">Secondary</Btn>
          <Btn variant="ghost">Ghost</Btn>
          <Btn variant="ai" icon="spark">AI action</Btn>
        </div>
      </div>
      <div>
        <SectionLabel>Status pills</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Pill tone="dirty" icon="alert">Dirty 14</Pill>
          <Pill tone="progress" icon="clock">In progress 9</Pill>
          <Pill tone="clean">To inspect 6</Pill>
          <Pill tone="ready" icon="check">Ready 52</Pill>
          <Pill tone="pickup">Pickup 3</Pill>
          <Pill tone="ooo">OOO 3</Pill>
          <Pill tone="accent" icon="star">VIP</Pill>
          <AILabel confidence={91}>Insight</AILabel>
        </div>
      </div>
      <div>
        <SectionLabel>Stats</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <Stat label="Clean time" value="24" unit="min" delta="−3m" deltaTone="ready" icon="clock" />
          <Stat label="Open WOs" value="6" delta="2 high" deltaTone="alert" icon="wrench" />
          <Stat label="Guest NPS" value="62" delta="+8" deltaTone="ready" icon="star" />
        </div>
      </div>
      <div>
        <SectionLabel>AI message</SectionLabel>
        <div style={{
          background: 'var(--ai-soft)', border: '1px solid var(--ai-line)',
          borderRadius: 12, padding: 14,
        }}>
          <AILabel confidence={88}>Insight</AILabel>
          <p style={{
            margin: '10px 0 0', fontFamily: 'var(--font-display)', fontStyle: 'italic',
            fontSize: 17, lineHeight: 1.45,
          }}>
            Two AC complaints in the same fan-coil zone overnight. Recommend a pre-emptive belt swap.
          </p>
        </div>
      </div>
      <div>
        <SectionLabel>Avatars</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {['Mia Patel', 'Maria Vega', 'Tina Aoki', 'Carlos Ruiz', 'Beatrix Khan', 'Ravi Patel'].map(n => (
            <Avatar key={n} name={n} size={32} />
          ))}
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
