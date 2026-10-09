import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { pageHtml, PUBLIC_PAGES, sitemapXml } from './src/engine/share/sitePages.ts';

/**
 * Where the site lives, for every absolute URL a crawler reads.
 *
 * Canonical links, `og:url`, `og:image` and the sitemap all have to be
 * absolute, and none of them can be derived from the page at runtime —
 * crawlers read the HTML before any script runs. `VITE_SITE_URL` overrides it
 * for a preview deployment or a custom domain.
 */
const DEFAULT_SITE_URL = 'https://vscanva.vercel.app';

/**
 * Put the site URL into `index.html`, and write `robots.txt` and `sitemap.xml`.
 *
 * ## Why boards are not disallowed in robots.txt
 *
 * A board's address is its key, so boards must never be *indexed* — but
 * disallowing `/room/` in robots.txt is the wrong way to say so, twice over.
 * A disallowed URL can still be indexed from links to it, just without its
 * content, because the crawler is forbidden from fetching the page that would
 * have told it not to. And X and LinkedIn honour robots.txt for link previews,
 * so it would take the card off every board shared there. Boards are kept out
 * of search with an `X-Robots-Tag: noindex` header instead (`vercel.json`),
 * which every search engine honours and no unfurler cares about.
 */
function siteMeta(siteUrl: string): Plugin {
  const site = siteUrl.replace(/\/+$/, '');
  return {
    name: 'vega-site-meta',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', site),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        // The public pages only. Boards are private by address.
        source: sitemapXml(site),
      });
    },
  };
}

/**
 * Each public page as its own copy of the built `index.html`, with its own
 * title, description, canonical and card (`src/engine/share/sitePages.ts`).
 * After the HTML plugin, so the copy carries the real script and style tags.
 */
function publicPages(siteUrl: string): Plugin {
  const site = siteUrl.replace(/\/+$/, '');
  return {
    name: 'vega-public-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') {
        this.warn('index.html was not in the bundle; public pages not written');
        return;
      }
      const html = String(index.source);
      for (const page of PUBLIC_PAGES) {
        this.emitFile({ type: 'asset', fileName: `${page.path.slice(1)}.html`, source: pageHtml(html, site, page) });
      }
    },
  };
}

/**
 * Modules under `engine/export/` that the live canvas legitimately shares, and
 * which must therefore stay out of the lazy export chunk.
 *
 * Kept in step with the source by `src/engine/export/exportChunking.test.ts`.
 */
const EXPORT_SHARED =
  /\/engine\/export\/(chrome|DocumentImport|restoreDocument|pendingRestore|exportScope|renderScope|isolate|ExportTypes|filenames|abort|commentPins|markup|nodesToSvg|stickyExport|svgPaint|svgShadow)\./;

/**
 * Modules the dashboard (`Home.tsx`) imports that board-only chunks also
 * import. Listed by file rather than by folder: a folder such as
 * `components/menu/` also holds the canvas menus, which would come with it.
 */
const LIBRARY_SHARED = new RegExp(
  [
    '/components/menu/(Menu|menuModel|shortcuts)\\.',
    '/components/ui/Avatar\\.',
    '/engine/presence/collaborators\\.',
    '/engine/cursor/remoteCursor\\.',
    '/engine/model/(stickyThemes|stacking|connector|connectorAnchor|previewPaint|boardPreview)\\.',
    '/engine/model/connectorRouter/(curve|pathOps|router|geometry)\\.',
    '/engine/chart/expression\\.',
    '/engine/room/roomCode\\.',
    '/engine/export/(filenames|ExportTypes|DocumentImport|pendingRestore)\\.',
  ].join('|')
);

/** Module ids with Windows separators folded to `/`, so one pattern serves both. */
const posixId = (id: string) => id.replace(/\\/g, '/');
const inPackage = (...names: string[]) => {
  const pattern = new RegExp(`/node_modules/(${names.join('|')})/`);
  return (id: string) => pattern.test(posixId(id));
};
const inSource = (pattern: RegExp) => (id: string) => pattern.test(posixId(id));

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    siteMeta(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || DEFAULT_SITE_URL),
    publicPages(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL || DEFAULT_SITE_URL),
  ],
  // The loopback IP rather than `localhost`: Spotify accepts only 127.0.0.1 as a
  // local redirect, and sign-in must start on the origin it returns to.
  // `npm run dev -- --host` still serves the LAN.
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    /**
     * The largest chunk is `vendor-sentry` (~475 kB raw, ~156 kB gzipped),
     * reached only through the dynamic `import()` in `utils/observability.ts`.
     * It is a single library and off the critical path, so the limit sits just
     * above it rather than warning on every build.
     */
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        /**
         * Named chunks, by priority.
         *
         * Each group also captures its modules' dependencies, so the order
         * matters: a module goes to the highest-priority group that wants it.
         * React, the store and the CRDT come first because the entry needs
         * them; left to a lower group they were captured by the export chunk,
         * and the dashboard had to import the exporter and Konva to render.
         *
         * `scripts/check-bundle.mjs` asserts the result: no `app-*` chunk and
         * no Konva is statically reachable from the entry.
         */
        codeSplitting: {
          groups: [
            { name: 'vendor-react', priority: 100, test: inPackage('react', 'react-dom', 'scheduler', 'zustand', 'use-sync-external-store') },
            { name: 'vendor-yjs', priority: 90, test: inPackage('yjs', '@hocuspocus/provider', '@hocuspocus/common', 'lib0', 'y-indexeddb', 'y-protocols') },
            { name: 'vendor-konva', priority: 80, test: inPackage('konva', 'react-konva', 'react-konva-utils', 'react-reconciler', 'its-fine') },
            { name: 'vendor-motion', priority: 80, test: inPackage('framer-motion', 'motion-dom', 'motion-utils') },
            { name: 'vendor-icons', priority: 80, test: inPackage('lucide-react') },
            // Reached only by the dynamic `import()` in `utils/observability.ts`.
            { name: 'vendor-sentry', priority: 80, test: inPackage('@sentry', '@sentry-internal') },
            { name: 'vendor-physics', priority: 80, test: inPackage('matter-js') },
            { name: 'vendor-drawing', priority: 80, test: inPackage('perfect-freehand', 'polygon-clipping') },
            { name: 'vendor-lodash', priority: 80, test: inPackage('lodash') },
            { name: 'vendor-spatial', priority: 80, test: inPackage('rbush', 'quickselect') },
            // The font parser and the Brotli decompressor it needs for `.woff2`;
            // only "Convert to path" on a text object loads it.
            { name: 'vendor-fontkit', priority: 80, test: inPackage('fontkit', 'brotli', 'unicode-trie', 'unicode-properties', 'restructure', 'dfa', 'tiny-inflate', 'clone', 'fast-deep-equal') },
            /**
             * Application code the entry needs to render at all: the store,
             * the document layer, the app shell. Captured here, above the
             * engine groups, so an engine chunk that shares one of these
             * modules cannot claim it and drag itself onto the entry path.
             */
            { name: 'shell', priority: 50, tags: ['$initial'] },
            /**
             * What the dashboard shares with the board's panels. Above the
             * `app-*` groups, which would otherwise capture these as their own
             * dependencies — the menu went to `app-toolbar` and the connector
             * geometry behind template covers to `app-export` — and make the
             * dashboard download the toolbar and the exporter to render.
             */
            { name: 'lib-shared', priority: 20, test: inSource(LIBRARY_SHARED) },
            /**
             * The export engine, minus the modules the live canvas shares with
             * it (`EXPORT_SHARED`). One shared constant left in the export
             * chunk is enough to make the whole exporter a dependency of the
             * first frame; `exportChunking.test.ts` holds the list in step with
             * the source.
             */
            {
              name: 'app-export',
              priority: 10,
              test: (id: string) => inSource(/\/engine\/export\//)(id) && !EXPORT_SHARED.test(posixId(id)),
            },
            { name: 'app-diagram', priority: 10, test: inSource(/\/engine\/diagram\//) },
            { name: 'app-physics', priority: 10, test: inSource(/\/engine\/physics\//) },
            { name: 'app-pathEdit', priority: 10, test: inSource(/\/engine\/model\/(pathGeometry|pathBoolean|pathEditing)/) },
            { name: 'app-rough', priority: 10, test: inSource(/\/engine\/model\/(rough\.ts|roughShape)/) },
            { name: 'app-templates', priority: 10, test: inSource(/\/engine\/templates\//) },
            // Board panels, so the board route downloads as several parallel
            // pieces instead of one 800 kB chunk. Safe now that `shell` holds
            // everything the entry needs above them.
            { name: 'app-toolbar', priority: 10, test: inSource(/\/components\/(ObjectContextToolbar|toolbar\/)/) },
            { name: 'app-layers', priority: 10, test: inSource(/\/components\/LayersPanel/) },
            { name: 'app-properties', priority: 10, test: inSource(/\/components\/(PropertiesPanel|panel\/)/) },
            { name: 'app-learn', priority: 10, test: inSource(/\/components\/learn\//) },
            { name: 'app-table', priority: 10, test: inSource(/\/components\/table\//) },
          ],
        },
      },
    },
  },
}));
