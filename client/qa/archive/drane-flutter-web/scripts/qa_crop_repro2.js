const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = __dirname;

const JOBS = [
  { src: 'qa_mobile_map_04_sheet_settled.png', out: 'report2_crop_mobilemap.png', clip: { x: 0, y: 160, width: 390, height: 220 } },
  { src: 'qa_sweep_operator_desktop_56_quote_form_woken.png', out: 'report2_crop_paywall.png', clip: { x: 555, y: 1050, width: 460, height: 240 } },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1500,2700', '--no-sandbox'],
  });
  const page = await browser.newPage();
  for (const job of JOBS) {
    const fileUrl = 'file:///' + path.join(OUT_DIR, job.src).replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'load' });
    await page.setViewport({ width: 1500, height: 2700 });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT_DIR, job.out), clip: job.clip });
    console.log('cropped', job.out);
  }
  await browser.close();
})();
