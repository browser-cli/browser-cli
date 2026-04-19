import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    sdk: 'src/sdk.ts',
    postinstall: 'src/postinstall.ts',
  },
  format: ['esm'],
  target: 'node22',
  dts: { entry: 'src/sdk.ts' },
  clean: true,
  splitting: false,
  shims: false,
  sourcemap: true,
  banner: ({ format }) => {
    if (format === 'esm') return { js: '#!/usr/bin/env node' }
    return {}
  },
})
