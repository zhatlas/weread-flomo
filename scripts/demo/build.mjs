import { build } from 'vite';

// A classic script also runs from an extracted ZIP under file://.
await build({
  configFile: false, publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"', fetch: 'window.demoFetch' },
  build: {
    rollupOptions: { external: ['node:crypto'] },
    license: { fileName: 'licenses.txt' },
    outDir: 'demo/assets', emptyOutDir: true, minify: 'esbuild',
    lib: { entry: 'scripts/demo/entry.js', name: 'ReadingDemo', formats: ['iife'], fileName: () => 'workspace.js', cssFileName: 'workspace' },
  },
});
