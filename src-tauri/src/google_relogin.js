// Only the already-recognized Google account chooser is automated.
// No email entry, fresh login, CAPTCHA, challenge, or verification handling.
(function flowpilotReauth(email, password) {
  if (window.location.origin !== "https://accounts.google.com" ||
      window.self !== window.top || !password) return;

  const armKey = "flowpilot-recognized-reauth";
  const maxAge = 90 * 1000;
  const expected = typeof email === "string" ? email.trim().toLowerCase() : "";
  let finished = false;
  let observer;
  const isVisible = (element) =>
    element instanceof HTMLElement && element.getClientRects().length > 0;

  // A normal password challenge can use /challenge/pwd; never block that
  // route. Everything else needing an extra Google challenge is left alone.
  const isVerificationChallenge = () => {
    const pathname = window.location.pathname || "";
    if (/\\/(?:captcha|recaptcha|sorry)(?:\\/|$)/i.test(pathname)) return true;
    if (/\\/challenge(?:\\/|$)/i.test(pathname) &&
        !/\\/challenge\\/pwd(?:\\/|$)/i.test(pathname)) return true;
    const widgets = document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], ' +
      '[data-sitekey], .g-recaptcha, .h-captcha, [aria-label*="captcha" i]'
    );
    return Array.from(widgets).some(isVisible);
  };

  function run() {
    if (finished) return;
    if (isVerificationChallenge()) {
      // Skip this profile. Never click account/password controls or retry.
      sessionStorage.removeItem(armKey);
      finished = true;
      observer?.disconnect();
      return;
    }
    let armed = null;
    try {
      armed = JSON.parse(sessionStorage.getItem(armKey) || "null");
      if (armed && (Date.now() - armed.timestamp > maxAge ||
          (expected && armed.email !== expected))) {
        sessionStorage.removeItem(armKey);
        armed = null;
      }
    } catch (_) {
      sessionStorage.removeItem(armKey);
    }

    if (armed) {
      const input = document.querySelector('input[type="password"]');
      const next = document.querySelector("#passwordNext");
      if (!isVisible(input) || !isVisible(next)) return;
      // The password page is permitted only after this tab selected a
      // previously recognized identity. Never enter a username.
      finished = true;
      observer?.disconnect();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )?.set;
      if (!setter) return;
      setter.call(input, password);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      sessionStorage.removeItem(armKey);
      const button = next.querySelector("button") || next;
      button.click();
      return;
    }

    const nodes = Array.from(document.querySelectorAll(
      "[data-identifier], [data-email]"
    ));
    const choices = new Map();
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const value = (node.getAttribute("data-identifier") ||
        node.getAttribute("data-email") || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
      if (!choices.has(value)) choices.set(value, node);
    }
    const choice = expected
      ? choices.get(expected)
      : choices.size === 1 ? choices.values().next().value : null;
    if (!choice) return; // Never guess between multiple identities.
    const pickedEmail = expected || choices.keys().next().value;
    finished = true;
    observer?.disconnect();
    sessionStorage.setItem(armKey, JSON.stringify({
      email: pickedEmail, timestamp: Date.now()
    }));
    (choice.closest('[role="link"], [role="button"], button, a') || choice).click();
  }

  const start = Date.now();
  observer = new MutationObserver(() => {
    if (Date.now() - start > 20000) {
      observer.disconnect();
      return;
    }
    run();
  });
  observer.observe(document.documentElement || document, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ["data-identifier", "data-email", "type"]
  });
  run();
})(__FLOWPILOT_EMAIL__, __FLOWPILOT_PASSWORD__);
