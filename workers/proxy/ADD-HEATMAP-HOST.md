# Worker 업데이트 — 히트맵 호스트 추가 (KOSPI/KOSDAQ 트리맵)

> 본인 전용 Cloudflare Worker 를 이미 [DEPLOY-USER.md](./DEPLOY-USER.md) 가이드로 배포해 두신 분 대상.
> 새 버전 worker.js 로 교체하면 **🗺️ 히트맵 탭**(KOSPI/KOSDAQ 종목 트리맵)이 활성화됩니다.

---

## ❓ 업데이트 안 하면 어떻게 되나요?

- ✅ 기존 모든 기능은 그대로 정상 작동
- ❌ **히트맵 탭에만** "⚠️ 프록시 워커 설정 필요" 안내가 뜸
- 히트맵 데이터(`scanner.tradingview.com`)가 아직 워커 허용 호스트 목록에 없어 워커가 **403 Host not allowed** 반환

업데이트는 **선택**입니다. 히트맵이 안 보여도 무방하면 그냥 두셔도 됩니다.

---

## 🕐 소요 시간

- **약 3분**, 코딩 지식 불필요
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

### 6) 워커를 여러 개(6-way) 쓰신다면

등록한 **모든 워커**에 대해 3~5단계를 반복하세요. (허용 호스트 목록이 워커마다 있어야 함)

---

## 코드 한 줄만 직접 추가하는 방법 (전체 교체 대신)

전체 붙여넣기가 부담되면, `worker.js` 상단 `ALLOWED_HOSTS` 목록에 아래 한 줄만 추가해도 됩니다:

```js
const ALLOWED_HOSTS = new Set([
  "wts-info-api.tossinvest.com",
  // ... 기존 항목들 ...
  "scanner.tradingview.com",   // ← 이 줄 추가
]);
```

추가 후 **[Deploy]**. (POST 지원은 이미 [UPDATE-POST-SUPPORT.md](./UPDATE-POST-SUPPORT.md) 로 반영돼 있어야 합니다 — 컨센서스 차트가 보이면 이미 POST 지원 상태)

---

## 동작 검증 (선택, 1분)

브라우저에서 포트폴리오 사이트 열기:
https://hanjungwoo3.github.io/portfolio-web/

1. 상단 탭에서 **🗺️ 히트맵** 클릭
2. "프록시 워커 설정 필요" 안내가 사라지고 **트리맵**(섹터별 종목 타일)이 그려지면 성공
3. 안 보이면: F12 → Network 탭 → `scanner.tradingview.com` 검색 → 응답 200 이면 성공, 403 이면 worker 재배포 다시 확인

---

## 변경 사항 요약

| 항목 | 이전 | 이후 |
|------|------|------|
| `ALLOWED_HOSTS` | scanner.tradingview.com 없음 → 403 | 추가 → 히트맵 데이터 통과 |

POST 지원이 필요합니다(이 API 는 POST). 아직 GET 전용 워커라면 [UPDATE-POST-SUPPORT.md](./UPDATE-POST-SUPPORT.md) 를 먼저 적용하세요.
