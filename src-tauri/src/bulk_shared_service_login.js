// Injected only into the target service's WebView during explicit bulk sharing.
// No password entry, CAPTCHA bypass, credential access, or arbitrary link clicks.
(function bulkSharedServiceLogin(service, canClick) {
  const hostnames = {
    claude: ["claude.ai"],
    chatgpt: ["chatgpt.com", "auth.openai.com"],
    leonardo: ["app.leonardo.ai", "leonardo.ai"],
    dola: ["www.dola.com", "dola.com"],
    migoo: ["migoo.ai", "www.migoo.ai"]
  };
  if (!hostnames[service]?.includes(location.hostname) ||
      location.protocol !== "https:" || window.top !== window.self)
    return "waiting";
  const visible = node =>
    node instanceof HTMLElement && node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== "hidden" &&
    !node.closest("[aria-hidden='true'], [inert]");
  const buttons = [...document.querySelectorAll('button, a, [role="button"]')]
    .filter(node => visible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true");
  const title = node => (node.getAttribute("aria-label") || node.innerText ||
    node.textContent || node.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  const google = buttons.filter(node =>
    /^(?:continue|sign in|log in|login|sign up|use|connect) (?:with|using) google$/i.test(title(node)) ||
    /^google$/i.test(title(node)) && !!node.closest("form, [role='dialog']"));
  const entry = buttons.filter(node => /^(?:sign in|log in|login)$/i.test(title(node)));
  // Positive in-app signals only; never use absence of a login button as proof.
  const appSignals = {
    claude: ['a[href^="/new"]', 'a[href^="/recents"]', '[data-testid="new-chat-button"]'],
    chatgpt: ['a[href^="/c/"]', '[data-testid="new-chat-button"]', 'button[aria-label="User menu"]'],
    leonardo: ['a[href*="/generation"]', 'a[href*="/personal-feed"]'],
    dola: ['a[href*="/chat/"]', 'button[aria-label="Profile"]'],
    migoo: ['a[href*="/workspace"]', 'a[href*="/projects/"]']
  };
  const signOut = buttons.some(node => /^(?:log out|sign out)$/i.test(title(node)));
  const insideApp = (appSignals[service] || []).some(selector =>
    [...document.querySelectorAll(selector)].some(visible));
  if (signOut || (insideApp && google.length === 0 && entry.length === 0)) return "signed_in";

  if (!canClick) return "waiting";
  if (google.length === 1 && !window.__flowpilotGoogleClicked) {
    window.__flowpilotGoogleClicked = true;
    google[0].click();
    return "google_clicked";
  }
  // Only enter a conventional sign-in screen; never click ambiguous CTAs.
  if (google.length === 0 && entry.length === 1 && !window.__flowpilotEntryClicked) {
    window.__flowpilotEntryClicked = true;
    entry[0].click();
    return "entry_clicked";
  }
  if (google.length > 1 || entry.length > 1) return "needs_attention";
  return "waiting";
})(__FLOWPILOT_SERVICE__, __FLOWPILOT_CAN_CLICK__);