/**
 * qa_feed_portfolio_register.js
 * QA: 피드 · 포트폴리오 · 운용자 등록 플로우
 * - review-client: 피드/포트폴리오 조회
 * - qa-newuser:    운용자 등록 5단계 → 제출
 */
const puppeteer = require('puppeteer');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const CHROME   = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const PROJ_REF = 'wgujitwmipifuhxavmsn';
const API_KEY  = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const SUPA_URL = `https://${PROJ_REF}.supabase.co`;
const STORAGE_KEY = `sb-${PROJ_REF}-auth-token`;

const OUT_DIR = path.join(__dirname, 'screenshots_qa');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── token helper ─────────────────────────────────────────────────────────────
function apiPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      `${SUPA_URL}${urlPath}`,
      { method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch (e) { resolve({ _raw: buf }); }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function login(email, password) {
  const r = await apiPost('/auth/v1/token?grant_type=password', { email, password });
  if (!r.access_token) throw new Error(`Login failed for ${email}: ${JSON.stringify(r).slice(0, 200)}`);
  return r;
}

// ── screenshot helper ─────────────────────────────────────────────────────────
let idx = 0;
async function shot(page, label) {
  const file = path.join(OUT_DIR, `${String(idx++).padStart(2, '0')}_${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  [SHOT] ${path.basename(file)}`);
  return file;
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function tap(page, x, y, wait = 1800) {
  await page.touchscreen.tap(x, y);
  await delay(wait);
}

// ── auth inject + goto ────────────────────────────────────────────────────────
async function gotoAs(page, route, session, wait = 3500) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(600);
  await page.evaluate((key, val) => localStorage.setItem(key, val), STORAGE_KEY, JSON.stringify({
    access_token:  session.access_token,
    token_type:    'bearer',
    expires_in:    3600,
    expires_at:    session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  }));
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle0', timeout: 45000 });
  await delay(wait);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
// Get visible text-input positions
async function getInputPositions(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea'))
      .map(el => {
        const r = el.getBoundingClientRect();
        if (r.height === 0) return null;
        return { type: el.type, placeholder: el.placeholder, x: r.x + r.width / 2, y: r.y + r.height / 2, visible: r.height > 0 };
      })
      .filter(Boolean);
  });
}

// Clear + type into a Flutter text input
async function typeInto(page, x, y, text) {
  await page.mouse.click(x, y);
  await delay(400);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await delay(150);
  await page.keyboard.type(text, { delay: 40 });
  await delay(300);
}

// Click a Flutter semantic button by text
async function clickByText(page, text) {
  const found = await page.evaluate(searchText => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.trim() === searchText) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, text);
  if (found) {
    await page.mouse.click(found.x, found.y);
    await delay(1500);
    return true;
  }
  return false;
}

// ── PART 1: Feed + Portfolio QA ───────────────────────────────────────────────
async function runFeedPortfolioQA(page, clientSession) {
  console.log('\n══════════════════════════════════════');
  console.log(' PART 1: 피드 · 포트폴리오 QA');
  console.log('══════════════════════════════════════');
  const issues = [];

  // ── 1-1. 피드 초기 ─────────────────────────────────────────────────────────
  console.log('\n[1-1] /feed 초기 화면');
  await gotoAs(page, '/feed', clientSession, 4000);
  await shot(page, 'feed_01_initial');

  const feedUrl = page.url();
  if (!feedUrl.includes('/feed')) {
    issues.push({ step: 'feed_nav', note: `URL=${feedUrl}` });
  }

  // Check for pilot cards
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  if (bodyText.includes('아직 공개된 피드가 없습니다')) {
    console.log('  [INFO] 피드 비어있음 (정상 빈 상태)');
    issues.push({ step: 'feed_empty', severity: 'INFO', note: '파일럿 없음' });
  }

  // ── 1-2. 피드 스크롤 ───────────────────────────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 300));
  await delay(1000);
  await shot(page, 'feed_02_scrolled');

  // ── 1-3. 카테고리 필터 (항공촬영 탭) ─────────────────────────────────────
  console.log('\n[1-2] 카테고리 필터 탭');
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(500);
  // Filter bar is at top of page, chips at roughly y=90, x varies
  // "인기순" button ≈ x=555, y=90 in 390px viewport
  await tap(page, 117, 90, 1500); // 카테고리 chip
  await shot(page, 'feed_03_category_filter');

  // ── 1-4. 지역 필터 드롭다운 ─────────────────────────────────────────────
  console.log('\n[1-3] 지역 필터');
  await tap(page, 63, 90, 1500); // 지역 chip
  await shot(page, 'feed_04_region_filter_open');

  // ── 1-5. 포트폴리오 직접 접근 ────────────────────────────────────────────
  console.log('\n[1-4] /portfolio');
  await gotoAs(page, '/portfolio', clientSession, 4000);
  await shot(page, 'portfolio_01_initial');

  // ── 1-6. 포트폴리오 스크롤 ─────────────────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 400));
  await delay(1000);
  await shot(page, 'portfolio_02_scrolled');
  await page.evaluate(() => window.scrollTo(0, 800));
  await delay(1000);
  await shot(page, 'portfolio_03_scrolled_more');

  // ── 1-7. 피드에서 파일럿 탭 시도 ────────────────────────────────────────
  console.log('\n[1-5] 피드 파일럿 카드 탭');
  await gotoAs(page, '/feed', clientSession, 4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(500);
  // Pilot cards appear around y=250+ in feed
  await tap(page, 195, 260, 2500);
  await shot(page, 'feed_05_pilot_card_tap');
  console.log('  URL after pilot tap:', page.url());

  // If we got to a pilot page, take more shots
  const pilotUrl = page.url();
  if (pilotUrl.includes('/portfolio/') || pilotUrl.includes('/pilot/')) {
    await page.evaluate(() => window.scrollTo(0, 400));
    await delay(1000);
    await shot(page, 'feed_06_pilot_detail_scroll');
  }

  console.log('\n  ✓ 피드/포트폴리오 QA 완료. Issues:', issues.length);
  return issues;
}

// ── PART 2: Operator Registration ─────────────────────────────────────────────
async function runOperatorRegistration(page, newUserSession) {
  console.log('\n══════════════════════════════════════');
  console.log(' PART 2: 운용자 등록 (5단계)');
  console.log('══════════════════════════════════════');
  const issues = [];

  await gotoAs(page, '/pilot/register', newUserSession, 4000);
  await shot(page, 'reg_00_initial');

  // ── Step 1: 자격증 등록 ────────────────────────────────────────────────────
  console.log('\n[Step 1] 자격증 등록');
  await shot(page, 'reg_01_license_step');

  // Find inputs on this page
  let inputs = await getInputPositions(page);
  console.log('  Inputs found:', inputs.length, inputs.map(i => `(${Math.round(i.x)},${Math.round(i.y)})`).join(', '));

  // 자격증 번호 field (type number, after the dropdown)
  if (inputs.length > 0) {
    const numField = inputs.find(i => i.type === 'number' || i.type === 'text') || inputs[0];
    await typeInto(page, numField.x, numField.y, '24-001234');
    console.log('  자격증 번호 입력 완료');
  } else {
    // Coordinate-based fallback: 자격증 번호 field at roughly y=380
    await typeInto(page, 195, 380, '24-001234');
  }
  await shot(page, 'reg_01b_license_filled');

  // Click "다음"
  const next1 = await clickByText(page, '다음');
  if (!next1) {
    // Try coordinate tap at bottom of form (다음 button)
    await tap(page, 280, 700, 2000);
  }
  await delay(2000);
  await shot(page, 'reg_01c_after_next');
  console.log('  URL after step 1:', page.url());

  // ── Step 2: 사업자 정보 ────────────────────────────────────────────────────
  console.log('\n[Step 2] 사업자 정보');
  await shot(page, 'reg_02_business_step');

  inputs = await getInputPositions(page);
  console.log('  Inputs found:', inputs.length);

  // Fields in order: 상호명, 사업자등록번호, 대표자명
  const fieldValues = ['QA드론 서비스', '123-45-67890', '테스트유저'];
  const textInputs = inputs.filter(i => ['text', 'number', 'tel', ''].includes(i.type));
  for (let i = 0; i < Math.min(textInputs.length, fieldValues.length); i++) {
    await typeInto(page, textInputs[i].x, textInputs[i].y, fieldValues[i]);
    console.log(`  Field ${i + 1} 입력: ${fieldValues[i]}`);
  }
  await shot(page, 'reg_02b_business_filled');

  const next2 = await clickByText(page, '다음');
  if (!next2) await tap(page, 280, 700, 2000);
  await delay(2000);
  await shot(page, 'reg_02c_after_next');

  // ── Step 3: 보험 등록 ──────────────────────────────────────────────────────
  console.log('\n[Step 3] 보험 등록');
  await shot(page, 'reg_03_insurance_step');

  inputs = await getInputPositions(page);
  console.log('  Inputs found:', inputs.length);

  // Fields: 보험 증권번호, 가입된 기체 번호
  const insuranceValues = ['DB-DRONE-TEST001', 'D-2026-001'];
  const insInputs = inputs.filter(i => ['text', ''].includes(i.type));
  for (let i = 0; i < Math.min(insInputs.length, insuranceValues.length); i++) {
    await typeInto(page, insInputs[i].x, insInputs[i].y, insuranceValues[i]);
    console.log(`  보험 필드 ${i + 1}: ${insuranceValues[i]}`);
  }
  await shot(page, 'reg_03b_insurance_filled');

  const next3 = await clickByText(page, '다음');
  if (!next3) await tap(page, 280, 700, 2000);
  await delay(2000);
  await shot(page, 'reg_03c_after_next');

  // ── Step 4: 보유 기체 ──────────────────────────────────────────────────────
  console.log('\n[Step 4] 보유 기체');
  await shot(page, 'reg_04_drone_step');

  inputs = await getInputPositions(page);
  console.log('  Inputs found:', inputs.length);

  // Model field (text)
  const droneTextInputs = inputs.filter(i => ['text', ''].includes(i.type));
  if (droneTextInputs.length > 0) {
    await typeInto(page, droneTextInputs[0].x, droneTextInputs[0].y, 'Mavic 3 Pro');
    console.log('  모델명 입력: Mavic 3 Pro');
  }
  // 기체 신고번호 (last text field if multiple)
  if (droneTextInputs.length > 1) {
    await typeInto(page, droneTextInputs[droneTextInputs.length - 1].x, droneTextInputs[droneTextInputs.length - 1].y, 'S2026001');
    console.log('  기체 신고번호: S2026001');
  }

  // Tap "촬영용" chip (카테고리 선택)
  await tap(page, 55, 450, 800); // approximate chip position
  await shot(page, 'reg_04b_drone_filled');

  const next4 = await clickByText(page, '다음');
  if (!next4) await tap(page, 280, 700, 2000);
  await delay(2000);
  await shot(page, 'reg_04c_after_next');

  // ── Step 5: 활동 지역·일정 ────────────────────────────────────────────────
  console.log('\n[Step 5] 활동 지역·일정');
  await shot(page, 'reg_05_area_step');

  // Tap "서울" chip (region selection)
  await tap(page, 195, 250, 1000);
  await shot(page, 'reg_05b_area_selected');
  await page.evaluate(() => window.scrollTo(0, 300));
  await delay(500);
  await shot(page, 'reg_05c_area_scrolled');

  // ── Submit ─────────────────────────────────────────────────────────────────
  console.log('\n[Submit] 인증 제출');
  const submitted = await clickByText(page, '인증 제출');
  if (!submitted) {
    console.log('  "인증 제출" 버튼을 텍스트로 찾지 못함, 좌표 탭 시도');
    await tap(page, 280, 700, 3000);
  }
  await delay(4000);
  await shot(page, 'reg_06_after_submit');
  console.log('  URL after submit:', page.url());

  const finalText = await page.evaluate(() => document.body.innerText || '');
  const success = finalText.includes('완료') || finalText.includes('접수') || finalText.includes('등록') || page.url().includes('done');
  console.log('  Submit result:', success ? '✅ 성공 가능성 있음' : '⚠️ 결과 불명확, 스크린샷 확인 필요');

  if (!success) {
    issues.push({ step: 'register_submit', severity: 'WARN', note: '제출 결과 불명확' });
  }

  return issues;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  // Get fresh tokens
  console.log('[AUTH] Logging in...');
  const clientSession = await login('review-client@modedrone.kr', 'Review2026!');
  const newUserSession = await login('qa-newuser-20260612@gmail.com', 'QAtest2026!');
  console.log('  Client:', clientSession.user?.email);
  console.log('  NewUser:', newUserSession.user?.email);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [JS ERR]', msg.text().slice(0, 120));
  });

  const allIssues = [];

  try {
    const feedIssues = await runFeedPortfolioQA(page, clientSession);
    allIssues.push(...feedIssues);

    const regIssues = await runOperatorRegistration(page, newUserSession);
    allIssues.push(...regIssues);

  } catch (err) {
    console.error('\n[FATAL]', err.message);
    allIssues.push({ step: 'exception', severity: 'FATAL', error: err.message });
    try { await shot(page, 'fatal_error'); } catch (_) {}
  } finally {
    const result = { issues: allIssues, screenshotDir: OUT_DIR };
    fs.writeFileSync('qa_feed_portfolio_result.json', JSON.stringify(result, null, 2));
    console.log('\n══════════════════════════════════════');
    console.log(' DONE — Issues:', allIssues.length);
    allIssues.forEach(i => console.log(' -', i.severity || 'INFO', i.step, i.note || i.error || ''));
    console.log('══════════════════════════════════════');
    try { await browser.close(); } catch (_) {}
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
