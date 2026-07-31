const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:9001';
const OUT = path.join(__dirname, 'screenshots');

// All output images are 1080x1920 (9:16) via deviceScaleFactor
// CSS width must be < 760 for compact/mobile Flutter layout
const DEVICES = [
  { name: 'phone',      w: 360,  h: 640,  dpr: 3 },  // 360*3=1080 x 640*3=1920, compact layout
  { name: 'tablet_7',  w: 540,  h: 960,  dpr: 2 },  // 540*2=1080 x 960*2=1920, compact layout
  { name: 'tablet_10', w: 1080, h: 1920, dpr: 1 },  // 1080x1920, web layout (>760px)
];

// /home is listed first so pre-warm state carries directly into 02_discover
const PAGES = [
  { path: '/home',      file: '02_discover',  label: 'Home/Discover', extra: 8000 },
  { path: '/home',      file: '03_browse',    label: 'Home scrolled', extra: 8000 },
  { path: '/landing',   file: '01_landing',   label: 'Landing',       extra: 3000 },
  { path: '/portfolio', file: '04_portfolio', label: 'Portfolio',     extra: 4000 },
];

async function waitForCanvas(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(() =>
      !!(document.querySelector('canvas') ||
         document.querySelector('flt-glass-pane') ||
         document.querySelector('flt-scene'))
    );
    if (found) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`    Canvas ready after ${elapsed}s`);
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('    TIMEOUT: Canvas not found');
  return false;
}

async function shootPage(page, dev, pg) {
  console.log(`  ${pg.label} (${pg.path}) ...`);
  await page.goto(BASE_URL + pg.path, { waitUntil: 'load', timeout: 30000 });

  await waitForCanvas(page, 60000);
  await new Promise(r => setTimeout(r, pg.extra));

  const outPath = path.join(OUT, `${dev.name}_${pg.file}.jpg`);
  // clip in CSS px — puppeteer multiplies by DPR for physical output
  await page.screenshot({
    path: outPath,
    type: 'jpeg',
    quality: 92,
    clip: { x: 0, y: 0, width: dev.w, height: dev.h },
  });
  console.log(`  -> saved: ${path.basename(outPath)}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  for (const dev of DEVICES) {
    const physW = dev.w * dev.dpr;
    const physH = dev.h * dev.dpr;
    console.log(`\n=== ${dev.name} (CSS ${dev.w}x${dev.h} DPR${dev.dpr} → ${physW}x${physH}px) ===`);

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: false,
      defaultViewport: null,
      args: [
        `--window-size=${physW},${physH}`,
        '--no-sandbox',
        '--lang=ko-KR',
        '--disable-infobars',
        '--disable-extensions',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr });

    // Pre-warm: load /home so Supabase data is cached for 02_discover
    console.log('  [warm-up] loading /home ...');
    try {
      await page.goto(BASE_URL + '/home', { waitUntil: 'load', timeout: 30000 });
      await waitForCanvas(page, 30000);
      await new Promise(r => setTimeout(r, 18000));
      console.log('  [warm-up] done');
    } catch(e) {
      console.warn('  [warm-up] error:', e.message.split('\n')[0]);
    }

    for (const pg of PAGES) {
      try {
        await shootPage(page, dev, pg);
      } catch(e) {
        console.warn(`  ERROR on ${pg.path}:`, e.message.split('\n')[0]);
      }
    }

    await browser.close();
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nAll done!', OUT);
})();
