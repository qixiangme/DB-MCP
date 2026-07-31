const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2700 });
  watchForErrors(page, 'playstore_readiness4');

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  console.log('=== /chats -> open first room ===');
  await page.goto(config.baseUrl + '/chats', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(4000);
  await page.mouse.click(480, 100);
  await delay(3000);
  await page.screenshot({ path: screenshotPath(config, 'play_07_chat_room') });

  await browser.close();
  console.log('DONE');
})();
