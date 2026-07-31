const config = require('../config');
const { launchBrowser, waitForCanvas, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2700 });
  watchForErrors(page, 'playstore_readiness2');

  console.log('=== /terms ===');
  await page.goto(config.baseUrl + '/terms', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(4000);
  await page.screenshot({ path: screenshotPath(config, 'play_02_terms') });

  console.log('=== /delete-account ===');
  await page.goto(config.baseUrl + '/delete-account', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(4000);
  await page.screenshot({ path: screenshotPath(config, 'play_03_delete_account') });

  await browser.close();
  console.log('DONE');
})();
