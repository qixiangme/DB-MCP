import assert from 'node:assert/strict';
import test from 'node:test';
import { guard, loadSchema, MAX_SCHEMA_OUTPUT_CHARS } from '../tool-contract.mjs';

test('출력 예산 초과 시에도 유효한 JSON을 반환한다', async () => {
  const encoded = await guard(() => ({ rows: ['x'.repeat(500)] }), 200);
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.error, 'tool_output_too_large');
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.maxOutputChars, 200);
});

test('DB 오류의 내부 식별자를 응답에 노출하지 않는다', async () => {
  const encoded = await guard(() => {
    throw new Error('column employees.secret_salary does not exist');
  });
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.type, 'SQL_NOT_FOUND');
  assert.doesNotMatch(encoded, /employees|secret_salary/);
});

test('SQL 검증 실패는 내부 문구 대신 INVALID_INPUT 계약으로 반환한다', async () => {
  const encoded = await guard(() => {
    throw new Error('DELETE는 허용되지 않습니다. SELECT만 가능합니다.');
  });
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.type, 'INVALID_INPUT');
  assert.equal(parsed.error, '입력값이 올바르지 않습니다.');
});

test('get_schema가 외래키와 값 힌트를 같은 구조로 반환한다', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns'))
        return {
          rows: [
            { table_name: 'orders', column_name: 'product_id', data_type: 'integer' },
            { table_name: 'products', column_name: 'category', data_type: 'character varying' },
          ],
        };
      if (sql.includes("constraint_type = 'FOREIGN KEY'"))
        return {
          rows: [
            {
              source_table: 'orders',
              source_column: 'product_id',
              target_table: 'products',
              target_column: 'id',
            },
          ],
        };
      return { rows: [{ v: 'AI 플랫폼' }] };
    },
  };

  const schema = await loadSchema(pool);
  assert.deepEqual(schema.foreignKeys, ['orders.product_id -> products.id']);
  assert.deepEqual(schema.valueHints, { 'products.category': ['AI 플랫폼'] });
  assert.equal(calls.length, 3);
});

test('스키마는 일반 도구보다 큰 8000자 출력 예산을 사용한다', async () => {
  const encoded = await guard(() => ({ schema: 'x'.repeat(5000) }), MAX_SCHEMA_OUTPUT_CHARS);
  assert.equal(JSON.parse(encoded).schema.length, 5000);
});
