import { inflateRawSync } from 'node:zlib';
export type ParsedTable = {
  sheet: string;
  columns: string[];
  rows: Record<string, string>[];
};
function unescapeXml(value: string) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function columnIndex(ref: string) {
  let n = 0;
  for (const c of ref) {
    if (!/[A-Z]/i.test(c)) break;
    n = n * 26 + c.toUpperCase().charCodeAt(0) - 64;
  }
  return n - 1;
}
function zipEntries(input: Buffer) {
  let end = -1;
  for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--) {
    if (input.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error('This workbook is not a valid XLSX file.');
  const count = input.readUInt16LE(end + 10);
  if (count > 2000) throw Error('Workbook contains too many files.');
  let offset = input.readUInt32LE(end + 16),
    total = 0;
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (input.readUInt32LE(offset) !== 0x02014b50) throw Error('Workbook archive is invalid.');
    const method = input.readUInt16LE(offset + 10),
      compressed = input.readUInt32LE(offset + 20),
      size = input.readUInt32LE(offset + 24),
      nameLen = input.readUInt16LE(offset + 28),
      extraLen = input.readUInt16LE(offset + 30),
      commentLen = input.readUInt16LE(offset + 32),
      local = input.readUInt32LE(offset + 42),
      name = input.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    const isSheet = name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml') && /^\d+$/.test(name.slice(19, -4));
    if (!new Set(['xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/_rels/workbook.xml.rels']).has(name) && !isSheet) continue;
    total += size;
    if (size > 8_000_000 || total > 16_000_000) throw Error('Workbook expands beyond the safe import limit.');
    if (input.readUInt32LE(local) !== 0x04034b50) throw Error('Workbook archive is invalid.');
    const dataOffset = local + 30 + input.readUInt16LE(local + 26) + input.readUInt16LE(local + 28),
      part = input.subarray(dataOffset, dataOffset + compressed);
    let raw: Buffer;
    if (method === 0) raw = Buffer.from(part);else if (method === 8) raw = inflateRawSync(part, {
      maxOutputLength: 8_000_001
    });else throw Error('Workbook compression method is unsupported.');
    out.set(name, raw.toString('utf8'));
  }
  return out;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;else cell += c;
    } else if (c === '"' && cell === '') quoted = true;else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
      cell = '';
      if (rows.length > 10001) throw Error('CSV has more than 10,000 data rows.');
    } else cell += c;
  }
  if (quoted) throw Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
function table(columns: string[], body: string[][], sheet = '') {
  if (!columns.length) throw Error('No column headers were found.');
  if (columns.length > 50) throw Error('A file can contain up to 50 columns.');
  const keys: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const base = (columns[i].trim() || 'Column ' + (i + 1)).slice(0, 100);
    let name = base,
      n = 2;
    while (keys.includes(name)) name = base + ' (' + n++ + ')';
    keys.push(name);
  }
  if (body.length > 10000) throw Error('A file can contain up to 10,000 data rows.');
  return {
    sheet,
    columns: keys,
    rows: body.filter(row => row.some(v => v.trim())).map(row => Object.fromEntries(keys.map((k, i) => [k, (row[i] || '').slice(0, 2000)])))
  };
}
export function parseUploadedTable(extension: string, data: Buffer): ParsedTable | null {
  if (extension === 'csv') {
    const rows = parseCsv(data.toString('utf8').replace(/^\uFEFF/, ''));
    if (!rows.length) throw Error('CSV is empty.');
    return table(rows[0], rows.slice(1));
  }
  if (extension !== 'xlsx') return null;
  const zip = zipEntries(data),
    workbook = zip.get('xl/workbook.xml') || '',
    relationships = zip.get('xl/_rels/workbook.xml.rels') || '';
  const sheetAttrs = /<sheet\b([^>]*)\/?\s*>/.exec(workbook)?.[1] || '';
  const sheetName = /\bname="([^"]+)"/.exec(sheetAttrs)?.[1] || 'Sheet 1';
  const relationshipId = /\br:id="([^"]+)"/.exec(sheetAttrs)?.[1];
  const relationship = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(m => /\bId="([^"]+)"/.exec(m[1])?.[1] === relationshipId)?.[1] || '';
  const target = /\bTarget="([^"]+)"/.exec(relationship)?.[1] || 'worksheets/sheet1.xml';
  const relativeTarget = target.startsWith('/') ? target.slice(1) : target;
  const sheetPath = relativeTarget.startsWith('xl/') ? relativeTarget : 'xl/' + relativeTarget;
  if (!sheetPath.startsWith('xl/worksheets/sheet') || !sheetPath.endsWith('.xml')) throw Error('Workbook first worksheet path is invalid.');
  const sheet = zip.get(sheetPath);
  if (!sheet) throw Error('Workbook has no first worksheet.');
  const strings: string[] = [];
  const shared = zip.get('xl/sharedStrings.xml') || '';
  for (const item of shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) strings.push([...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => unescapeXml(x[1])).join(''));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /\br="([A-Z]+)\d+"/i.exec(cm[1]),
        idx = ref ? columnIndex(ref[1]) : values.length;
      if (idx < 0 || idx >= 50) continue;
      const type = /\bt="([^"]+)"/.exec(cm[1])?.[1],
        v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cm[2])?.[1] || '';
      const text = type === 's' ? strings[Number(v)] || '' : type === 'inlineStr' ? [...cm[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => unescapeXml(x[1])).join('') : unescapeXml(v);
      values[idx] = text.slice(0, 2000);
    }
    if (values.some(v => (v || '').trim())) rows.push(values);
    if (rows.length > 10001) throw Error('Worksheet has more than 10,000 data rows.');
  }
  if (!rows.length) throw Error('The first worksheet is empty.');
  return table(rows[0].map(v => v || ''), rows.slice(1), unescapeXml(sheetName));
}
