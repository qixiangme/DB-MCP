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
    headless: false, defaultViewport: null, executablePath: CHROME_PATH,
    args: ['--window-size=390,844', '--no-sandbox', '--lang=ko-KR', '--disable-infobars', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE_URL + '/landing', { waitUntil: 'networkidle2', timeout: 60000 });
  await waitForCanvas(page);
  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: 'C:\\Users\\chang\\FlutterProjects\\drane\\qa_cycle2_landing_realheight.png' });
  await browser.close();
})();
