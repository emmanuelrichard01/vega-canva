/**
 * The presenter view's second window.
 *
 * Opened empty and drawn into by this window, so the presenter view reads the
 * same board, the same show and the same permissions as the presentation it
 * drives: a command from either window is one function call on one store,
 * with no copy of the document to keep in step and nothing to lose in transit.
 * The window takes this page's styles (and any that load later) and its
 * theme, and closes when the show ends.
 *
 * Opened synchronously from the gesture that starts the show, because a
 * browser only lets a click open a window while the click is still current.
 */

export interface PresenterWindow {
  win: Window;
  root: HTMLElement;
  close: () => void;
}

const NAME = 'vega-presenter-view';

export function openPresenterWindow(title: string): PresenterWindow | null {
  if (typeof window === 'undefined') return null;
  const width = Math.min(1440, Math.max(960, Math.round(window.screen.availWidth * 0.7)));
  const height = Math.min(900, Math.max(640, Math.round(window.screen.availHeight * 0.75)));
  const win = window.open('', NAME, `popup=yes,width=${width},height=${height}`);
  if (!win) return null;

  const doc = win.document;
  doc.title = `Presenter view · ${title}`;
  doc.head.replaceChildren();
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.append(charset);

  const copy = (node: Node) => {
    if (node instanceof HTMLStyleElement || (node instanceof HTMLLinkElement && node.rel === 'stylesheet')) {
      doc.head.append(doc.importNode(node, true));
    }
  };
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(copy);
  // Styles that arrive later (a lazily loaded part of the app) follow.
  const mirror = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(copy)));
  mirror.observe(document.head, { childList: true });

  const syncTheme = () => {
    doc.body.className = document.body.className;
    const contrast = document.documentElement.dataset.contrast;
    if (contrast) doc.documentElement.dataset.contrast = contrast;
    else delete doc.documentElement.dataset.contrast;
  };
  syncTheme();
  const theme = new MutationObserver(syncTheme);
  theme.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-contrast'] });

  doc.body.replaceChildren();
  const root = doc.createElement('div');
  root.className = 'pv-host';
  doc.body.append(root);

  return {
    win,
    root,
    close: () => {
      mirror.disconnect();
      theme.disconnect();
      if (!win.closed) win.close();
    },
  };
}
