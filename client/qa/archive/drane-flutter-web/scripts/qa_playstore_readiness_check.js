/**
 * QA check for Google Play launch readiness: confirm live whether
 * report/block UI exists in chat + feed, and whether legal pages
 * (/privacy, /terms, /delete-account) actually render.
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
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2700 });
  watchForErrors(page, 'playstore_readiness');

  try {
    console.log('=== Login as client ===');
    await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
    await waitForCanvas(page);
    await delay(4000);

    console.log('=== /privacy ===');
    await page.goto(config.baseUrl + '/privacy', { waitUntil: 'load', timeout: 30000 });
    await waitForCanvas(page);
    await delay(3000);
    await page.screenshot({ path: screenshotPath(config, 'play_01_privacy') });

    console.log('=== /terms ===');
    await page.goto(config.baseUrl + '/terms', { waitUntil: 'load', timeout: 30000 });
    await waitForCanvas(page);
    await delay(3000);
    await page.screenshot({ path: screenshotPath(config, 'play_02_terms') });

    console.log('=== /delete-account ===');
    await page.goto(config.baseUrl + '/delete-account', { waitUntil: 'load', timeout: 30000 });
    await waitForCanvas(page);
    await delay(3000);
    await page.screenshot({ path: screenshotPath(config, 'play_03_delete_account') });

    console.log('=== feed page (check for report button) ===');
    await page.goto(config.baseUrl + '/home', { waitUntil: 'load', timeout: 30000 });
    await waitForCanvas(page);
    await delay(4000);
    await page.screenshot({ path: screenshotPath(config, 'play_04_home') });

  } catch (err) {
    console.error('FATAL', err);
    try { await page.screenshot({ path: screenshotPath(config, 'play_fatal') }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

main();
