/**
 * QA sweep - operator desktop - part 20
 * Item 7: Toggle to 이용자 (client) view, check job-request map with broadcast markers
 */
const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_DIR = 'C:\\Users\\chang\\FlutterProjects\\drane';

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const PROJECT_REF = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const delay = ms => new Promise(r => setTimeout(r, ms));

async function injectLogin(page, email, password) {
  const session = await page.evaluate(async (url, key, email, password) => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }, SUPABASE_URL, SUPABASE_KEY, email, password);
  if (!session.access_token) { console.error('LOGIN FAILED', session); return false; }
  await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), STORAGE_KEY, session);
  return true;
}

async function waitForCanvas(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() => !!(document.querySelector('canvas') || document.querySelector('flt-glass-pane')));
    if (found) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

let shotIdx = 61;
async function shot(page, name) {
  const file = path.join(OUT_DIR, `qa_sweep_operator_desktop_${String(shotIdx++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file });
  console.log('[SHOT]', file);
  return file;
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: null,
    args: ['--window-size=1440,2700', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2700 });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log('[CONSOLE ERROR]', msg.text());
    }
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
    console.log('[PAGE ERROR]', err.message);
  });

  try {
    console.log('=== Login ===');
    await page.goto(BASE_URL + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(2000);
    await injectLogin(page, 'review-operator@modedrone.kr', 'Review2026!');

    console.log('=== Navigating to /operator ===');
    await page.goto(BASE_URL + '/operator', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(10000);
    await shot(page, 'before_toggle');

    // Click "이용자" toggle in top nav. Approx displayed (901,23) -> actual (1216,31)
    console.log('=== Clicking 이용자 toggle ===');
    await page.mouse.click(1216, 31);
    await delay(4000);
    await shot(page, 'after_toggle_client_view');

    console.log('URL:', page.url());

    // Scroll down to find job-request map with broadcast markers
    await page.mouse.move(720, 1000);
    await page.mouse.wheel({ deltaY: 500 });
    await delay(1200);
    await shot(page, 'client_view_scrolled1');

    await page.mouse.wheel({ deltaY: 500 });
    await delay(1200);
    await shot(page, 'client_view_scrolled2');

    await page.mouse.wheel({ deltaY: 500 });
    await delay(1200);
    await shot(page, 'client_view_scrolled3');

  } catch (err) {
    console.error('FATAL', err);
    try { await shot(page, 'fatal_error'); } catch (_) {}
  } finally {
    console.log('=== SUMMARY ===');
    console.log('Console errors:', JSON.stringify(consoleErrors));
    console.log('Page errors:', JSON.stringify(pageErrors));
    await browser.close();
  }
}

main();
