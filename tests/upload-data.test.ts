import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUploadedTable } from '../server/upload-data.js';
import { writeWorkbook } from '../server/xlsx.js';
import * as XLSX from 'xlsx';
test('CSV imports quoted cells and separates row columns', () => {
  const table = parseUploadedTable('csv', Buffer.from('Employee,Leads,Notes\r\n"Ali, B.",4,"replied, booked"\r\n'));
  assert.deepEqual(table?.columns, ['Employee', 'Leads', 'Notes']);
  assert.deepEqual(table?.rows, [{
    Employee: 'Ali, B.',
    Leads: '4',
    Notes: 'replied, booked'
  }]);
});
test('XLSX reads the first sheet and inline text/numeric cells without evaluating formulas', () => {
  const bytes = writeWorkbook([{
    name: 'Daily outcomes',
    rows: [['Employee', 'Leads', 'Meetings'], ['Amina', 5, 2], ['Bilal', 3, 1]]
  }]);
  const table = parseUploadedTable('xlsx', bytes);
  assert.equal(table?.sheet, 'Daily outcomes');
  assert.deepEqual(table?.columns, ['Employee', 'Leads', 'Meetings']);
  assert.deepEqual(table?.rows, [{
    Employee: 'Amina',
    Leads: '5',
    Meetings: '2'
  }, {
    Employee: 'Bilal',
    Leads: '3',
    Meetings: '1'
  }]);
});
test('invalid XLSX archives are rejected', () => {
  assert.throws(() => parseUploadedTable('xlsx', Buffer.from('not a zip')), /valid XLSX/);
});
test('XLSX imports shared-string workbooks and resolves the first sheet relationship', () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Owner', 'Qualified leads'], ['Amina', 7]]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'People');
  const bytes = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    bookSST: true
  }) as Buffer;
  const parsed = parseUploadedTable('xlsx', bytes);
  assert.equal(parsed?.sheet, 'People');
  assert.deepEqual(parsed?.rows, [{
    Owner: 'Amina',
    'Qualified leads': '7'
  }]);
});
test('CSV imports thousands of rows within the bounded spreadsheet limit', () => {
  const csv = ['Company,Replies', ...Array.from({
    length: 2501
  }, (_, i) => 'Company ' + i + ',' + i % 7)].join('\n');
  const table = parseUploadedTable('csv', Buffer.from(csv));
  assert.equal(table?.rows.length, 2501);
  assert.equal(table?.rows[2500].Company, 'Company 2500');
});
