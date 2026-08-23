import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    // Event-day tablets may run very old Android WebView (Android 6.0.1
    // era). esbuild's default target ships ES2020 syntax (e.g. `??`)
    // untranspiled, which is a hard parse-time SyntaxError on engines that
    // old - and since the whole app ships as a single JS chunk, that error
    // would take down every route, not just event mode. es2015 keeps native
    // async/await, classes, arrow functions etc (no regenerator bloat) while
    // downleveling newer syntax - not going all the way to es5 per product
    // decision.
    target: 'es2015',
  },
  plugins: [react()],
});
