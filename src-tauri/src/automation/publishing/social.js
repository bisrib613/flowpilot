(action, data) => {
    const visible = el => !!el?.getClientRects().length;
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    const label = el => (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    const find = (root, selector, labels) => all(root, selector).find(el => labels.includes(label(el)));
    const click = el => {
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        el.click();
        return true;
    };
    const set = (el, text) => {
        if (!el) return false;
        if (el.isContentEditable && el.innerText.trim() === text.trim()) return true;
        el.focus();
        if (el.isContentEditable) {
            const transfer = new DataTransfer();
            transfer.setData('text/plain', text);
            el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true}));
            if (!el.innerText && text) document.execCommand('insertText', false, text);
            return el.innerText.trim() === text.trim();
        }
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return el.value === text;
    };
    const dialog = all(document, '[role="dialog"]').at(-1);
    const inputs = dialog ? all(dialog, '[data-lexical-editor="true"][contenteditable="true"]') : [];
    const buttons = 'button, [role="button"]';
    const linkPattern = data.platform === 'pinterest' ? /^\/pin\/\d+\/?$/ : /^\/@[^/]+\/post\/[^/]+\/?$/;
    const links = () => all(document, 'a[href]').map(a => new URL(a.href))
        .filter(url => url.origin === location.origin && linkPattern.test(url.pathname))
        .map(url => url.origin + url.pathname);
    switch (action) {
        case 'pinFields': {
            const title = document.querySelector('input[data-test-id="editor-title"], [id*="storyboard-selector-title"]');
            const description = document.querySelector('[data-test-id="editor-description"] [contenteditable="true"], .public-DraftEditor-content[contenteditable="true"]');
            const link = document.querySelector('[data-test-id="editor-link"], input[id*="storyboard-selector-link"]');
            return set(title, data.title) && (!data.description || set(description, data.description))
                && (!data.url || set(link, data.url));
        }
        case 'pinBoard': {
            const trigger = document.querySelector('[data-test-id="board-dropdown-select-button"]');
            return click(trigger?.matches('button') ? trigger : trigger?.querySelector('button'));
        }
        case 'selectBoard': {
            const board = data.board.trim().toLowerCase();
            return click(all(document, '[data-test-id="board-row"], [role="option"], [role="menuitem"]').find(el => label(el) === board));
        }
        case 'pinSubmit': {
            const boardControl = document.querySelector('[data-test-id="board-dropdown-select-button"]');
            if (!boardControl || boardControl.textContent.trim().toLowerCase() !== data.board.trim().toLowerCase()) return false;
            return click(find(document, 'button', ['publish', 'terbitkan']));
        }
        case 'threadOpen':
            return !!dialog || click(find(document, buttons, ['create', 'buat', 'new thread', 'thread baru', "what's new?", 'apa yang baru?']));
        case 'threadReady':
            return !!inputs.length;
        case 'threadTopicOpen':
            return !!dialog && click(find(dialog, buttons, ['add a topic', 'tambahkan topik']));
        case 'threadTopicFill':
            return !!dialog && set(dialog.querySelector('input[placeholder*="topic" i], input[placeholder*="topik" i]'), data.topic);
        case 'threadTopicSelect':
            return !!dialog && click(find(dialog, '[role="option"], button', [data.topic.toLowerCase()]));
        case 'threadText':
            return set(inputs[data.index], data.text);
        case 'threadAttach':
            return !!dialog && (dialog.querySelector('input[type="file"]') ||
                click(dialog.querySelector('svg[aria-label*="media" i], svg[aria-label*="attach" i], svg[aria-label*="lampir" i]')?.closest(buttons))) ? true : false;
        case 'threadPreview':
            return !!dialog && (!!dialog.querySelector('video') || all(dialog, 'img').some(img => img.complete && img.height > 120));
        case 'threadAdd':
            return !!dialog && click(find(dialog, buttons, ['add to thread', 'tambahkan ke utas', 'tambah ke utas']));
        case 'threadSubmit':
            return !!dialog && click(find(dialog, buttons, ['post', 'posting', 'kirim']));
        case 'links':
            return links();
        case 'receipt': {
            const status = all(document, '[role="status"], [role="alert"], [aria-live="polite"]');
            const fresh = [...new Set(status.flatMap(el => all(el, 'a[href]').map(a => new URL(a.href)))
                .filter(url => url.origin === location.origin && linkPattern.test(url.pathname))
                .map(url => url.origin + url.pathname).filter(url => !data.previous.includes(url)))];
            if (linkPattern.test(location.pathname)) {
                const direct = location.origin + location.pathname;
                if (!data.previous.includes(direct)) return direct;
            }
            return fresh.length === 1 ? fresh[0] : null;
        }
        default:
            throw Error('Unknown publishing action');
    }
}
