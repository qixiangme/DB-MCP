const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:9001';
const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const PROJECT_REF = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const SHOT_DIR = 'C:\\Users\\chang\\FlutterProjects\\drane';

let shotCounter = 1;
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

  console.log('=== Navigating to /home ===');
  await page.goto(BASE_URL + '/home', { waitUntil: 'networkidle2' });
  await waitForCanvas(page);
  await sleep(1500);

  console.log('=== Injecting login ===');
  const session = await injectLogin(page, 'review-operator@modedrone.kr', 'Review2026!');
  if (!session) { console.error('ABORT: login failed'); await browser.close(); process.exit(1); }

  console.log('=== Navigating to /operator/feed ===');
  await page.goto(BASE_URL + '/operator/feed', { waitUntil: 'networkidle2' });
  await waitForCanvas(page);
  console.log('Waiting 8s for feed to load...');
  await sleep(8000);

  await page.screenshot({ path: shotName('feed_page'), fullPage: true });
  console.log('Saved feed page screenshot');

  // Find and click "새 게시물" button. Since this is Flutter web/CanvasKit, we need to click by text location.
  // We'll use accessibility tree / semantics if available, else click approximate coords found via screenshot analysis.
  // Try clicking via a search of all elements with aria-label or text using the accessibility snapshot.
  const btn = await findByText(page, '새 게시물');
  if (btn) {
    console.log('Found 새 게시물 button at', btn);
    await page.mouse.click(btn.x, btn.y);
  } else {
    console.log('Could not find 새 게시물 via a11y tree, will need manual coordinate click');
  }
  await sleep(2500);
  await page.screenshot({ path: shotName('feed_composer_opened'), fullPage: true });
  console.log('Saved composer opened screenshot');

  await browser.close();

  async function findByText(page, text) {
    // Use CDP Accessibility domain to find node with given name, return center coords
    const client = await page.target().createCDPSession();
    await client.send('Accessibility.enable');
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const match = nodes.find(n => n.name && n.name.value && n.name.value.includes(text));
    if (!match || !match.backendDOMNodeId) return null;
    try {
      const { model } = await client.send('DOM.getBoxModel', { backendNodeId: match.backendDOMNodeId });
      const quad = model.content;
      const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
      const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      return { x, y };
    } catch (e) {
      return null;
    }
  }
})();
