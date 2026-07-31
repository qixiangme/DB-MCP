/**
 * QA check: verify "(선택)" / "*" labels on 운용자등록 (pilot onboarding) and
 * operator mypage 기체 등록 sections after adding optional-field markers.
 *
 * Click coordinates for the "다음" button are filled in incrementally as we
 * discover them from screenshots (Flutter web renders to <canvas>, so there
 * is no DOM text to query — coordinate clicks are the only option).
 */
const config = require('../config');
const {
  launchBrowser,
  waitForCanvas,
  loginAndReload,
  screenshotPath,
  watchForErrors,
} = require('../lib/harness');

const delay = ms => new Promise(r => setTimeout(r, ms));

// Filled in step by step as we confirm each step's "다음" button position.
const NEXT_CLICKS = [];

async function main() {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2700 });
  watchForErrors(page, 'optional_labels_check');

  try {
    console.log('=== Login as operator review account ===');
    await loginAndReload(page, config, config.accounts.operator.email, config.accounts.operator.password, '/operator');

    console.log('=== /pilot/register (step 1: 자격증 등록) ===');
    await page.goto(config.baseUrl + '/pilot/register', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(5000);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step1_license') });

    console.log('=== filling 자격증 번호 (required, currently empty) ===');
    await page.mouse.click(871, 297);
    await delay(300);
    await page.keyboard.type('24000123', { delay: 50 });
    await delay(500);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step1_filled') });

    console.log('=== clicking 다음 -> step 2 ===');
    await page.mouse.click(922, 504);
    await delay(2500);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step2_business') });

    console.log('=== filling 사업자 정보 (required fields) ===');
    await page.mouse.click(871, 230);
    await delay(300);
    await page.keyboard.type('드라메 리뷰', { delay: 50 });
    await page.mouse.click(871, 297);
    await delay(300);
    await page.keyboard.type('1234567890', { delay: 50 });
    await page.mouse.click(871, 365);
    await delay(300);
    await page.keyboard.type('홍길동', { delay: 50 });
    await delay(500);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step2_filled') });

    console.log('=== clicking 다음 -> step 3 ===');
    await page.mouse.click(922, 568);
    await delay(2500);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step3_insurance') });

    console.log('=== filling 보험 증권번호 (required) ===');
    await page.mouse.click(871, 297);
    await delay(300);
    await page.keyboard.type('DB-DRONE-240099', { delay: 50 });
    await delay(500);

    console.log('=== clicking 다음 -> step 4 (보유 기체 / 기체등록) ===');
    await page.mouse.click(922, 568);
    await delay(2500);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_step4_drone') });

    console.log('=== /operator/mypage (기체 목록 카드) ===');
    await page.goto(config.baseUrl + '/operator/mypage', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(5000);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_mypage_top') });
    await page.mouse.move(720, 1000);
    await page.mouse.wheel({ deltaY: 900 });
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_mypage_scrolled1') });
    await page.mouse.wheel({ deltaY: 900 });
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'optlabel_mypage_scrolled2') });

  } catch (err) {
    console.error('FATAL', err);
    try { await page.screenshot({ path: screenshotPath(config, 'optlabel_fatal') }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

main();
