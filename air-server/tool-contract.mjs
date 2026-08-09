export const MAX_OUTPUT_CHARS = 4000;
export const MAX_SCHEMA_OUTPUT_CHARS = 8000;
export const MAX_HINT_VALUES = 12;

const safeError = (error) => {
  const message = String(error?.cause?.message ?? error?.message ?? '').toLowerCase();
  if (message.includes('syntax error')) return ['SQL 문법 오류입니다. 질의를 다시 확인해주세요.', 'SQL_SYNTAX'];
  if (message.includes('permission denied')) return ['데이터베이스 접근 권한이 없습니다.', 'SQL_PERMISSION'];
  if (message.includes('does not exist')) return ['요청한 데이터를 찾을 수 없습니다.', 'SQL_NOT_FOUND'];
  if (message.includes('timeout') || message.includes('timed out'))
    return ['질의 실행 시간이 초과되었습니다. 조건을 좀 더 구체적으로 명시해주세요.', 'TIMEOUT'];
  if (message.includes('connection')) return ['데이터베이스 연결에 실패했습니다.', 'CONNECTION'];
  if (
    error instanceof TypeError ||
    message.includes('문만 허용') ||
    message.includes('다중 문장') ||
    message.includes('주석은 허용') ||
    message.includes('허용되지 않습니다')
  )
    return ['입력값이 올바르지 않습니다.', 'INVALID_INPUT'];
  return ['내부 오류가 발생했습니다.', 'UNKNOWN'];
};

/** Spring ToolResponseEncoder와 같은 유효 JSON·오류 마스킹·출력 예산 계약. */
export const guard = async (fn, maxOutputChars = MAX_OUTPUT_CHARS) => {
  try {
    const json = JSON.stringify(await fn());
    if (json.length <= maxOutputChars) return json;
    return JSON.stringify({
      error: 'tool_output_too_large',
      truncated: true,
      originalChars: json.length,
      maxOutputChars,
    });
  } catch (error) {
    const [message, type] = safeError(error);
    console.warn(`도구 실행 오류 [${type}]`);
    return JSON.stringify({ error: message, type, truncated: false });
  }
};

/** 실제 DB 제약조건을 포함한 Spring/AIR 공통 get_schema 응답을 만든다. */
export const loadSchema = async (pool) => {
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name NOT IN ('vector_store', 'kg_triples', 'document_chunks')
     ORDER BY table_name, ordinal_position`,
  );
  const tables = {};
  for (const row of rows) (tables[row.table_name] ??= []).push(`${row.column_name} (${row.data_type})`);

  const { rows: keyRows } = await pool.query(
    `SELECT tc.table_name AS source_table,
            kcu.column_name AS source_column,
            ccu.table_name AS target_table,
            ccu.column_name AS target_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.constraint_schema = kcu.constraint_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
      AND tc.constraint_schema = ccu.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
     ORDER BY tc.table_name, kcu.ordinal_position`,
  );
  const foreignKeys = keyRows.map(
    (row) => `${row.source_table}.${row.source_column} -> ${row.target_table}.${row.target_column}`,
  );

  const valueHints = {};
  for (const row of rows.filter((item) => item.data_type.includes('char'))) {
    const { rows: values } = await pool.query(
      `SELECT DISTINCT ${row.column_name} AS v FROM ${row.table_name}
       WHERE ${row.column_name} IS NOT NULL LIMIT ${MAX_HINT_VALUES + 1}`,
    );
    if (values.length >= 1 && values.length <= MAX_HINT_VALUES)
      valueHints[`${row.table_name}.${row.column_name}`] = values.map((item) => item.v);
  }
  return { tables, foreignKeys, valueHints };
};
