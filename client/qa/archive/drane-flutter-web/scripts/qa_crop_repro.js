const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = __dirname;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1500,2700', '--no-sandbox'],
  });
  const page = await browser.newPage();
  const fileUrl = 'file:///' + path.join(OUT_DIR, 'qa_repro_02_after_confirm.png').replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.setViewport({ width: 1500, height: 2700 });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({
    path: path.join(OUT_DIR, 'report2_crop_composer.png'),
    clip: { x: 60, y: 845, width: 970, height: 55 },
  });
  await browser.close();
  console.log('done');
})();
