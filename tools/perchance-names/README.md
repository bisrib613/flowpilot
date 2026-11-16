# Perchance name scraper

## Alternative source

```sh
node random-name-generator.mjs
```

This reads only `button.btn-copy-name[data-clipboard-text]` on the supplied Indonesian female-name generator, avoiding the accompanying fake addresses, phone numbers, emails and payment data. It invokes Generate Random Name once for a fresh batch instead of assuming repeated visits to a URL with fixed `s=334` will change the output. A live browser check observed the URL change to `s=72` and ten different names. No claim of guaranteed uniqueness is made.

Direct HTTP retrieval from the current execution environment returned 403 (1010); its ordinary browser page loaded and generated names. No HTTP-only integration or successful standalone headless run is claimed. The Perchance script's standalone local navigation also failed with ERR_EMPTY_RESPONSE, while the Cloud Browser selectors and randomize behavior were verified. Both scripts are browser-backed tools, not yet providers bundled into the EXE. Site restrictions cause explicit failure; no challenge solving or bypass is implemented.

This standalone browser scraper reads the rendered output of the owner's chosen [generator](https://perchance.org/namegen-as-id). It uses no API key and does not scrape real people's profiles. The generator describes its names as following Javanese naming customs. It is not a representative dataset for all Indonesian naming traditions.

```sh
cd tools/perchance-names
npm install
npx playwright install chromium
node scrape.mjs 5 random
```

Arguments: count (1–20), then `random`, `masculine`, or `feminine`. Output is one JSON object with `source`, `namingConvention`, and `names`. Failures exit nonzero. Repeats are possible. The scraper loads one page and clicks randomize between results. Its browser closes on success and failure. It uses no stored user sessions. `CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium executable.

The live iframe, labeled name paragraphs and randomize button were inspected and the output was observed changing after clicking randomize. This tool is separate from the desktop provider: the packaged EXE does not bundle Node, Playwright or a second Chromium runtime. Integrating it into the application requires a browser-backed provider and lifecycle/error handling; simply fetching the outer HTML does not establish access to generated names. The app's local fallback remains operational.
