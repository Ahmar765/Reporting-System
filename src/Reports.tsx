import { useEffect, useState } from 'react';
import { Plus, ArrowUpRight } from 'lucide-react';
import { api, timestamp, type Row } from './api';
import { Badge, Empty } from './components';
export default function Reports({
  filters,
  onOpen,
  onCreate,
  canCreate = true
}: {
  filters: Row;
  onOpen: (id: number) => void;
  onCreate: () => void;
  canCreate?: boolean;
}) {
  const [result, setResult] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('desc');
  const query = new URLSearchParams(Object.entries({
    ...filters,
    page
  }).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    api('/reports?' + query).then(r => {
      if (active) setResult(r);
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [query]);
  useEffect(() => setPage(1), [filters.start, filters.end, filters.user, filters.status]);
  return <><div className="section-intro"><div><span className="eyebrow">REPORTING HISTORY</span><h1>Every day, documented.</h1><p>Drafts, submissions, corrections, and the feedback that follows.</p></div>{canCreate && <button className="primary" onClick={onCreate}><Plus size={16} />New daily report</button>}</div><section className="panel"><div className="panel-heading"><h2>Daily reports</h2><div className="inline"><input type="search" aria-label="Search current page" placeholder="Search this page…" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Sort reports" value={sort} onChange={e => setSort(e.target.value)}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div></div>{error && <div className="error" role="alert">{error}</div>}{!result && !error ? <div className="skeleton" aria-busy="true"><div /></div> : result?.rows.length ? <><div className="table-scroll"><table><thead><tr><th>Reporting date</th><th>Team member</th><th>Status</th><th>Submitted</th><th>Version</th><th><span className="sr-only">Open report</span></th></tr></thead><tbody>{[...result.rows].sort((a, b) => sort === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)).filter(r => (r.name + ' ' + r.role_name + ' ' + r.date).toLowerCase().includes(search.toLowerCase())).map(r => <tr key={r.id}><td><button className="text-button" onClick={() => onOpen(r.id)}>{r.date}</button></td><td><strong>{r.name}</strong><small>{r.role_name}</small></td><td><Badge status={r.status} /></td><td>{timestamp(r.submitted_at)}</td><td>v{r.version}</td><td><button className="icon-button" aria-label={'Open report ' + r.date + ' by ' + r.name} onClick={() => onOpen(r.id)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div><div className="pagination"><span>{result.total} reports · page {page}</span><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button disabled={page * 20 >= result.total} onClick={() => setPage(page + 1)}>Next</button></div></> : <Empty title="No reports in this period" text={canCreate ? "Adjust the filters or create your first daily report." : "Adjust the filters to find submitted team reports."} action={canCreate ? <button className="primary" onClick={onCreate}>Create daily report</button> : undefined} />}</section></>;
}
