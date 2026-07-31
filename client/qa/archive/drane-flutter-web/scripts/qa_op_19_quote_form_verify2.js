/**
 * QA sweep - operator desktop - part 19
 * Retry verifying quote form fields with corrected x coordinates
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

let shotIdx = 59;
async function shot(page, name) {
  const file = path.join(OUT_DIR, `qa_sweep_operator_desktop_${String(shotIdx++).padStart(2, '0')}_${name}.png`);
  await page.screenshot({ path: file });
  console.log('[SHOT]', file);
  return file;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    defaultViewport: null,
    args: ['--window-size=1440,2700', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2700 });

  try {
    await page.goto(BASE_URL + '/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(2000);
    await injectLogin(page, 'review-operator@modedrone.kr', 'Review2026!');

    await page.goto(BASE_URL + '/operator/requests', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(8000);

    // Wake interaction
    await page.mouse.click(765, 900);
    await delay(1500);

    // Click 견적 금액 field with corrected x
    console.log('=== Click 견적 금액 field (corrected x=900) ===');
    await page.mouse.click(900, 1525);
    await delay(600);
    await page.keyboard.type('500000', { delay: 50 });
    await delay(600);
    await shot(page, 'quote_price_typed_v2');

    console.log('=== Click 견적 확정 메시지 field (corrected x=900) ===');
    await page.mouse.click(900, 1600);
    await delay(600);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(300);
    await page.keyboard.type('QA 테스트 메시지 - 실제 제출하지 않음', { delay: 40 });
    await delay(600);
    await shot(page, 'quote_message_typed_v2');

    console.log('=== NOT submitting ===');

  } catch (err) {
    console.error('FATAL', err);
  } finally {
    await browser.close();
  }
}

main();
