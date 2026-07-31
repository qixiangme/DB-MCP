const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_ROOT = path.join(__dirname, 'play store screenshot');

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const OPERATOR_EMAIL = 'review-operator@modedrone.kr';
const CLIENT_EMAIL   = 'review-client@modedrone.kr';
const PASSWORD = 'Review2026!';
const PROJECT_REF = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

const DEVICES = [
  { name: '전화',          w: 360,  h: 640,  dpr: 3 },
  { name: '7인치 태블릿',  w: 540,  h: 960,  dpr: 2 },
  { name: '10인치 태블릿', w: 1080, h: 1920, dpr: 1 },
];

// Two separate groups: client browser session, then operator browser session
const CLIENT_PAGES = [
  { path: '/home',      file: '01_이용자_홈',       label: '이용자 홈',       extra: 8000 },
  { path: '/landing',   file: '02_랜딩',            label: '랜딩',           extra: 3000 },
  { path: '/portfolio', file: '03_포트폴리오_목록', label: '포트폴리오 목록', extra: 5000 },
  { path: '/feed',      file: '04_피드',            label: '피드',           extra: 6000 },
  { path: '/my/quotes', file: '05_내견적',          label: '내견적',         extra: 5000 },
  { path: '/chats',     file: '06_채팅목록',        label: '채팅 목록',      extra: 5000 },
];

const OPERATOR_PAGES = [
  { path: '/operator',             file: '07_운용자_홈',         label: '운용자 홈',         extra: 18000 },
  { path: '/operator/requests',    file: '08_받은요청',          label: '받은 요청',         extra: 8000  },
  { path: '/operator/portfolio',   file: '09_운용자_포트폴리오', label: '운용자 포트폴리오', extra: 6000  },
  { path: '/operator/mypage',      file: '10_운용자_마이페이지', label: '운용자 마이페이지', extra: 6000  },
];

async function waitForCanvas(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() =>
      !!(document.querySelector('canvas') ||
         document.querySelector('flt-glass-pane') ||
         document.querySelector('flt-scene'))
    );
    if (found) {
      console.log(`    canvas ${Math.round((Date.now() - start) / 1000)}s`);
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('    TIMEOUT: no canvas');
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
    console.error('  [login] FAILED:', JSON.stringify(session).slice(0, 200));
    return false;
  }
  await page.evaluate((key, sess) => localStorage.setItem(key, JSON.stringify(sess)), STORAGE_KEY, session);
  console.log(`  [login] OK – ${session.user?.email}`);
  return true;
}

async function launchBrowser(dev) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=620,900',
      '--no-sandbox', '--lang=ko-KR',
      '--disable-infobars', '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
}

async function runSession(dev, email, pages, outDir) {
  const browser = await launchBrowser(dev);
  const page = await browser.newPage();
  await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr });

  // Warm-up: load Flutter, inject session, wait for data
  console.log(`  [warm-up:${email.split('@')[0]}] ...`);
  await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
  await waitForCanvas(page, 30000);
  await new Promise(r => setTimeout(r, 5000));
  await injectLogin(page, email);
  await new Promise(r => setTimeout(r, 13000));
  console.log('  [warm-up] done');

  for (const pg of pages) {
    console.log(`  ${pg.label} (${pg.path}) ...`);
    try {
      await page.goto(BASE_URL + pg.path, { waitUntil: 'load', timeout: 30000 });
    } catch (e) { console.warn(`    goto: ${e.message.slice(0, 60)}`); }

    await waitForCanvas(page, 60000);
    await new Promise(r => setTimeout(r, pg.extra));

    const outPath = path.join(outDir, `${pg.file}.jpg`);
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 92,
      clip: { x: 0, y: 0, width: dev.w, height: dev.h } });
    console.log(`    → ${pg.file}.jpg`);
  }

  try { await browser.close(); } catch (_) {}
  await new Promise(r => setTimeout(r, 1000));
}

(async () => {
  for (const dev of DEVICES) {
    const outDir = path.join(OUT_ROOT, dev.name);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`\n=== ${dev.name} (${dev.w}x${dev.h} DPR${dev.dpr} → ${dev.w*dev.dpr}x${dev.h*dev.dpr}px) ===`);

    // Fresh browser per account group to avoid Chrome slowdown
    await runSession(dev, CLIENT_EMAIL,   CLIENT_PAGES,   outDir);
    await runSession(dev, OPERATOR_EMAIL, OPERATOR_PAGES, outDir);
  }
  console.log('\nAll done!', OUT_ROOT);
})();
