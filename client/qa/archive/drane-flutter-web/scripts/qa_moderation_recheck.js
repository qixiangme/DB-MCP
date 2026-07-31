const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2000 });
  watchForErrors(page, 'moderation_recheck');

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  console.log('=== /blocked-users (long wait) ===');
  await page.goto(config.baseUrl + '/blocked-users', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(9000);
  await page.screenshot({ path: screenshotPath(config, 'recheck_01_blocked_users_longwait') });

  await browser.close();
  console.log('DONE');
})();
