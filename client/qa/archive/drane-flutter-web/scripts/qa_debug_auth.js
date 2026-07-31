const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2000 });
  watchForErrors(page, 'debug_auth');
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('DEBUG')) console.log('[BROWSER]', text);
  });

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  const storageKey = `sb-${config.supabaseProjectRef}-auth-token`;
  const tokenOnHome = await page.evaluate((k) => localStorage.getItem(k), storageKey);
  console.log('token present on /home:', !!tokenOnHome, tokenOnHome ? tokenOnHome.slice(0, 60) : null);

  console.log('=== goto /blocked-users ===');
  await page.goto(config.baseUrl + '/blocked-users', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(2000);

  const tokenOnBlocked = await page.evaluate((k) => localStorage.getItem(k), storageKey);
  console.log('token present on /blocked-users:', !!tokenOnBlocked, tokenOnBlocked ? tokenOnBlocked.slice(0, 60) : null);

  await delay(6000);
  await page.screenshot({ path: screenshotPath(config, 'debug_01_blocked_after_wait') });

  await browser.close();
  console.log('DONE');
})();
