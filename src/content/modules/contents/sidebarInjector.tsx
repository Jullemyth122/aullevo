import { createRoot } from 'react-dom/client';
import Sidebar from '../../Sidebar';

/* 
   REACT SIDEBAR INJECTION (Shadow DOM)
*/

export function injectSidebar() {
    const HOST_ID = 'aullevo-sidebar-host';
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('assets/content.css');
    shadowRoot.appendChild(link);

    const rootElement = document.createElement('div');
    rootElement.id = 'aullevo-react-root';
    rootElement.style.pointerEvents = 'auto';
    shadowRoot.appendChild(rootElement);

    const root = createRoot(rootElement);
    root.render(<Sidebar />);
}
