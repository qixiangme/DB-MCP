/**
 * QA check for the new UGC moderation feature: report/block menu on feed
 * posts and chat rooms, blocked-users management page, updated terms page.
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
  watchForErrors(page, 'moderation_check');

  try {
    console.log('=== Login as client ===');
    await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
    await waitForCanvas(page);
    await delay(4000);

    console.log('=== /feed ===');
    await page.goto(config.baseUrl + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(5000);
    await page.screenshot({ path: screenshotPath(config, 'mod_01_feed') });

    console.log('=== /terms ===');
    await page.goto(config.baseUrl + '/terms', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(3000);
    await page.screenshot({ path: screenshotPath(config, 'mod_02_terms') });

    console.log('=== /blocked-users ===');
    await page.goto(config.baseUrl + '/blocked-users', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForCanvas(page);
    await delay(3000);
    await page.screenshot({ path: screenshotPath(config, 'mod_03_blocked_users') });

  } catch (err) {
    console.error('FATAL', err);
    try { await page.screenshot({ path: screenshotPath(config, 'mod_fatal') }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

main();
