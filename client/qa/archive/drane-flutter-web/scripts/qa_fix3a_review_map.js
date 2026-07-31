const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_DIR = __dirname;

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const OPERATOR_EMAIL = 'review-operator@modedrone.kr';
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
    args: [
      '--window-size=1440,2600',
      '--no-sandbox', '--lang=ko-KR',
      '--disable-infobars', '--disable-extensions',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2600 });

  console.log('=== Warm-up + login as operator ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 5000));
  await injectLogin(page, OPERATOR_EMAIL);
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 10000));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_fix3_step0_operator_landed.png') });

  console.log('=== Toggle to client (이용자) view to see the job-request map ===');
  // "이용자 / 운용자" toggle lives in the top nav on the right.
  await page.mouse.click(1218, 24);
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_fix3_step1_client_view.png') });

  console.log('=== Click "견적 응답하기" on the already-shown marker preview ===');
  await page.mouse.click(1144, 1138);
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_fix3_step2_after_respond_click.png') });

  await browser.close();
  console.log('\nDone.');
})();
