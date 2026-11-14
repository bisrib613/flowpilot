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
    const avatar = () => all(document, 'flow-header-user-icon, button[aria-label*="Google Account" i], button[aria-label*="Akun Google" i]')[0];
    const creditPanel = () => all(document, 'flow-account-panel, [cdktrapfocus][role="dialog"]').find(panel =>
        panel.matches('flow-account-panel') || panel.querySelector('span.credits-count'));
    const editor = document.querySelector('flow-rich-text-editor .ProseMirror[contenteditable="true"], .prosemirror-editor .ProseMirror[contenteditable="true"]');
    const settings = document.querySelector('flow-prompt-box-settings');
    const resultTiles = () => all(document, 'flow-a2ui-message-renderer flow-a2ui-video-option, flow-grid-tile-container')
        .filter(tile => !tile.hasAttribute('data-flowpilot-reference'));
    const videoUrl = tile => {
        const media = tile.querySelector('video[src], video source[src]');
        try {
            const url = new URL(media?.currentSrc || media?.src);
            return url.protocol === 'https:' && url.hostname === 'flow-content.google' && url.pathname.startsWith('/video/') ? url.href : null;
        } catch { return null; }
    };
    switch (action) {
        case 'openCredits': {
            const panel = creditPanel();
            if (visible(panel)) return true;
            const control = avatar();
            return click(control?.querySelector('button, [role="button"]') || control);
        }
        case 'credits': {
            const balance = creditPanel()?.querySelector('span.credits-count');
            const match = visible(balance) && (balance.innerText || '').trim().match(/^[0-9]+(?:[,.][0-9]{3})*/);
            return match ? Number(match[0].replace(/[,.]/g, '')) : null;
        }
        case 'closeCredits': {
            const panel = creditPanel();
            return !visible(panel) || click(panel.querySelector('button.close-btn, button[aria-label="Close account panel"]'));
        }
        case 'creditsClosed': return !creditPanel();
        case 'session':
            if (/^\/about\/?$/.test(location.pathname)) return 'login-required';
            return avatar() || visible(editor) || all(document, 'flow-projects-page > button[mat-fab][extended]').length ? 'ready' : null;
        case 'normalMode': {
            const panel = document.querySelector('flow-agent-panel');
            return !visible(panel) || click(panel.querySelector('.agent-panel-header .header-right button:nth-child(2)'));
        }
        case 'normalReady': return !visible(document.querySelector('flow-agent-panel'));
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
        case 'asset': {
            if (visible(document.querySelector('flow-upload-consent-dialog'))) return 'consent-required';
            const tiles = all(document, 'flow-grid-tile-container').filter(tile =>
                (tile.innerText + ' ' + (tile.getAttribute('aria-label') || '')).includes(data));
            if (tiles.length !== 1) return null;
            const tile = tiles[0];
            tile.setAttribute('data-flowpilot-reference', '');
            const video = tile.querySelector('video');
            const image = tile.querySelector('img[src]');
            return video ? !!(video.currentSrc || video.src || video.querySelector('source[src]'))
                : !!(image?.complete && image.naturalWidth);
        }
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
        case 'submitReady': return !!editor && (!!editor.innerText.trim() || !!editor.querySelector('[contenteditable="false"]'));
        case 'beforeSubmit':
            resultTiles().forEach(tile => tile.setAttribute('data-flowpilot-previous', ''));
            return true;
        case 'result': {
            const newTiles = resultTiles().filter(tile => !tile.hasAttribute('data-flowpilot-previous'));
            const urls = [...new Set(newTiles.map(videoUrl).filter(Boolean))];
            if (urls.length === 1) return urls[0];
            if (newTiles.some(tile => tile.querySelector('.error-tile, flow-error-tile, .error-message-text'))) return {error: true};
            return null;
        }
        default: throw Error('Unknown Flow action');
    }
}
