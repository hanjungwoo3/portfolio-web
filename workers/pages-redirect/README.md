# pages-redirect

`5959.pages.dev` 로 들어와도 본체(GitHub Pages)로 넘어가게 하는 진입용 별칭.

앱을 옮기는 게 아니라 **입구만 하나 더 다는 것**이라, 최종 origin 은 계속
`https://hanjungwoo3.github.io` 다. 따라서 프록시 워커 6곳의 `ALLOWED_ORIGINS`,
Google OAuth 등록 URI, Dexie/localStorage 저장소 전부 손댈 필요 없다.

## 배포

```sh
npx wrangler pages deploy public --project-name=5959
```

첫 실행 시 프로젝트가 없으면 생성 여부를 물어본다. 브랜치는 production 선택.

## 되돌리기

Cloudflare 대시보드에서 Pages 프로젝트 삭제. 302 라 브라우저 캐시가 남지 않는다.
(301 로 바꿨다면 캐시 때문에 되돌리기 번거로우니 주의.)

## 주의

`_redirects` 는 정적 에셋보다 먼저 평가되므로 `index.html` 은 규칙이 안 먹었을
때만 쓰이는 안전망이다.
