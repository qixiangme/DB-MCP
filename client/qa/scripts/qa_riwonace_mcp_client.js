const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('../config');

const OUT_DIR = path.join(config.screenshotsDir, 'riwonace-mcp-client');
const RESULT_DIR = config.resultsDir;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RESULT_DIR, { recursive: true });

const summary = {
  baseUrl: config.baseUrl,
  startedAt: new Date().toISOString(),
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  screenshots: [],
};

function record(name, ok, detail = '') {
  summary.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function screenshot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  summary.screenshots.push(file);
}

async function expectSelector(page, selector, name) {
  await page.waitForSelector(selector, { timeout: 10000 });
  record(name, true, selector);
}

async function installApiMocks(page) {
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = request.url();
    const method = request.method();

    if (url.endsWith('/api/tools')) {
      return request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mcpTools: ['vector_search', 'run_sql', 'kg_search', 'get_schema'] }),
      });
    }

    if (url.endsWith('/mcp-admin/ingest')) {
      return request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ingested: 10 }),
      });
    }

    if (url.endsWith('/api/chat') && method === 'POST') {
      let question = 'unknown';
      try {
        question = JSON.parse(request.postData() || '{}').question || question;
      } catch (_) {
        question = 'parse-error';
      }

      const lower = question.toLowerCase();
      const routes = lower.includes('air')
        ? ['GRAPH']
        : lower.includes('sql') || question.includes('급여') || question.includes('평균') || question.includes('매출')
          ? ['SQL']
          : ['VECTOR'];
      const toolCalls = routes.includes('SQL')
        ? ['get_schema', 'run_sql']
        : routes.includes('GRAPH')
          ? ['kg_search']
          : ['vector_search'];

      await new Promise((resolve) => setTimeout(resolve, 80));
      return request.respond({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          answer: `QA mock answer for: ${question}`,
          routes,
          toolCalls,
          contextSources: routes.includes('SQL') ? ['sql'] : routes.includes('GRAPH') ? ['knowledge-graph'] : ['document:riwonace'],
          latencyMs: 123,
        }),
      });
    }

    return request.continue();
  });
}

async function newQaPage(browser, viewport) {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') summary.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => summary.pageErrors.push(err.message));
  await installApiMocks(page);
  await page.setViewport(viewport);
  await page.goto(config.baseUrl, { waitUntil: 'networkidle0', timeout: 45000 });
  return page;
}

async function click(page, testId) {
  await page.click(`[data-testid="${testId}"]`);
}

async function desktopFlow(browser) {
  const page = await newQaPage(browser, { width: 1440, height: 1400, deviceScaleFactor: 1 });

  await expectSelector(page, '[data-testid="page-title"]', 'desktop title rendered');
  await expectSelector(page, '[data-testid="single-query-panel"]', 'single query panel rendered');
  await expectSelector(page, '[data-testid="batch-panel"]', 'dataset test panel rendered');
  await expectSelector(page, '[data-testid="dataset-list"] .dataset-item', 'dataset questions loaded');
  await page.waitForFunction(() => document.body.innerText.includes('42') || document.body.innerText.includes('30'));
  record('dataset load count visible', true, 'public dataset JSON loaded');
  await screenshot(page, 'desktop_initial');

  await click(page, 'check-tools-button');
  await page.waitForFunction(() => document.body.innerText.includes('4') && document.body.innerText.includes('MCP'));
  record('tools health check', true, 'mocked /api/tools');

  await click(page, 'ingest-button');
  await page.waitForFunction(() => document.body.innerText.includes('완료'));
  record('ingest request check', true, 'mocked /mcp-admin/ingest');

  await click(page, 'run-single-button');
  await page.waitForFunction(() => document.body.innerText.includes('QA mock answer for:'));
  await page.waitForFunction(() => document.body.innerText.includes('vector_search'));
  await page.waitForFunction(() => document.body.innerText.includes('123ms'));
  await expectSelector(page, '[data-testid="grading-box"]', 'grading box rendered');
  record('single run result check', true, 'answer, tool call, latency visible');

  await click(page, 'run-dataset-button');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('라우트 적중') && text.includes('키워드 적중') && text.includes('route');
  }, { timeout: 20000 });
  record('dataset run summary check', true, 'route and keyword metrics rendered');
  await screenshot(page, 'desktop_after_dataset_run');

  await click(page, 'export-csv-button');
  record('csv export button click', true, 'download triggered');

  await page.close();
}

async function mobileFlow(browser) {
  const page = await newQaPage(browser, { width: 390, height: 1400, deviceScaleFactor: 2 });

  await expectSelector(page, '[data-testid="metrics-grid"]', 'mobile metrics rendered');
  await expectSelector(page, '[data-testid="answer-panel"]', 'mobile answer panel rendered');
  await expectSelector(page, '[data-testid="dataset-list"] .dataset-item', 'mobile dataset list rendered');
  await screenshot(page, 'mobile_initial');

  const buttonIssues = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const textFits = button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1;
        return { text: button.textContent || button.getAttribute('title') || '', width: rect.width, height: rect.height, textFits };
      })
      .filter((item) => !item.textFits || item.width < 36 || item.height < 28);
  });
  record('mobile button sizing check', buttonIssues.length === 0, JSON.stringify(buttonIssues).slice(0, 240));
  if (buttonIssues.length) throw new Error('Mobile button sizing issues detected');

  await page.close();
}

(async () => {
  const launchOptions = {
    headless: config.headless,
    args: ['--no-sandbox', '--lang=ko-KR', '--disable-dev-shm-usage'],
  };
  if (config.chromePath) launchOptions.executablePath = config.chromePath;

  const browser = await puppeteer.launch(launchOptions);

  try {
    await desktopFlow(browser);
    await mobileFlow(browser);
  } finally {
    await browser.close();
  }

  const failed = summary.checks.filter((check) => !check.ok);
  const resultPath = path.join(RESULT_DIR, `riwonace-mcp-client-${Date.now()}.json`);
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Result: ${resultPath}`);

  if (failed.length || summary.consoleErrors.length || summary.pageErrors.length) {
    console.error(JSON.stringify({ failed, consoleErrors: summary.consoleErrors, pageErrors: summary.pageErrors }, null, 2));
    process.exit(1);
  }
})();
