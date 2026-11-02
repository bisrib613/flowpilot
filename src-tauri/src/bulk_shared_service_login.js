// Injected only into the target service's WebView during explicit bulk sharing.
// No password entry, CAPTCHA bypass, credential access, or arbitrary link clicks.
(function bulkSharedServiceLogin(service, canClick, fallbackName) {
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
  const path = location.pathname;
  // Service-side CAPTCHA lives in the opener after Google's popup closes.
  if ([...document.querySelectorAll('iframe[title="hCaptcha challenge"], iframe[title="recaptcha challenge expires in two minutes"]')].some(visible))
    return "verification_required";
  if (service === "claude" && !canClick && !window.__flowpilotGoogleClicked && /^(?:\/login|\/logout)(?:\/|$)/.test(path) &&
      new URLSearchParams(location.search).get("reauth") === "1")
    return "reauth_required";
  const buttons = [...document.querySelectorAll('button, a, [role="button"]')]
    .filter(node => visible(node) && !node.disabled && node.getAttribute("aria-disabled") !== "true" && node.getAttribute("aria-busy") !== "true");
  const title = node => (node.getAttribute("aria-label") || node.innerText ||
    node.textContent || node.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  const google = buttons.filter(node =>
    service === "claude" && node.getAttribute("data-testid") === "login-with-google" ||
    /^(?:continue|sign in|log in|login|sign up|use|connect) (?:with|using) google$/i.test(title(node)) ||
    /^google$/i.test(title(node)) && !!node.closest("form, [role='dialog']"));
  const entry = buttons.filter(node => /^(?:sign in|log in|login)$/i.test(title(node)));
  // Observed OpenAI signup: keep Google's populated name; use the linked
  // profile name only when it is empty. The owner's requested signup age is 27.
  // Act only on this exact HTTPS host/route, never on arbitrary number inputs.
  if (service === "chatgpt" && location.hostname === "auth.openai.com" && path === "/about-you") {
    const names = [...document.querySelectorAll('input[name="name"]')].filter(visible);
    const ages = [...document.querySelectorAll('input[name="age"]')].filter(visible);
    const submit = buttons.filter(node => node.getAttribute("type") === "submit" && title(node) === "Continue");
    if (names.length !== 1 || ages.length !== 1 || submit.length !== 1 ||
        names[0].disabled || ages[0].disabled) return "signup_required";
    if (window.__flowpilotSignupClicked) return "waiting";
    const name = names[0].value.trim() || (fallbackName || "").trim();
    if (!name) return "signup_required";
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (!names[0].value.trim()) setValue(names[0], name);
    if (!ages[0].value) setValue(ages[0], "27");
    if (!names[0].checkValidity() || !ages[0].checkValidity()) return "signup_required";
    if (!window.__flowpilotSignupPrepared) {
      window.__flowpilotSignupPrepared = true;
      return "signup_filled";
    }
    window.__flowpilotSignupClicked = true;
    submit[0].click();
    return "signup_clicked";
  }
  // The welcome dialog appears over an already-rendered account shell. Finish
  // this observed stage before reporting success; don't click arbitrary Continue.
  if (service === "chatgpt" && location.hostname === "chatgpt.com") {
    const welcome = [...document.querySelectorAll('dialog, [role="dialog"]')].filter(node =>
      visible(node) && /(?:^|\n)You[’']re all set(?:\n|$)/.test(node.innerText || node.textContent || ""));
    if (welcome.length) {
      if (welcome.length !== 1) return "onboarding_required";
      const next = [...welcome[0].querySelectorAll("button")].filter(node =>
        visible(node) && !node.disabled && title(node) === "Continue");
      if (next.length !== 1) return "onboarding_required";
      if (window.__flowpilotWelcomeClicked) return "waiting";
      window.__flowpilotWelcomeClicked = true;
      next[0].click();
      return "onboarding_clicked";
    }
  }
  // Positive in-app signals only; never use absence of a login button as proof.
  const appSignals = {
    claude: ['a[href^="/new"]', 'a[href^="/recents"]', '[data-testid="new-chat-button"]'],
    chatgpt: ['a[href^="/c/"]', 'button[aria-label="User menu"]', 'button[aria-label="Open profile menu"]'],
    leonardo: ['a[href*="/generation"]', 'a[href*="/personal-feed"]'],
    dola: ['a[href*="/chat/"]', 'button[aria-label="Profile"]'],
    migoo: ['a[href*="/workspace"]', 'a[href*="/projects/"]']
  };
  const signOut = buttons.some(node => /^(?:log out|sign out)$/i.test(title(node)));
  const insideApp = (appSignals[service] || []).some(selector =>
    [...document.querySelectorAll(selector)].some(visible));
  if (service === "chatgpt" && insideApp && google.length === 0 && entry.length === 0 &&
      [...document.querySelectorAll('dialog, [role="dialog"]')].some(visible))
    return "onboarding_required";
  const authRoute = /^(?:\/login|\/logout|\/auth)(?:\/|$)/.test(path) ||
    service === "chatgpt" && location.hostname !== "chatgpt.com";
  if (!authRoute && (signOut || (insideApp && google.length === 0 && entry.length === 0))) return "signed_in";

  if (!canClick) return "waiting";
  if (google.length === 1 && !window.__flowpilotGoogleClicked) {
    window.__flowpilotGoogleClicked = true;
    google[0].click();
    return "google_clicked";
  }
  // Duplicate Log in controls are normal on ChatGPT (banner + sidebar).
  // Scope entry to the banner when present, instead of treating them as ambiguity.
  if (service === "chatgpt" && google.length === 0 && !window.__flowpilotEntryClicked) {
    const bannerEntry = entry.filter(node => node.closest('header, [role="banner"]'));
    if (bannerEntry.length === 1) {
      window.__flowpilotEntryClicked = true;
      bannerEntry[0].click();
      return "entry_clicked";
    }
  }
  // Only enter a conventional sign-in screen; never click ambiguous CTAs.
  if (google.length === 0 && entry.length === 1 && !window.__flowpilotEntryClicked) {
    window.__flowpilotEntryClicked = true;
    entry[0].click();
    return "entry_clicked";
  }
  if (google.length > 1 || entry.length > 1) return "needs_attention";
  return "waiting";
})(__FLOWPILOT_SERVICE__, __FLOWPILOT_CAN_CLICK__, __FLOWPILOT_PROFILE_NAME__);
