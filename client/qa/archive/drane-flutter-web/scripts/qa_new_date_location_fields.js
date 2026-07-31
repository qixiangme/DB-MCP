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

async function waitForCanvas(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() =>
      !!(document.querySelector('canvas') ||
         document.querySelector('flt-glass-pane') ||
         document.querySelector('flt-scene'))
    );
    if (found) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('  TIMEOUT: no canvas');
  return false;
}

async function injectLogin(page, email) {
  const session = await page.evaluate(async (url, key, email, password) => {
    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return await res.json();
    } catch (e) { return { error: e.message }; }
  }, SUPABASE_URL, SUPABASE_KEY, email, PASSWORD);
  if (!session.access_token) {
    console.error('  [login] FAILED:', JSON.stringify(session).slice(0, 300));
    return false;
  }
  await page.evaluate((key, sess) => localStorage.setItem(key, JSON.stringify(sess)), STORAGE_KEY, session);
  console.log(`  [login] OK - ${session.user?.email}`);
  return true;
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

  console.log('=== Login as client, open job request composer ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 5000));
  await injectLogin(page, CLIENT_EMAIL);
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 8000));

  await page.mouse.click(1271, 564); // 새요청 등록
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_composer_with_date.png') });

  console.log('=== Tap 일정 field to open date picker ===');
  await page.mouse.click(715, 890);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_date_picker_open.png') });

  console.log('=== Pick a date and confirm ===');
  await page.mouse.click(719, 1360); // day 15
  await new Promise(r => setTimeout(r, 400));
  await page.mouse.click(846, 1529); // 확인
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_date_selected.png') });

  console.log('=== Navigate to QuoteRequestPage (direct request) ===');
  await page.goto(BASE_URL + '/quote/request/d184f8fb-2d28-4fdd-89c0-f08e03330697', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 6000));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_quote_request_page.png') });

  console.log('=== Tap 촬영 위치 field to open map picker ===');
  await page.mouse.click(722, 309);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_quote_location_dialog.png') });

  console.log('=== Tap a point inside the map (dialog already open) ===');
  await page.mouse.click(715, 1287); // tap inside the map area
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_quote_location_tapped.png') });
  await page.mouse.click(1001, 1555); // 이 위치로 선택 confirm button
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_new_quote_location_confirmed.png') });

  await browser.close();
  console.log('\nDone.');
})();
