const puppeteer = require('puppeteer');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:8765';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: { width: 390, height: 844 },
    args: ['--no-sandbox', '--lang=ko-KR'],
  });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));
  page.on('requestfailed', req => logs.push(`[FAILED] ${req.url()} — ${req.failure().errorText}`));

  console.log('Loading /landing ...');
  try {
    await page.goto(BASE_URL + '/landing', { waitUntil: 'networkidle0', timeout: 60000 });
  } catch(e) {
    console.log('goto error:', e.message.slice(0, 100));
  }

  await new Promise(r => setTimeout(r, 10000));

  console.log('\n=== Console logs (last 50) ===');
  logs.slice(-50).forEach(l => console.log(l));

  const dom = await page.evaluate(() => ({
    hasCanvas: !!document.querySelector('canvas'),
    hasFlutterPane: !!document.querySelector('flt-glass-pane'),
    bodyHTML: document.body.innerHTML.slice(0, 300),
  }));
  console.log('\nDOM:', dom);

  await page.screenshot({ path: 'screenshots/debug_check.jpg', type: 'jpeg', quality: 90 });
  console.log('Screenshot saved');

  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();
