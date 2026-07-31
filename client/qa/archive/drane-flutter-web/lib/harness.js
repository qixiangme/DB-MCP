// Reusable Puppeteer QA harness for Flutter-web apps backed by Supabase auth.
//
// Project-agnostic on purpose: nothing here references drane's routes, copy,
// or test accounts. Per-project values (Chrome path, base URL, Supabase
// project, test accounts) live in ../config.js (gitignored, copy from
// config.example.js).
//
// This module has zero dependencies of its own beyond `puppeteer`, which
// ships in this folder's own package.json -- so `qa/` can be copied
// wholesale into another project (`cp -r qa /path/to/other-project/`) and
// works as soon as config.js is filled in and `npm install` has run here.

const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Launch a Chrome window sized for a specific breakpoint and return
 * { browser, page }. Always non-headless: Flutter web's canvas rendering is
 * easiest to debug (and screenshot) with a real, visible window.
 */
async function launchBrowser(config, { width = 1440, height = 2600 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: false,
    defaultViewport: null,
    args: [
      `--window-size=${width},${height}`,
      '--no-sandbox',
      '--lang=ko-KR',
      '--disable-infobars',
      '--disable-extensions',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  return { browser, page };
}

/**
 * Poll until Flutter has painted something (a <canvas> for CanvasKit, or
 * <flt-glass-pane> for the HTML renderer). Flutter web has no reliable
 * "DOMContentLoaded"-equivalent event for first paint, so this is the
 * standard wait condition used throughout this harness.
 */
async function waitForCanvas(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(
      () =>
        !!(
          document.querySelector('canvas') ||
          document.querySelector('flt-glass-pane')
        )
    );
    if (found) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('  [waitForCanvas] TIMEOUT: no canvas/flt-glass-pane found');
  return false;
}

/**
 * Log in without touching the login UI: hits Supabase's password grant
 * directly and writes the session into localStorage under the same key the
 * Supabase JS client reads on boot (`sb-<project-ref>-auth-token`).
 *
 * Returns true/false rather than throwing so callers can decide whether a
 * failed login should abort the whole script or just skip a step.
 */
async function injectSupabaseLogin(page, config, email, password) {
  const storageKey = `sb-${config.supabaseProjectRef}-auth-token`;
  const session = await page.evaluate(
    async (url, key, email, password) => {
      try {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    config.supabaseUrl,
    config.supabaseAnonKey,
    email,
    password
  );

  if (!session.access_token) {
    console.error(
      '  [injectSupabaseLogin] FAILED:',
      JSON.stringify(session).slice(0, 300)
    );
    return false;
  }
  await page.evaluate(
    (k, s) => localStorage.setItem(k, JSON.stringify(s)),
    storageKey,
    session
  );
  return true;
}

/**
 * The reliable end-to-end login sequence used across every script in this
 * project: load once (unauthenticated) so the app boots, inject the
 * session, then reload so the app picks it up on a fresh init. A single
 * goto+inject without the second reload has been unreliable -- some app
 * state (auth listeners, route guards) only re-checks localStorage on boot.
 */
async function loginAndReload(page, config, email, password, homePath = '/home') {
  await page.goto(config.baseUrl + homePath, {
    waitUntil: 'load',
    timeout: 30000,
  });
  await waitForCanvas(page, 30000);
  await new Promise((r) => setTimeout(r, 5000));
  await injectSupabaseLogin(page, config, email, password);
  await page.goto(config.baseUrl + homePath, {
    waitUntil: 'load',
    timeout: 30000,
  });
  await waitForCanvas(page, 30000);
  await new Promise((r) => setTimeout(r, 6000));
}

/** Resolve a screenshot filename against config.screenshotsDir. */
function screenshotPath(config, name) {
  return path.join(config.screenshotsDir, name.endsWith('.png') ? name : `${name}.png`);
}

/**
 * Attach console/pageerror listeners that print only 'error'-level output.
 * Call once per page, right after creating it -- every QA script in this
 * project's history that skipped this step ended up missing a real bug.
 */
function watchForErrors(page, label = '') {
  const prefix = label ? `[${label}] ` : '';
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`${prefix}console error:`, msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.error(`${prefix}pageerror:`, err.message);
  });
}

module.exports = {
  launchBrowser,
  waitForCanvas,
  injectSupabaseLogin,
  loginAndReload,
  screenshotPath,
  watchForErrors,
};
