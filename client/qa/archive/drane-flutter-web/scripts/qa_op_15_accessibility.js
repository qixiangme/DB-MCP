/**
 * QA sweep - operator desktop - part 15
 * Inspect accessibility tree to read blurred quote-form text, and try clicking near it
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

let shotIdx = 46;
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

    // Try enabling accessibility by clicking the "Enable accessibility" button flutter injects, or use snapshot
    const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
    fs_write(snapshot);

    // Try clicking directly on the blurred banner / button area to see if it's interactive
    console.log('=== Clicking on blurred submit button area ===');
    await page.mouse.click(1000, 1734); // approx button location in full res
    await delay(2000);
    await shot(page, 'after_click_blurred_button');

    console.log('URL:', page.url());

    function fs_write(obj) {
      const fs = require('fs');
      fs.writeFileSync(path.join(OUT_DIR, 'qa_accessibility_snapshot.json'), JSON.stringify(obj, null, 2));
      console.log('Wrote accessibility snapshot, node count approx:', JSON.stringify(obj).length);
    }
  } catch (err) {
    console.error('FATAL', err);
  } finally {
    await browser.close();
  }
}

main();
