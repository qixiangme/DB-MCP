/**
 * QA sweep - operator desktop - part 4
 * Item 3 continued: fill caption, open dropdowns, open map picker dialog, tap map, confirm
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

let shotIdx = 8;
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

    console.log('=== Navigating to /operator/feed ===');
    await page.goto(BASE_URL + '/operator/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(6000);

    // Click "새 게시물" button
    await page.mouse.click(1278, 158);
    await delay(1500);

    // Type caption text
    console.log('=== Typing caption ===');
    await page.mouse.click(400, 265);
    await delay(400);
    await page.keyboard.type('QA 테스트 - 필드 확인용 (제출안함)', { delay: 30 });
    await delay(800);
    await shot(page, 'caption_typed');

    // Click 서비스 종류 dropdown
    console.log('=== Opening 서비스 종류 dropdown ===');
    await page.mouse.click(300, 340);
    await delay(1000);
    await shot(page, 'service_dropdown_open');

    // Press Escape to close if opened as overlay, or click first option
    // Try clicking somewhere in the middle assuming options appear below
    await page.keyboard.press('Escape');
    await delay(800);

    // Click 지역 dropdown
    console.log('=== Opening 지역 dropdown ===');
    await page.mouse.click(740, 340);
    await delay(1000);
    await shot(page, 'region_dropdown_open');
    await page.keyboard.press('Escape');
    await delay(800);

    // Click "선택하기" for map picker
    console.log('=== Opening map picker dialog ===');
    await shot(page, 'before_map_picker_click');
    await page.mouse.click(1278, 398);
    await delay(2000);
    await shot(page, 'map_picker_dialog_opened');

    console.log('URL:', page.url());
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
