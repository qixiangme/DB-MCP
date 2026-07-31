/**
 * QA check: map rotation disabled / Korea-only bounds, and the new
 * "close my own request" + 7-day auto-expiry flow on the job request map.
 *
 * Uses a tall viewport instead of scrolling -- flutter_map/canvas scroll via
 * mouse.wheel has been unreliable across runs on this project (see
 * qa/README.md), so we size the window to fit the map section on first
 * paint instead.
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

async function main() {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 3000 });
  watchForErrors(page, 'map_expiry_check');

  try {
    console.log('=== Login as client review account ===');
    await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
    await waitForCanvas(page);
    await delay(5000);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_01_home_tall') });

    console.log('=== clicking 요청 마감하기 ===');
    await page.mouse.click(1145, 1137);
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_02_confirm_dialog') });

    console.log('=== confirming 마감하기 ===');
    await page.mouse.click(849, 1545);
    await delay(2500);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_03_after_close') });

    console.log('=== reload to check persistence ===');
    await page.goto(config.baseUrl + '/home', { waitUntil: 'load', timeout: 30000 });
    await waitForCanvas(page);
    await delay(6000);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_04_after_reload') });

    console.log('=== click another (not-own) marker ===');
    await page.mouse.click(786, 787);
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_05_other_marker') });

    console.log('=== scroll-wheel zoom test on map ===');
    await page.mouse.move(680, 900);
    await page.mouse.wheel({ deltaY: -300 });
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_06_zoomed') });

    console.log('=== open composer, check 7-day notice ===');
    await page.mouse.click(1271, 566);
    await delay(1200);
    await page.screenshot({ path: screenshotPath(config, 'mapqa_07_composer') });

  } catch (err) {
    console.error('FATAL', err);
    try { await page.screenshot({ path: screenshotPath(config, 'mapqa_fatal') }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

main();
