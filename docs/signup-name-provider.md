# Shared signup name provider

`src/services/signup-name.ts` exposes the global `generateIndonesianName()` helper using Faker 10.6.0's `person.fullName()` with locale `id_ID`. The official locale-specific import is loaded on demand and bundled locally. No API key, CDN, scraping or network request is used to generate the name.

Bulk sign-in supplies one generated local candidate to the native command. The backend uses it only after a recognized signup adapter requests a name. ChatGPT is connected now; future service adapters can use the same helper and native provider. Existing accounts are unchanged. Full names may contain localized prefixes, suffixes or repeated name parts, as returned by Faker; they are not guaranteed unique identities. The previous handwritten 512-combination bank has been removed.

An optional saved key takes priority over an environment key. API failures, invalid responses or timeouts fall back to local generation. The explicit Disable setting disables both sources; Use local names re-enables local generation and overrides an environment key. A credential-store read failure remains an error so a saved Disable preference is not silently ignored. No API credential is bundled in source or this preview.

The ChatGPT signup flow uses age 27 only when its age field is empty. If the generator is disabled or local generation fails, it retains its Google/profile-name fallback. API requests still occur only when the signup form requests a name. IPC candidates are validated again in Rust before use.

Validation: production frontend build and all 87 existing JS checks pass. A 1,000-name exercise with fetch replaced by a throwing function passed, producing 998 distinct valid names with no fetch requests in that run. The locale chunk is about 469 kB (180 kB gzip), loaded on demand. The main bundle remains about 205 kB. Rust tests cover source precedence, disable/local re-enable, API payload validation and IPC name validation; the current environment lacks a Rust compiler, so execution requires the Windows job. The Faker MIT license is included in `public/licenses/faker-LICENSE.txt`.
