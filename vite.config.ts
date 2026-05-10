import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// GitHub Pages 배포 시 base 경로 — repo 이름과 동일
const isProd = process.env.NODE_ENV === "production";

// 빌드 시각 — 헤더 버전 표시 + 강제 갱신 비교용
const BUILD_TIME = new Date().toISOString();

// 빌드 시점의 git short hash — 헤더 버전 배지에 표시
let COMMIT_HASH = "unknown";
try {
  COMMIT_HASH = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString().trim();
} catch { /* git 없거나 repo 아닌 환경 — 그대로 unknown */ }

export default defineConfig({
  base: isProd ? "/portfolio-web/" : "/",
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __COMMIT_HASH__: JSON.stringify(COMMIT_HASH),
  },
  plugins: [
    react(),
    // version.json 생성 — 클라이언트가 폴링해서 새 버전 감지용
    // build: dist/version.json, dev: public/version.json (vite 가 public 자동 서빙)
    {
      name: "write-version-json",
      buildStart() {
        // dev / build 양쪽에서 public/version.json 갱신
        const publicDir = resolve(__dirname, "public");
        mkdirSync(publicDir, { recursive: true });
        writeFileSync(
          resolve(publicDir, "version.json"),
          JSON.stringify({ commit: COMMIT_HASH, buildTime: BUILD_TIME }, null, 2),
        );
      },
      closeBundle() {
        // build 완료 시 dist 에도 한번 더 (PWA precache 안에 들어가도록)
        const outDir = resolve(__dirname, "dist");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          resolve(outDir, "version.json"),
          JSON.stringify({ commit: COMMIT_HASH, buildTime: BUILD_TIME }, null, 2),
        );
      },
    },
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
        orientation: "portrait",
        lang: "ko",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // version.json 은 precache 에서 제외 — 항상 네트워크에서 직접 fetch 해야
        // 새 버전 토스트가 동작 (cache-first 로 옛 hash 응답하면 안 됨)
        globIgnores: ["**/version.json"],
        // 프록시 응답 + version.json 은 NetworkFirst (짧은 TTL)
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
          {
            urlPattern: /version\.json/,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
