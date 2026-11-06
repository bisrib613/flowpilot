import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

export const source = 'https://www.random-name-generator.com/indonesia?s=334&search_terms=&gender=female&search_terms=&n=10';
export const nameSelector = 'button.btn-copy-name[data-clipboard-text]';

export function validateNames(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) throw new Error('Missing or unexpected name list');
  return values.map(value => {
    const name = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
    if (!name || name.length > 100 || !/^[\p{L}\p{M}][\p{L}\p{M} '\u2019-]*$/u.test(name)) {
      throw new Error('Invalid display name in source output');
    }
    return name;
  });
}

export async function scrapeNames({ executablePath } = {}) {
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator(nameSelector).first().waitFor({ state: 'attached' });
    // The source URL includes s=334. Let the site's own form generate a fresh
    // batch rather than treating a fixed URL as a guarantee of fresh output.
    await Promise.all([
      page.waitForURL(url => url.toString() !== source, { timeout: 15000 }),
      page.getByRole('button', { name: /Generate Random Name/ }).click(),
    ]);
    await page.locator(nameSelector).first().waitFor({ state: 'attached' });
    const values = await page.locator(nameSelector).evaluateAll(elements =>
      elements.map(el => el.getAttribute('data-clipboard-text')));
    return { source: 'https://www.random-name-generator.com/indonesia', gender: 'female', names: validateNames(values) };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await scrapeNames({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH })) + '\n');
  } catch (error) {
    process.stderr.write('Name scrape failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
