const config = require('../config');
const { launchBrowser, waitForCanvas, loginAndReload, screenshotPath, watchForErrors } = require('../lib/harness');
const delay = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { browser, page } = await launchBrowser(config, { width: 1440, height: 3000 });
  watchForErrors(page, 'moderation_flow');

  await loginAndReload(page, config, config.accounts.client.email, config.accounts.client.password, '/home');
  await waitForCanvas(page);
  await delay(4000);

  console.log('=== /feed ===');
  await page.goto(config.baseUrl + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(5000);

  console.log('=== click kebab on 2nd post (ROW) ===');
  await page.mouse.click(962, 795);
  await delay(1000);
  await page.screenshot({ path: screenshotPath(config, 'flow_01_menu_open') });

  console.log('=== click 신고하기 ===');
  await page.mouse.click(926, 807);
  await delay(1000);
  await page.screenshot({ path: screenshotPath(config, 'flow_02_report_dialog') });

  console.log('=== submit report ===');
  await page.mouse.click(855, 1642);
  await delay(2000);
  await page.screenshot({ path: screenshotPath(config, 'flow_03_after_report') });

  console.log('=== open kebab again, click 차단하기 ===');
  await page.mouse.click(962, 795);
  await delay(1000);
  await page.mouse.click(917, 856);
  await delay(1000);
  await page.screenshot({ path: screenshotPath(config, 'flow_04_block_dialog') });

  console.log('=== confirm block ===');
  await page.mouse.click(1014, 1545);
  await delay(2000);
  await page.screenshot({ path: screenshotPath(config, 'flow_05_after_block') });

  console.log('=== check blocked-users page ===');
  await page.goto(config.baseUrl + '/blocked-users', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(3000);
  await page.screenshot({ path: screenshotPath(config, 'flow_06_blocked_list') });

  console.log('=== reload feed to check ROW post gone ===');
  await page.goto(config.baseUrl + '/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForCanvas(page);
  await delay(5000);
  await page.screenshot({ path: screenshotPath(config, 'flow_07_feed_after_block') });

  await browser.close();
  console.log('DONE');
})();
