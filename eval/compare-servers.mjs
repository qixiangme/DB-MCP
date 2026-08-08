#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const setFile = args.get('--set') ?? 'official-eval.json';
const repetitions = Number(args.get('--reps') ?? 1);
const label = args.get('--label') ?? 'air-spring-parity';
const servers = [
  { name: 'spring-ai', url: args.get('--spring-url') ?? 'http://localhost:8080' },
  { name: 'air-exact', url: args.get('--air-url') ?? 'http://localhost:8083' },
];

if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('--reps는 1 이상의 정수여야 합니다.');

const dataset = JSON.parse(await readFile(resolve(here, setFile), 'utf8'));
const results = [];

export const scoreAnswer = (question, response) => {
  const answer = String(response.answer ?? '');
  const folded = answer.toLocaleLowerCase();
  const keywords = question.keywords ?? [];
  const rule = question.answerRule;
  let matchedKeywords;
  let answerCorrect;
  let ruleUsed;

  if (!rule || rule.type === 'anyOf') {
    const required = rule?.required ?? keywords;
    matchedKeywords = required.filter((keyword) => folded.includes(String(keyword).toLocaleLowerCase()));
    answerCorrect = matchedKeywords.length > 0;
    ruleUsed = rule ? 'anyOf' : 'legacy-anyOf';
  } else if (rule.type === 'allOf') {
    matchedKeywords = rule.required.filter((keyword) => folded.includes(String(keyword).toLocaleLowerCase()));
    answerCorrect = matchedKeywords.length === rule.required.length;
    ruleUsed = 'allOf';
  } else if (rule.type === 'minMatches') {
    matchedKeywords = rule.from.filter((keyword) => folded.includes(String(keyword).toLocaleLowerCase()));
    answerCorrect = matchedKeywords.length >= rule.count;
    ruleUsed = `minMatches(${rule.count})`;
  } else if (rule.type === 'exactNumeric') {
    const actual = new Set(answer.replaceAll(',', '').match(/-?\d+(?:\.\d+)?/g) ?? []);
    matchedKeywords = rule.expected.map(String).filter((number) => actual.has(number));
    answerCorrect = matchedKeywords.length > 0;
    ruleUsed = 'exactNumeric';
  } else {
    throw new Error(`지원하지 않는 answerRule: ${rule.type}`);
  }
  return {
    answerCorrect,
    routeCorrect: Array.isArray(response.routes) && response.routes.includes(question.expectedRoute),
    matchedKeywords,
    ruleUsed,
  };
};

for (let rep = 1; rep <= repetitions; rep += 1) {
  for (let index = 0; index < dataset.questions.length; index += 1) {
    const question = dataset.questions[index];
    // 서버 순서를 교대해 Ollama 열 상태와 시간 흐름이 한 구현에만 유리해지는 편향을 줄인다.
    const ordered = (rep + index) % 2 === 0 ? servers : [...servers].reverse();
    for (const server of ordered) {
      const started = performance.now();
      let row;
      try {
        const httpResponse = await fetch(`${server.url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ question: question.question }),
          signal: AbortSignal.timeout(300_000),
        });
        if (!httpResponse.ok) throw new Error(`HTTP ${httpResponse.status}`);
        const response = await httpResponse.json();
        row = {
          server: server.name,
          rep,
          id: question.id,
          question: question.question,
          expectedRoute: question.expectedRoute,
          actualRoutes: response.routes ?? [],
          questionType: question.type ?? 'route',
          ...scoreAnswer(question, response),
          latencyMs: response.latencyMs,
          wallLatencyMs: Math.round(performance.now() - started),
          answer: response.answer,
          error: null,
        };
      } catch (error) {
        row = {
          server: server.name,
          rep,
          id: question.id,
          question: question.question,
          expectedRoute: question.expectedRoute,
          questionType: question.type ?? 'route',
          actualRoutes: [],
          answerCorrect: false,
          routeCorrect: false,
          matchedKeywords: [],
          ruleUsed: question.answerRule?.type ?? 'legacy-anyOf',
          latencyMs: -1,
          wallLatencyMs: Math.round(performance.now() - started),
          answer: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      results.push(row);
      console.log(
        `[${server.name} ${question.id} rep${rep}] ` +
          `route=${row.routeCorrect ? 'O' : 'X'} answer=${row.answerCorrect ? 'O' : 'X'} ${row.latencyMs}ms`,
      );
    }
  }
}

const percent = (numerator, denominator) => denominator === 0 ? 0 : Math.round((1000 * numerator) / denominator) / 10;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
};
const summary = Object.fromEntries(servers.map((server) => {
  const rows = results.filter((row) => row.server === server.name);
  const validLatencies = rows.filter((row) => row.latencyMs >= 0).map((row) => row.latencyMs);
  return [server.name, {
    samples: rows.length,
    answerAccuracyPct: percent(rows.filter((row) => row.answerCorrect).length, rows.length),
    routeAccuracyPct: percent(rows.filter((row) => row.routeCorrect).length, rows.length),
    averageLatencyMs: validLatencies.length === 0 ? null : Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length),
    medianLatencyMs: validLatencies.length === 0 ? null : median(validLatencies),
    errors: rows.filter((row) => row.error !== null).length,
    byQuestionType: Object.fromEntries([...new Set(rows.map((row) => row.questionType))].map((type) => {
      const selected = rows.filter((row) => row.questionType === type);
      return [type, {
        samples: selected.length,
        answerAccuracyPct: percent(selected.filter((row) => row.answerCorrect).length, selected.length),
      }];
    })),
  }];
}));

const output = {
  metadata: {
    createdAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dataset: setFile,
    repetitions,
    model: args.get('--model') ?? 'gemma3:1b',
    temperature: 0,
    vectorSearchMode: 'exact',
    serverOrder: 'alternating',
    urls: Object.fromEntries(servers.map((server) => [server.name, server.url])),
  },
  summary,
  results,
};

const outputPath = resolve(here, 'results', `${label}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`결과 저장: ${outputPath}`);
