export type Row = Record<string, any>;
let csrf = '';
export async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : {
          'Content-Type': 'application/json'
        }),
        'X-CSRF-Token': csrf
      },
      ...(body === undefined ? {} : {
        body: JSON.stringify(body)
      })
    });
  } catch {
    throw Error('Cannot reach the reporting server. Start it with npm start, then reload this page.');
  }
  const data = await res.json().catch(() => ({
    error: 'Unexpected server response.'
  }));
  if (!res.ok) throw Error(data.error || 'Request failed');
  if (data.csrf) csrf = data.csrf;
  return data;
}
export const number = (v: unknown, digits = 1) => v === null || v === undefined ? 'Pending' : Number(v).toLocaleString(undefined, {
  maximumFractionDigits: digits
});
export const percent = (v: unknown) => v === null || v === undefined ? 'Pending' : number(v) + '%';
export const localDate = (zone = 'Asia/Karachi') => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());
export const timestamp = (v: string | null, zone = 'Asia/Karachi') => v ? new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: zone
}).format(new Date(v)) : 'Not submitted';
export async function apiUpload(path: string, file: File) {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-CSRF-Token': csrf,
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: file
    });
  } catch {
    throw Error('Upload could not reach the reporting server. Retry after reconnecting.');
  }
  const data = await res.json().catch(() => ({
    error: 'Unexpected server response.'
  }));
  if (!res.ok) throw Error(data.error || 'Upload failed');
  return data;
}
