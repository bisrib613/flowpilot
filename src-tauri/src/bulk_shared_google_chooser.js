// Google account chooser for an already-linked Flow session.
// Never fills an email/password, changes accounts, or bypasses verification.
(function bulkSharedGoogleChooser(expected, canClick) {
  if (location.origin !== "https://accounts.google.com" || window.top !== window.self)
    return "waiting";
  const path = location.pathname.toLowerCase();
  if (/\/(?:captcha|recaptcha|sorry)(?:\/|$)/.test(path) ||
      (/\/challenge(?:\/|$)/.test(path) && !/\/challenge\/pwd(?:\/|$)/.test(path)))
    return "needs_attention";
  const isVisible = el => el instanceof HTMLElement && el.getClientRects().length > 0;
  // Google may show a separate OAuth consent screen after the account
  // chooser (e.g. "Login ke Claude" with "Batal" / "Lanjutkan"). This
  // grants a third party access to profile information and MUST NOT be
  // clicked by automation. Signal the desktop app while leaving the
  // popup available for the user to approve or cancel.
  const buttonLabels = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
    .filter(isVisible)
    .map(node => (node.getAttribute('aria-label') || node.innerText ||
      node.textContent || node.value || "").replace(/\\s+/g, " ").trim().toLowerCase());
  const hasApprove = buttonLabels.some(v =>
    /^(?:lanjutkan|continue|izinkan|allow)$/.test(v));
  const hasCancel = buttonLabels.some(v =>
    /^(?:batal|cancel)$/.test(v));
  const consentRoute = /(?:\\/|^)(?:consent|oauthchooseaccount)(?:\\/|$)/i.test(path);
  const summary = (document.body && document.body.innerText || "").slice(0, 5000);
  const consentText = /(?:mengizinkan.{0,100}mengakses|will allow.{0,100}access|sign in to|login ke)/i.test(summary);
  if (hasApprove && (hasCancel || consentRoute || consentText)) return "consent_required";
  const password = [...document.querySelectorAll('input[type="password"]')].some(isVisible);
  if (password) return "invalid_session";
  const candidates = [...document.querySelectorAll('[data-identifier], [data-email]')]
    .filter(isVisible).map(node => ({
      node,
      email: (node.getAttribute("data-identifier") ||
        node.getAttribute("data-email") || "").toLowerCase().trim()
    })).filter(item => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email));
  const unique = new Map();
  candidates.forEach(item => { if (!unique.has(item.email)) unique.set(item.email, item.node); });
  const email = (expected || "").trim().toLowerCase();
  const selected = email ? unique.get(email) :
    unique.size === 1 ? unique.values().next().value : null;
  if (selected) {
    if (canClick && !window.__flowpilotChooserClicked) {
      window.__flowpilotChooserClicked = true;
      (selected.closest('[role="link"], [role="button"], a, button') || selected).click();
      return "chooser_clicked";
    }
    return "waiting";
  }
  if (email && unique.size > 0) return "needs_attention";
  if (unique.size > 1) return "needs_attention";
  if ([...document.querySelectorAll('input[type="email"], input[name="identifierId"]')]
      .some(isVisible)) return "invalid_session";
  return "waiting";
})(__FLOWPILOT_EXPECTED_EMAIL__, __FLOWPILOT_CAN_CLICK__);