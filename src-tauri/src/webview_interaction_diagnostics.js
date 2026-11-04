// Diagnostic builds only. Observe interaction without replacing clipboard APIs,
// cancelling events, changing focus, or recording page/clipboard contents.
(() => {
  if (window !== window.top || location.protocol !== 'https:' ||
      !['claude.ai', 'chatgpt.com', 'flow.google.com'].includes(location.hostname)) return;
  let recentCopyAt = -Infinity;
  const send = (event, control, prevented = false, trusted = false, hit = false) => {
    try {
      window.chrome?.webview?.postMessage([
        'flowpilot-interaction', event, control,
        Number(document.hasFocus()), Number(document.visibilityState === 'visible'),
        Number(navigator.userActivation?.isActive === true), Number(prevented),
        Number(trusted), Number(hit),
      ].join('|'));
    } catch (_) { /* Diagnostics must never disrupt the page. */ }
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(type, event => {
      const button = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null;
      if (!button) return;
      const labels = ['aria-label', 'title', 'data-testid'].map(name => button.getAttribute(name) || '').join(' ');
      const control = /copy|clipboard|salin/i.test(labels) ? 'copy' : 'other';
      if (control === 'copy') recentCopyAt = performance.now();
      const hit = button.contains(document.elementFromPoint(event.clientX, event.clientY));
      queueMicrotask(() => send(type, control, event.defaultPrevented, event.isTrusted, hit));
    }, { capture: true, passive: true });
  }
  window.addEventListener('unhandledrejection', event => {
    if (performance.now() - recentCopyAt > 5000) return;
    const name = event.reason?.name;
    send('rejection', ['NotAllowedError', 'SecurityError', 'TypeError', 'AbortError'].includes(name) ? name : 'other');
  });
  for (const type of ['focus', 'blur']) window.addEventListener(type, () => send(type, 'document'));
  document.addEventListener('visibilitychange', () => send('visibility', 'document'));
  send('ready', 'document');
})();
