// Automatic re-login only for an account already listed by Google.
// No entering an email address, fresh login, CAPTCHA handling or retries.
(function flowpilotReauth(email, password) {
  if (window.location.origin !== "https://accounts.google.com" ||
      window.self !== window.top || !password) return;

  const armKey = "flowpilot-recognized-reauth";
  const maxAge = 90_000;
  const expected = typeof email === "string" ? email.trim().toLowerCase() : "";
  let finished = false;
  let observer;

  const isVisible = (element) =>
    element instanceof HTMLElement && element.getClientRects().length > 0;

  function isVerificationChallenge() {
    const pathname = window.location.pathname || "";
    if (/\/(?:captcha|recaptcha|sorry)(?:\/|$)/i.test(pathname)) return true;
    // The ordinary Google password step has /challenge/pwd in its URL.
    if (/\/challenge(?:\/|$)/i.test(pathname) &&
        !/\/challenge\/pwd(?:\/|$)/i.test(pathname)) return true;
    const captchas = document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], ' +
      'iframe[title*="captcha" i], [data-sitekey], .g-recaptcha, ' +
      '.h-captcha, [aria-label*="captcha" i]'
    );
    return Array.from(captchas).some(isVisible);
  }

  function stop() {
    finished = true;
    observer?.disconnect();
  }

  function skipVerification() {
    sessionStorage.removeItem(armKey);
    stop();
  }

  function getArmedIdentity() {
    let armed;
    try {
      armed = JSON.parse(sessionStorage.getItem(armKey) || "null");
    } catch (_) {
      sessionStorage.removeItem(armKey);
      return null;
    }
    if (!armed) return null;
    if (typeof armed.email !== "string" ||
        typeof armed.timestamp !== "number" ||
        Date.now() - armed.timestamp < 0 ||
        Date.now() - armed.timestamp > maxAge ||
        (expected && armed.email !== expected)) {
      sessionStorage.removeItem(armKey);
      return null;
    }
    return armed;
  }

  function passwordControl() {
    const fields = Array.from(document.querySelectorAll(
      'input[name="Passwd"], input[type="password"], #Passwd'
    )).filter((node) =>
      node instanceof HTMLInputElement &&
      node.type === "password" && !node.disabled && isVisible(node)
    );
    // Never guess which password field to fill.
    return fields.length === 1 ? fields[0] : null;
  }

  function submitControl() {
    const candidates = Array.from(document.querySelectorAll(
      '#passwordNext, #signIn'
    )).filter(isVisible);
    if (candidates.length !== 1) return null;
    const root = candidates[0];
    const button = root.matches("button") ? root :
      root.querySelector("button, [role='button']");
    return button || root;
  }

  function selectRecognizedAccount() {
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
    if (!choice) return;
    const selectedEmail = expected || choices.keys().next().value;
    const clickable = choice.closest('[role="link"], [role="button"], button, a') || choice;
    sessionStorage.setItem(armKey, JSON.stringify({
      email: selectedEmail, timestamp: Date.now()
    }));
    // Do NOT stop the observer: Google may render its password step without
    // a full page navigation. The same observer must see that transition.
    clickable.click();
  }

  function submitRecognizedPassword(armed) {
    const input = passwordControl();
    const button = submitControl();
    if (!input || !button) return;

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    )?.set;
    if (!setter) return;
    stop(); // Prevent duplicate submits when the input triggers DOM mutations.
    setter.call(input, password);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Give Google's UI time to process input events before clicking Next.
    setTimeout(() => {
      if (isVerificationChallenge()) {
        setter.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        sessionStorage.removeItem(armKey);
        return;
      }
      if (!input.isConnected || input.value !== password ||
          getArmedIdentity()?.email !== armed.email) return;
      sessionStorage.removeItem(armKey);
      button.click();
    }, 140);
  }

  function run() {
    if (finished) return;
    if (isVerificationChallenge()) {
      skipVerification();
      return;
    }
    const armed = getArmedIdentity();
    if (armed) {
      submitRecognizedPassword(armed);
      return;
    }
    selectRecognizedAccount();
  }

  const started = Date.now();
  observer = new MutationObserver(() => {
    if (Date.now() - started > 25_000) {
      stop();
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
