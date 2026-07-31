const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:9001';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function waitForCanvas(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() => !!(document.querySelector('canvas') || document.querySelector('flt-glass-pane')));
    if (found) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: CHROME_PATH,
    args: ['--window-size=390,2500', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 2500 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });

  try {
    console.log('--- / (root) ---');
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'C:\\Users\\chang\\FlutterProjects\\drane\\qa_cycle2_client_mobile_01_root.png', fullPage: true });

    console.log('--- /landing ---');
    await page.goto(BASE_URL + '/landing', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'C:\\Users\\chang\\FlutterProjects\\drane\\qa_cycle2_client_mobile_02_landing.png', fullPage: true });

    console.log('--- /login ---');
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'C:\\Users\\chang\\FlutterProjects\\drane\\qa_cycle2_client_mobile_03_login.png', fullPage: true });

    console.log('--- /signup ---');
    await page.goto(BASE_URL + '/signup', { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'C:\\Users\\chang\\FlutterProjects\\drane\\qa_cycle2_client_mobile_04_signup.png', fullPage: true });

    console.log('--- CONSOLE ERRORS ---');
    console.log(JSON.stringify(consoleErrors, null, 2));
  } catch (e) {
    console.error('SCRIPT ERROR', e);
  } finally {
    await browser.close();
  }
})();
