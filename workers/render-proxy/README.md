# Portfolio Render Proxy

Node.js Express-스타일 HTTP 서버. Render.com Web Service 무료 배포.

**무료**: 750시간/월 always-on (1 인스턴스 24/7), **요청 수 제한 없음**, 100GB 대역폭/월.

## 배포

1. https://render.com → **Sign up with GitHub** (CC 불필요)
2. 대시보드 → **New +** → **Web Service**
3. **Build and deploy from a Git repository** → portfolio-web 리포 연결
4. 다음 설정:
   - **Name**: `portfolio-render-proxy` (URL 일부)
   - **Region**: `Oregon (US West)` 또는 `Singapore` (KR 가까움 — 그러나 Singapore는 유료일 수 있음)
   - **Branch**: `main`
   - **Root Directory**: `workers/render-proxy`
   - **Runtime**: `Node`
   - **Build Command**: `npm install` (또는 비워둠)
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free** ⭐
5. **Create Web Service** 클릭
6. 빌드 완료 후 URL 확인 (예: `https://portfolio-render-proxy.onrender.com`)

## 주의

- Free 인스턴스는 15분 무활동 시 sleep → 다음 요청 시 콜드 스타트 ~30초
- 라운드 로빈에서 첫 요청만 느릴 수 있음 (이후 캐시)
- 활성 트래픽 있는 동안엔 always-on
- Health check endpoint: `/health` → Render가 주기적으로 ping (sleep 방지 목적은 X)

## 활성 유지 (선택)

cron 서비스 (cron-job.org 등 무료) 로 5-10분마다 `/health` ping 하면 sleep 방지.

## 사용

```
GET https://<your-app>.onrender.com/?url=<encoded_target>
```
