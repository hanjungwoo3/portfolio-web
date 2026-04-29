# 내 전용 Cloudflare Worker 배포 가이드

공개 4-way 프록시 (Cloudflare/Vercel/Deno/Render) 대신 본인 전용 worker를 사용하면:

- ✅ 본인 100k 요청/일 전용 (개인 사용엔 사실상 무제한)
- ✅ 공개 인프라 부담 0
- ✅ rate limit 영향 없음
- ✅ 무료 (신용카드 불필요)

## 단계 (10분, 코딩 지식 X)

### 1. Cloudflare 가입

1. https://dash.cloudflare.com/sign-up 가입 (GitHub 또는 이메일)
2. 이메일 인증 클릭

### 2. 가입 직후 — Workers & Pages 활성화

1. 좌측 메뉴 **Workers & Pages** 클릭
2. **Get Started** 또는 **Create application** 버튼
3. 이름(=서브도메인) 설정 (예: `myname` → `myname.workers.dev`)

### 3. Worker 코드 배포 — 가장 빠른 길 (웹 에디터)

1. **Create application** → **Create Worker**
2. 이름 입력 (예: `portfolio-proxy`)
3. **Deploy** → 그러면 기본 worker가 생성됨
4. **Edit code** 또는 **Quick edit** 클릭 (웹 에디터 열림)
5. 에디터 내용 전체 삭제
6. 아래 GitHub 파일 내용을 통째로 복사·붙여넣기:

   👉 https://raw.githubusercontent.com/hanjungwoo3/portfolio-web/main/workers/proxy/src/worker.js

   ※ Cloudflare 웹 에디터는 기본 파일이 `worker.js`라 순수 JS 버전을 사용해야 함.
     TypeScript 원본(`index.ts`) 붙여넣으면 16개 문법 에러가 뜸.

7. 우측 상단 **Save and Deploy**
8. 발급된 URL 확인 (예: `https://portfolio-proxy.myname.workers.dev`)

### 4. 앱 설정에 입력

1. 포트폴리오 사이트 → 우측 상단 **⚙️ 설정**
2. **🔧 내 전용 프록시 URL** 칸에 위 URL 붙여넣기
3. **저장** 클릭
4. 끝 — 이제 본인 worker만 사용됨

## 검증

브라우저 DevTools (F12) → Network 탭 → "proxy" 필터 →
모든 요청이 본인 worker URL (`*.workers.dev`)로 가는지 확인.

## 한도 초과 시

브라우저에서 ⚙️ 설정 열어 URL 비우기 + 저장 → 공개 4-way로 자동 복귀.

## 참고

- Worker 코드는 GitHub에 공개 — 기능: 토스/네이버/야후 CORS 우회만 (사용자 데이터 X)
- 본인 worker 사용량: Cloudflare 대시보드 → Workers & Pages → 본인 worker → Metrics
- 100k 요청/일 한도 초과 시 Cloudflare가 자동 차단 → 다음 날 UTC 자정 (KST 09:00)에 reset
