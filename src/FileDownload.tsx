import { useState } from 'react';
import { downloadAttachment } from './api';
export function FileDownload({ id, children = 'Download', className = 'text-button' }: { id: string; children?: React.ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <span><button type="button" className={className} disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { await downloadAttachment(id); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}>{busy ? 'Downloading…' : children}</button>{error && <span role="alert" className="error">{error}</span>}</span>;
}
