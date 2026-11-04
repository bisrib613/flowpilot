import { chromium } from 'playwright';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function extractName(text, label) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized.startsWith(label + ' ')) throw new Error('Generator output changed: missing label');
  const name = normalized.slice(label.length).trim();
  if (!name || name.length > 100 || !/^[\p{L}\p{M}][\p{L}\p{M} '\u2019-]*$/u.test(name)) {
    throw new Error('Generator output did not contain a valid display name');
  }
  return name;
}

export async function scrapeNames({ count = 1, gender = 'random', executablePath } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Count must be 1–20');
  if (!['random', 'masculine', 'feminine'].includes(gender)) throw new Error('Invalid gender option');
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto('https://perchance.org/namegen-as-id', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Verified on the live generator. Do not depend on its changing subdomain.
    const output = page.frameLocator('#outputIframeEl');
    const randomize = output.getByRole('button', { name: 'randomize', exact: true });
    await randomize.waitFor({ state: 'visible' });
    const names = [];
    for (let i = 0; i < count; i++) {
      if (i) await randomize.click();
      const label = (gender === 'random' ? randomInt(2) === 0 : gender === 'masculine') ? 'MASCULINE' : 'FEMININE';
      const row = output.locator('p').filter({ hasText: new RegExp('^\\s*' + label) });
      names.push(extractName(await row.innerText(), label));
    }
    return { source: 'https://perchance.org/namegen-as-id', namingConvention: 'Javanese', names };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await scrapeNames({ count: Number(process.argv[2] || 1), gender: process.argv[3] || 'random', executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    // Failure is explicit: never return a fabricated scrape result or silently
    // substitute the app's local bank. No credentials or profile data are used.
    process.stderr.write('Perchance scrape failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
