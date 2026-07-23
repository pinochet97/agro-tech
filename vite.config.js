import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // Encaminha /api para o backend de cotações (server/cotacoes-proxy.mjs),
    // que consome o CEPEA/ESALQ. Assim o front chama /api/cotacoes sem CORS.
    // Suba os dois juntos com `npm run dev:all`.
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.COTACOES_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
