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