import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend smoke tests. The server suite is Node-only, so until now NOTHING
// exercised the React app: `tsc -b && vite build` proves it compiles, not that
// it runs. A React major bump sailed through CI on exactly that gap.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    css: false,
    restoreMocks: true,
  },
});
