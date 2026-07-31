const puppeteer = require('puppeteer');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = __dirname;

const JOBS = [
  {
    src: 'qa_fix3_step2_after_respond_click.png',
    out: 'report_crop_fix3a.png',
    clip: { x: 555, y: 950, width: 590, height: 420 },
  },
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
    await page.setViewport({ width: 1450, height: 2650 });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT_DIR, job.out), clip: job.clip });
    console.log('cropped ->', job.out);
  }
  await browser.close();
})();
