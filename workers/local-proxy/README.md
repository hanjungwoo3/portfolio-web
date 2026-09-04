# 💻 내 PC 로컬 프록시

앱이 시세를 가져올 때 쓰는 CORS 프록시를 **클라우드 워커 대신 내 PC**에서 돌리는 옵션입니다.

## 왜 쓰나

토스는 **egress IP 풀 단위**로 스로틀링합니다. Cloudflare·Netlify 같은 클라우드 워커는 나가는 IP가
다른 사용자와 공유돼서, 내 호출량과 무관하게 `400 + 빈 본문`(사실상 레이트리밋 신호)이 돌아옵니다.

집 PC는 가정용 IP라 실사용자 트래픽과 구분되지 않고, **일일 호출 한도도 없습니다.**
덕분에 폴링 주기를 5초까지 줄여도 됩니다.

| | 공개 4-way | 개인 워커 | **내 PC** |
|---|---|---|---|
| 일일 한도 | 공유 | 100k/일 | **없음** |
| 토스 400 차단 | 잦음 | 가끔 | **드묾** |
| 휴대폰 | ✅ | ✅ | ❌ |
| PC 꺼도 동작 | ✅ | ✅ | ❌ |

## 쓰는 법

저장소를 받을 필요 없습니다. **의존성이 0개**라(Node 18+ 내장 기능만 사용)
파일 하나만 내려받아 실행하면 됩니다.

```bash
curl -fsSL -O https://raw.githubusercontent.com/hanjungwoo3/portfolio-web/main/workers/local-proxy/server.mjs
node server.mjs
```

`package.json` 도 `npm install` 도 필요 없습니다. 저장소를 이미 받아둔 경우엔
`npm run proxy` 로 같은 걸 실행할 수 있습니다.

```
✅ 로컬 프록시 실행 중 — http://127.0.0.1:8787
   앱 설정 → '내 전용 프록시' 에 등록:  http://127.0.0.1:8787
```

그다음 앱에서 **⚙️ 설정 → 내 전용 프록시 → 💻 내 PC** 버튼 → **저장**.

포트를 바꾸려면 `node server.mjs --port 9000` (저장소에서는 `npm run proxy -- --port 9000`).
설정에 등록하는 주소도 같이 바꿔야 합니다.

터미널을 닫으면 프록시도 꺼집니다. 그때는 설정에서 체크를 해제하면 공개 프록시로 돌아갑니다.

## Yahoo 는 자동으로 클라우드로 나갑니다

토스와 Yahoo 는 요구가 정반대입니다.

| 업스트림 | 클라우드 IP | 가정용 IP(내 PC) |
|---|---|---|
| 토스 | `400` 잦음 (IP 풀 스로틀링) | ✅ 통과 |
| **Yahoo** | ✅ 통과 | **`429 Edge: Too Many Requests`** |

Yahoo 는 가정용 IP 를 막습니다. `query1`/`query2`, `v8/chart`·`v7/quote` 전부이고
User-Agent 를 브라우저로 바꿔도 동일합니다(실측). 프록시 코드로 넘을 수 없는 IP 단위 차단입니다.

그래서 앱이 **호스트를 보고 갈라서 보냅니다**(`src/lib/api.ts` `proxyUrlsFor`).

```
yahoo.com  → 클라우드 프록시만 (로컬 제외)
그 외      → 기존 라운드로빈 (로컬 포함)
```

따로 설정할 건 없습니다. 로컬 프록시만 등록한 상태여도 Yahoo 요청은 공개 프록시로 자동
폴백하므로, 미국 지수·VIX·자산추이·ETF 비교·국내 ETF 스파크라인이 정상 동작합니다.

> 이 라우팅이 없던 동안에는 로컬 프록시를 켜면 Yahoo 기반 차트가 전부 비어 보였습니다.
> 지수 탭에서 KOSPI·KOSDAQ·선물·V-KOSPI(토스/yasun/CNBC)만 그려지고
> KODEX 200·섹터 ETF(Yahoo)는 스파크라인이 사라지는 증상입니다.

## 제약 — 먼저 읽어주세요

브라우저 보안 정책 때문에 생기는 제약이고, 코드로 우회할 수 없습니다.

- **PC 전용.** 휴대폰에서 PC의 LAN IP(`http://192.168.x.x`)로 붙는 건 mixed content로 차단됩니다.
  https 페이지가 http로 요청하는 걸 허용하는 예외는 `localhost`/`127.0.0.1`에만 적용되기 때문입니다.
- **Safari 미지원.** Chrome·Edge·Firefox는 `https` 페이지 → `http://localhost`를 허용하지만
  Safari는 막습니다.
- **PC가 켜져 있고 `node server.mjs`가 떠 있어야** 합니다.

## 동작

`workers/proxy/src/index.ts`(Cloudflare Worker)와 **같은 계약**을 Node로 구현한 것이라
앱 입장에서는 워커와 구분되지 않습니다.

| 요청 | 응답 |
|---|---|
| `GET /` | 헬스체크 JSON |
| `GET /usage` | `{requests, limit: 0, local: true}` — `limit 0` = 한도 없음 |
| `GET /?url=<encoded>` | 대상 GET 우회 (3초 메모리 캐시) |
| `POST /?url=<encoded>` | body 전달 (컨센서스·TradingView 스캐너) |

같이 구현된 것:

- **호스트 화이트리스트** — 토스/네이버/야후/investing/yasun/TradingView만. 그 외 `403`
- **Origin 검사** — `https://hanjungwoo3.github.io`와 로컬 개발만. 그 외 `403`
- **업스트림별 헤더** — 토스는 `Origin: tossinvest.com`, 네이버는 네이버 Referer 등
- **Yahoo crumb 인증** — 세션 쿠키 + crumb 자동 발급/캐시(30분)
- **Private Network Access** — Chrome이 공인 origin → 사설망 요청에 요구하는
  `Access-Control-Allow-Private-Network: true` 응답

의존성은 없습니다(Node 18+ 내장 `http` + `fetch`). 그래서 파일 하나만 있으면 돕니다.

## 확인

```bash
curl http://127.0.0.1:8787/usage
curl -H "Origin: https://hanjungwoo3.github.io" \
  "http://127.0.0.1:8787/?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('https://wts-info-api.tossinvest.com/api/v1/c-chart/kr-s/KGG01P/day:1?count=2',safe=''))")"
```

`Origin` 헤더 없이 호출하면 `403 Forbidden origin`이 정상입니다.
