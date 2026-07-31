/**
 * QA sweep - operator desktop - part 8
 * Item 4 continued: type into intro/description fields, toggle chips, then cancel (do not save)
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

let shotIdx = 27;
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

    console.log('=== Navigating to /operator/portfolio ===');
    await page.goto(BASE_URL + '/operator/portfolio', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(6000);

    // Click "편집하기" button
    console.log('=== Clicking 편집하기 ===');
    await page.mouse.click(1278, 127);
    await delay(2000);

    // Type into 한줄 소개 field (approx displayed y=225 -> actual y=304)
    console.log('=== Typing into 한줄 소개 ===');
    await page.mouse.click(400, 304);
    await delay(400);
    await page.keyboard.type('QA 테스트 소개 문구 (저장안함)', { delay: 30 });
    await delay(600);

    // Click a 전문 분야 chip - "부동산" approx displayed (333,304)->(450,410)
    console.log('=== Clicking 전문 분야 chip 부동산 ===');
    await page.mouse.click(450, 410);
    await delay(800);

    // Click a 서비스 지역 chip - "제주" approx displayed (159,367)->(214,495)
    console.log('=== Clicking 서비스 지역 chip 제주 ===');
    await page.mouse.click(214, 495);
    await delay(800);

    // Type into 서비스 상세설명 field approx displayed (400,433)->(540,585)
    console.log('=== Typing into 서비스 상세설명 ===');
    await page.mouse.click(540, 585);
    await delay(400);
    await page.keyboard.type('QA 테스트 상세 설명입니다 (저장하지 않음).', { delay: 30 });
    await delay(600);

    await shot(page, 'portfolio_edit_filled');

    // Click 취소 to cancel/revert instead of saving
    console.log('=== Clicking 취소 to cancel edits ===');
    await page.mouse.click(1201, 138); // 취소 button approx
    await delay(2000);
    await shot(page, 'portfolio_after_cancel');

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
