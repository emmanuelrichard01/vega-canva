import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Modules under `engine/export/` that the live canvas legitimately shares, and
 * which must therefore stay out of the lazy export chunk.
 *
 * Kept in step with the source by `src/engine/export/exportChunking.test.ts`.
 */
const EXPORT_SHARED =
  /\/engine\/export\/(chrome|DocumentImport|restoreDocument|pendingRestore|exportScope|renderScope|isolate)\./;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    /**
     * The Konva vendor chunk sits at ~490 kB gzipped and cannot be split
     * further (it is a single library). The default 500 kB limit triggers a
     * warning on every build for something that is not actionable — raising
     * slightly silences it without hiding real regressions.
     */
    chunkSizeWarningLimit: 550,
    modulePreload: {
      resolveDependencies(_filename, deps, { hostType }) {
        /**
         * Filter out heavy canvas/editor chunks from the eager HTML preload set.
         *
         * Vite's default behaviour emits modulepreload links in index.html for all
         * dependency chunks reachable from any dynamic route in App.tsx. This caused
         * ~919kB of canvas chunks (vendor-konva, app-export, vendor-fontkit, etc.) to be
         * eagerly downloaded on first visit to the dashboard (`/`).
         *
         * Stripping them from index.html ensures the dashboard loads with minimal bytes;
         * when the user opens `/room/:id`, the browser fetches the canvas chunks on demand.
         */
        if (hostType === 'html') {
          return deps.filter(
            (dep) =>
              !dep.includes('vendor-konva') &&
              !dep.includes('app-export') &&
              !dep.includes('vendor-fontkit') &&
              !dep.includes('vendor-motion') &&
              !dep.includes('vendor-sentry') &&
              // The dagre/mermaid diagram engine, 63 kB, reachable only from
              // a board. It survived the first pass of this filter and was
              // the largest thing still being preloaded for a dashboard that
              // cannot draw a diagram.
              !dep.includes('app-diagram') &&
              !dep.includes('app-physics') &&
              !dep.includes('app-pathEdit') &&
              !dep.includes('Room')
          );
        }
        return deps;
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // --- Vendor splits (heaviest first) ---
            if (id.includes('konva') || id.includes('react-konva')) return 'vendor-konva';
            if (id.includes('yjs') || id.includes('@hocuspocus') || id.includes('lib0')) return 'vendor-yjs';
            if (id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('lucide-react')) return 'vendor-icons';
            // Named so it is legible in the bundle report -- rolldown was
            // calling it `esm-<hash>.js`, which is 463 kB of unattributed
            // mystery. It is reached only by the dynamic `import()` in
            // `utils/observability.ts`, so it stays off the critical path.
            if (id.includes('@sentry')) return 'vendor-sentry';
            if (id.includes('matter-js')) return 'vendor-physics';
            if (id.includes('perfect-freehand') || id.includes('polygon-clipping')) return 'vendor-drawing';
            if (id.includes('lodash')) return 'vendor-lodash';
            if (id.includes('rbush')) return 'vendor-spatial';
            /**
             * The font parser, and the Brotli decompressor it carries to read
             * a `.woff2`. Only "Convert to path" on a text object ever needs
             * it, so it is imported dynamically and named here — otherwise it
             * shows up in the build as `browser-module`, which says nothing
             * about what it is or why the bundle grew by 150 kB.
             */
            if (id.includes('fontkit') || id.includes('brotli') || id.includes('unicode-trie') || id.includes('unicode-properties') || id.includes('restructure') || id.includes('/dfa/')) return 'vendor-fontkit';
          }

          // --- Application-level splits for subsystems that are lazily
          //     reachable or heavy enough to justify their own chunk ---
          /**
           * The export engine, minus the parts the live canvas shares with it.
           *
           * This rule used to be `includes('/engine/export/')` with no
           * exceptions, and it quietly put the whole 440kB chunk on the
           * critical path of every board *and* the dashboard. The cause was
           * `chrome.ts`: 47 lines holding the name Konva tags interface nodes
           * with, imported by twelve canvas components, and swept into the
           * lazy chunk along with the PDF writer. One constant was enough to
           * make the entire exporter a dependency of the first frame.
           *
           * These seven modules are shared with the canvas by nature rather
           * than by accident -- they describe what is document and what is
           * chrome, what a selection covers, how a restore lands. They are
           * pure, they total under 900 lines, and none of them reaches an
           * exporter. They belong wherever they are used.
           *
           * `exportChunking.test.ts` holds this: it fails if anything outside
           * `engine/export/` starts importing a module that is not on this
           * list, which is exactly how the regression happened the first time.
           */
          if (id.includes('/engine/export/') && !EXPORT_SHARED.test(id)) return 'app-export';
          if (id.includes('/engine/diagram/')) return 'app-diagram';
          if (id.includes('/engine/physics/')) return 'app-physics';
          if (
            id.includes('/engine/model/pathGeometry') ||
            id.includes('/engine/model/pathBoolean') ||
            id.includes('/engine/model/pathEditing')
          ) return 'app-pathEdit';
          if (
            id.includes('/engine/model/rough.ts') ||
            id.includes('/engine/model/roughShape')
          ) return 'app-rough';
        },
      },
    },
  },
});
