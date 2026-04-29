import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages 배포 시 base 경로 — repo 이름과 동일
const isProd = process.env.NODE_ENV === "production";

// 빌드 시각 — 헤더 버전 표시 + 강제 갱신 비교용
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: isProd ? "/portfolio-web/" : "/",
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "포트폴리오",
        short_name: "포트폴리오",
        description: "내 주식 포트폴리오 — 토스 라이브 가격 + 수급",
        theme_color: "#1f2937",
        background_color: "#f6f7f9",
        display: "standalone",
        start_url: "/portfolio-web/",
        scope: "/portfolio-web/",
        orientation: "any",
        lang: "ko",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // 프록시 응답은 캐시 — 짧은 TTL
        runtimeCaching: [
          {
            urlPattern: /workers\.dev\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "proxy-api",
              expiration: { maxAgeSeconds: 60, maxEntries: 100 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
});
