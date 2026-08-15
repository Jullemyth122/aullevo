/* 
   SHADOW DOM TOAST SYSTEM — fully isolated from page CSS
*/

let _toastShadowRoot: ShadowRoot | null = null;

function getToastShadowRoot(): ShadowRoot {
    if (_toastShadowRoot) return _toastShadowRoot;

    const TOAST_HOST_ID = 'aullevo-toast-host';
    let toastHost = document.getElementById(TOAST_HOST_ID);
    if (!toastHost) {
        toastHost = document.createElement('div');
        toastHost.id = TOAST_HOST_ID;
        toastHost.style.cssText =
            'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
        document.body.appendChild(toastHost);
    }

    const shadow = toastHost.shadowRoot || toastHost.attachShadow({ mode: 'open' });
    if (!shadow.querySelector('style')) {
        const style = document.createElement('style');
        style.textContent = `
            #aullevo-toast {
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 360px;
                padding: 12px 20px;
                border-radius: 12px;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
                font-size: 13px;
                font-weight: 500;
                color: #fff;
                box-shadow: 0 8px 32px rgba(0,0,0,0.35);
                pointer-events: none;
                line-height: 1.5;
                opacity: 0;
                transform: translateY(-8px);
                transition: opacity 0.25s ease, transform 0.25s ease;
                z-index: 1;
            }
            #aullevo-toast.visible {
                opacity: 1;
                transform: translateY(0);
            }
        `;
        shadow.appendChild(style);
    }

    _toastShadowRoot = shadow;
    return shadow;
}

let _toastEl: HTMLElement | null = null;
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(text: string, type: 'info' | 'success' | 'error' = 'info', duration = 4500) {
    const shadow = getToastShadowRoot();

    if (!_toastEl) {
        _toastEl = document.createElement('div');
        _toastEl.id = 'aullevo-toast';
        shadow.appendChild(_toastEl);
    }

    const colors: Record<string, string> = {
        info: 'linear-gradient(135deg, #3B82F6, #6366F1)',
        success: 'linear-gradient(135deg, #10B981, #059669)',
        error: 'linear-gradient(135deg, #EF4444, #DC2626)',
    };

    _toastEl.style.background = colors[type];
    _toastEl.textContent = text;
    _toastEl.classList.remove('visible');
    void _toastEl.offsetHeight;
    _toastEl.classList.add('visible');

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => hideToast(), duration);
}

export function hideToast() {
    if (_toastEl) _toastEl.classList.remove('visible');
}
