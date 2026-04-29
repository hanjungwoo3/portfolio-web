# Portfolio Vercel Proxy

Cloudflare Worker (`workers/proxy/`)와 동일 로직의 Edge Function.
무료 한도: **100k 요청/일** — Cloudflare 와 합산 200k/일.

## 배포

```bash
# 1회 — Vercel CLI 설치 (npx 대안)
npm i -g vercel

# 이 디렉토리에서
cd workers/vercel-proxy
vercel login
vercel        # 첫 배포 (preview)
vercel --prod # production 배포 (하나의 영구 URL)
```

배포 후 URL 형태: `https://portfolio-vercel-proxy.vercel.app`

## 사용

```
GET https://<YOUR-VERCEL-URL>/?url=<encoded_target>
```

(`vercel.json`의 rewrite로 `/`가 `/api/proxy`로 매핑되어 Cloudflare와 동일 형태)

## 화이트리스트

`api/proxy.ts`의 `ALLOWED_HOSTS` — Cloudflare worker와 동기화 유지.
