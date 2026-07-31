const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 3000 });
  let hadError = false;
  page.on('console', msg => { if (msg.type() === 'error') { hadError = true; console.error('[CONSOLE ERROR]', msg.text()); } });
  page.on('pageerror', err => { hadError = true; console.error('[PAGE ERROR]', err.message); });

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(6000);
  await page.screenshot({ path: screenshotPath(config, 'migration_verify_01') });
  console.log('hadError:', hadError);
  await browser.close();
})();
