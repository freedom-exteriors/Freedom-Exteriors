import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser only ever talks to its own origin: /api/* is proxied to the API here, and
// rewritten to the Railway API by Vercel in production (vercel.json). That keeps the
// session cookie first-party (SameSite=Lax) with no CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3001",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
