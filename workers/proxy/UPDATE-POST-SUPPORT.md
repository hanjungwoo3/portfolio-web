# Worker 업데이트 — POST 지원 추가 (예상치 차트용)

> 본인 전용 Cloudflare Worker 를 이미 [DEPLOY-USER.md](./DEPLOY-USER.md) 가이드로 배포해 두신 분 대상.
> 새 버전 worker.js 로 교체하면 **예상 매출 / 영업이익 / EPS 분기 차트** 가 활성화됩니다.

---

## ❓ 업데이트 안 하면 어떻게 되나요?

- ✅ 기존 모든 기능은 그대로 정상 작동 (가격, 차트, 공매도, 재무추이 5개 등)
- ❌ **기업가치 모달의 "🔮 컨센서스 예상치" 섹션만 비어 보임**
- 워커가 GET 만 지원하던 시절에 배포됐는데 새 컨센서스 API 는 POST 호출이라 워커가 405 반환

업데이트는 **선택**입니다. 컨센서스 차트가 안 보여도 무방하면 그냥 두셔도 됩니다.

---

## 🕐 소요 시간

- **약 5분**, 코딩 지식 불필요
- [DEPLOY-USER.md](./DEPLOY-USER.md) 의 3.2 → 3.3 → 3.4 단계 그대로 반복

---

## 업데이트 절차

### 1) Cloudflare 대시보드 진입

1. https://dash.cloudflare.com 접속 → 로그인
2. 좌측 메뉴 **Compute** → **Workers & Pages**
3. 본인 worker (예: `portfolio-proxy`) 클릭

### 2) Edit code

1. 우측 상단 **Edit code** (또는 **Quick edit**) 클릭
2. 좌측 `worker.js` 파일 열림

### 3) 새 코드 복사

새 탭에서 아래 URL 열기 (반드시 `.js`):

```
https://raw.githubusercontent.com/hanjungwoo3/portfolio-web/main/workers/proxy/src/worker.js
```

**Cmd+A** → **Cmd+C** 로 전체 복사.

### 4) 기존 코드 덮어쓰기

Cloudflare 에디터로 돌아와서:

1. 좌측 코드 영역 클릭 (커서 위치)
2. **Cmd+A** (기존 코드 전체 선택)
3. **Cmd+V** (붙여넣기)
4. 하단 상태바 **0 errors** 확인

### 5) Deploy

우측 상단 **[Deploy]** 클릭. 5~10초 후 완료.

---

## 동작 검증 (선택, 1분)

브라우저에서 포트폴리오 사이트 열기:
https://hanjungwoo3.github.io/portfolio-web/

1. 아무 한국 종목 카드 클릭 → 📊 **기업가치** 모달 열기
2. 스크롤 내려서 **재무 추이 5개 차트** 아래
3. **🔮 컨센서스 예상치 (분기)** 섹션에 매출 / 영업이익 / EPS 3개 차트가 보이면 성공

차트가 안 보이면:
- F12 → Network 탭 → `estimate/revenue` 검색
- 응답 상태가 200 이면 성공. 405 면 worker 코드 붙여넣기 다시 (4단계로)
- 405 가 계속되면 Cloudflare 대시보드에서 worker 가 최신 코드인지 다시 확인

---

## 변경 사항 요약 (호기심 있는 분)

worker.js 의 변경 내용:

| 항목 | 이전 | 이후 |
|------|------|------|
| `Access-Control-Allow-Methods` | `GET, OPTIONS` | `GET, POST, OPTIONS` |
| 비-GET 요청 | 405 반환 | POST 도 통과 |
| POST body | — | 그대로 upstream forward |
| POST 응답 캐시 | — | `no-store` (캐시 안 함) |

화이트리스트 (`ALLOWED_HOSTS`) 변경 없음 — 보안 영향 0. 토스/Naver/Yahoo 만 통과 그대로.

---

## 다른 워커 (Vercel / Deno / Render) 쓰시는 분

같은 변경이 다음 파일들에 적용되어 있습니다:
- `workers/vercel-proxy/api/proxy.ts`
- `workers/deno-proxy/main.ts`
- `workers/render-proxy/server.js`

각 플랫폼 가이드에 따라 재배포하시면 됩니다 (Cloudflare 와 동일 패턴).

---

## 📊 전용 프록시 사용량 표시 (선택)

설정 → 전용 프록시에서 각 프록시의 **오늘 요청수 / 100,000** 막대를 보고 싶을 때만.
설정 안 해도 모든 기능은 정상이며, 사용량만 "미지원"으로 안내됩니다.

> 원리: 앱이 `https<나의-워커>/usage` 호출 → 워커가 **Cloudflare GraphQL Analytics API** 로 오늘 요청수를 조회해 반환.
> API 토큰은 **워커 환경변수(서버측)** 에만 저장 → 브라우저에 노출 안 됨.

### 1) 워커 코드 최신화
위 **업데이트 절차(1~5단계)** 그대로 최신 `worker.js` 로 교체하면 `/usage` 엔드포인트가 포함됩니다.

### 2) Cloudflare API 토큰 만들기
1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Create Custom Token**
2. 권한: **Account → Account Analytics → Read** (이 하나면 충분)
3. Account Resources: 내 계정 → **Continue → Create Token** → 토큰 값 복사 (한 번만 표시)

### 3) 워커 환경변수 설정
대시보드 → 내 워커 → **Settings → Variables and Secrets** 에서 추가 후 Deploy:

| 이름 | 값 | 종류 |
|---|---|---|
| `CF_API_TOKEN` | 2)의 토큰 | **Secret (Encrypt)** |
| `CF_ACCOUNT_ID` | 계정 ID (워커 Overview 의 Account ID) | Text |
| `CF_SCRIPT_NAME` | (선택) 이 워커 스크립트명 | Text |

- `CF_SCRIPT_NAME` 넣으면 *이 워커만*, 비우면 *계정 전체* Workers 요청수("Requests today"와 동일).

### 4) 확인
브라우저에서 `https<나의-워커>/usage` → `{ "requests": 9101, "limit": 100000, "date": "..." }` 면 성공.
이제 앱 설정에서 프록시마다 사용량 막대가 표시됩니다.

> 참고: 무료 한도는 **계정 단위 100,000 req/day**. GraphQL 수치는 수 분 지연될 수 있음.
