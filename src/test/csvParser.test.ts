import assert from 'node:assert/strict';
import { parseCsv, serializeCsv, stripBom } from '../csvParser';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

test('standard comma-separated', () => {
  const { data } = parseCsv('a,b,c\n1,2,3\n', { hasHeader: true });
  assert.deepEqual(data.headers, ['a', 'b', 'c']);
  assert.deepEqual(data.rows, [['1', '2', '3']]);
  assert.equal(data.delimiter, ',');
});

test('quoted fields with commas', () => {
  const { data } = parseCsv('h1,h2\n"hello, world",x\n', { hasHeader: true });
  assert.deepEqual(data.rows[0], ['hello, world', 'x']);
});

test('quoted fields with newlines', () => {
  const { data } = parseCsv('h\n"line1\nline2",b\n', { hasHeader: true });
  assert.deepEqual(data.rows[0][0], 'line1\nline2');
});

test('escaped quotes', () => {
  const { data } = parseCsv('h\n"""quoted""",b\n', { hasHeader: true });
  assert.equal(data.rows[0][0], '"quoted"');
});

test('TSV detection', () => {
  const { data } = parseCsv('a\tb\n1\t2\n', { hasHeader: true, fileName: 'data.tsv' });
  assert.equal(data.delimiter, '\t');
});

test('empty fields', () => {
  const { data } = parseCsv('a,b,c\n,,\n', { hasHeader: true });
  assert.deepEqual(data.rows[0], ['', '', '']);
});

test('single-row files', () => {
  const { data } = parseCsv('only,header\n', { hasHeader: true });
  assert.deepEqual(data.headers, ['only', 'header']);
  assert.equal(data.rows.length, 1);
});

test('round-trip serialization', () => {
  const headers = ['a', 'b'];
  const rows = [['1', '2,3'], ['x', 'y']];
  const csv = serializeCsv(headers, rows, { delimiter: ',', hasHeader: true });
  const { data } = parseCsv(csv, { delimiter: ',', hasHeader: true });
  assert.deepEqual(data.headers, headers);
  assert.deepEqual(data.rows, rows);
});

test('BOM strip', () => {
  assert.equal(stripBom('\uFEFFdata'), 'data');
});

test('empty file', () => {
  const { data } = parseCsv('', { hasHeader: true });
  assert.deepEqual(data.headers, ['Column 1']);
  assert.deepEqual(data.rows, [['']]);
});

console.log('All csvParser tests passed.');
