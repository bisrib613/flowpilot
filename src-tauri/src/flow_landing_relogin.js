// Invoked only for a Flow profile which landed on its public /about page.
// Click the known sign-in entry once. Never enter credentials here.
(function flowpilotBeginRecognizedReLogin() {
  if (window.location.origin !== "https://flow.google.com" ||
      window.location.pathname !== "/about") return;
  if (window.__flowpilotReLoginClicked) return;
  const started = Date.now();
  const matcher = /^(?:create with google flow|try (?:google )?flow|start creating|sign in(?: with google)?)(?:\b|$)/i;

  const isVisible = (element) =>
    element instanceof HTMLElement && element.getClientRects().length > 0;
  const label = (element) =>
    (element.getAttribute("aria-label") || element.textContent || "")
      .replace(/\s+/g, " ").trim();

  let observer;
  const clickKnownEntry = () => {
    const candidates = Array.from(document.querySelectorAll(
      'a, button, [role="button"]'
    ));
    const button = candidates.find((element) =>
      isVisible(element) && !element.disabled &&
      matcher.test(label(element))
    );
    if (!button) return false;
    window.__flowpilotReLoginClicked = true;
    observer?.disconnect();
    button.click();
    return true;
  };

  if (clickKnownEntry()) return;
  observer = new MutationObserver(() => {
    if (clickKnownEntry() || Date.now() - started > 12_000) {
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement || document, {
    subtree: true, childList: true
  });
})();
