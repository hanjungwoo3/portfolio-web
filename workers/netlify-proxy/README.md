# Netlify Edge Function 프록시

Cloudflare/Vercel 워커와 동일한 CORS 프록시를 Netlify Edge Functions(Deno 런타임)로 배포.
**카드(결제정보) 등록 불필요** — 무료 한도 내 동작.

```
workers/netlify-proxy/
├─ netlify.toml                       # publish=public, 빌드 없음
├─ public/index.html                  # publish 디렉터리용 placeholder
└─ netlify/edge-functions/proxy.ts    # 엣지 함수 (path: "/")
```

## 배포 방법 (CLI — Edge Function은 drag&drop 불가)

```bash
npm i -g netlify-cli         # 최초 1회
cd workers/netlify-proxy
netlify login                # 브라우저 인증 (카드 없이 GitHub/이메일 가입)
netlify deploy --prod        # 새 사이트 생성 → 프로덕션 배포
```

배포 후 출력되는 사이트 URL (예: `https://포트폴리오-proxy-xxxx.netlify.app`)을 복사.

## 앱에 연결

1. 루트 `.env.production` 의 `VITE_PROXY_URL_5` 주석 해제 후 위 URL 로 교체:
   ```
   VITE_PROXY_URL_5=https://<your-site>.netlify.app
   ```
2. 앱 재빌드/배포 (`npm run deploy`).
   - 클라이언트는 이미 5번째 슬롯을 인식함 (`src/lib/api.ts` PUBLIC_PROXY_URLS).

## 동작 확인

```bash
# 200 + JSON 이면 정상
curl "https://<your-site>.netlify.app/?url=https%3A%2F%2Fwts-info-api.tossinvest.com%2Fapi%2Fv3%2Fstock-prices%3Fmeta%3Dtrue%26productCodes%3DA005930"
# 403 "Host not allowed" → 화이트리스트 누락
```

## 한도 (Netlify 무료)

- Edge Functions 호출 무료 한도 내. 초과해도 카드 미등록이라 **과금 없이 정지**(다음 주기 복구) — Vercel처럼 결제 청구 위험 없음.
- 화이트리스트/CORS/Yahoo crumb 로직은 Cloudflare 워커(`workers/proxy/src/worker.js`)와 동일하게 유지.
