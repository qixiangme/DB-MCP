/**
 * QA sweep - operator desktop - part 1
 * Items 1-2: /operator dashboard, /pilot/register
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

let shotIdx = 1;
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
    console.log('=== Navigating to /home ===');
    await page.goto(BASE_URL + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(2000);

    console.log('=== Injecting login ===');
    const ok = await injectLogin(page, 'review-operator@modedrone.kr', 'Review2026!');
    console.log('Login injected:', ok);

    console.log('=== Navigating to /operator ===');
    await page.goto(BASE_URL + '/operator', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    console.log('Waiting extra 18s for operator dashboard data...');
    await delay(18000);

    await shot(page, 'operator_dashboard');

    // scroll down to see more sections
    await page.mouse.move(720, 1000);
    await page.mouse.wheel({ deltaY: 600 });
    await delay(1500);
    await shot(page, 'operator_dashboard_scrolled');

    await page.mouse.wheel({ deltaY: 600 });
    await delay(1500);
    await shot(page, 'operator_dashboard_scrolled2');

    // scroll back up
    await page.mouse.wheel({ deltaY: -1500 });
    await delay(1000);

    // Check current URL
    console.log('Current URL:', page.url());

    // Try clicking notification bell - need to find it. Take a screenshot first then try top-right area
    await shot(page, 'operator_dashboard_top');

    // === Item 2: /pilot/register ===
    console.log('=== Navigating to /pilot/register ===');
    await page.goto(BASE_URL + '/pilot/register', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(5000);
    console.log('URL after navigating to /pilot/register:', page.url());
    await shot(page, 'pilot_register');

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
