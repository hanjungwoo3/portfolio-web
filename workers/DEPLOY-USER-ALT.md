# 전용 프록시 추가 배포 — Netlify / Supabase

[Cloudflare Worker 가이드](proxy/DEPLOY-USER.md)를 이미 마치신 분을 위한 **두 번째 프록시** 배포 문서입니다.

## 먼저 — 이게 필요한가요?

**대부분은 필요 없습니다.** Cloudflare Worker 하나로 충분합니다(10만 요청/일). 아직 안 하셨다면 [Cloudflare 가이드](proxy/DEPLOY-USER.md)부터 하세요. 브라우저에서 복사·붙여넣기만 하면 되고 10분이면 끝납니다.

이 문서가 필요한 경우는 하나입니다.

> **시세 소스(토스)가 간헐적으로 `400`을 돌려주며 갱신이 멈출 때.**

토스는 **egress IP 풀 단위**로 요청을 제한합니다. Cloudflare Workers의 나가는 IP는 전 세계 Cloudflare 고객이 공유하기 때문에, 내 호출량이 적어도 그 풀이 붐비면 같이 막힙니다. 실측에서도 Cloudflare Worker 3개가 **동시에** 400을 받았다가 30초 뒤 함께 회복됐습니다. 같은 시각 Netlify·Supabase는 정상이었습니다.

즉 워커를 하나 더 만들어도 소용없습니다. **나가는 IP 풀이 다른 공급자**를 하나 두는 게 유일한 대비책입니다. 앱은 400을 받으면 자동으로 다른 공급자로 넘어갑니다.

| | Cloudflare | Netlify | Supabase |
|---|---|---|---|
| 무료 한도 | 100,000/일 | Edge Functions 무료 한도 | 500,000/월 |
| 배포 방법 | **브라우저만** | CLI 필요 | CLI 필요 |
| 예상 소요 | 10분 | 15분 | 15분 |
| 카드 등록 | 불필요 | 불필요 | 불필요 |

Netlify·Supabase는 터미널(명령줄) 사용이 필요합니다. 익숙하지 않으시면 굳이 안 하셔도 됩니다.

---

## 공통 준비

두 방법 모두 이 저장소의 코드를 내려받아야 합니다.

```bash
git clone https://github.com/hanjungwoo3/portfolio-web.git
cd portfolio-web
```

> **코드는 수정할 필요 없습니다.** 접속 허용 도메인이 이미 앱 주소로 설정돼 있어서 그대로 배포하면 동작합니다.

---

## 방법 A — Netlify Edge Function

### A.1 CLI 설치 및 로그인

```bash
npm i -g netlify-cli
netlify login
```

브라우저가 열리면 GitHub 또는 이메일로 가입·로그인합니다. 카드 등록은 없습니다.

### A.2 배포

```bash
cd workers/netlify-proxy
netlify deploy --prod
```

처음 실행하면 몇 가지를 물어봅니다.

- `Create & configure a new site` 선택
- 팀은 기본값 그대로
- 사이트 이름은 아무거나 (비워두면 자동 생성)

배포가 끝나면 **Website URL**이 출력됩니다. 이 주소를 복사해 두세요.

```
https://<사이트이름>.netlify.app
```

---

## 방법 B — Supabase Edge Function

### B.1 CLI 설치 및 로그인

```bash
brew install supabase/tap/supabase     # macOS
# 또는: npm i -g supabase

supabase login
```

### B.2 프로젝트 생성

[supabase.com](https://supabase.com) 대시보드에서 무료 프로젝트를 하나 만듭니다. 생성 후 **Project Settings → General**에서 `Reference ID`를 확인해 두세요.

### B.3 배포

```bash
cd workers/supabase-proxy
supabase functions deploy proxy --no-verify-jwt --project-ref <REFERENCE_ID>
```

> ⚠️ **`--no-verify-jwt`를 빼먹지 마세요.** 없으면 모든 요청에 인증 헤더를 요구해서 앱이 못 씁니다.

배포 후 주소는 이 형식입니다.

```
https://<REFERENCE_ID>.supabase.co/functions/v1/proxy
```

---

## 배포 확인

배포한 주소를 **브라우저 주소창에 그대로** 붙여넣고 엽니다.

정상이면 이런 응답이 보입니다.

```json
{
  "ok": true,
  "message": "포트폴리오 프록시(Netlify)가 정상 작동 중입니다. ..."
}
```

| 화면 | 상태 |
|---|---|
| 위 JSON | ✅ 정상 |
| `404` 또는 `Page not found` | 배포 실패 — 명령을 다시 확인 |
| `{"error":"Forbidden origin"}` | ✅ **정상입니다** (뒤의 트러블슈팅 참고) |

---

## 앱에 등록

1. 앱에서 **⚙️ 설정** 열기
2. **내 전용 프록시 URL** 항목에서 **➕ 프록시 추가**
3. 배포한 주소를 붙여넣고 체크박스를 켠 뒤 **저장**

기존 Cloudflare Worker는 **지우지 마세요.** 여러 개를 켜두면 앱이 자동으로 분산하고, 한쪽이 막히면 다른 공급자로 넘어갑니다. 그게 이 문서의 목적입니다.

---

## 트러블슈팅

### Q1. 브라우저로 열었더니 `{"error":"Forbidden origin"}`

**정상입니다.** 이 프록시는 앱에서 온 요청만 받도록 되어 있어서, 브라우저로 직접 열면 거부하는 게 맞습니다. 앱에 등록해서 쓰시면 됩니다.

### Q2. Netlify `netlify deploy` 에서 사이트 선택이 헷갈림

`Create & configure a new site`를 고르면 됩니다. 이미 만든 사이트가 있다면 `Link this directory to an existing site`를 골라 연결하세요.

### Q3. Supabase 배포는 됐는데 앱에서 안 됨

`--no-verify-jwt` 없이 배포했을 가능성이 큽니다. 같은 명령에 옵션을 붙여 다시 배포하면 덮어씌워집니다.

### Q4. 여전히 갱신이 멈춤

공급자를 늘려도 **모든 공급자가 동시에 제한에 걸리면** 멈춥니다. 이건 시세 소스 쪽 정책이라 앱에서 없앨 수 없습니다. 보통 수십 초 안에 자동 회복됩니다.

### Q5. 코드가 업데이트됐을 때

```bash
git pull
```

한 뒤 위 배포 명령을 다시 실행하면 됩니다.

---

## 참고

- **프록시 코드 공개**: `workers/netlify-proxy/netlify/edge-functions/proxy.ts`, `workers/supabase-proxy/supabase/functions/proxy/index.ts`
  기능은 Cloudflare 워커와 동일합니다 — 시세 사이트 CORS 우회만 하고, 사용자 데이터는 전혀 처리하지 않습니다.
- **카드 등록 불필요**: 두 서비스 모두 무료 플랜에 결제 정보가 필요 없습니다. 한도를 넘겨도 과금 없이 정지되고 다음 주기에 복구됩니다.
