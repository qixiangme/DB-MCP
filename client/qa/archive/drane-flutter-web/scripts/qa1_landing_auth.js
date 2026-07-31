const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:9001';
const OUT = 'C:\\Users\\chang\\FlutterProjects\\drane\\';

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
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    defaultViewport: null,
    args: ['--window-size=1440,2600', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 2600 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleErrors.push(`[pageerror] ${err.message}`));

  try {
    console.log('--- Testing / (root) ---');
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_01_root.png' });
    console.log('Screenshot 01 root saved. URL:', page.url());

    console.log('--- Testing /landing ---');
    await page.goto(BASE_URL + '/landing', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02_landing.png' });
    console.log('Screenshot 02 landing saved. URL:', page.url());

    // Scroll down to find "01 견적 요청" section
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02b_landing_scroll1.png' });

    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02c_landing_scroll2.png' });

    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02d_landing_scroll3.png' });

    await page.evaluate(() => window.scrollTo(0, 0));

    console.log('--- Testing /login ---');
    await page.goto(BASE_URL + '/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_03_login.png' });
    console.log('Screenshot 03 login saved. URL:', page.url());

    console.log('--- Testing /signup ---');
    await page.goto(BASE_URL + '/signup', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_04_signup.png' });
    console.log('Screenshot 04 signup saved. URL:', page.url());

    console.log('--- Console/page errors collected ---');
    console.log(consoleErrors.length ? consoleErrors.join('\n') : 'NONE');
  } catch (e) {
    console.error('ERROR during test:', e);
  } finally {
    await browser.close();
  }
})();
