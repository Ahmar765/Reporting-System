import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callingColumns, isCallingData, callingValueCounts, callingGraphs, callingDate, filterCallingRows, type CallingRow } from '../shared/calling-data.js';
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
test('six replacement graphs match the requested X and Y axes and count the appropriate records', () => {
  const headers = [...table.columns, 'Company Country', 'Date'];
  const graphColumns = callingColumns(headers);
  const records = rows.map((row, index) => ({ values: { ...row.values, 'Company Country': index === 1 ? 'Canada' : 'Pakistan', Date: index === 0 ? '14/10/2026' : index === 1 ? '13/10/2026' : '' } }));
  const graphs = callingGraphs(records, graphColumns);
  assert.deepEqual(graphs.map(graph => [graph.title, graph.xAxis, graph.yAxis]), [
    ['Call Status', 'Status', 'Number of companies/calls'],
    ['Response Analysis', 'Response', 'Number of responses'],
    ['Agent Performance', 'Owner', 'Number of calls'],
    ['Country-wise Leads', 'Company Country', 'Number of companies'],
    ['Follow-up Analysis', 'Next Action Item', 'Number of leads'],
    ['Calling Trend', 'Date', 'Number of calls']
  ]);
  const total = (id: string) => graphs.find(graph => graph.id === id)!.data.reduce((sum, point) => sum + point.count, 0);
  assert.equal(total('status'), 4);
  assert.equal(total('response'), 3);
  assert.equal(total('agent'), 3, 'Assigned records without a call status must not inflate calls made.');
  assert.equal(total('country'), 4);
  assert.equal(total('followUp'), 3, 'Repeated next-action columns must count once.');
  assert.deepEqual(graphs.find(graph => graph.id === 'trend')!.data, [{ name: '2026-10-13', count: 1 }, { name: '2026-10-14', count: 1 }]);
  assert.match(graphs.find(graph => graph.id === 'trend')!.note, /1 call without a valid date is excluded/);
  const combined = callingGraphs([...records, ...records], graphColumns);
  assert.equal(combined.find(graph => graph.id === 'agent')!.data.reduce((sum, point) => sum + point.count, 0), 6);
  const filtered = callingGraphs(filterCallingRows(records, graphColumns, { owner: 'Casey', response: 'Interested' }), graphColumns);
  assert.equal(filtered.find(graph => graph.id === 'agent')!.data[0].count, 2);
});
test('calling trend validates day-first dates and leaves blank dates undated', () => {
  assert.equal(callingDate('13/10/2026'), '2026-10-13');
  assert.equal(callingDate('2/1/2026'), '2026-01-02');
  assert.equal(callingDate('2026-10-14'), '2026-10-14');
  assert.equal(callingDate('29/02/2024'), '2024-02-29');
  for (const invalid of ['', '31/02/2026', '29/02/2026', '13/14/2026', 'not a date']) assert.equal(callingDate(invalid), null);
  const incomplete = callingGraphs(rows, columns);
  assert.equal(incomplete.find(graph => graph.id === 'country')!.missingColumn, true);
  assert.equal(incomplete.find(graph => graph.id === 'trend')!.missingColumn, true);
});
