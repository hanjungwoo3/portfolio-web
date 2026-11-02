# 포트폴리오 (Portfolio Web)

한국·미국 주식을 한눈에 보는 PWA. 토스·Yahoo·Naver 데이터를 통합해 보유 종목 손익·시간외 가격·정규장 종가·수급·컨센서스·기대가/목표가/손절가까지 한 카드에 표시합니다.

> 사이트: https://hanjungwoo3.github.io/portfolio-web/

- 정적 호스팅: GitHub Pages (무료)
- CORS 프록시: 4-way 라운드 로빈 자동 페일오버 — Cloudflare · Vercel · Deno · Render
- 사용자 데이터: 브라우저 IndexedDB (per-user 로컬, Google Drive 동기화 옵션)

## 데스크톱 앱 · 증권사 연결

- 맥·윈도우 앱: [앱 받기](https://github.com/hanjungwoo3/portfolio-web/releases/tag/apps)
- 토스증권·한국투자증권 계좌 연결(조회 전용, 키는 내 PC 에만): **[연결 방법](docs/BROKER-CONNECT.md)**

## 아키텍처

```
브라우저 (PWA)
  ├─ React + TypeScript + Vite + Tailwind
  ├─ TanStack Query (자동 폴링·캐싱)
  ├─ Dexie (IndexedDB) — holdings / peaks / memos
  └─ fetch ─→ CORS 프록시 (Cloudflare/Vercel/Deno/Render 라운드 로빈)
                     ↓
            Toss · Yahoo Finance · Naver · DART
```

## 폴더

| 경로 | 설명 |
|------|------|
| `src/` | React 앱 (Vite) |
| `workers/proxy/` | Cloudflare Worker — 주력 프록시 |
| `workers/vercel-proxy/` | Vercel Edge Function |
| `workers/deno-proxy/` | Deno Deploy |
| `workers/render-proxy/` | Render |

## 로컬 개발

```bash
npm install
npm run dev           # http://localhost:5173
```

`.env.production` 또는 `.env.local` 에 프록시 URL 설정:
```
VITE_PROXY_URL=https://portfolio-proxy.<sub>.workers.dev
VITE_PROXY_URL_2=https://<your-vercel>.vercel.app
VITE_PROXY_URL_3=https://<your-deno>.deno.net
VITE_PROXY_URL_4=https://<your-render>.onrender.com
```

빈 값은 자동으로 제외되어 나머지로만 운영됩니다 (`filter(Boolean)`).

## 배포

```bash
npm run deploy
```
한 명령으로:
1. `npm run build` (predeploy)
2. `git push origin main` — 소스 동기화
3. `gh-pages -d dist -b gh-pages` — `gh-pages` 브랜치에 빌드 결과 publish

push 실패 시 사이트 publish 가 차단되어 **사이트와 소스 일관성이 보장**됩니다.

## 프록시 워커

각 워커 폴더 안의 README/DEPLOY 가이드 참고.

- Cloudflare: `workers/proxy/DEPLOY-USER.md` (본인 전용 워커 1-3분 셋업)
- Vercel / Deno / Render: 각 폴더 `README.md`

## 데이터 import / export

설정 다이얼로그에서 JSON 으로 가져오기·내보내기. 스키마 예:
```json
{
  "holdings": [
    { "ticker": "005930", "name": "삼성전자",
      "shares": 10, "avg_price": 60000,
      "account": "보유" }
  ],
  "peaks": { "005930": 75000 }
}
```

## 자세한 기능 정리

색상 규칙, 메모 시스템, 그룹/탭 정책, 책갈피·dim 처리, 정규장/시간외 변동률 등 모든 운영 규칙은 [`FEATURES.md`](FEATURES.md) 참고.
