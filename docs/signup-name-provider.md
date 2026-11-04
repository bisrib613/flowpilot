# Shared signup name provider

`name_generator::random_indonesian_name()` is independent of any service selector. ChatGPT's observed signup adapter currently calls it. Future adapters for Claude or other services can use the same backend provider when they identify their own name field; this change does not claim those selectors exist.

Without a configured API key, the provider uses the bundled Indonesian name bank. A UUID v4 supplies random bits to select one of 512 two-part combinations. It works offline and generates display names, not identities scraped from people. Repeats are possible and names are not unique account identifiers.

An optional saved key takes priority over an environment key. API failures, invalid responses or timeouts fall back to local generation. The explicit Disable setting disables both sources; Use local names re-enables local generation and overrides an environment key. A credential-store read failure remains an error so a saved Disable preference is not silently ignored. No API credential is bundled in source or this preview.

The existing ChatGPT signup flow requests a name only on the recognized signup form, keeps existing accounts unchanged, and uses age 27 only when its age field is empty. If the generator is disabled, it retains its Google/profile-name fallback.

Validation: frontend production build and existing JS checks run locally. Rust tests cover source precedence, disabling/local re-enable, API payload validation, and all 512 local combinations. The current environment lacks a Rust compiler; execution of these Rust tests requires the Windows job.
