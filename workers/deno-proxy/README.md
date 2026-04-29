# Portfolio Deno Deploy Proxy

Cloudflare Worker / Vercel Edge Function 동등 로직.
무료: **100k req/일** · 100GB transfer/월.
Cloudflare(100k) + Vercel(100k) + Deno(100k) = **합산 300k req/일**.

## 배포 — 두 방법 중 선택

### A. 웹 (가장 빠름, 1-2분)

1. https://deno.com → **Sign in with GitHub** (1클릭 가입)
2. https://dash.deno.com → **New Playground**
3. Playground 에디터에 `main.ts` 내용 전체 복사·붙여넣기
4. 우측 상단 **Save & Deploy** 클릭
5. 발급된 URL 확인 (예: `https://<random-name>.deno.dev`)
6. 프로젝트 이름 변경: 좌측 메뉴 → **Settings** → 원하는 이름 (예: `portfolio-deno-proxy`)

### B. CLI (반복 배포 자동화)

```bash
# deployctl 설치
deno install -gArf jsr:@deno/deployctl

cd workers/deno-proxy
deployctl deploy --project=portfolio-deno-proxy main.ts
```

## 로컬 실행

```bash
deno task dev
# 또는
deno run --allow-net main.ts
```

## 사용

```
GET https://<your-project>.deno.dev/?url=<encoded_target>
```
