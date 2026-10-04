/**
 * @project FabriHub - Front
 * @file vite.config.ts
 * @description Configuración de Vite (alias al estilo DaviHub y proxy /api en desarrollo)
 *
 * En `npm run dev` las llamadas a /api van al contenedor `front` (http://localhost:8080),
 * que a su vez hace de proxy a la API. Así el desarrollo usa la API real sin publicarla.
 */

import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_DEV_API_TARGET ?? "http://localhost:8080", changeOrigin: true }
    }
  },
  resolve: {
    alias: {
      "@": r("./src"),
      "@global": r("./src/global"),
      "@assets": r("./src/global/assets"),
      "@atoms": r("./src/global/atoms"),
      "@clients": r("./src/global/clients"),
      "@config": r("./src/global/config"),
      "@modules": r("./src/global/modules"),
      "@store": r("./src/global/store"),
      "@utils": r("./src/global/utils"),
      "@navigation": r("./src/navigation"),
      "@layouts": r("./src/layouts"),
      "@auth": r("./src/app/auth"),
      "@dashboard": r("./src/app/dashboard"),
      "@admin": r("./src/app/admin")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"]
  }
} as Parameters<typeof defineConfig>[0]);
