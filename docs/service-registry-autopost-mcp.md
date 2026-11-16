# Flowpilot service registry, future autopost and MCP

## Implemented in PR #14

Pinterest (https://www.pinterest.com/) and Threads (https://www.threads.com/) are first-class desktop services. Both use the existing account and WebView lifecycle: add, open, switch, resume, close, and remove profiles. Each has its own browser profile unless the user explicitly selects an existing Flow session to share.

Bulk Add Profile can create Pinterest or Threads accounts linked to Flow sessions. Sign-in is deliberately manual for these two services: do not run a Google login selector that was only audited for other providers, and do not claim they were automatically signed in. Normal standalone profiles work without a Flow session.

The frontend service catalog now lives in src/services/service-registry.ts. Each stable service ID carries display metadata, entry URL, category, and shared sign-in mode. The account store validates IDs against the same catalog. The Rust WebView manager mirrors the supported service URLs and must stay in sync with the catalog.

This change does not implement Pinterest posting, Threads posting, a scheduler, or an MCP endpoint.

## Future shared tools and agent architecture

Separate tool definitions from transport and user interface. Desktop UI, an internal Flowpilot agent, and external MCP clients should all invoke the same operations in a native/core service layer.

### Proposed tool groups

- Profiles: list_services, list_profiles, open_profile, switch_profile, close_profile, profile_status
- Browser: get_page_snapshot, browser_interact, read_page_result, download_result
- Files: list_local_files, resolve_asset, save_asset, read_result
- Posting adapters: validate_draft, attach_media, publish_post, read_post_result, and later schedule_post, cancel_scheduled_post
- Tasks: create_task, get_task_status, cancel_task, list_recent_tasks

Platform-specific posting adapters should share a task orchestration interface but retain their individual post formats, required fields, error handling and service account selection. The actual posting procedures must be implemented and tested against each platform before enabling automated submission.

Each operation should have a stable ID, input/output schema, capability tag, observable status, and a lifecycle contract. Discover profiles dynamically by service ID and profile ID; do not create a hardcoded tool for each account. Keep WebView/browser session reuse in the existing profile manager. Local files should remain ordinary device files unless an explicitly invoked tool transfers their content.

### MCP phase (later)

Expose the shared registry through a local MCP Streamable HTTP adapter; use Tailscale Funnel or another HTTPS tunnel as a transport configuration, not as another implementation of the tools. The future in-app agent can call the registry in-process without any tunnel.

## Scope control

Do not refactor the currently working Google relogin, profile directory sharing, or native download flow as part of adding Pinterest and Threads. Build this foundation first, then implement autopost in a separate increment, and MCP exposure afterward.

## Asset attribution

Social platform icons bundled locally from the Simple Icons project (CC0): https://github.com/simple-icons/simple-icons . Trademarks remain owned by their respective brands.
