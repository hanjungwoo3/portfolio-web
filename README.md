# 포트폴리오 v3 (PWA)

데스크톱 v1/v2 + 모바일(Kivy)을 잇는 웹 버전. 무료 호스팅, 사용자 데이터 브라우저 로컬 저장.

## 아키텍처

```
사용자 브라우저 (PWA)
  ├─ React + TypeScript + Tailwind
  ├─ TanStack Query (폴링/캐싱)
  ├─ IndexedDB (Dexie) — holdings/peaks/config
  └─ fetch ─→ Cloudflare Worker (CORS 프록시)
                     ↓
                Toss API / Naver
```

- 정적 호스팅: GitHub Pages (무료)
- CORS 프록시: Cloudflare Workers (무료 티어 100K req/day)
- 데이터: 브라우저 IndexedDB (per-user, 자동)

## 폴더

| 경로 | 설명 |
|------|------|
| `src/` | React 앱 (Vite) |
| `workers/proxy/` | Cloudflare Worker (CORS 프록시) |

## 로컬 개발

### 1. Worker 실행
```bash
cd workers/proxy
npm install
npx wrangler dev      # http://localhost:8787
```

### 2. Vite 실행 (별도 터미널)
```bash
npm install
npm run dev           # http://localhost:5173
```

브라우저에서 http://localhost:5173 — 데모 4종목 카드 표시.

## 배포

### Worker (Cloudflare)
```bash
cd workers/proxy
npx wrangler login    # 1회
npx wrangler deploy   # → https://portfolio-proxy.<sub>.workers.dev
```

배포 URL을 `.env.production` 의 `VITE_PROXY_URL` 에 설정.

### 웹앱 (GitHub Pages)
```bash
npm run build         # → dist/
# .github/workflows/deploy.yml 로 자동 배포 (추후 추가)
```

## 데이터 호환

데스크톱 v2 / 모바일의 `holdings.json` import 지원 (예정). 스키마:
```json
{
  "holdings": [
    { "ticker": "005930", "name": "삼성전자",
      "shares": 10, "avg_price": 200000,
      "account": "" }
  ]
}
```

## v1/v2/모바일 / v3 관계

- v1 (`portfolio_window.py`): 데스크톱 Tkinter, 단일 탭
- v2 (`portfolio_window_v2.py`): 데스크톱 Tkinter, 사용자 그룹 + 검색
- 모바일 (`mobile/`): Kivy → Android APK
- **v3 (이 폴더): 웹 PWA — 모든 플랫폼 단일 코드**

v3 출시 후에도 v2/모바일은 그대로 유지.
