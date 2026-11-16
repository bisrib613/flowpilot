(() => {
  if (window.top !== window.self || location.protocol !== 'https:' ||
      !['claude.ai', 'chatgpt.com'].includes(location.hostname) ||
      !window.chrome?.webview || !navigator.clipboard) return;
  const original = navigator.clipboard.writeText;
  if (typeof original !== 'function') return;
  let gestureAt = -Infinity;
  const arm = event => {
    if (event.isTrusted && document.visibilityState === 'visible') gestureAt = performance.now();
  };
  document.addEventListener('click', arm, true);
  document.addEventListener('keydown', arm, true);
  const pending = new Map();
  chrome.webview.addEventListener('message', event => {
    const message = event.data;
    if (message?.kind !== 'flowpilot-copy-result') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.ok ? entry.resolve() : entry.reject(new DOMException('Clipboard is unavailable. Try copying again.', 'NotAllowedError'));
  });
  navigator.clipboard.writeText = function (text) {
    // Preserve normal API behavior outside an explicit foreground user action.
    const eligible = this === navigator.clipboard && typeof text === 'string' &&
      text.length <= 1_000_000 && performance.now() - gestureAt < 1500 &&
      document.visibilityState === 'visible';
    if (!eligible) return original.call(this, text);
    gestureAt = -Infinity;
    const receiver = this;
    return new Promise((resolve, reject) => {
      let settled = false;
      let recovering = false;
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ok ? resolve(value) : reject(value);
      };
      const recover = () => {
        if (settled || recovering) return;
        recovering = true;
        const id = crypto.randomUUID();
        const fail = error => finish(false, error);
        const timeout = setTimeout(() => {
          pending.delete(id);
          fail(new DOMException('Clipboard recovery timed out. Try again.', 'TimeoutError'));
        }, 3000);
        pending.set(id, {resolve: () => finish(true), reject: fail, timer: timeout});
        try { chrome.webview.postMessage({kind: 'flowpilot-copy-text', id, text}); }
        catch (error) { clearTimeout(timeout); pending.delete(id); fail(error); }
      };
      const timer = setTimeout(recover, 1800);
      try {
        Promise.resolve(original.call(receiver, text)).then(
          value => { if (!recovering) finish(true, value); },
          error => {
            if (['NotAllowedError', 'AbortError', 'UnknownError'].includes(error?.name)) recover();
            else finish(false, error);
          }
        );
      } catch (error) { finish(false, error); }
    });
  };
})();
