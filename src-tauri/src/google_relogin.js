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
    // Do not leave the shared password in a field if a challenge appears.
    if (passwordFillStarted) {
      const current = passwordControl();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      )?.set;
      if (current && setter) {
        setter.call(current, "");
        current.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
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
    // Google commonly wraps the real button inside #passwordNext. Resolve
    // the actual clickable descendant, not just the wrapper div.
    const roots = Array.from(document.querySelectorAll(
      '#passwordNext, #signIn'
    )).filter(isVisible);
    if (roots.length !== 1) return null;
    const root = roots[0];
    const button = root.matches('button, input[type="submit"]')
      ? root : root.querySelector('button, input[type="submit"], [role="button"]');
    if (!button || !isVisible(button)) return null;
    return button;
  }

  const buttonReady = (button) =>
    button && !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    !button.closest("[inert], [aria-disabled='true']");
  let passwordFillStarted = false;
  let nextAttemptStartedAt = 0;
  let nextCheckScheduled = false;

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

    if (!passwordFillStarted) {
      passwordFillStarted = true;
      nextAttemptStartedAt = Date.now();
      // Keep the observer alive: Google's password view may rerender and
      // its Next button can remain disabled while input is processed.
      input.focus?.();
      setter.call(input, password);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const checkNext = () => {
      nextCheckScheduled = false;
      if (finished) return;
      if (isVerificationChallenge()) {
        const current = passwordControl();
        if (current) {
          setter.call(current, "");
          current.dispatchEvent(new Event("input", { bubbles: true }));
        }
        skipVerification();
        return;
      }
      if (getArmedIdentity()?.email !== armed.email) { stop(); return; }

      // Allow Google's controlled form to settle before submit; query the
      // button again because its DOM node may have been replaced.
      const currentInput = passwordControl();
      const currentButton = submitControl();
      const elapsed = Date.now() - nextAttemptStartedAt;
      if (currentInput && currentInput.isConnected &&
          currentInput.value === password && buttonReady(currentButton) &&
          elapsed >= 350) {
        // Click ONCE. Never auto-retry a submission or bypass challenges.
        sessionStorage.removeItem(armKey);
        stop();
        currentButton.click();
        return;
      }
      if (elapsed >= 6500) {
        // Leave the filled form for a manual Next click rather than guessing.
        stop();
        return;
      }
      scheduleNextCheck();
    };

    const scheduleNextCheck = () => {
      if (nextCheckScheduled || finished) return;
      nextCheckScheduled = true;
      setTimeout(checkNext, 250);
    };
    scheduleNextCheck();
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
    attributeFilter: ["data-identifier", "data-email", "type",
      "class", "style", "hidden", "aria-hidden", "disabled"]
  });
  run();
})(__FLOWPILOT_EMAIL__, __FLOWPILOT_PASSWORD__);
