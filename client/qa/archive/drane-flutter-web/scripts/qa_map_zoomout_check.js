/**
 * QA check: after the CameraConstraint.contain -> containCenter fix, does
 * zooming all the way out reveal China/Japan? The user wants neighboring
 * countries to stay hidden even when zoomed/scrolled.
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
  watchForErrors(page, 'map_zoomout_check');

  try {
    await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
    await waitForCanvas(page);
    await delay(5000);
    await page.screenshot({ path: screenshotPath(config, 'zoomout_01_initial') });

    console.log('=== zoom out repeatedly on the map ===');
    await page.mouse.move(480, 600);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel({ deltaY: 300 });
      await delay(400);
    }
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'zoomout_02_after_zoomout') });

    console.log('=== try panning toward China (drag right/east->west content shift) ===');
    await page.mouse.move(700, 600);
    await page.mouse.down();
    await page.mouse.move(300, 600, { steps: 10 });
    await page.mouse.up();
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'zoomout_03_after_pan') });

    console.log('=== zoom IN repeatedly to confirm zoom still responds ===');
    await page.mouse.move(480, 400);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel({ deltaY: -300 });
      await delay(400);
    }
    await delay(1000);
    await page.screenshot({ path: screenshotPath(config, 'zoomout_04_zoomed_in') });

  } catch (err) {
    console.error('FATAL', err);
    try { await page.screenshot({ path: screenshotPath(config, 'zoomout_fatal') }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

main();
