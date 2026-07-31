/**
 * qa_web_desktop.js
 * 웹(데스크톱) 뷰포트 QA + 상호작용 흐름 테스트
 * Usage: node qa_web_desktop.js <cycleNum>
 *
 * 테스트 항목:
 *  1. 데스크톱(1280x800) 전 페이지 스크롤 스크린샷
 *  2. 모바일(390x844) 상호작용 흐름:
 *     Flow1 - 포트폴리오 → 견적 요청 시트 열기 → 닫기 → 내 견적 새로고침
 *     Flow2 - 운용자 받은 요청 ROW 탭 → 응답 시트 → 닫기 → 목록 새로고침
 *     Flow3 - 클라이언트 채팅 스레드 열기 → 뒤로가기
 *     Flow4 - 채팅 메시지 실제 전송
 *     Flow5 - 운용자 포트폴리오 이미지 업로드 (desktop)
 *     Flow6 - 운용자 마이페이지 프로필 사진 업로드 (desktop)
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const CYCLE = parseInt(process.argv[2] || '1', 10);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT_DIR = path.join(__dirname, 'screenshots', 'qa', `web-cycle-${CYCLE}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const DESKTOP = { w: 1280, h: 800, dpr: 1 };
const PHONE   = { w: 390,  h: 844, dpr: 3 };

const SUPABASE_URL = 'https://wgujitwmipifuhxavmsn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6r9yqZWSOOWJhwVJXRD8Xw_KsgLSISW';
const PROJECT_REF  = 'wgujitwmipifuhxavmsn';
const STORAGE_KEY  = `sb-${PROJECT_REF}-auth-token`;
const CLIENT_EMAIL   = 'review-client@modedrone.kr';
const OPERATOR_EMAIL = 'review-operator@modedrone.kr';
const PASSWORD = 'Review2026!';

const summary = { cycle: CYCLE, screenshots: [], errors: [], flows: [] };

// 이전 사이클 스크린샷을 업로드 테스트 이미지로 재활용
const TEST_IMAGE_PATH = (() => {
  for (let c = CYCLE - 1; c >= 1; c--) {
    const p = path.join(__dirname, 'screenshots', 'qa', `web-cycle-${c}`, 'web_landing_01_top.jpg');
    if (fs.existsSync(p)) return p;
  }
  return null;
})();

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForFlutter(page, ms = 45000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const ok = await page.evaluate(() =>
      !!(document.querySelector('flt-glass-pane') ||
         document.querySelector('flt-scene-host') ||
         document.querySelector('canvas'))
    ).catch(() => false);
    if (ok) return true;
    await delay(600);
  }
  return false;
}

async function shoot(page, label, vp) {
  const file = path.join(OUT_DIR, `${label}.jpg`);
  for (let i = 0; i < 3; i++) {
    try {
      await page.screenshot({
        path: file, type: 'jpeg', quality: 85,
        clip: { x: 0, y: 0, width: vp.w, height: vp.h },
      });
      console.log(`    → ${label}.jpg`);
      summary.screenshots.push(label);
      return file;
    } catch(e) {
      if (i < 2) { await delay(3000); }
      else { console.error(`    FAILED: ${label}`); summary.errors.push(`[screenshot-fail] ${label}`); }
    }
  }
  return null;
}

async function scroll(page, steps, px = 400) {
  for (let i = 0; i < steps; i++) {
    try {
      await page.mouse.wheel({ deltaY: px });
    } catch(e) {
      console.warn(`    scroll step ${i+1} failed: ${e.message.slice(0,60)}`);
    }
    await delay(500);
  }
}

async function injectLogin(page, email) {
  const session = await page.evaluate(async (url, key, em, pw) => {
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      });
      return await r.json();
    } catch(e) { return { error: e.message }; }
  }, SUPABASE_URL, SUPABASE_KEY, email, PASSWORD);
  if (!session.access_token) { console.warn('    login FAILED:', email); return false; }
  await page.evaluate((k, s) => localStorage.setItem(k, JSON.stringify(s)), STORAGE_KEY, session);
  console.log(`    login OK: ${email}`);
  return true;
}

async function goto(page, urlPath, vp) {
  try { await page.goto(BASE_URL + urlPath, { waitUntil: 'networkidle0', timeout: 30000 }); }
  catch(e) { console.warn(`    goto ${urlPath}: ${e.message.slice(0,60)}`); }
  await waitForFlutter(page);
  await delay(2500);
}

// ── 데스크톱 전 페이지 스캔 ─────────────────────────────────────────────────
async function desktopScan(browser) {
  console.log('\n======== 데스크톱 뷰포트(1280x800) 스캔 ========');
  let page = await browser.newPage();
  await page.bringToFront();
  await page.setViewport({ width: DESKTOP.w, height: DESKTOP.h, deviceScaleFactor: DESKTOP.dpr });

  page.on('console', msg => {
    if (msg.type() === 'error') summary.errors.push(`[desktop-console] ${msg.text().slice(0,150)}`);
  });

  // 랜딩 페이지 (비로그인)
  console.log('\n▶ [desktop/web_landing] /landing');
  await goto(page, '/landing', DESKTOP);
  await shoot(page, 'web_landing_01_top', DESKTOP);
  await scroll(page, 1, 600);
  await shoot(page, 'web_landing_02_scroll', DESKTOP);
  await scroll(page, 1, 600);
  await shoot(page, 'web_landing_03_scroll', DESKTOP);

  // 클라이언트 로그인
  await goto(page, '/home', DESKTOP);
  await injectLogin(page, CLIENT_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  const clientPages = [
    { route: '/home',       name: 'web_home',       steps: 3 },
    { route: '/portfolio',  name: 'web_portfolio',   steps: 2 },
    { route: '/feed',       name: 'web_feed',        steps: 2 },
    { route: '/my/quotes',  name: 'web_my_quotes',   steps: 2 },
    { route: '/chats',      name: 'web_chats',       steps: 1 },
  ];

  for (const pg of clientPages) {
    console.log(`\n▶ [desktop/${pg.name}] ${pg.route}`);
    try {
      await goto(page, pg.route, DESKTOP);
      await shoot(page, `${pg.name}_01_top`, DESKTOP);
      for (let s = 0; s < pg.steps; s++) {
        await scroll(page, 1, 500);
        await shoot(page, `${pg.name}_0${s+2}_scroll`, DESKTOP);
      }
    } catch(e) {
      console.warn(`    [${pg.name}] 페이지 스캔 실패: ${e.message.slice(0,80)}`);
      summary.errors.push(`[desktop-scan] ${pg.name}: ${e.message.slice(0,100)}`);
      // 페이지가 detached된 경우 새 페이지로 복구
      try {
        if (page.isClosed()) {
          page = await browser.newPage();
          await page.setViewport({ width: DESKTOP.w, height: DESKTOP.h, deviceScaleFactor: DESKTOP.dpr });
          // 클라이언트 로그인 재주입
          await goto(page, '/home', DESKTOP);
          await injectLogin(page, CLIENT_EMAIL);
          await page.reload({ waitUntil: 'networkidle0' });
          await waitForFlutter(page);
          await delay(3000);
        }
      } catch(re) { console.warn('    페이지 복구 실패:', re.message.slice(0,60)); }
    }
  }

  // 운용자 로그인 (페이지가 닫혀있으면 새로 생성)
  if (page.isClosed()) {
    console.warn('  클라이언트 페이지 closed — 새 페이지 생성');
    page = await browser.newPage();
    await page.setViewport({ width: DESKTOP.w, height: DESKTOP.h, deviceScaleFactor: DESKTOP.dpr });
  }
  await goto(page, '/home', DESKTOP);
  await injectLogin(page, OPERATOR_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  const opPages = [
    { route: '/operator',            name: 'web_op_home',      steps: 2 },
    { route: '/operator/requests',   name: 'web_op_requests',  steps: 2 },
    { route: '/operator/portfolio',  name: 'web_op_portfolio', steps: 2 },
    { route: '/operator/mypage',     name: 'web_op_mypage',    steps: 1 },
  ];

  for (const pg of opPages) {
    console.log(`\n▶ [desktop/${pg.name}] ${pg.route}`);
    await goto(page, pg.route, DESKTOP);
    await shoot(page, `${pg.name}_01_top`, DESKTOP);
    for (let s = 0; s < pg.steps; s++) {
      await scroll(page, 1, 400);
      await shoot(page, `${pg.name}_0${s+2}_scroll`, DESKTOP);
    }
  }

  // 운용자 요청 페이지 — 오른쪽 하단 견적 폼 영역 클로즈업
  console.log('\n▶ [desktop/op_requests_form_zoom] 견적 폼 클로즈업');
  await goto(page, '/operator/requests', DESKTOP);
  await delay(2000);
  await page.mouse.click(960, 400);
  await delay(800);
  await page.mouse.wheel({ deltaY: 300 }).catch(() => {});
  await delay(1000);
  const formZoomFile = path.join(OUT_DIR, 'web_op_requests_form_zoom.jpg');
  await page.screenshot({
    path: formZoomFile, type: 'jpeg', quality: 92,
    clip: { x: 645, y: 540, width: 630, height: 260 },
  }).catch(e => console.warn('form-zoom failed:', e.message));
  console.log('    → web_op_requests_form_zoom.jpg');
  summary.screenshots.push('web_op_requests_form_zoom');

  return page; // 페이지 재사용 (새 탭 오픈 오류 방지)
}

// ── 모바일 상호작용 흐름 ─────────────────────────────────────────────────────
async function mobileFlowTest(page) {
  console.log('\n======== 모바일 상호작용 흐름 테스트 ========');
  await page.setViewport({ width: PHONE.w, height: PHONE.h, deviceScaleFactor: PHONE.dpr });

  page.on('console', msg => {
    if (msg.type() === 'error') summary.errors.push(`[flow-console] ${msg.text().slice(0,150)}`);
  });

  // ── 흐름 1: 클라이언트 포트폴리오 → 견적 시트 → 닫기 → 내 견적 확인 ──────
  console.log('\n  [흐름1] 포트폴리오 → 견적 요청 → 내 견적 새로고침');
  await goto(page, '/home', PHONE);
  await injectLogin(page, CLIENT_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  await goto(page, '/portfolio', PHONE);
  await shoot(page, 'flow1_01_portfolio_list', PHONE);

  await page.mouse.click(195, 280);
  await waitForFlutter(page);
  await delay(5000);
  await shoot(page, 'flow1_02_portfolio_detail', PHONE);

  await page.mouse.wheel({ deltaY: 300 });
  await delay(800);
  await shoot(page, 'flow1_03_portfolio_scrolled', PHONE);

  await page.mouse.click(195, 800);
  await delay(2000);
  await shoot(page, 'flow1_04_quote_sheet_open', PHONE);

  await page.keyboard.press('Escape');
  await delay(1000);
  await shoot(page, 'flow1_05_sheet_closed', PHONE);

  await goto(page, '/my/quotes', PHONE);
  await delay(2000);
  await shoot(page, 'flow1_06_my_quotes_after', PHONE);

  summary.flows.push({ flow: '포트폴리오→견적시트→내견적', screenshots: 6 });

  // ── 흐름 2: 운용자 받은 요청 ROW → 응답 시트 → 닫기 → 목록 갱신 ──────────
  console.log('\n  [흐름2] 운용자 받은 요청 → 응답 시트 → 닫기 → 목록 새로고침');
  await goto(page, '/home', PHONE);
  await injectLogin(page, OPERATOR_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  await goto(page, '/operator', PHONE);
  await shoot(page, 'flow2_01_operator_home_before', PHONE);

  await goto(page, '/operator/requests', PHONE);
  await shoot(page, 'flow2_02_requests_before', PHONE);

  await page.mouse.click(195, 350);
  await delay(2000);
  await shoot(page, 'flow2_03_request_tapped', PHONE);

  await page.mouse.wheel({ deltaY: 400 });
  await delay(800);
  await shoot(page, 'flow2_04_sheet_scrolled', PHONE);

  await page.mouse.wheel({ deltaY: 400 });
  await delay(800);
  await shoot(page, 'flow2_05_sheet_bottom', PHONE);

  await page.keyboard.press('Escape');
  await delay(3000);
  await shoot(page, 'flow2_06_after_close_refreshed', PHONE);

  await goto(page, '/operator', PHONE);
  await shoot(page, 'flow2_07_operator_home_after', PHONE);

  summary.flows.push({ flow: '운용자받은요청→응답시트→새로고침', screenshots: 7 });

  // ── 흐름 3: 클라이언트 채팅 스레드 열기 → 뒤로가기 ────────────────────────
  console.log('\n  [흐름3] 클라이언트 채팅 스레드 열기');
  await goto(page, '/home', PHONE);
  await injectLogin(page, CLIENT_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  await goto(page, '/chats', PHONE);
  await delay(2000);
  await shoot(page, 'flow3_01_chat_list', PHONE);

  await page.mouse.click(195, 105);
  await delay(3000);
  await shoot(page, 'flow3_02_chat_thread_open', PHONE);

  await page.mouse.wheel({ deltaY: 400 });
  await delay(800);
  await shoot(page, 'flow3_03_chat_scrolled', PHONE);

  // AppBar ← 버튼: Flutter Material AppBar leading icon center (CSS px)
  // leadingWidth=56, icon center = (56/2)=28, AppBar height=56, center = 28
  await page.mouse.click(28, 28);
  await delay(2000);
  await shoot(page, 'flow3_04_back_to_list', PHONE);

  summary.flows.push({ flow: '클라이언트채팅스레드→열기→닫기', screenshots: 4 });

  // ── 흐름 4: 채팅 메시지 실제 전송 ──────────────────────────────────────────
  console.log('\n  [흐름4] 채팅 메시지 전송');
  // 채팅 목록에서 스레드 재진입
  await goto(page, '/chats', PHONE);
  await delay(1500);

  await page.mouse.click(195, 105);
  await delay(3000);
  await shoot(page, 'flow4_01_chat_thread', PHONE);

  // 입력창 클릭 (하단 바: left_pad=16, x_center≈165, y_center≈820)
  await page.mouse.click(165, 820);
  await delay(1000);

  // 메시지 타이핑
  await page.keyboard.type('QA 자동화 테스트 메시지');
  await delay(600);
  await shoot(page, 'flow4_02_typed', PHONE);

  // Enter로 전송 (FocusNode onKeyEvent 처리)
  await page.keyboard.press('Enter');
  await delay(3000);
  await shoot(page, 'flow4_03_sent', PHONE);

  summary.flows.push({ flow: '채팅메시지전송', screenshots: 3 });

  // ── 흐름 5: 운용자 포트폴리오 이미지 업로드 (desktop viewport) ─────────────
  console.log('\n  [흐름5] 포트폴리오 이미지 업로드');
  await page.setViewport({ width: DESKTOP.w, height: DESKTOP.h, deviceScaleFactor: DESKTOP.dpr });

  await goto(page, '/home', DESKTOP);
  await injectLogin(page, OPERATOR_EMAIL);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForFlutter(page);
  await delay(3000);

  await goto(page, '/operator/portfolio', DESKTOP);
  await shoot(page, 'flow5_01_portfolio_preview', DESKTOP);

  // "편집하기" 버튼 클릭 (cycle-7 스크린샷 기준: x≈1210, y≈130)
  await page.mouse.click(1210, 130);
  await delay(2000);
  await shoot(page, 'flow5_02_edit_mode', DESKTOP);

  // 이미지 업로드 섹션까지 스크롤
  // 섹션 위치 추정: 소개+카테고리+지역+설명 = 약 y=820 (page 좌표)
  // 500px 스크롤 후 viewport-y ≈ 320
  await page.mouse.move(640, 400);
  await page.mouse.wheel({ deltaY: 500 });
  await delay(800);
  await shoot(page, 'flow5_03_edit_scrolled', DESKTOP);

  if (TEST_IMAGE_PATH) {
    try {
      console.log(`    테스트 이미지: ${path.basename(TEST_IMAGE_PATH)}`);
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        // "파일 업로드" 버튼: Row 우측, 약 x=1200, viewport-y ≈ 320 (500px 스크롤 후)
        page.mouse.click(1200, 320),
      ]);
      await chooser.accept([TEST_IMAGE_PATH]);
      console.log('    파일 선택 완료, 업로드 대기...');
      await delay(7000);
      await shoot(page, 'flow5_04_upload_result', DESKTOP);
      console.log('    ✓ 이미지 업로드 시도 완료');
    } catch(e) {
      console.warn('    이미지 업로드 실패:', e.message.slice(0, 80));
      summary.errors.push(`[flow5] 업로드: ${e.message.slice(0, 100)}`);
      await shoot(page, 'flow5_04_upload_error', DESKTOP).catch(() => {});
    }
  } else {
    console.warn('    테스트 이미지 없음 — 이전 사이클 스크린샷 필요');
    summary.errors.push('[flow5] 테스트 이미지 없음');
  }

  summary.flows.push({ flow: '포트폴리오이미지업로드', screenshots: TEST_IMAGE_PATH ? 4 : 3 });

  // ── 흐름 6: 운용자 마이페이지 프로필 사진 업로드 ──────────────────────────
  console.log('\n  [흐름6] 마이페이지 프로필 사진 업로드');
  await goto(page, '/operator/mypage', DESKTOP);
  await delay(1500);
  await shoot(page, 'flow6_01_mypage', DESKTOP);

  if (TEST_IMAGE_PATH) {
    try {
      console.log('    프로필 사진 업로드 시도...');
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        // 아바타 GestureDetector: CircleAvatar(radius=44) center
        // NavBar≈56px + PageShell.top=44 + radius=44 → y≈144, x≈68
        page.mouse.click(68, 144),
      ]);
      await chooser.accept([TEST_IMAGE_PATH]);
      console.log('    파일 선택 완료, 업로드 대기...');
      await delay(6000);
      await shoot(page, 'flow6_02_photo_result', DESKTOP);
      console.log('    ✓ 프로필 사진 업로드 시도 완료');
    } catch(e) {
      console.warn('    프로필 사진 업로드 실패:', e.message.slice(0, 80));
      summary.errors.push(`[flow6] 프로필: ${e.message.slice(0, 100)}`);
      await shoot(page, 'flow6_02_photo_error', DESKTOP).catch(() => {});
    }
  } else {
    console.warn('    테스트 이미지 없음 — 스킵');
  }

  summary.flows.push({ flow: '프로필사진업로드', screenshots: 2 });
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  if (TEST_IMAGE_PATH) {
    console.log(`테스트 이미지: ${TEST_IMAGE_PATH}`);
  } else {
    console.log('경고: 테스트 이미지 없음 (이전 사이클 필요)');
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    protocolTimeout: 120000,
    args: [
      '--window-size=1300,860',
      '--no-sandbox', '--lang=ko-KR',
      '--disable-infobars',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });

  let sharedPage = await desktopScan(browser);
  // 페이지가 닫혀 있으면 새 페이지를 생성
  if (!sharedPage || sharedPage.isClosed()) {
    console.warn('  데스크톱 스캔 후 페이지 detached — 새 페이지로 모바일 플로우 시작');
    sharedPage = await browser.newPage();
    await sharedPage.setViewport({ width: DESKTOP.w, height: DESKTOP.h, deviceScaleFactor: DESKTOP.dpr });
  }
  await mobileFlowTest(sharedPage);
  await browser.close();

  const jsonPath = path.join(__dirname, `qa_web_result_${CYCLE}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n✓ Web QA cycle ${CYCLE} done`);
  console.log(`  screenshots: ${summary.screenshots.length}`);
  console.log(`  flows tested: ${summary.flows.length}`);
  console.log(`  errors: ${summary.errors.length}`);
  if (summary.errors.length) {
    summary.errors.slice(0,15).forEach(e => console.log('  ' + e));
  }
})();
