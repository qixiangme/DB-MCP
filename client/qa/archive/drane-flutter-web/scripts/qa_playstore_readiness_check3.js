const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 3000 });
  watchForErrors(page, 'playstore_readiness3');

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  console.log('=== /feed ===');
  await page.goto(config.baseUrl + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(5000);
  await page.screenshot({ path: screenshotPath(config, 'play_05_feed') });

  console.log('=== /chats ===');
  await page.goto(config.baseUrl + '/chats', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(5000);
  await page.screenshot({ path: screenshotPath(config, 'play_06_chat') });

  await browser.close();
  console.log('DONE');
})();
