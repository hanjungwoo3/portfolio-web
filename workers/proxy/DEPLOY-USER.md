# 내 전용 Cloudflare Worker 배포 가이드

공개 4-way 프록시 (Cloudflare/Vercel/Deno/Render) 대신 본인 전용 worker를 사용하면:

- ✅ 본인 100k 요청/일 전용 (개인 사용엔 사실상 무제한)
- ✅ 공개 인프라 부담 0
- ✅ rate limit 영향 없음
- ✅ 무료 (신용카드 불필요)
- ✅ 폴링 주기 5초/10초/30초/60초 선택 가능 (공개는 10초 고정)

소요 시간: **약 10분**, 코딩 지식 불필요.

---

## 1단계 — Cloudflare 가입

### 1.1 회원가입

1. https://dash.cloudflare.com/sign-up 접속
2. 이메일 + 비밀번호 입력 (또는 GitHub 연동)
3. **Sign up** 클릭

### 1.2 이메일 인증

1. 가입한 이메일 받은편지함 확인 → Cloudflare 발송 메일 열기
2. 메일 안의 **Verify your email** 버튼 클릭
3. 브라우저에 "Email verified" 메시지 뜸 → 대시보드로 자동 이동

> 💡 인증 안 하면 Worker 배포 시 차단됨. 메일 못 받으면 스팸함 확인.

### 1.3 계정 타입 선택

"Choose your account type" 화면이 뜨면:
- ✅ **Personal** 선택 (개인 사용 / 무료)
- ❌ Team (협업용 — 유료 안내 끼어듦)

**Continue** 클릭.

### 1.4 "Build and scale apps globally" 화면

Workers 유료 플랜 ($5/월) 권유 화면이 뜸.

- 👉 우측 상단 또는 하단의 **Skip** 클릭
- 또는 좌측 메뉴 **Workers & Pages** 직접 클릭으로 우회

> 💡 Skip 해도 무료 100k req/일 그대로 사용 가능. 유료 플랜 가입 불필요.

---

## 2단계 — Worker 생성

### 2.1 Workers 대시보드 진입

대시보드(Account home)에서:
- 가운데 **Workers and Pages** 카드의 **Start building** 클릭
- 또는 좌측 메뉴 **Compute** → **Workers & Pages** 클릭

### 2.2 Worker 생성 시작

"Create a Worker" → "Ship something new" 화면이 뜸.

여러 옵션 중 **Start with Hello World!** 클릭.

> ❌ Connect GitHub/GitLab — repo fork 필요 (복잡)
> ❌ Select a template — 우리 코드와 다른 샘플
> ❌ Upload static files — Worker 아닌 정적 사이트용

### 2.3 Worker 이름 설정 + 첫 배포

"Deploy Hello World" 화면에서:

1. **Worker name** 입력란의 기본값(예: `polished-breeze-2df8`) 지우고
   👉 **`portfolio-proxy`** 입력
2. 우측에 **✓ 초록 체크** 표시되면 사용 가능
3. 화면 하단 **Deploy** 버튼 클릭
4. 배포 완료되면 URL 표시됨:
   ```
   https://portfolio-proxy.<본인계정>.workers.dev
   ```
   👉 이 URL 메모해두세요 (4단계에서 사용)

> 💡 이름을 `portfolio-proxy`로 하는 이유: 나중에 ⚙️ 설정에서 헷갈리지 않기 위함.
>     기본 자동생성 이름(예: `polished-breeze-2df8`)도 작동은 함.

---

## 3단계 — Worker 코드 교체

배포 후 자동으로 Worker 상세 화면이 뜸. 또는 좌측 메뉴 → 본인 worker 클릭.

### 3.1 코드 에디터 열기

상세 화면에서 **Edit code** (또는 **Quick edit**) 버튼 클릭.

→ VS Code 스타일 웹 에디터 화면이 열림. 좌측에 `worker.js` 파일이 보임.

### 3.2 GitHub raw URL에서 코드 복사

새 탭에서 아래 URL 열기 (**.js 파일 — 반드시 이거 사용**):

```
https://raw.githubusercontent.com/hanjungwoo3/portfolio-web/main/workers/proxy/src/worker.js
```

- 화면에 텍스트 코드만 길게 표시됨
- **Cmd+A** (전체 선택) → **Cmd+C** (복사)

> ⚠️ **주의**: `index.ts` 파일을 사용하면 안 됨!
>     Cloudflare 웹 에디터의 기본 파일은 `worker.js`(JavaScript)라서
>     TypeScript 문법(`Set<string>`, `: Promise<Response>` 등)을 받아주지 않음.
>     `index.ts`를 붙여넣으면 하단에 **16개 문법 에러**가 뜸.
>     반드시 위의 **`worker.js`** raw URL 사용.

### 3.3 에디터에 코드 붙여넣기

Cloudflare 에디터로 돌아와서:

1. 좌측 코드 영역 클릭 (커서 위치)
2. **Cmd+A** (기존 Hello World 코드 전체 선택)
3. **Delete** 또는 **Backspace** (기존 코드 전체 삭제)
4. **Cmd+V** (복사한 코드 붙여넣기)
5. 하단 우측 상태바 확인:
   - ✅ **0 errors** → 정상
   - ❌ 에러가 보이면 → 잘못된 파일을 복사한 것 (3.2의 .js 파일 다시 확인)

### 3.4 새 코드 배포

우측 상단 파란색 **[Deploy]** 버튼 클릭.

> 💡 우측 Preview 영역에 Error 1031 ("Improperly configured Workers Preview")이
>     뜰 수 있는데, 이건 **Cloudflare preview 화면 일시 오류**일 뿐 실제 배포에는 영향 없음. 무시.

배포 완료까지 5~10초.

---

## 4단계 — 동작 검증 (선택, 1분)

새 탭에서 아래 URL 접속 (Apple 주가 데이터 호출):

```
https://portfolio-proxy.<본인계정>.workers.dev/?url=https%3A%2F%2Fquery1.finance.yahoo.com%2Fv8%2Ffinance%2Fchart%2FAAPL
```

- ✅ JSON 응답 (`{"chart":...`)이 보이면 정상
- ❌ Error 502 / Error 1031 등이 뜨면 → 3.3 단계로 돌아가 코드 다시 붙여넣기

또는 그냥 루트 URL만 호출:
```
https://portfolio-proxy.<본인계정>.workers.dev/
```
→ `{"error":"Missing 'url' query parameter"}` 응답이 와야 정상 (이게 정상 동작 신호)

---

## 5단계 — 앱에 등록

1. 포트폴리오 사이트 접속: https://hanjungwoo3.github.io/portfolio-web/
2. 우측 상단 **⚙️ 설정** 클릭
3. **🔧 내 전용 프록시 URL (선택)** 칸에 본인 worker URL 붙여넣기:
   ```
   https://portfolio-proxy.<본인계정>.workers.dev
   ```
4. **저장** 버튼 클릭
   → 헤더 상태 메시지에 ✅ "전용 프록시 적용: ..." 표시됨

### 5.1 폴링 주기 선택 (전용 프록시 전용 기능)

저장 직후 **폴링 주기** 버튼들이 활성화됨:

| 주기 | 일일 요청량 (12시간 기준) | 추천 사용 |
|------|---------------------------|-----------|
| **5초** | 약 8,640 req | 장 시간대 실시간 추적 |
| **10초** | 약 4,320 req | 일반 (공개 프록시와 동일) |
| **30초** | 약 1,440 req | 가벼운 모니터링 |
| **60초** | 약 720 req | 배경 모니터링 |

원하는 주기 클릭 → 즉시 적용.

> 💡 100k req/일 한도 대비:
>     - 5초 폴링 × 12시간 = 약 8,640 → 한도의 **8.6%**
>     - 충분히 여유 있음. 가족/친구와 같은 worker 공유해도 OK.

---

## 6단계 — 최종 확인

브라우저 **DevTools (F12) → Network 탭** 열기 → 검색창에 **proxy** 입력.

- ✅ 모든 요청이 `portfolio-proxy.<본인계정>.workers.dev`로만 가면 정상
- ✅ 공개 4-way (`*.workers.dev`, `*.vercel.app`, `*.deno.net`, `*.onrender.com`)는
     더 이상 호출되지 않음 — 완전 분리 완료

선택한 폴링 주기(예: 5초)마다 새 요청이 뜨는지 확인.

---

## 트러블슈팅

### Q1. 코드 붙여넣었더니 "16 errors" 뜸

→ 잘못된 파일 사용. **`index.ts`** 가 아닌 **`worker.js`** raw URL을 사용해야 함.

3.2 단계의 URL을 다시 확인: 끝이 `worker.js` 인지.

### Q2. Deploy 눌렀는데 빨간 에러 메시지

→ 코드가 부분만 복사됐을 가능성. 새 탭에서 raw URL 다시 열고 Cmd+A → Cmd+C로 통째 복사.

### Q3. Error 1031 (Workers Preview)

→ 무시. Cloudflare 웹 에디터 우측 Preview 영역의 일시 오류일 뿐.
   실제 worker URL(`*.workers.dev`)은 정상 작동.

### Q4. 한도(100k/일) 초과 시

→ Cloudflare가 자동 차단. 다음 날 **UTC 자정 (KST 09:00)** 에 reset.

긴급 복구: 포트폴리오 사이트 → ⚙️ 설정 → URL 칸 비우기 + 저장
→ 공개 4-way로 자동 복귀 (10초 폴링).

### Q5. Worker 코드 업데이트 (이 가이드의 코드가 변경됐을 때)

1. Cloudflare 대시보드 → Workers & Pages → 본인 worker 클릭 → **Edit code**
2. 3.2~3.4 단계 반복 (raw URL에서 새 코드 복사 → 붙여넣기 → Deploy)

---

## 참고 정보

- **Worker 코드 공개**: GitHub의 `workers/proxy/src/worker.js` 그대로
  (기능: Toss/Naver/Yahoo CORS 우회 + Yahoo crumb 인증만, 사용자 데이터 전혀 처리 안 함)
- **사용량 확인**: Cloudflare 대시보드 → Workers & Pages → 본인 worker → **Metrics** 탭
- **무료 한도**: 100,000 req/일 (개인 사용엔 사실상 무제한)
- **신용카드 불필요**: Free 플랜은 카드 등록 없음
