const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_DIR = __dirname;

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const CLIENT_EMAIL = 'review-client@modedrone.kr';
const PASSWORD = 'Review2026!';
const PROJECT_REF = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

async function waitForCanvas(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() => !!(document.querySelector('canvas') || document.querySelector('flt-glass-pane')));
    if (found) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function injectLogin(page, email, password) {
  const session = await page.evaluate(async (url, key, email, password) => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }, SUPABASE_URL, SUPABASE_KEY, email, password);
  if (!session.access_token) { console.error('LOGIN FAILED', session); return false; }
  await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), STORAGE_KEY, session);
  return true;
}

async function currentUserEmail(page) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    try { return JSON.parse(raw)?.user?.email ?? null; } catch { return 'PARSE_ERROR'; }
  }, STORAGE_KEY);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1440,2600', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2600 });

  console.log('=== login as client, go to /my/quotes ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 5000));
  await injectLogin(page, CLIENT_EMAIL, PASSWORD);
  await page.goto(BASE_URL + '/my/quotes', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 8000));
  console.log('user before click:', await currentUserEmail(page));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_myquotes_00_before.png') });

  console.log('=== click the "운용자 견적 대기중 / 시설점검 · 강원 강릉 경포대" row ===');
  await page.mouse.click(390, 567);
  await new Promise(r => setTimeout(r, 2000));
  console.log('user after click:', await currentUserEmail(page));
  console.log('URL after click:', page.url());
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_myquotes_01_after_click.png') });

  await new Promise(r => setTimeout(r, 3000));
  console.log('user after settle:', await currentUserEmail(page));
  console.log('URL after settle:', page.url());
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_myquotes_02_settled.png') });

  await browser.close();
  console.log('Done.');
})();
