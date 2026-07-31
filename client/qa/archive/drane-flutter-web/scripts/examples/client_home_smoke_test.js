// Example QA script using the shared harness (lib/harness.js + config.js).
// Run: node qa/scripts/examples/client_home_smoke_test.js
//
// This is the pattern new scripts should follow -- compare to the
// pre-harness scripts in qa/scripts/*.js (kept as-is, not rewritten, since
// they still work and rewriting 50+ working scripts wasn't worth the risk).

const config = require('../../config');
const {
  launchBrowser,
  loginAndReload,
  screenshotPath,
  watchForErrors,
} = require('../../lib/harness');

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 2600 });
  watchForErrors(page, 'client_home_smoke_test');

  console.log('=== log in as client, load /home ===');
  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password);

  await page.screenshot({ path: screenshotPath(config, 'example_client_home') });
  console.log('Saved screenshot. Done.');

  await browser.close();
})();
