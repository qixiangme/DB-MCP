const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'http://localhost:9001';
const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const PROJECT_REF = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const SHOT_DIR = 'C:\\Users\\chang\\FlutterProjects\\drane';

let shotCounter = 0;
function shotName(name) {
  shotCounter++;
  return path.join(SHOT_DIR, `qa_cycle2_operator_desktop_${String(shotCounter).padStart(2, '0')}_${name}.png`);
}

async function injectLogin(page, email, password) {
  const session = await page.evaluate(async (url, key, email, password) => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.json();
  }, SUPABASE_URL, SUPABASE_KEY, email, password);
  if (!session.access_token) { console.error('LOGIN FAILED', session); return null; }
  await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), STORAGE_KEY, session);
  return session;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--window-size=1440,2700', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1440, height: 2700 });

  page.on('console', msg => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure() && req.failure().errorText));

  console.log('=== Navigating to /home ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'networkidle2' });
  await waitForCanvas(page);
  await sleep(2000);

  console.log('=== Injecting login ===');
  const session = await injectLogin(page, 'review-operator@modedrone.kr', 'Review2026!');
  if (!session) { console.error('ABORT: login failed'); await browser.close(); process.exit(1); }
  console.log('Login OK, user id:', session.user && session.user.id);

  console.log('=== Navigating to /operator ===');
  await page.goto(BASE_URL + '/operator', { waitUntil: 'networkidle2' });
  await waitForCanvas(page);
  console.log('Waiting 12s for dashboard to load...');
  await sleep(12000);

  await page.screenshot({ path: shotName('dashboard'), fullPage: true });
  console.log('Saved dashboard screenshot');

  // Save session info to a file for reuse in later scripts
  require('fs').writeFileSync(
    path.join(SHOT_DIR, 'qa_cycle2_session.json'),
    JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, user: session.user }, null, 2)
  );

  console.log('=== DONE PHASE 1 === (browser left open for next phase manually if needed)');
  await sleep(3000);
  await browser.close();
})();
