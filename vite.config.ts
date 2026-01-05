import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

import sigilProofHandler from "./api/proof/sigil.js";
import sigilSealHandler from "./api/sigils/seal.js";
import sigilIdHandler from "./api/sigils/[id].js";

const USE_EXTERNAL_PROOF_API = process.env.SIGIL_PROOF_API === "external";
const PROOF_API_TARGET = process.env.SIGIL_PROOF_API_URL ?? "http://localhost:8787";
const SIGIL_API_TARGET = process.env.SIGIL_API_URL ?? "http://localhost:8787";
const USE_LOCAL_SIGIL_API = !process.env.SIGIL_API_URL;

function sigilProofApi(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      // allow preflight
      if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      try {
        await sigilProofHandler(req as unknown, res as unknown);
        if (!res.writableEnded) next();
      } catch (error) {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Proof handler failed" }));
        }
        next(error);
      }
    })().catch(next);
  };

  return {
    name: "sigil-proof-api",
    configureServer(server) {
      server.middlewares.use("/api/proof/sigil", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/proof/sigil", handler);
    },
  };
}

function localSigilApi(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;

      // support both /sigils/* and /api/sigils/*
      if (p === "/sigils/seal" || p === "/api/sigils/seal") {
        await sigilSealHandler(req as unknown, res as unknown);
        if (!res.writableEnded) next();
        return;
      }

      const m = p.match(/^\/(?:api\/)?sigils\/([^/]+)\.svg$/);
      if (m) {
        (req as Connect.IncomingMessage & { query?: Record<string, string> }).query = { id: m[1] };
        await sigilIdHandler(req as unknown, res as unknown);
        if (!res.writableEnded) next();
        return;
      }

      next();
    })().catch(next);
  };

  return {
    name: "local-sigil-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(() => {
  const proxy: Record<string, { target: string; changeOrigin: boolean; rewrite?: (path: string) => string }> = {};

  // Only proxy sigils if we are NOT running local sigil api
  if (!USE_LOCAL_SIGIL_API) {
    proxy["/sigils"] = { target: SIGIL_API_TARGET, changeOrigin: true };
    proxy["/api/sigils"] = { target: SIGIL_API_TARGET, changeOrigin: true };
  }

  // Only proxy proof if we are using external proof api
  if (USE_EXTERNAL_PROOF_API) {
    proxy["/api/proof/sigil"] = { target: PROOF_API_TARGET, changeOrigin: true };
  }

  const proxyConfig = Object.keys(proxy).length ? { proxy } : undefined;

  return {
    resolve: {
      alias: {
        html2canvas: "/src/shims/html2canvas.ts",
      },
    },

    server: proxyConfig,
    preview: proxyConfig,

    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["verahai-icon.svg", "phi.svg"],
        manifest: {
          name: "Verahai · SigilMarkets",
          short_name: "Verahai",
          description: "SigilMarkets for Kairos glyph prophecy markets.",
          theme_color: "#0f1115",
          background_color: "#0f1115",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/verahai-icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "maskable any",
            },
          ],
        },
      }),

      // Local proof endpoint unless explicitly external
      ...(USE_EXTERNAL_PROOF_API ? [] : [sigilProofApi()]),

      // Local sigil endpoints unless SIGIL_API_URL is set
      ...(USE_LOCAL_SIGIL_API ? [localSigilApi()] : []),
    ],
  };
});
