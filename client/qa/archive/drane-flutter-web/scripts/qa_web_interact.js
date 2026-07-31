/**
 * qa_web_interact.js
 * Visual + touch QA: mobile viewport (360×640 CSS, DPR3), scroll + tap each page.
 * Usage: node qa_web_interact.js <cycleNum>
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CYCLE = parseInt(process.argv[2] || '1', 10);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_DIR = path.join(__dirname, 'screenshots', 'qa', `cycle-${CYCLE}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const PHONE = { w: 390, h: 844, dpr: 3 }; // iPhone 14 Pro 비율 (CSS px)

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const PROJECT_REF  = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY  = `sb-${PROJECT_REF}-auth-token`;
const CLIENT_EMAIL   = 'review-client@modedrone.kr';
const OPERATOR_EMAIL = 'review-operator@modedrone.kr';
const PASSWORD = 'Review2026!';

const summary = { cycle: CYCLE, screenshots: [], errors: [], interactions: [] };

// ── helpers ─────────────────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForFlutter(page, ms = 50000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const ok = await page.evaluate(() =>
      !!(document.querySelector('flt-glass-pane') ||
         document.querySelector('flt-scene-host') ||
         document.querySelector('canvas'))
    ).catch(() => false);
    if (ok) { console.log(`    flutter ready (${Math.round((Date.now()-t)/1000)}s)`); return true; }
    await delay(600);
  }
  console.warn('    WARN: flutter canvas not detected');
  return false;
}

async function shoot(page, label, retries = 2) {
  const file = path.join(OUT_DIR, `${label}.jpg`);
  for (let i = 0; i <= retries; i++) {
    try {
      await page.screenshot({
        path: file, type: 'jpeg', quality: 88,
        clip: { x: 0, y: 0, width: PHONE.w, height: PHONE.h },
      });
      console.log(`    → ${label}.jpg`);
      summary.screenshots.push(label);
      return file;
    } catch(e) {
      if (i < retries) {
        console.warn(`    screenshot retry ${i+1}: ${e.message.slice(0,60)}`);
        await delay(3000);
      } else {
        console.error(`    screenshot FAILED: ${label} — ${e.message.slice(0,80)}`);
        summary.errors.push(`[screenshot-fail] ${label}`);
      }
    }
  }
  return null;
}

async function scroll(page, steps, px = 320) {
  for (let i = 0; i < steps; i++) {
    try {
      await Promise.race([
        page.mouse.wheel({ deltaY: px }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('scroll timeout')), 8000)),
      ]);
    } catch (e) {
      console.warn(`    scroll step ${i+1} skipped: ${e.message}`);
    }
    await delay(600);
  }
}

async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo(0,0)).catch(() => {});
  try {
    await Promise.race([
      page.mouse.wheel({ deltaY: -9999 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('scrollTop timeout')), 8000)),
    ]);
  } catch (e) {
    console.warn(`    scrollTop skipped: ${e.message}`);
  }
  await delay(400);
}

async function tap(page, x, y, label) {
  console.log(`    tap (${x},${y}) — ${label}`);
  summary.interactions.push({ tap: label, x, y });
  try {
    await Promise.race([
      page.mouse.click(x, y),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tap timeout')), 8000)),
    ]);
  } catch (e) {
    console.warn(`    tap skipped: ${label} — ${e.message}`);
  }
  await delay(1200);
}

async function injectLogin(page, email) {
  // First navigate to get the page context
  const session = await page.evaluate(async (url, key, em, pw) => {
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: em, password: pw }),
      });
      return await r.json();
    } catch(e) { return { error: e.message }; }
  }, SUPABASE_URL, SUPABASE_KEY, email, PASSWORD);

  if (!session.access_token) {
    console.warn(`    login FAILED (${email}):`, JSON.stringify(session).slice(0,120));
    return false;
  }
  await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), STORAGE_KEY, session);
  console.log(`    login OK: ${email}`);
  return true;
}

async function goto(page, urlPath) {
  try {
    await page.goto(BASE_URL + urlPath, { waitUntil: 'networkidle0', timeout: 45000 });
  } catch(e) {
    console.warn(`    goto ${urlPath}: ${e.message.slice(0,80)}`);
    // If the frame is detached the page is unusable — re-throw so caller can handle
    if (e.message.includes('detached')) throw e;
  }
  await waitForFlutter(page);
  await delay(3500);
}

// ── page QA ─────────────────────────────────────────────────────────────────
async function qaPage(page, { route, name, steps = 4, interactions = [] }) {
  console.log(`\n▶ [${name}] ${route}`);
  try {
    await goto(page, route);
  } catch(e) {
    console.error(`    [qaPage] goto failed for ${name}: ${e.message.slice(0,100)}`);
    summary.errors.push(`[goto-fail] ${name}: ${e.message.slice(0,100)}`);
    return;
  }
  await shoot(page, `${name}_01_top`);

  for (let s = 0; s < steps; s++) {
    await scroll(page, 1);
    await shoot(page, `${name}_0${s+2}_scroll`);
  }
  await scrollTop(page);
  await delay(600);

  for (const act of interactions) {
    try {
      const before = page.url();
      await tap(page, act.x, act.y, act.label);
      await delay(800);
      await shoot(page, `${name}_tap_${act.label.replace(/\W+/g,'_')}`);
      // if navigation happened and not expected, go back
      if (!act.allowNav && !page.url().includes(route.split('?')[0])) {
        await page.goBack().catch(() => {});
        await waitForFlutter(page);
        await delay(1500);
      }
      // if bottom-sheet appeared, dismiss with Escape
      if (act.dismissAfter) {
        await page.keyboard.press('Escape');
        await delay(800);
        await shoot(page, `${name}_tap_${act.label.replace(/\W+/g,'_')}_dismissed`);
      }
    } catch(e) {
      console.warn(`    interaction error (${act.label}): ${e.message.slice(0,80)}`);
      summary.errors.push(`[interaction-fail] ${name}/${act.label}: ${e.message.slice(0,80)}`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  let browser;
  try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    protocolTimeout: 120000,
    args: [
      `--window-size=420,900`,
      '--no-sandbox', '--lang=ko-KR',
      '--disable-infobars',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: PHONE.w, height: PHONE.h, deviceScaleFactor: PHONE.dpr });

  page.on('console', msg => {
    if (msg.type() === 'error') summary.errors.push(`[console] ${msg.text().slice(0,200)}`);
  });
  page.on('pageerror', err => {
    summary.errors.push(`[pageerror] ${err.message.slice(0,200)}`);
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('chrome-extension') && !url.includes('favicon'))
      summary.errors.push(`[req-failed] ${url.slice(0,100)}`);
  });

  // ── 1. Landing (비로그인) ────────────────────────────────────────────────
  await qaPage(page, {
    route: '/landing', name: '01_landing', steps: 3,
    interactions: [
      { x: 180, y: 560, label: '시작하기_CTA', allowNav: true },
    ],
  });

  // ── 2. Client login inject ───────────────────────────────────────────────
  console.log('\n  [auth] client login...');
  await goto(page, '/home');
  const clientOk = await injectLogin(page, CLIENT_EMAIL);
  if (clientOk) {
    await page.reload({ waitUntil: 'networkidle0' });
    await waitForFlutter(page);
    await delay(4000);
  }

  // ── 3. 홈 ────────────────────────────────────────────────────────────────
  await qaPage(page, {
    route: '/home', name: '02_home', steps: 4,
    interactions: [
      { x: 180, y: 180, label: '파일럿카드_탭' },
      { x: 180, y: 530, label: '견적요청_탭', dismissAfter: true },
    ],
  });

  // ── 4. 포트폴리오 목록 ───────────────────────────────────────────────────
  await qaPage(page, {
    route: '/portfolio', name: '03_portfolio_list', steps: 4,
    interactions: [
      { x: 180, y: 280, label: '카드_탭', allowNav: true },
    ],
  });

  // ── 5. 포트폴리오 상세 (첫 번째 파일럿) ─────────────────────────────────
  // navigate then interact
  console.log('\n▶ [portfolio_detail] navigating to first item...');
  await goto(page, '/portfolio');
  await delay(1500);
  // tap first card
  await tap(page, 180, 280, '포트폴리오_첫카드');
  await waitForFlutter(page);
  await delay(5000);
  await shoot(page, '04_portfolio_detail_01_top');
  await scroll(page, 2);
  await shoot(page, '04_portfolio_detail_02_scroll');
  // tap "견적 요청하기" button (bottom area)
  await tap(page, 180, 590, '견적요청하기_버튼');
  await delay(1500);
  await shoot(page, '04_portfolio_detail_tap_견적버튼');
  await page.keyboard.press('Escape');
  await delay(800);

  // ── 6. 피드 ──────────────────────────────────────────────────────────────
  await qaPage(page, {
    route: '/feed', name: '05_feed', steps: 5,
    interactions: [
      { x: 180, y: 220, label: '피드아이템_탭' },
    ],
  });

  // ── 7. 내 견적 ───────────────────────────────────────────────────────────
  await qaPage(page, {
    route: '/my/quotes', name: '06_my_quotes', steps: 3,
  });

  // ── 8. 채팅 목록 ─────────────────────────────────────────────────────────
  await qaPage(page, {
    route: '/chats', name: '07_chats', steps: 2,
  });

  // ── 9. Operator login inject ─────────────────────────────────────────────
  console.log('\n  [auth] operator login...');
  await goto(page, '/home');
  const opOk = await injectLogin(page, OPERATOR_EMAIL);
  if (opOk) {
    await page.reload({ waitUntil: 'networkidle0' });
    await waitForFlutter(page);
    await delay(4000);
  }

  // ── 10. 운용자 대시보드 ──────────────────────────────────────────────────
  await qaPage(page, {
    route: '/operator', name: '08_operator_home', steps: 4,
    interactions: [
      { x: 180, y: 280, label: '대시보드_카드_탭' },
    ],
  });

  // ── 11. 받은 요청 ────────────────────────────────────────────────────────
  await qaPage(page, {
    route: '/operator/requests', name: '09_operator_requests', steps: 3,
    interactions: [
      { x: 180, y: 250, label: '요청ROW_탭', dismissAfter: true },
    ],
  });

  // ── 12. 운용자 포트폴리오 편집 ───────────────────────────────────────────
  await qaPage(page, {
    route: '/operator/portfolio', name: '10_operator_portfolio', steps: 3,
  });

  // ── 13. 운용자 마이페이지 ────────────────────────────────────────────────
  await qaPage(page, {
    route: '/operator/mypage', name: '11_operator_mypage', steps: 3,
  });

  } catch(fatalErr) {
    console.error('\n[FATAL] Unhandled error:', fatalErr.message);
    summary.errors.push(`[fatal] ${fatalErr.message.slice(0,200)}`);
  } finally {
    if (browser) {
      try { await browser.close(); } catch(e) { console.warn('browser.close warning:', e.message.slice(0,80)); }
    }
    const jsonPath = path.join(__dirname, `qa_result_${CYCLE}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

    console.log(`\n✓ QA cycle ${CYCLE} done`);
    console.log(`  screenshots: ${summary.screenshots.length}`);
    console.log(`  errors captured: ${summary.errors.length}`);
    if (summary.errors.length) {
      console.log('  --- errors ---');
      summary.errors.slice(0,20).forEach(e => console.log('  ' + e));
    }
    console.log(`  json: ${jsonPath}`);
  }
})();
