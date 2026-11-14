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
    const labels = el => [el.getAttribute('data-name'), el.getAttribute('data-filename'), el.getAttribute('title'),
        el.getAttribute('aria-label'), ...(el.innerText || '').split('\n')].filter(Boolean)
        .map(value => value.trim().replace(/^@/, ''));
    const hasName = (el, names) => labels(el).some(label => names.includes(label));
    const hasMention = (names, count) => !!editor && [...editor.querySelectorAll('[contenteditable="false"]')]
        .filter(chip => hasName(chip, names)).length >= count;
    const mentionInput = () => all(document, '#add-menu-input, .cdk-overlay-pane input[aria-label="Telusuri aset"], .cdk-overlay-pane input[aria-label="Search assets"], .cdk-overlay-pane input[placeholder="Telusuri aset"], .cdk-overlay-pane input[placeholder="Search assets"]')[0];
    const controlPoint = button => {
        if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
        button.scrollIntoView({block: 'nearest', inline: 'nearest'});
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return button.contains(document.elementFromPoint(x, y)) ? {x, y} : null;
    };
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
    const videoKey = url => new URL(url).pathname;
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
        case 'project':
            return !!editor || click(document.querySelector('flow-projects-page > button[mat-fab][extended]:has(mat-icon)'));
        case 'settings':
            return visible(settings) || click(document.querySelector('flow-base-prompt-box button.settings-trigger-button'));
        case 'mode': return click(icon(data));
        case 'modelMenu': return !!exact(document, 'flow-menu-item .label', data) || click(settings?.querySelector('button.mat-mdc-menu-trigger'));
        case 'model': return click(exact(document, 'flow-menu-item .label', data)?.closest('flow-menu-item')?.querySelector('button[mat-menu-item]'));
        case 'duration':
        case 'outputCount': {
            if (!visible(settings)) return null;
            const pattern = action === 'duration' ? /^(\d+)\s*(?:dtk|detik|s|secs?|seconds?)$/i : /^x(\d+)$/i;
            const options = all(settings, 'flow-toggles mat-button-toggle').flatMap(toggle => {
                const label = toggle.querySelector('.toggle-text')?.textContent.trim();
                const match = label?.match(pattern);
                const button = toggle.querySelector('button[role="radio"]');
                return match && button ? [{ value: Number(match[1]), label, button }] : [];
            });
            const target = options.find(option => option.value === data);
            if (!target) return null;
            if (target.button.getAttribute('aria-checked') === 'true') return true;
            click(target.button);
            return null;
        }
        case 'toggleOptions':
            return all(settings || document, 'flow-toggles .toggle-text').map(el => el.textContent.trim());
        case 'closeSettings':
            return !visible(settings) || click(document.querySelector('flow-base-prompt-box button.settings-trigger-button'));
        case 'addTarget': {
            const controls = all(document, 'header button[aria-label]')
                .filter(button => /^(Menu tambahkan media|Add media(?: menu)?)$/i.test(button.getAttribute('aria-label')));
            return controls.length === 1 ? controlPoint(controls[0]) : null;
        }
        case 'uploadMenuReady': return visible(document.querySelector('[role="menu"].add-menu'));
        case 'uploadTarget': {
            const structural = all(document, '[role="menu"].add-menu flow-menu-item[xapfileselectortrigger] button[mat-menu-item]');
            const labeled = all(document, '[role="menu"].add-menu button')
                .filter(button => labels(button).some(label => /^(upload|upload media|unggah media)$/i.test(label)));
            const candidates = structural.length ? structural : labeled;
            return candidates.length === 1 ? controlPoint(candidates[0]) : null;
        }
        case 'submitTarget': {
            const buttons = all(document, 'flow-base-prompt-box button[aria-label]')
                .filter(button => /^(Start generation|Mulai pembuatan)$/i.test(button.getAttribute('aria-label')));
            return buttons.length === 1 ? controlPoint(buttons[0]) : null;
        }
        case 'asset': {
            if (visible(document.querySelector('flow-upload-consent-dialog'))) return 'consent-required';
            const tiles = all(document, 'flow-grid-tile-container').filter(tile =>
                hasName(tile, data.names));
            if (tiles.length !== 1) return null;
            const tile = tiles[0];
            tile.setAttribute('data-flowpilot-reference', '');
            const video = tile.querySelector('video');
            const image = tile.querySelector('img[src]');
            const ready = data.kind === 'video'
                ? video?.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0
                : !!(image?.complete && image.naturalWidth);
            return ready ? (labels(tile).find(label => data.names.includes(label)) || data.names[0]) : null;
        }
        case 'focus': if (!editor) return false; editor.focus(); return true;
        case 'mentionSearch': {
            const input = mentionInput();
            if (!visible(input)) return false;
            input.focus();
            return true;
        }
        case 'mentionSelect': {
            const input = mentionInput();
            const root = input?.closest('.cdk-overlay-pane, [role="dialog"]') || document;
            if (!visible(input) || root === document) return false;
            const candidates = all(root, '[role="option"], flow-menu-item, button')
                .filter(el => hasName(el, data));
            const options = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
            return options.length === 1 && click(options[0]);
        }
        case 'mentionAttached':
            return !visible(mentionInput()) && hasMention(data.names, data.count);
        case 'submitReady': {
            if (!visible(editor) || visible(mentionInput())) return false;
            const normalize = text => text.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/gu, ' ').trim();
            // Read rendered text with inline mention chips removed. Keep block breaks.
            const text = node => {
                if (node.nodeType === 3) return node.nodeValue || '';
                if (node.nodeType !== 1 || node.matches('[contenteditable="false"]')) return ' ';
                if (node.tagName === 'BR') return ' ';
                const content = [...node.childNodes].map(text).join('');
                return /^(DIV|P|LI)$/.test(node.tagName) ? ' ' + content + ' ' : content;
            };
            return normalize(text(editor)) === normalize(data.body)
                && data.mentions.every(mention => hasMention(mention.names, mention.count));
        }
        case 'beforeSubmit':
            resultTiles().forEach(tile => tile.setAttribute('data-flowpilot-previous', ''));
            return [...new Set(resultTiles().map(videoUrl).filter(Boolean).map(videoKey))];
        case 'downloadStart': return (async () => {
            const url = new URL(data);
            if (url.origin !== 'https://flow-content.google' || !url.pathname.startsWith('/video/')) throw Error('Unexpected Flow video URL');
            const response = await fetch(url, {credentials: 'include', signal: AbortSignal.timeout(20000)});
            if (!response.ok) throw Error('Flow video download HTTP ' + response.status);
            if (!/^(video\/|application\/octet-stream)/i.test(response.headers.get('content-type') || '')) throw Error('Expected a video response');
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            try {
                for (;;) {
                    const {done, value} = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > 128 * 1024 * 1024) throw Error('Flow clip exceeds 128 MiB');
                    chunks.push(value);
                }
            } finally {
                await reader.cancel();
            }
            if (!size) throw Error('Empty Flow video');
            window.__flowpilotMotionDownload = new Blob(chunks);
            return size;
        })();
        case 'downloadChunk': return (async () => {
            const bytes = new Uint8Array(await window.__flowpilotMotionDownload.slice(data, data + 262144).arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            return btoa(binary);
        })();
        case 'downloadClear': delete window.__flowpilotMotionDownload; return true;
        case 'submission':
        case 'result': {
            const newTiles = resultTiles().filter(tile => !tile.hasAttribute('data-flowpilot-previous'));
            const urls = [...new Set(newTiles.map(videoUrl).filter(url => url && !data.includes(videoKey(url))))];
            if (urls.length === 1) return {status: 'complete', url: urls[0]};
            if (urls.length > 1) return {status: 'ambiguous'};
            const hasState = (tile, selector) => tile.matches(selector) || !!tile.querySelector(selector);
            if (newTiles.some(tile => hasState(tile, '.error-tile, flow-error-tile, .error-message-text'))) return {status: 'error'};
            if (action === 'submission' && newTiles.some(tile => hasState(tile, 'flow-pending-tile, .loading-percentage, .progress-bar, [role="progressbar"]'))) return {status: 'pending'};
            return null;
        }
        default: throw Error('Unknown Flow action');
    }
}
