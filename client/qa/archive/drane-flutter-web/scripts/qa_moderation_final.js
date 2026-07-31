const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2200 });
  watchForErrors(page, 'moderation_final');

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  console.log('=== /feed (should NOT show ROW post, blocked) ===');
  await page.goto(config.baseUrl + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(5000);
  await page.screenshot({ path: screenshotPath(config, 'final_01_feed_no_row') });

  console.log('=== /blocked-users (should show ROW) ===');
  await page.goto(config.baseUrl + '/blocked-users', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(4000);
  await page.screenshot({ path: screenshotPath(config, 'final_02_blocked_list_shows_row') });

  console.log('=== click 차단 해제 ===');
  await page.mouse.click(1391, 87);
  await delay(2000);
  await page.screenshot({ path: screenshotPath(config, 'final_03_after_unblock') });

  await browser.close();
  console.log('DONE');
})();
