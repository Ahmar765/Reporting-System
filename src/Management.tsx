import { useState } from 'react';
import { Plus, Users, Target, Pencil, ShieldCheck } from 'lucide-react';
import { api, firebaseMode, localDate, number, type Row } from './api';
import { Field, Badge, Empty } from './components';
type Props = {
  data: Row;
  refresh: () => Promise<void>;
  toast: (m: string) => void;
};
export function Team({
  data,
  refresh,
  toast
}: Props) {
  const blank = () => ({
    name: '',
    email: '',
    employee_code: '',
    role_id: data.roles[0]?.id || 1,
    access: 'employee',
    joining_date: localDate(data.settings.timezone),
    timezone: data.settings.timezone,
    workdays: [1, 2, 3, 4, 5],
    deadline: data.settings.deadline,
    notifications: true,
    email_notifications: false,
    category_ids: [],
    password: ''
  }) as Row;
  const [form, setForm] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');
  const [reset, setReset] = useState<Row | null>(null);
  const set = (patch: Row) => setForm(f => ({
    ...f,
    ...patch
  }));
  return <><div className="section-intro"><div><span className="eyebrow">PEOPLE & RESPONSIBILITIES</span><h1>A team with room to grow.</h1><p>Individual accounts, relevant categories, and a schedule that fits.</p></div><button className="primary" onClick={() => {
        setForm(blank());
        setError('');
      }}><Plus size={16} />Add team member</button></div>{error && <div className="error" role="alert">{error}</div>}
 {form && <form className="panel" onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      setError('');
      try {
        await api(form.id ? '/users/' + form.id : '/users', form, form.id ? 'PUT' : 'POST');
        setForm(null);
        await refresh();
        toast('Employee profile saved.');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }}><div className="panel-heading"><h2>{form.id ? 'Edit profile' : 'Create employee account'}</h2><button className="text-button" type="button" onClick={() => setForm(null)}>Cancel</button></div><div className="form-grid three"><Field label="Full name"><input required value={form.name} onChange={e => set({
            name: e.target.value
          })} /></Field><Field label="Email address"><input required type="email" autoComplete="off" readOnly={firebaseMode && !!form.id} value={form.email} onChange={e => set({
            email: e.target.value
          })} /></Field><Field label="Employee identifier"><input required value={form.employee_code} onChange={e => set({
            employee_code: e.target.value
          })} /></Field><Field label="Job role"><select value={form.role_id} onChange={e => set({
            role_id: Number(e.target.value)
          })}>{data.roles.map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><Field label="Access level"><select value={form.access} onChange={e => set({
            access: e.target.value
          })}><option value="employee">Employee</option><option value="admin">Administrator</option></select></Field><Field label="Joining date"><input required type="date" value={form.joining_date} onChange={e => set({
            joining_date: e.target.value
          })} /></Field><Field label="IANA timezone"><input required value={form.timezone} onChange={e => set({
            timezone: e.target.value
          })} /></Field><Field label="Daily deadline"><input required type="time" value={form.deadline} onChange={e => set({
            deadline: e.target.value
          })} /></Field>{!form.id && <Field label="Initial password (12+ characters)"><input required minLength={12} maxLength={128} autoComplete="new-password" type="password" value={form.password} onChange={e => set({
            password: e.target.value
          })} /></Field>}</div><fieldset className="checks"><legend>Scheduled working days</legend>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <label key={d}><input type="checkbox" checked={form.workdays.includes(i + 1)} onChange={e => set({
            workdays: e.target.checked ? [...form.workdays, i + 1] : form.workdays.filter((v: number) => v !== i + 1)
          })} />{d}</label>)}</fieldset><fieldset className="checks"><legend>Assigned reporting categories</legend>{data.categories.map((c: Row) => <label key={c.id}><input type="checkbox" checked={form.category_ids.includes(c.id)} onChange={e => set({
            category_ids: e.target.checked ? [...form.category_ids, c.id] : form.category_ids.filter((v: number) => v !== c.id)
          })} />{c.name}</label>)}</fieldset><div className="checks"><label><input type="checkbox" checked={!!form.notifications} onChange={e => set({
            notifications: e.target.checked
          })} />In-app reminders</label><label><input type="checkbox" disabled={firebaseMode} checked={!firebaseMode && !!form.email_notifications} onChange={e => set({
            email_notifications: e.target.checked
          })} />{firebaseMode ? 'Email reminders unavailable on this free deployment' : 'Email reminders when SMTP is configured'}</label></div><button disabled={busy} className="primary">{busy ? 'Saving…' : 'Save employee'}</button></form>}
 {reset && <form className="panel" onSubmit={async e => {
      e.preventDefault();
      try {
        await api('/users/' + reset.id + '/password', {
          ...(firebaseMode ? {} : { password: reset.password })
        });
        setReset(null);
        toast(firebaseMode ? 'Password reset email sent to the employee.' : 'Password reset. Existing sessions revoked.');
      } catch (err) {
        setError((err as Error).message);
      }
    }}><h2>Reset password · {reset.name}</h2>{firebaseMode ? <p>A password reset link will be emailed to {reset.email}.</p> : <Field label="New password (12+ characters)"><input required minLength={12} type="password" autoComplete="new-password" value={reset.password} onChange={e => setReset({
          ...reset,
          password: e.target.value
        })} /></Field>}<div className="inline"><button className="primary">{firebaseMode ? 'Send reset email' : 'Reset password'}</button><button type="button" onClick={() => setReset(null)}>Cancel</button></div></form>}
 <section className="panel"><div className="panel-heading"><h2><Users size={18} />Team members</h2><input type="search" aria-label="Search employees" placeholder="Search name, role or email…" value={search} onChange={e => setSearch(e.target.value)} /></div><div className="table-scroll"><table><thead><tr><th>Employee</th><th>Role / access</th><th>Schedule</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.users.filter((u: Row) => (u.name + ' ' + u.role_name + ' ' + u.email).toLowerCase().includes(search.toLowerCase())).map((u: Row) => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.email} · {u.employee_code}</small></td><td>{u.role_name}<small>{u.access}</small></td><td>{u.deadline}<small>{u.timezone}</small></td><td><Badge status={u.active ? 'active' : 'inactive'} /></td><td><div className="inline"><button className="icon-button" aria-label={'Edit ' + u.name} onClick={() => {
                    setForm({
                      ...u,
                      notifications: !!u.notifications,
                      email_notifications: !!u.email_notifications,
                      password: ''
                    });
                    setError('');
                  }}><Pencil size={15} /></button><button className="text-button" onClick={() => setReset({
                    ...u,
                    password: ''
                  })}>Reset password</button>{u.id !== data.user.id && <button className="text-button" onClick={async () => {
                    if (!confirm((u.active ? 'Deactivate ' : 'Activate ') + u.name + '?')) return;
                    try {
                      await api('/users/' + u.id + '/status', {
                        active: !u.active
                      });
                      await refresh();
                      toast('Account status updated.');
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}>{u.active ? 'Deactivate' : 'Activate'}</button>}</div></td></tr>)}</tbody></table></div></section><form className="panel" onSubmit={async e => {
      e.preventDefault();
      try {
        await api('/roles', {
          name: custom
        });
        setCustom('');
        await refresh();
        toast('Custom role created.');
      } catch (err) {
        setError((err as Error).message);
      }
    }}><h2>Custom job roles</h2><p className="muted">Roles describe responsibilities; administrator access is managed separately.</p><div className="inline"><Field label="New role name"><input required minLength={2} value={custom} onChange={e => setCustom(e.target.value)} /></Field><button className="secondary">Create role</button></div></form></>;
}
export function Targets({
  data,
  refresh,
  toast
}: Props) {
  const [error, setError] = useState('');
  const [tab, setTab] = useState('assignments');
  const [newKpi, setNewKpi] = useState<Row>({
    name: '',
    description: '',
    category_id: data.categories[0]?.id || 1,
    unit: 'actions',
    kind: 'achievement',
    aggregation: 'sum'
  });
  const [category, setCategory] = useState('');
  const [assignment, setAssignment] = useState<Row>({
    user_id: data.users[0]?.id || 1,
    kpi_id: data.kpis[0]?.id || '',
    target: 20,
    frequency: 'daily',
    start_date: localDate(data.settings.timezone),
    end_date: '',
    weight: 1,
    minimum_quality: ''
  });
  const [filter, setFilter] = useState('');
  const tomorrow = () => {
    const d = new Date(localDate(data.settings.timezone) + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const [config, setConfig] = useState<Row>({
    scope: 'company',
    scopeId: '',
    effective_date: tomorrow(),
    weights: {
      achievement: 40,
      quality: 25,
      impact: 20,
      consistency: 10,
      learning: 5
    },
    cap: 100,
    bands: [{
      min: 90,
      label: 'Excellent'
    }, {
      min: 75,
      label: 'Good'
    }, {
      min: 60,
      label: 'Needs Improvement'
    }, {
      min: 0,
      label: 'Below Expectations'
    }]
  });
  const submit = async (path: string, body: Row) => {
    setError('');
    try {
      await api(path, body);
      await refresh();
      toast('Configuration saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return <><div className="section-intro"><div><span className="eyebrow">MEASURE WHAT MATTERS</span><h1>Different roles. Clear expectations.</h1><p>Define metrics, set individual targets, and make scoring transparent.</p></div><Target size={32} /></div><div className="tabs">{[['assignments', 'Individual targets'], ['definitions', 'Metric library'], ['scoring', 'Scoring models']].map(([v, l]) => <button key={v} className={tab === v ? 'selected' : ''} onClick={() => setTab(v)}>{l}</button>)}</div>{error && <div className="error" role="alert">{error}</div>}
 {tab === 'assignments' && <><form className="panel" onSubmit={e => {
        e.preventDefault();
        void submit('/assignments', {
          ...assignment,
          user_id: Number(assignment.user_id),
          kpi_id: Number(assignment.kpi_id),
          target: Number(assignment.target),
          weight: Number(assignment.weight),
          end_date: assignment.end_date || null,
          minimum_quality: assignment.minimum_quality === '' ? null : Number(assignment.minimum_quality)
        });
      }}><h2>Assign a versioned target</h2><p className="muted">A new version closes the previous target before its start date. Past performance keeps its original assignment.</p><div className="form-grid three"><Field label="Employee"><select required value={assignment.user_id} onChange={e => setAssignment({
              ...assignment,
              user_id: Number(e.target.value)
            })}>{data.users.filter((u: Row) => u.active).map((u: Row) => <option key={u.id} value={u.id}>{u.name} · {u.role_name}</option>)}</select></Field><Field label="KPI"><select required value={assignment.kpi_id} onChange={e => setAssignment({
              ...assignment,
              kpi_id: Number(e.target.value)
            })}><option value="">Choose a metric</option>{data.kpis.filter((k: Row) => k.active).map((k: Row) => <option key={k.id} value={k.id}>{k.category} · {k.name} ({k.unit})</option>)}</select></Field><Field label="Target quantity"><input required type="number" min="0.0001" step="any" value={assignment.target} onChange={e => setAssignment({
              ...assignment,
              target: e.target.value
            })} /></Field><Field label="Frequency"><select value={assignment.frequency} onChange={e => setAssignment({
              ...assignment,
              frequency: e.target.value
            })}>{['daily', 'weekly', 'monthly'].map(v => <option key={v}>{v}</option>)}</select></Field><Field label="Effective start"><input required type="date" min={localDate(data.settings.timezone)} value={assignment.start_date} onChange={e => setAssignment({
              ...assignment,
              start_date: e.target.value
            })} /></Field><Field label="Effective end (optional)"><input type="date" value={assignment.end_date} onChange={e => setAssignment({
              ...assignment,
              end_date: e.target.value
            })} /></Field><Field label="KPI weight within component"><input required type="number" min="0.01" max="100" step="any" value={assignment.weight} onChange={e => setAssignment({
              ...assignment,
              weight: e.target.value
            })} /></Field><Field label="Minimum reviewed quality % (optional)"><input type="number" min="0" max="100" value={assignment.minimum_quality} onChange={e => setAssignment({
              ...assignment,
              minimum_quality: e.target.value
            })} /></Field></div><button className="primary">Assign target</button></form><section className="panel"><div className="panel-heading"><h2>Target history</h2><select aria-label="Filter targets by employee" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All employees</option>{data.users.map((u: Row) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>{data.assignments.length ? <div className="table-scroll"><table><thead><tr><th>Employee / metric</th><th>Target / frequency</th><th>Effective dates</th><th>Weight</th><th>Action</th></tr></thead><tbody>{data.assignments.filter((a: Row) => !filter || String(a.user_id) === filter).map((a: Row) => <tr key={a.id}><td><strong>{data.users.find((u: Row) => u.id === a.user_id)?.name}</strong><small>{data.kpis.find((k: Row) => k.id === a.kpi_id)?.name}</small></td><td>{number(a.target)} {data.kpis.find((k: Row) => k.id === a.kpi_id)?.unit}<small>{a.frequency}</small></td><td>{a.start_date}<small>to {a.end_date || 'ongoing'}</small></td><td>{a.weight}</td><td>{(!a.end_date || a.end_date >= localDate(data.settings.timezone)) && <button className="text-button" onClick={() => {
                    const end = prompt('End this target on which date? (YYYY-MM-DD)', localDate(data.settings.timezone));
                    if (end) void submit('/assignments/' + a.id + '/end', {
                      end_date: end
                    });
                  }}>End target</button>}</td></tr>)}</tbody></table></div> : <Empty title="No targets assigned" text="Choose an employee and a metric above to set a clear expectation." />}</section></>}
 {tab === 'definitions' && <><form className="panel" onSubmit={e => {
        e.preventDefault();
        void submit('/kpis', newKpi);
      }}><h2>Create a custom metric</h2><div className="form-grid three"><Field label="Metric name"><input required minLength={2} value={newKpi.name} onChange={e => setNewKpi({
              ...newKpi,
              name: e.target.value
            })} /></Field><Field label="Category"><select value={newKpi.category_id} onChange={e => setNewKpi({
              ...newKpi,
              category_id: Number(e.target.value)
            })}>{data.categories.map((c: Row) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Unit"><input required value={newKpi.unit} onChange={e => setNewKpi({
              ...newKpi,
              unit: e.target.value
            })} /></Field><Field label="Period aggregation"><select value={newKpi.aggregation} onChange={e => setNewKpi({
              ...newKpi,
              aggregation: e.target.value
            })}><option value="sum">Sum (counts, revenue, deliverables)</option><option value="average">Daily average (rates, quality percentages)</option></select></Field><Field label="Scoring component"><select value={newKpi.kind} onChange={e => setNewKpi({
              ...newKpi,
              kind: e.target.value
            })}><option value="achievement">KPI achievement</option><option value="quality">Quality & accuracy</option><option value="impact">Outcomes & impact</option></select></Field><Field label="Description"><textarea value={newKpi.description} onChange={e => setNewKpi({
              ...newKpi,
              description: e.target.value
            })} /></Field></div><button className="primary">Create metric</button></form><form className="panel" onSubmit={e => {
        e.preventDefault();
        void submit('/categories', {
          name: category
        });
        setCategory('');
      }}><h2>Add reporting category</h2><div className="inline"><Field label="Category name"><input required minLength={2} value={category} onChange={e => setCategory(e.target.value)} /></Field><button className="secondary">Add category</button></div></form><section className="panel"><h2>Metric library</h2><div className="table-scroll"><table><thead><tr><th>Metric</th><th>Category</th><th>Unit</th><th>Component</th><th>Status</th></tr></thead><tbody>{data.kpis.map((k: Row) => <tr key={k.id}><td><strong>{k.name}</strong><small>{k.description}</small></td><td>{k.category}</td><td>{k.unit}<small>{k.aggregation}</small></td><td>{k.kind}</td><td><button className="text-button" onClick={() => {
                    if (confirm((k.active ? 'Archive ' : 'Activate ') + k.name + '? Historical assignments will be preserved.')) void submit('/kpis/' + k.id + '/status', {
                      active: !k.active
                    });
                  }}>{k.active ? 'Archive' : 'Activate'}</button></td></tr>)}</tbody></table></div></section></>}
 {tab === 'scoring' && <><form className="panel" onSubmit={e => {
        e.preventDefault();
        void submit('/scoring', {
          ...config,
          user_id: config.scope === 'employee' ? Number(config.scopeId) : null,
          role_id: config.scope === 'role' ? Number(config.scopeId) : null
        });
      }}><h2><ShieldCheck size={18} />Configure a scoring model</h2><p className="muted">Employee models take precedence over role models, then company defaults. Changes apply from a future date. Selected-period scoring uses the model effective at its start.</p><div className="form-grid three"><Field label="Scope"><select value={config.scope} onChange={e => setConfig({
              ...config,
              scope: e.target.value,
              scopeId: ''
            })}><option value="company">Company</option><option value="role">Job role</option><option value="employee">Individual employee</option></select></Field>{config.scope !== 'company' && <Field label="Apply to"><select required value={config.scopeId} onChange={e => setConfig({
              ...config,
              scopeId: e.target.value
            })}><option value="">Select</option>{(config.scope === 'role' ? data.roles : data.users).map((u: Row) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}<Field label="Effective date"><input required type="date" min={tomorrow()} value={config.effective_date} onChange={e => setConfig({
              ...config,
              effective_date: e.target.value
            })} /></Field><Field label="Achievement cap (%)"><input required type="number" min="100" max="200" value={config.cap} onChange={e => setConfig({
              ...config,
              cap: Number(e.target.value)
            })} /></Field>{Object.entries(config.weights).map(([key, value]) => <Field key={key} label={key + ' weight (%)'}><input required type="number" min="0" max="100" step="any" value={String(value)} onChange={e => setConfig({
              ...config,
              weights: {
                ...config.weights,
                [key]: Number(e.target.value)
              }
            })} /></Field>)}</div><p className="notice">Total weights: {Object.values(config.weights).reduce<number>((s, v) => s + Number(v), 0)}% · Required: 100%</p><h3>Rating thresholds</h3><div className="form-grid">{config.bands.map((b: Row, i: number) => <div className="inline" key={i}><Field label="Rating label"><input required value={b.label} onChange={e => setConfig({
                ...config,
                bands: config.bands.map((v: Row, j: number) => j === i ? {
                  ...v,
                  label: e.target.value
                } : v)
              })} /></Field><Field label="Minimum score"><input type="number" required min="0" max="100" value={b.min} onChange={e => setConfig({
                ...config,
                bands: config.bands.map((v: Row, j: number) => j === i ? {
                  ...v,
                  min: Number(e.target.value)
                } : v)
              })} /></Field></div>)}</div><button className="primary">Save future model</button></form><section className="panel"><h2>Configuration history</h2>{data.scoring.map((c: Row) => <details key={c.id}><summary>Model #{c.id} · {c.user_id ? data.users.find((u: Row) => u.id === c.user_id)?.name : c.role_id ? data.roles.find((r: Row) => r.id === c.role_id)?.name : 'Company default'} · from {c.effective_date}</summary><pre>{JSON.stringify({
              ...c,
              weights: JSON.parse(c.weights),
              bands: JSON.parse(c.bands)
            }, null, 2)}</pre></details>)}</section></>}
 </>;
}
