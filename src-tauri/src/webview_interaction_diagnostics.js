// Diagnostic builds only. Clipboard write probes delegate to the original API;
// never read arguments, clipboard data, chat text, or error messages.
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
  const errorCategory = error => {
    try {
      const name = error?.name;
      return ['NotAllowedError', 'SecurityError', 'TypeError', 'AbortError'].includes(name) ? name : 'other';
    } catch (_) { return 'other'; }
  };
  // A site can catch a write rejection, so unhandledrejection alone misses it.
  // Observe settlement and rethrow the SAME error to the caller. Do not retry,
  // change permissions, read the clipboard, or substitute a native copy action.
  const observeWrite = (owner, method, synchronous = false) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(owner, method);
      if (!descriptor || typeof descriptor.value !== 'function') {
        send('probe-unavailable', method);
        return;
      }
      const original = descriptor.value;
      Object.defineProperty(owner, method, { ...descriptor, value: function (...args) {
        // execCommand is shared with edit operations. Only observe copy.
        if (synchronous && args[0] !== 'copy') return Reflect.apply(original, this, args);
        send('write-start', method);
        let result;
        try { result = Reflect.apply(original, this, args); }
        catch (error) { send('write-error', errorCategory(error)); throw error; }
        if (synchronous) {
          send(result === true ? 'write-ok' : 'write-false', method);
          return result;
        }
        let timer;
        // Chaining preserves success/rejection and does not swallow a rejection
        // the site would otherwise leave unhandled. Promise identity/timing can
        // differ in this diagnostic build; this is not a production fix.
        timer = setTimeout(() => send('write-pending', method), 3000);
        return Promise.prototype.then.call(result, value => {
          clearTimeout(timer);
          send('write-ok', method);
          return value;
        }, error => {
          clearTimeout(timer);
          send('write-error', errorCategory(error));
          throw error;
        });
      } });
      send('probe-installed', method);
    } catch (_) { send('probe-unavailable', method); }
  };
  if (typeof Clipboard !== 'undefined') {
    observeWrite(Clipboard.prototype, 'writeText');
    observeWrite(Clipboard.prototype, 'write');
  } else {
    send('probe-unavailable', 'writeText');
    send('probe-unavailable', 'write');
  }
  if (typeof Document !== 'undefined') observeWrite(Document.prototype, 'execCommand', true);
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
    send('rejection', errorCategory(event.reason));
  });
  // Observe legacy execCommand copy without reading ClipboardEvent data.
  document.addEventListener('copy', event => {
    queueMicrotask(() => send('copy-event', 'document', event.defaultPrevented, event.isTrusted));
  }, { capture: true, passive: true });
  for (const type of ['focus', 'blur']) window.addEventListener(type, () => send(type, 'document'));
  document.addEventListener('visibilitychange', () => send('visibility', 'document'));
  send('ready', 'document');
})();
