import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUploadRows, numericColumns, numericCell } from '../shared/upload-charts.js';
const row = (user_id: number, count: unknown, type = 'Calls') => ({ user_id, user_name: 'Employee ' + user_id, date: '2026-10-15', values: { Count: count, Type: type } });
test('single and collective file graphs aggregate every selected row', () => {
  const first = [row(2, '3'), row(2, '7')];
  const second = [row(2, '20'), row(3, '8', 'Emails')];
  assert.equal(aggregateUploadRows(first, 'Count', 'employee', 'sum')[0].value, 10);
  const combined = [...first, ...second];
  assert.deepEqual(aggregateUploadRows(combined, 'Count', 'employee', 'sum').map(x => x.value), [30, 8]);
  assert.deepEqual(aggregateUploadRows(combined, 'Count', 'employee', 'average').map(x => x.value), [10, 8]);
  assert.deepEqual(aggregateUploadRows(combined, 'Count', 'column:Type', 'sum').map(x => x.value), [30, 8]);
  assert.equal(aggregateUploadRows(combined, 'Count', 'date', 'sum')[0].value, 38);
});
test('blank and missing cells are excluded, while explicit zero is kept', () => {
  const rows = [row(2, ''), row(2, null), row(2, undefined), row(2, '  '), row(2, 'invalid'), row(2, '0'), row(2, 10)];
  assert.deepEqual(numericColumns(['Count', 'Type'], rows), ['Count']);
  assert.deepEqual(aggregateUploadRows(rows, 'Count', 'employee', 'average'), [{ name: 'Employee 2', value: 5, count: 2 }]);
  assert.equal(numericCell(false), null);
  assert.equal(numericCell(Infinity), null);
});
