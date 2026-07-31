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

async function viewportInfo(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    bodyScrollWidth: document.body.scrollWidth,
  }));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1440,2700', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2700 });

  console.log('=== login as operator, go to /operator/requests ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 5000));
  await injectLogin(page, OPERATOR_EMAIL, PASSWORD);
  await page.goto(BASE_URL + '/operator/requests', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 9000));
  console.log('viewport before interaction:', JSON.stringify(await viewportInfo(page)));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_layoutbug_00_initial.png') });

  console.log('=== click second request card to switch selection ===');
  await page.mouse.click(300, 1290);
  await new Promise(r => setTimeout(r, 1500));
  console.log('viewport after card click:', JSON.stringify(await viewportInfo(page)));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_layoutbug_01_after_card_click.png') });

  console.log('=== click the promo/blurred area to dismiss paywall ===');
  await page.mouse.click(950, 1500);
  await new Promise(r => setTimeout(r, 1500));
  console.log('viewport after promo click:', JSON.stringify(await viewportInfo(page)));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_layoutbug_02_after_promo_click.png') });

  console.log('=== toggle to client view and back ===');
  await page.mouse.click(1218, 24);
  await new Promise(r => setTimeout(r, 2000));
  await page.mouse.click(1218, 24);
  await new Promise(r => setTimeout(r, 2000));
  console.log('viewport after toggle round-trip:', JSON.stringify(await viewportInfo(page)));
  await page.screenshot({ path: path.join(OUT_DIR, 'qa_layoutbug_03_after_toggle.png') });

  await browser.close();
  console.log('Done.');
})();
