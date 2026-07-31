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
  try {
    await page.goto(BASE_URL + '/landing', { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCanvas(page);
    await new Promise(r => setTimeout(r, 4000));
    const dims = await page.evaluate(() => ({
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      docElScrollHeight: document.documentElement.scrollHeight,
    }));
    console.log('DIMS', JSON.stringify(dims));

    // try mouse wheel scroll instead of window.scrollBy since flutter web canvas may handle its own scrolling
    await page.mouse.move(720, 1300);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel({ deltaY: 800 });
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02e_landing_wheel_scroll.png' });
    console.log('wheel scroll screenshot taken');

    // try again scrolled further
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel({ deltaY: 800 });
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: OUT + 'qa_cycle2_client_desktop_02f_landing_wheel_scroll2.png' });
    console.log('done');
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await browser.close();
  }
})();
