import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LayoutDashboard, FileText, Users, Download, Bell, Settings2, ShieldCheck, LogOut, Menu, Plus, ChevronRight, ArrowRight, Leaf, CalendarDays, FileSpreadsheet, X } from 'lucide-react';
import { api, localDate, type Row } from './api';
import { Field } from './components';
import Dashboard from './Dashboard';
import UploadedInsights from './UploadedInsights';
import ReportEditor from './ReportEditor';
import Reports from './Reports';
import { Team } from './Management';
import { Settings, Exports, Notifications, Audit } from './Workspace';
import './styles.css';
function Login({
  onLogin
}: {
  onLogin: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="login"><section className="login-story"><a className="brand" href="/"><span className="brand-mark"><Leaf size={24} /></span>cadence<span className="brand-dot">.</span></a><span className="eyebrow">BUSINESS DEVELOPMENT WORKSPACE</span><h1>Great teams find<br />their rhythm.</h1><p>A shared place for daily progress, thoughtful feedback, and meaningful growth.</p><div className="login-art" aria-hidden="true"><div /><div /><div /><div /><div /><div /><span>Small steps.<br /><b>Visible progress.</b></span></div><footer>Clarity for your team. Context for every result.</footer></section><section className="login-form"><div><span className="eyebrow">WELCOME TO CADENCE</span><h2>Good work starts here.</h2><p>Sign in to your team workspace.</p><form onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/auth/login', {
              email,
              password
            });
            setPassword('');
            await onLogin();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}>{error && <p className="error" role="alert">{error}</p>}<Field label="Work email"><input required autoComplete="username" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Password"><input required autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} /></Field><button disabled={busy} className="primary">{busy ? 'Signing in…' : 'Sign in to workspace'}<ArrowRight size={17} /></button></form><p className="login-help">Need an account or password reset? Contact your workspace administrator.</p></div></section></div>;
}
function App() {
  const [data, setData] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [reportId, setReportId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [message, setMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [preset, setPreset] = useState('month');
  const today = localDate();
  const [filters, setFilters] = useState<Row>({
    start: today.slice(0, 7) + '-01',
    end: today,
    user: '',
    role: '',
    category: '',
    status: ''
  });
  const toast = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(''), 7000);
  };
  const refresh = async () => {
    const result = await api('/bootstrap');
    setData(result);
  };
  useEffect(() => {
    api('/auth/me').then(refresh).catch(e => {
      if (e.message !== 'Please sign in.') setGlobalError(e.message);
    }).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const navigate = (next: string, id: number | null = null) => {
    if (dirty && !confirm('Leave this report with unsaved changes? Save the draft first to keep your edits.')) return;
    setDirty(false);
    setPage(next);
    setReportId(id);
    setMobile(false);
    window.scrollTo(0, 0);
  };
  const selectPeriod = (value: string) => {
    setPreset(value);
    if (value === 'custom') return;
    const end = localDate(data?.settings.timezone);
    const d = new Date(end + 'T12:00:00Z');
    let start = end;
    if (value === 'week') {
      d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
      start = d.toISOString().slice(0, 10);
    }
    if (value === 'month') start = end.slice(0, 7) + '-01';
    if (value === 'previous') {
      d.setUTCDate(0);
      start = d.toISOString().slice(0, 7) + '-01';
      setFilters(f => ({
        ...f,
        start,
        end: d.toISOString().slice(0, 10)
      }));
      return;
    }
    setFilters(f => ({
      ...f,
      start,
      end
    }));
  };
  if (!ready) return <div className="boot" role="status"><Leaf />Opening your workspace…</div>;
  if (!data) return <>{globalError && <div className="error">{globalError}</div>}<Login onLogin={refresh} /></>;
  const admin = data.user.access === 'admin';
  const navigation = [{
    id: 'dashboard',
    label: admin ? 'Team overview' : 'My overview',
    icon: LayoutDashboard
  }, {
    id: 'reports',
    label: 'Daily reports',
    icon: FileText
  }, ...(admin ? [{
    id: 'team',
    label: 'Team members',
    icon: Users
  }, {
    id: 'uploads',
    label: 'Uploaded files',
    icon: FileSpreadsheet
  }] : []), {
    id: 'summaries',
    label: 'Weekly & monthly',
    icon: CalendarDays
  }, {
    id: 'exports',
    label: 'Reports & exports',
    icon: Download
  }];
  const utility = [{
    id: 'notifications',
    label: 'Notifications',
    icon: Bell
  }, {
    id: 'settings',
    label: 'Settings',
    icon: Settings2
  }, ...(admin ? [{
    id: 'audit',
    label: 'Audit trail',
    icon: ShieldCheck
  }] : [])];
  const label = [...navigation, ...utility].find(n => n.id === page)?.label || 'Daily report';
  const showFilters = ['dashboard', 'summaries', 'reports', 'exports'].includes(page);
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>{mobile && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />}<aside className={'sidebar ' + (mobile ? 'open' : '')}><a className="brand" href="#" onClick={e => {
        e.preventDefault();
        navigate('dashboard');
      }}><span className="brand-mark"><Leaf size={22} /></span>cadence<span className="brand-dot">.</span></a><div className="workspace-label"><span>BD</span><div><strong>BD Team Workspace</strong><small>Reporting & performance</small></div></div><span className="nav-label">WORKSPACE</span><nav aria-label="Workspace">{navigation.map(({
          id,
          label,
          icon: Icon
        }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={18} />{label}{page === id && <span className="nav-active-dot" />}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="small">A LITTLE EVERY DAY</span><strong>Progress has a rhythm.</strong><p>{admin ? "Review reports and spot patterns across the team." : "Your daily report helps the whole team move forward."}</p>{!admin && <button onClick={() => navigate('editor')}>Log today’s work<ArrowRight size={14} /></button>}</div><nav aria-label="Account">{utility.map(({
            id,
            label,
            icon: Icon
          }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={18} />{label}{id === 'notifications' && data.unread > 0 && <span className="count">{data.unread}</span>}</button>)}</nav><div className="account"><span className="avatar">{data.user.name.slice(0, 1)}</span><div><strong>{data.user.name}</strong><small>{admin ? 'Administrator' : data.user.role_name}</small></div><button aria-label="Sign out" className="icon-button" onClick={async () => {
            if (dirty && !confirm('Sign out with unsaved report changes?')) return;
            try {
              await api('/auth/logout', {});
              setData(null);
              setDirty(false);
            } catch (e) {
              toast((e as Error).message);
            }
          }}><LogOut size={16} /></button></div></div></aside><div className="workspace"><header className="topbar"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={22} /></button><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>{label}</strong></div><div className="topbar-right"><span className="timezone">{data.settings.timezone}</span><button className="icon-button notification-button" aria-label="Open notifications" onClick={() => navigate('notifications')}><Bell size={19} />{data.unread > 0 && <i />}</button><span className="avatar small-avatar">{data.user.name[0]}</span></div></header><main id="main"><div className="page-topline"><span>{new Intl.DateTimeFormat('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: data.settings.timezone
            }).format(new Date())}</span>{!admin && <button className="text-button" onClick={() => navigate('editor')}><Plus size={15} />New daily report</button>}</div>{showFilters && <section className="filterbar" aria-label="Report filters"><Field label="Reporting period"><select value={preset} onChange={e => selectPeriod(e.target.value)}><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option><option value="previous">Previous month</option><option value="custom">Custom range</option></select></Field><Field label="From"><input type="date" required value={filters.start} onChange={e => {
              setPreset('custom');
              setFilters({
                ...filters,
                start: e.target.value
              });
            }} /></Field><Field label="To"><input type="date" required value={filters.end} onChange={e => {
              setPreset('custom');
              setFilters({
                ...filters,
                end: e.target.value
              });
            }} /></Field>{admin && <><Field label="Employee"><select value={filters.user} onChange={e => setFilters({
                ...filters,
                user: e.target.value
              })}><option value="">All team members</option>{data.users.map((u: Row) => <option key={u.id} value={u.id}>{u.name}{!u.active ? ' (inactive)' : ''}</option>)}</select></Field><Field label="Role"><select value={filters.role} onChange={e => setFilters({
                ...filters,
                role: e.target.value
              })}><option value="">All roles</option>{data.roles.map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field></>}<Field label="Category"><select value={filters.category} onChange={e => setFilters({
              ...filters,
              category: e.target.value
            })}><option value="">All categories</option>{data.categories.map((c: Row) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Status"><select value={filters.status} onChange={e => setFilters({
              ...filters,
              status: e.target.value
            })}><option value="">All statuses</option>{['draft', 'submitted', 'correction_requested', 'corrected', 'approved', 'late'].map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}</select></Field></section>}
 {(page === 'dashboard' || page === 'summaries') && <Dashboard key={page} data={data} filters={filters} onSelect={id => setFilters({
          ...filters,
          user: String(id)
        })} toast={toast} />}{page === 'reports' && <Reports filters={filters} onOpen={id => navigate('editor', id)} onCreate={() => navigate('editor')} canCreate={!admin} />}{page === 'editor' && <ReportEditor key={reportId || 'new'} data={data} reportId={reportId} onBack={() => navigate('reports')} onDirty={setDirty} toast={toast} />}{page === 'team' && admin && <Team data={data} refresh={refresh} toast={toast} />}{page === 'uploads' && admin && <UploadedInsights data={data} filters={filters} />}{page === 'settings' && <Settings data={data} refresh={refresh} toast={toast} />}{page === 'exports' && <Exports filters={filters} />}{page === 'notifications' && <Notifications data={data} refresh={refresh} toast={toast} />}{page === 'audit' && admin && <Audit />}<footer className="page-footer"><span>Cadence · BD Team Reporting</span><span>Every metric has context. Every person has a role.</span></footer></main></div>{message && <div className="toast" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage('')}><X size={16} /></button></div>}</div>;
}
class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
}, {
  error: boolean;
}> {
  state = {
    error: false
  };
  static getDerivedStateFromError() {
    return {
      error: true
    };
  }
  render() {
    return this.state.error ? <div className="boot" role="alert"><h1>Unable to display this page.</h1><p>Reload to reconnect to your workspace.</p><button onClick={() => window.location.reload()}>Reload</button></div> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
