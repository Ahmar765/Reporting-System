import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callingColumns, isCallingData, callingValueCounts, filterCallingRows, type CallingRow } from '../shared/calling-data.js';
import { parseUploadedTable } from '../server/upload-data.js';
const csv = 'Owner name ,Owner Number ,Remarks ,Owner,Status,Response,Nex Action item,Nex Action item\r\nProspect A,123456,Agreed,Casey,Called,Interested,Audit Needed,Audit Needed\r\nProspect B,789012,No answer,Jordan,Not picked up,Voice note,Follow up,Follow up\r\nProspect C,345678,,casey ,Called,Interested,Audit Needed,Audit Needed\r\nProspect D,901234,,Casey,,,,\r\n';
const table = parseUploadedTable('csv', Buffer.from(csv))!;
const columns = callingColumns(table.columns);
const rows: CallingRow[] = table.rows.map(values => ({ values }));
test('calling CSV headers match the Owner attribute, trimmed fields and duplicate misspelled action columns', () => {
  assert.equal(isCallingData(columns), true);
  assert.deepEqual(columns.owner, ['Owner']);
  assert.deepEqual(columns.remarks, ['Remarks']);
  assert.deepEqual(columns.nextAction, ['Nex Action item', 'Nex Action item (2)']);
  assert.deepEqual(callingColumns([' Next action item ', 'NEXT ACTION ITEM (2)']).nextAction, [' Next action item ', 'NEXT ACTION ITEM (2)']);
  assert.equal(isCallingData(callingColumns(['Owner', 'Phone'])), false);
});
test('five calling filters combine with AND and normalize whitespace and case', () => {
  assert.equal(filterCallingRows(rows, columns, { owner: 'Casey' }).length, 3);
  assert.equal(filterCallingRows(rows, columns, { owner: ' Casey ', status: 'called', response: 'INTERESTED', nextAction: 'Audit Needed' }).length, 2);
  assert.equal(filterCallingRows(rows, columns, { owner: 'Casey', remarks: 'Agreed', status: 'Called', response: 'Interested', nextAction: 'Audit Needed' }).length, 1);
  assert.equal(filterCallingRows(rows, columns, { owner: 'Jordan', response: 'Interested' }).length, 0);
  assert.equal(filterCallingRows(rows, columns, { remarks: null }).length, 2);
  assert.equal(filterCallingRows(rows, columns, {}).length, 4);
});
test('collective calling graphs count records and never double-count repeated action columns', () => {
  const action = callingValueCounts(rows, columns, 'nextAction');
  assert.equal(action.find(value => value.label === 'Audit Needed')?.count, 2);
  assert.equal(action.reduce((count, value) => count + value.count, 0), 4);
  const combined = [...rows, ...rows];
  const filtered = filterCallingRows(combined, columns, { owner: 'Casey', response: 'Interested' });
  assert.equal(callingValueCounts(filtered, columns, 'nextAction')[0].count, 4);
  assert.equal(callingValueCounts(rows, columns, 'owner')[0].count, 3);
});
test('a populated duplicate action column remains filterable when the first is blank', () => {
  const row = { values: { 'Nex Action item': '', 'Nex Action item (2)': 'Follow up' } };
  assert.equal(filterCallingRows([row], columns, { nextAction: 'Follow up' }).length, 1);
  assert.equal(filterCallingRows([row], columns, { nextAction: null }).length, 0);
  assert.equal(callingValueCounts([row], columns, 'nextAction')[0].count, 1);
});
