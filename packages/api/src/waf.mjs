/**
 * WAF token bootstrapper.
 *
 * The `aws-waf-token` cannot be minted with plain HTTP — it is the solution to
 * AWS WAF's browser challenge (JS proof-of-work / integrity checks). We launch a
 * real (headless) Chromium, load app.traderepublic.com so the WAF SDK runs, then
 * harvest the resulting `aws-waf-token` cookie and the other seed cookies.
 *
 * Returns everything the TR client needs to make its first authenticated call:
 *   { wafToken, cookies: [{name, value}, …], userAgent }
 *
 * Requires: `pnpm add playwright` + `npx playwright install chromium`.
 */

const APP_URL = 'https://app.traderepublic.com/';
const WAF_COOKIE = 'aws-waf-token';

export async function bootstrapWaf({ headless = true, timeoutMs = 45_000 } = {}) {
  // Lazy import so the server can start even if Playwright isn't installed yet.
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Poll the cookie jar until WAF has issued its token (challenge solved).
    const deadline = Date.now() + timeoutMs;
    let wafToken;
    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      const waf = cookies.find((c) => c.name === WAF_COOKIE);
      if (waf?.value) {
        wafToken = waf.value;
        break;
      }
      await page.waitForTimeout(750);
    }
    if (!wafToken) {
      throw new Error(
        'WAF token not issued within timeout. Try headless:false to solve a ' +
          'visible CAPTCHA, or retry.',
      );
    }

    const cookies = await context.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return {
      wafToken,
      userAgent,
      cookies: cookies.map(({ name, value }) => ({ name, value })),
    };
  } finally {
    await browser.close();
  }
}
