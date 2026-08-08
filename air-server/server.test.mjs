import test from 'node:test';
import assert from 'node:assert/strict';

import { queryTokens, sqlGuard } from './server.mjs';

test('sqlGuard allows one read-only statement and supplies a row limit', () => {
  assert.equal(sqlGuard('SELECT id FROM employees'), 'SELECT id FROM employees LIMIT 50');
  assert.equal(sqlGuard('WITH active AS (SELECT 1) SELECT * FROM active LIMIT 3;'), 'WITH active AS (SELECT 1) SELECT * FROM active LIMIT 3');
});

test('sqlGuard rejects mutations, comments, and multiple statements', () => {
  for (const sql of [
    'DELETE FROM employees',
    'SELECT * FROM employees; SELECT 1',
    'SELECT * FROM employees -- bypass',
    'SELECT pg_sleep(1)',
  ]) {
    assert.throws(() => sqlGuard(sql));
  }
});

test('queryTokens removes particles, stop words, and duplicates', () => {
  assert.deepEqual(queryTokens('AIR는 AIR는 백업 정책이 어떻게 되어 있어?'), ['AIR', '백업', '정책']);
});
