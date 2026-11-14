(action, data) => {
    const visible = el => !!el?.getClientRects().length;
    const all = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
    const exact = (root, selector, text) => all(root, selector).find(el => (el.innerText || '').trim() === text);
    const click = el => {
        if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        el.click();
        return true;
    };
    const icon = name => exact(document, 'flow-prompt-box-settings mat-icon', name)?.closest('button, [role="button"]');
    const editor = document.querySelector('flow-rich-text-editor .ProseMirror[contenteditable="true"], .prosemirror-editor .ProseMirror[contenteditable="true"]');
    const settings = document.querySelector('flow-prompt-box-settings');
    const videoLinks = () => [...new Set([...document.querySelectorAll('video, video source')].map(el => el.currentSrc || el.src)
        .filter(src => { try { const url = new URL(src); return url.protocol === 'https:' && url.hostname === 'flow-content.google' && url.pathname.startsWith('/video/'); } catch { return false; } }))];
    switch (action) {
        case 'uploadInput': return !!document.querySelector('input[type=file]');
        case 'project':
            return !!editor || click(document.querySelector('flow-projects-page > button[mat-fab][extended]:has(mat-icon)'));
        case 'settings':
            return visible(settings) || click(document.querySelector('flow-base-prompt-box button.settings-trigger-button'));
        case 'mode': return click(icon(data));
        case 'modelMenu': return !!exact(document, 'flow-menu-item .label', data) || click(settings?.querySelector('button.mat-mdc-menu-trigger'));
        case 'model': return click(exact(document, 'flow-menu-item .label', data)?.closest('flow-menu-item')?.querySelector('button[mat-menu-item]'));
        case 'duration': return click(all(settings || document, 'flow-toggles button, flow-toggles [role="button"]').find(el => /^10(?:\s*(?:s|sec|seconds|detik))?$/i.test(el.innerText.trim())));
        case 'closeSettings':
            return !visible(settings) || click(document.querySelector('flow-base-prompt-box button.settings-trigger-button'));
        case 'add': return !!document.querySelector('[role="menu"].add-menu') || click(document.querySelector('header .header-right-container button:first-child'));
        case 'upload': return click(document.querySelector('[role="menu"].add-menu flow-menu-item[xapfileselectortrigger] button[mat-menu-item]'));
        case 'asset': return all(document, 'flow-grid-tile-container').some(tile =>
            (tile.innerText + ' ' + (tile.getAttribute('aria-label') || '')).includes(data));
        case 'focus': if (!editor) return false; editor.focus(); return true;
        case 'mentionSearch': {
            const input = document.querySelector('#add-menu-input');
            if (!visible(input)) return false;
            input.focus();
            return true;
        }
        case 'mentionSelect': {
            const input = document.querySelector('#add-menu-input');
            const root = input?.closest('.cdk-overlay-pane, [role="dialog"]') || document;
            return click(all(root, '[role="option"], button, flow-menu-item').find(el => {
                const text = (el.innerText || '').trim();
                return text === data || text.startsWith(data + '\n');
            }));
        }
        case 'mentions': return !!editor && editor.querySelectorAll('[contenteditable="false"]').length >= data;
        case 'submitReady': return !!editor && editor.innerText.includes(data);
        case 'links': return videoLinks();
        case 'result': {
            const fresh = videoLinks().filter(url => !data.includes(url));
            if (fresh.length === 1) return fresh[0];
            if (all(document, 'flow-error-tile, .error-tile, .error-message-text').length) return {error: true};
            return null;
        }
        default: throw Error('Unknown Flow action');
    }
}
