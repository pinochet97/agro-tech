import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // Quando existir um backend de cotações (fase futura), aponte
    // VITE_COTACOES_ENDPOINT para /api e descomente o proxy abaixo
    // para consumir CEPEA/B3 em dev sem esbarrar em CORS:
    //
    // proxy: {
    //   "/api": {
    //     target: "http://localhost:8787",
    //     changeOrigin: true,
    //     rewrite: (p) => p.replace(/^\/api/, ""),
    //   },
    // },
  },
});
