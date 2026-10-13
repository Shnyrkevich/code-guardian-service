import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the page calls /graphql on its own origin and Vite forwards it to the backend,
// so the backend needs no CORS setup. Point it elsewhere with API_TARGET=http://host:port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/graphql': process.env['API_TARGET'] ?? 'http://localhost:3000' },
  },
});
