import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // --- Vendor splits (heaviest first) ---
            if (id.includes('konva') || id.includes('react-konva')) return 'vendor-konva';
            if (id.includes('yjs') || id.includes('@hocuspocus') || id.includes('lib0')) return 'vendor-yjs';
            if (id.includes('framer-motion')) return 'vendor-motion';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('matter-js')) return 'vendor-physics';
            if (id.includes('perfect-freehand') || id.includes('polygon-clipping')) return 'vendor-drawing';
            if (id.includes('lodash')) return 'vendor-lodash';
            if (id.includes('rbush')) return 'vendor-spatial';
          }

          // --- Application-level splits for subsystems that are lazily
          //     reachable or heavy enough to justify their own chunk ---
          if (id.includes('/engine/export/')) return 'app-export';
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
