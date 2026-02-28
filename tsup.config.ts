import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  esmModules: true,
  emitTypes: true,
  shims: false,
  loader: {
    '.ts': 'ts'
  }
});
