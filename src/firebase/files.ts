import { Buffer } from 'buffer';
import { gzipSync, gunzipSync } from 'fflate';
import { collection, doc, getDocFromServer, getDocsFromServer, Bytes, type Transaction } from 'firebase/firestore';
import { firestore } from './config';
import { parseUploadedTable } from './upload-data';
import { all, one, exec, audit, now, insertRows } from './database';
import { commitWorkspace, type Loaded } from './store';
import { reportKey } from '../../shared/spark-data';
import type { Row } from '../../shared/query';
const CHUNK = 256 * 1024;
const mimeByExt: Record<string, string> = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', txt: 'text/plain', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ods: 'application/vnd.oasis.opendocument.spreadsheet' };
export const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
export function fileParts(bytes: Uint8Array, kind: string) {
  return Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, index) => ({ id: `${kind}-${index}`, kind, index, bytes: Bytes.fromUint8Array(bytes.slice(index * CHUNK, (index + 1) * CHUNK)) }));
}
export async function uploadFile(loaded: Loaded, id: number, file: File) {
  const { db, user } = loaded;
  const report = one(db, 'SELECT * FROM reports WHERE id=?', id);
  if (!report || user.access !== 'admin' && report.user_id !== user.id) throw Error('Report not found.');
  if (!['draft', 'correction_requested'].includes(report.status)) throw Error('Attachments are locked after submission. Request a correction first.');
  if (all(db, 'SELECT id FROM report_files WHERE report_id=?', id).length >= 10) throw Error('A report can contain up to 10 attached files.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw Error('Choose a non-empty file up to 5 MB.');
  const name = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-255);
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (!mimeByExt[extension]) throw Error('This file format is not supported.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseUploadedTable(extension, Buffer.from(bytes));
  const rowBytes = new TextEncoder().encode(JSON.stringify(parsed?.rows || []));
  if (rowBytes.length > 16 * 1024 * 1024) throw Error('Parsed data exceeds 16 MB. Split this spreadsheet into smaller files.');
  const compressed = gzipSync(rowBytes);
  if (compressed.length > 2 * 1024 * 1024) throw Error('Parsed data is too large. Split this spreadsheet into smaller files.');
  const fileId = crypto.randomUUID();
  const metadata: Row = { id: fileId, report_id: id, user_id: report.user_id, original_name: name, extension, mime_type: mimeByExt[extension], byte_size: bytes.length, storage_name: fileId + '.' + extension, sheet_name: parsed?.sheet || '', columns_json: JSON.stringify(parsed?.columns || []), row_count: parsed?.rows.length || 0, created_at: now() };
  insertRows(db, 'report_files', [metadata]);
  audit(db, user.id, 'report.file_uploaded', 'report_file', fileId, null, { report_id: id, name, bytes: bytes.length, rows: metadata.row_count });
  const parts = [...fileParts(bytes, 'bytes'), ...fileParts(compressed, 'rows')];
  const manifest = { owner: report.user_id, reportKey: reportKey(report), metadata, dataChunks: Math.ceil(bytes.length / CHUNK), rowChunks: Math.ceil(compressed.length / CHUNK), sha256: await sha256(bytes), rowSha256: await sha256(compressed), rowBytes: rowBytes.length };
  await commitWorkspace(loaded, { apply(tx) {
    tx.set(doc(firestore, 'cadenceFiles', fileId), manifest);
    for (const part of parts) { const { id: partId, ...data } = part; tx.set(doc(firestore, 'cadenceFiles', fileId, 'parts', partId), data); }
  } });
  return { file: { ...metadata, columns: parsed?.columns || [] } };
}
export async function readFile(id: string, kind: 'bytes' | 'rows') {
  const manifestDoc = await getDocFromServer(doc(firestore, 'cadenceFiles', id));
  if (!manifestDoc.exists()) throw Error('File not found.');
  const manifest = manifestDoc.data();
  const parts = (await getDocsFromServer(collection(firestore, 'cadenceFiles', id, 'parts'))).docs.filter(d => d.get('kind') === kind).sort((a, b) => a.get('index') - b.get('index'));
  const count = Number(kind === 'bytes' ? manifest.dataChunks : manifest.rowChunks);
  if (parts.length !== count || parts.some((p, i) => p.get('index') !== i)) throw Error('File is incomplete. Contact your administrator.');
  const buffers = parts.map(p => (p.get('bytes') as Bytes).toUint8Array());
  const bytes = new Uint8Array(buffers.reduce((s, b) => s + b.length, 0));
  let offset = 0; for (const b of buffers) { bytes.set(b, offset); offset += b.length; }
  if (await sha256(bytes) !== (kind === 'bytes' ? manifest.sha256 : manifest.rowSha256)) throw Error('File integrity check failed.');
  if (kind === 'bytes' && bytes.length !== manifest.metadata.byte_size) throw Error('File size check failed.');
  return { bytes, manifest };
}
export async function loadParsedRows(loaded: Loaded, files: Row[]) {
  for (const f of files) {
    if (!f.row_count) continue;
    const { bytes, manifest } = await readFile(f.id, 'rows');
    if (manifest.rowBytes > 16 * 1024 * 1024) throw Error('Parsed file exceeds the safe size limit.');
    const raw = gunzipSync(bytes, { out: new Uint8Array(manifest.rowBytes) });
    if (raw.length !== manifest.rowBytes) throw Error('Parsed file is incomplete.');
    const rows = JSON.parse(new TextDecoder().decode(raw)) as Row[];
    if (rows.length !== f.row_count || rows.length > 10000) throw Error('Parsed row count is invalid.');
    insertRows(loaded.db, 'report_file_rows', rows.map((values, i) => ({ file_id: f.id, row_number: i + 1, values_json: JSON.stringify(values) })));
  }
}
export async function removeFile(loaded: Loaded, id: string) {
  const f = one(loaded.db, 'SELECT * FROM report_files WHERE id=?', id);
  if (!f || loaded.user.access !== 'admin' && f.user_id !== loaded.user.id) throw Error('File not found.');
  const r = one(loaded.db, 'SELECT * FROM reports WHERE id=?', f.report_id)!;
  if (!['draft', 'correction_requested'].includes(r.status)) throw Error('Submitted report attachments are locked.');
  const parts = await getDocsFromServer(collection(firestore, 'cadenceFiles', id, 'parts'));
  exec(loaded.db, 'DELETE FROM report_files WHERE id=?', id);
  audit(loaded.db, loaded.user.id, 'report.file_removed', 'report_file', id, f.original_name);
  await commitWorkspace(loaded, { apply(tx: Transaction) {
    for (const part of parts.docs) tx.delete(part.ref);
    tx.delete(doc(firestore, 'cadenceFiles', id));
  } });
  return { ok: true };
}
export async function downloadFile(id: string) {
  const { bytes, manifest } = await readFile(id, 'bytes');
  saveBlob(new Blob([new Uint8Array(bytes)], { type: manifest.metadata.mime_type }), manifest.metadata.original_name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
