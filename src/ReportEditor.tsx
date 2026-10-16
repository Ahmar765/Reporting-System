import { FileDownload } from './FileDownload';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, Send, ArrowLeft, ExternalLink, Paperclip, X } from 'lucide-react';
import { api, apiUpload, localDate, timestamp, number, type Row } from './api';
import { Field, Badge, Empty } from './components';
import ReportUploadInsights from './ReportUploadInsights';
import { canChangeReport, canStartReportEdit } from '../server/report-edit-policy';
const reflectionFields = [['achievements', 'Key achievements'], ['blockers', 'Challenges & blockers'], ['missed_reason', 'Reasons for missed targets'], ['lessons', 'Lessons learned'], ['suggestions', 'Improvement suggestions'], ['next_plan', 'Plan for the next working day'], ['assistance', 'Manager assistance request']];
export default function ReportEditor({
  data,
  reportId,
  onBack,
  onDirty,
  toast
}: {
  data: Row;
  reportId: number | null;
  onBack: () => void;
  onDirty: (v: boolean) => void;
  toast: (m: string) => void;
}) {
  const [report, setReport] = useState<Row>({
    date: localDate(data.user.timezone),
    version: 0,
    status: 'draft',
    activities: [],
    achievements: '',
    blockers: '',
    missed_reason: '',
    lessons: '',
    suggestions: '',
    next_plan: '',
    assistance: ''
  });
  const [loading, setLoading] = useState(!!reportId);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [review, setReview] = useState<Row>({
    action: 'comment',
    comment: '',
    improvement_plan: '',
    quality: '',
    learning: ''
  });
  useEffect(() => {
    if (reportId) api('/reports/' + reportId).then((r: Row) => setReport({
      ...r,
      activities: r.activities.map((a: Row) => ({
        ...a,
        links: a.links?.length ? a.links : a.evidence ? [a.evidence] : ['']
      }))
    })).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [reportId]);
  const editable = report.user_id === undefined || report.user_id === data.user.id;
  const locked = !editable || !canChangeReport(report as { status: string });
  const canStartEdit = editable && data.user.access === 'employee' && canStartReportEdit(report as { status: string });
  const startEdit = async () => {
    if (saveLock.current || !confirm('Start your one edit for this report? You can save changes and update attachments until you resubmit. Resubmitting permanently locks further edits.')) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      await api('/reports/' + report.id + '/edit', { version: report.version });
      const latest = await api('/reports/' + report.id);
      setReport({ ...latest, activities: latest.activities.map((a: Row) => ({ ...a, links: a.links?.length ? a.links : a.evidence ? [a.evidence] : [''] })) });
      toast('Your one-time edit is open. Resubmit when your changes are ready.');
    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setSaving(false); }
  };
  const change = (patch: Row) => {
    setReport((r: Row) => ({
      ...r,
      ...patch
    }));
    onDirty(true);
  };
  const targets = data.assignments.filter((a: Row) => a.user_id === data.user.id && a.start_date <= report.date && (!a.end_date || a.end_date >= report.date)).map((a: Row) => ({
    ...a,
    ...data.kpis.find((k: Row) => k.id === a.kpi_id),
    id: a.id,
    kpi_id: a.kpi_id
  }));
  const add = (target?: Row) => change({
    activities: [...report.activities, {
      category_id: target?.category_id || data.categories[0]?.id || 0,
      assignment_id: target?.id || null,
      title: target?.name || '',
      description: '',
      actual: 0,
      unit: target?.unit || 'tasks',
      outcome: '',
      status: 'completed',
      minutes: 0,
      evidence: '',
      links: [''],
      notes: ''
    }]
  });
  const activityChange = (index: number, patch: Row) => change({
    activities: report.activities.map((a: Row, i: number) => i === index ? {
      ...a,
      ...patch
    } : a)
  });
  const chooseFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list);
    if (next.some(file => file.size > 5 * 1024 * 1024)) {
      setError('Each file must be 5 MB or smaller.');
      return;
    }
    setPendingFiles(current => [...current, ...next].slice(0, 10));
    onDirty(true);
    void save(false, next);
  };
  const save = async (submit: boolean, filesToUpload = pendingFiles) => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const cleanActivities = report.activities.map((a: Row) => ({
        ...a,
        category_id: Number(a.category_id),
        actual: Number(a.actual),
        minutes: Number(a.minutes),
        evidence: '',
        links: (a.links || []).map((v: string) => v.trim()).filter(Boolean)
      }));
      let result: Row;
      if (filesToUpload.length) {
        result = await api('/reports', {
          ...report,
          activities: cleanActivities,
          submit: false
        });
        setReport({
          ...result,
          activities: cleanActivities.map((a: Row) => ({
            ...a,
            links: a.links.length ? a.links : ['']
          }))
        });
        for (const file of filesToUpload) {
          const uploaded = await apiUpload('/reports/' + result.id + '/files', file);
          result = {
            ...result,
            files: [...(result.files || []), uploaded.file]
          };
          setReport({
            ...result,
            activities: cleanActivities.map((a: Row) => ({
              ...a,
              links: a.links.length ? a.links : ['']
            }))
          });
          setPendingFiles(current => current.filter(item => item !== file));
        }
        if (submit) result = await api('/reports', {
          ...report,
          version: result.version,
          activities: cleanActivities,
          submit: true
        });
      } else result = await api('/reports', {
        ...report,
        activities: cleanActivities,
        submit
      });
      setReport({
        ...result,
        activities: (result.activities || cleanActivities).map((a: Row) => ({
          ...a,
          links: a.links?.length ? a.links : a.evidence ? [a.evidence] : ['']
        }))
      });
      onDirty(false);
      toast(submit ? 'Report submitted successfully.' : report.employee_edit_open === 1 ? 'Changes and attachments saved.' : 'Draft and attachments saved securely.');
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes('This report changed') && !report.id) {
        try {
          const found = await api('/reports?start=' + encodeURIComponent(report.date) + '&end=' + encodeURIComponent(report.date));
          const existing = found.rows?.find((row: Row) => row.date === report.date);
          if (existing && canChangeReport(existing as { status: string })) {
            const latest = await api('/reports/' + existing.id);
            const merged = {
              ...latest,
              ...report,
              id: latest.id,
              version: latest.version,
              files: latest.files,
              activities: report.activities.length ? report.activities : latest.activities.map((a: Row) => ({
                ...a,
                links: a.links?.length ? a.links : a.evidence ? [a.evidence] : ['']
              }))
            };
            for (const key of ['achievements', 'blockers', 'missed_reason', 'lessons', 'suggestions', 'next_plan', 'assistance']) if (!report[key]) merged[key] = latest[key];
            setReport(merged);
            setError('An existing draft for this date was found and linked. Your staged file is still here; review the draft, then choose Retry upload.');
          } else setError('A report for this date already exists and is not editable. Open it from report history to continue.');
        } catch {
          setError(message);
        }
      } else setError(message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  if (loading) return <div className="skeleton" aria-busy="true"><div /><div /></div>;
  return <><button className="text-button" onClick={onBack}><ArrowLeft size={16} />Report history</button><div className="section-intro"><div><span className="eyebrow">DAILY WORK LOG</span><h1>{locked ? 'A day of progress.' : 'Make today’s work count.'}</h1><p>Capture your activities, outcomes, and the context behind them.</p></div><Badge status={report.status} /></div>{error && <div className="error" role="alert">{error}</div>}
 {canStartEdit && <section className="panel report-edit-option"><div><h2>Edit your daily report</h2><p>You have one edit after submission. Update the report and attachments, then resubmit to lock your changes.</p></div><button type="button" className="primary" disabled={saving} onClick={() => void startEdit()}>{saving ? 'Opening edit…' : 'Edit daily report (one chance)'}</button></section>}
 {editable && report.employee_edit_count === 1 && <p className="notice" role="status">{report.employee_edit_open === 1 ? 'Your one edit is in progress. You can save changes until you resubmit; resubmitting locks this report permanently.' : 'Your one edit has been used. This report is locked.'}</p>}
 <form onSubmit={e => {
      e.preventDefault();
      void save(true);
    }}><fieldset className="report-form-fields" disabled={locked || saving}><section className="panel"><h2>Report information</h2><div className="form-grid three"><Field label="Employee"><input readOnly value={data.users.find((u: Row) => u.id === report.user_id)?.name || data.user.name} /></Field><Field label="Working date"><input required disabled={locked || report.version > 0} type="date" max={localDate(data.user.timezone)} value={report.date} onChange={e => change({
                date: e.target.value
              })} /></Field><Field label="Role"><input readOnly value={data.users.find((u: Row) => u.id === report.user_id)?.role_name || data.user.role_name} /></Field></div><p className="muted small">Created: {timestamp(report.created_at, data.user.timezone)} · Submitted: {timestamp(report.submitted_at, data.user.timezone)} · Version {report.version}</p></section>
 <section className="panel"><div className="panel-heading"><div><h2>Activities & measurable results</h2><p>Record each activity and its measurable outcome. Keep different metrics in separate rows.</p></div>{!locked && <button type="button" className="secondary" onClick={() => add()} disabled={!data.categories.length}><Plus size={16} />Custom activity</button>}</div>{!locked && targets.length > 0 && <div className="target-chips">{targets.map((t: Row) => <button type="button" key={t.id} disabled={report.activities.some((a: Row) => a.assignment_id === t.id)} onClick={() => add(t)}><Plus size={13} />{t.category} · {t.name}<span>{number(t.target)} / {t.frequency}</span></button>)}</div>}
 {!report.activities.length && <Empty title={locked ? 'No activity entries' : 'Add your first activity'} text={data.categories.length ? 'Record the actual quantity, including an explicit zero when measured.' : 'Ask your administrator to assign reporting categories.'} />}
 {report.activities.map((a: Row, index: number) => {
            const target = targets.find((t: Row) => t.id === a.assignment_id) || data.assignments.find((t: Row) => t.id === a.assignment_id);
            return <fieldset className="activity" disabled={locked} key={index}><legend>Activity {String(index + 1).padStart(2, '0')}{target && <span>Assigned target: {target.target} {a.unit} / {target.frequency}</span>}</legend><div className="form-grid three"><Field label="Category"><select required value={a.category_id} disabled={!!a.assignment_id} onChange={e => activityChange(index, {
                    category_id: Number(e.target.value)
                  })}><option value="0">Select category</option>{data.categories.map((c: Row) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Activity name"><input required maxLength={160} value={a.title} onChange={e => activityChange(index, {
                    title: e.target.value
                  })} /></Field><Field label="Status"><select value={a.status} onChange={e => activityChange(index, {
                    status: e.target.value
                  })}>{['completed', 'in_progress', 'blocked'].map(v => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}</select></Field><Field label="Actual quantity"><input type="number" required min="0" max="1000000000000" step="any" value={a.actual} onChange={e => activityChange(index, {
                    actual: e.target.value
                  })} /></Field><Field label="Measurement unit"><input required readOnly={!!a.assignment_id} value={a.unit} onChange={e => activityChange(index, {
                    unit: e.target.value
                  })} /></Field><Field label="Time spent (minutes)"><input type="number" min="0" max="1440" value={a.minutes} onChange={e => activityChange(index, {
                    minutes: e.target.value
                  })} /></Field><Field label="Description"><textarea value={a.description} onChange={e => activityChange(index, {
                    description: e.target.value
                  })} /></Field><Field label="Outcome"><textarea value={a.outcome} onChange={e => activityChange(index, {
                    outcome: e.target.value
                  })} /></Field><Field label="Notes"><textarea value={a.notes} onChange={e => activityChange(index, {
                    notes: e.target.value
                  })} /></Field></div><div className="evidence-links"><div className="panel-heading"><strong>Evidence and task links</strong>{!locked && <button type="button" className="text-button" onClick={() => activityChange(index, {
                    links: [...(a.links || []), '']
                  })}><Plus size={14} />Add link</button>}</div>{(a.links?.length ? a.links : a.evidence ? [a.evidence] : ['']).map((link: string, linkIndex: number) => <div className="inline evidence-link" key={linkIndex}><Field label={'Link ' + (linkIndex + 1)}><input type="url" placeholder="https://" value={link} disabled={locked} onChange={e => activityChange(index, {
                      links: (a.links || [a.evidence || '']).map((v: string, i: number) => i === linkIndex ? e.target.value : v)
                    })} /></Field>{!locked && <button type="button" className="icon-button" aria-label={'Delete evidence link ' + (linkIndex + 1)} onClick={() => activityChange(index, {
                    links: (a.links || []).filter((_: string, i: number) => i !== linkIndex)
                  })}><X size={15} /></button>}{locked && link && <a href={link} target="_blank" rel="noreferrer" aria-label={'Open link ' + (linkIndex + 1)}><ExternalLink size={14} /></a>}</div>)}</div>{!locked && <button type="button" className="text-button danger" onClick={() => change({
                activities: report.activities.filter((_: Row, i: number) => i !== index)
              })}><Trash2 size={14} />Remove activity</button>}{locked && a.evidence && <a href={a.evidence} target="_blank" rel="noreferrer">Open evidence <ExternalLink size={13} /></a>}</fieldset>;
          })}</section>
 <section className="panel upload-panel"><h2>Files and spreadsheet data</h2><p className="muted">Files upload automatically when selected. CSV/XLSX data appears in the admin dashboard after the report is submitted. Documents stay available as report attachments.</p>{!locked && <label className="upload-drop"><Paperclip size={18} /><span>Choose files · up to 5 MB each</span><input type="file" multiple accept=".csv,.xlsx,.xls,.doc,.docx,.pdf,.txt,.ppt,.pptx,.ods" onChange={e => {
              chooseFiles(e.target.files);
              e.currentTarget.value = '';
            }} /></label>}{pendingFiles.length > 0 && <button type="button" className="secondary upload-now" disabled={saving} onClick={() => void save(false)}><Paperclip size={15} />{saving ? 'Uploading files…' : 'Upload now'}</button>}{pendingFiles.map((file, i) => <div className="file-row" key={i}><span>{file.name} · {(file.size / 1024).toFixed(0)} KB · {saving ? 'uploading…' : 'waiting for upload'}</span><button type="button" className="icon-button" aria-label={'Remove ' + file.name} onClick={() => setPendingFiles(pendingFiles.filter((_, n) => n !== i))}><X size={14} /></button></div>)}{report.files?.map((file: Row) => <div className="file-row" key={file.id}><span><strong>{file.original_name}</strong><small>{file.row_count ? file.row_count + ' rows · ' + file.columns?.join(', ') : 'Attachment'}{file.sheet_name ? ' · ' + file.sheet_name : ''}</small></span><FileDownload id={file.id}><ExternalLink size={14} />Download</FileDownload>{!locked && <button type="button" className="icon-button" aria-label={'Remove ' + file.original_name} onClick={async () => {
              try {
                await api('/files/' + file.id, {}, 'DELETE');
                setReport({
                  ...report,
                  files: report.files.filter((x: Row) => x.id !== file.id)
                });
                change({
                  files: report.files.filter((x: Row) => x.id !== file.id)
                });
              } catch (err) {
                setError((err as Error).message);
              }
            }}><Trash2 size={14} /></button>}</div>)}</section>
 </fieldset>{report.id && report.files?.length > 0 && <ReportUploadInsights key={report.files.length} reportId={report.id} />}<fieldset className="report-form-fields" disabled={locked || saving}>
 <section className="panel"><h2>Reflect & plan</h2><p className="muted">Give your manager the context that numbers alone cannot show.</p><div className="form-grid">{reflectionFields.map(([key, label]) => <Field key={key} label={label + (key === 'achievements' || key === 'next_plan' ? ' *' : '')}><textarea disabled={locked} required={key === 'achievements' || key === 'next_plan'} maxLength={5000} value={report[key]} onChange={e => change({
                [key]: e.target.value
              })} /></Field>)}</div></section>
 </fieldset>{!locked && <div className="form-actions sticky-actions"><span>{saving ? 'Saving…' : report.employee_edit_open === 1 ? 'Resubmitting uses your only edit and locks this report.' : 'Save your draft or submit for review.'}</span><button disabled={saving} type="button" className="secondary" onClick={() => void save(false)}><Save size={16} />{report.employee_edit_open === 1 ? 'Save changes' : 'Save draft'}</button><button disabled={saving} className="primary"><Send size={16} />{report.employee_edit_open === 1 ? 'Resubmit and lock' : 'Submit report'}</button></div>}</form>
 {report.feedback?.length > 0 && <section className="panel"><h2>Manager feedback</h2>{report.feedback.map((f: Row) => <blockquote key={f.id}><p>{f.comment}</p><p>{f.improvement_plan}</p><small>{f.actor} · {timestamp(f.created_at, data.user.timezone)}</small></blockquote>)}</section>}
 {data.user.access === 'admin' && report.id && report.status !== 'draft' && <form className="panel" onSubmit={async e => {
      e.preventDefault();
      try {
        await api('/reports/' + report.id + '/review', {
          ...review,
          quality: review.quality === '' ? null : Number(review.quality),
          learning: review.learning === '' ? null : Number(review.learning)
        });
        setReport(await api('/reports/' + report.id));
        toast('Review recorded in the audit log.');
      } catch (e) {
        setError((e as Error).message);
      }
    }}><h2>Review this report</h2><div className="form-grid three"><Field label="Action"><select value={review.action} onChange={e => setReview({
            ...review,
            action: e.target.value
          })}><option value="comment">Add feedback</option><option value="approve" disabled={report.status === 'correction_requested'}>Approve</option><option value="request_correction" disabled={report.employee_edit_count === 1 && report.employee_edit_open !== 1}>Request correction</option></select></Field><Field label="Quality score (optional, 0–100)"><input type="number" min="0" max="100" value={review.quality} onChange={e => setReview({
            ...review,
            quality: e.target.value
          })} /></Field><Field label="Learning score (optional, 0–100)"><input type="number" min="0" max="100" value={review.learning} onChange={e => setReview({
            ...review,
            learning: e.target.value
          })} /></Field><Field label="Review comment"><textarea required value={review.comment} onChange={e => setReview({
            ...review,
            comment: e.target.value
          })} /></Field><Field label="Improvement plan"><textarea value={review.improvement_plan} onChange={e => setReview({
            ...review,
            improvement_plan: e.target.value
          })} /></Field></div><button className="primary">Record review</button></form>}
 {report.revisions?.length > 0 && <section className="panel"><h2>Version history</h2>{report.revisions.map((v: Row) => <details key={v.id}><summary>Version {v.version} · {timestamp(v.created_at, data.user.timezone)}</summary><pre>{JSON.stringify(JSON.parse(v.snapshot), null, 2)}</pre></details>)}</section>}</>;
}
