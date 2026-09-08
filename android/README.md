# 안드로이드 앱 (Capacitor)

프록시 없이 도는 안드로이드 앱. 웹 코드는 그대로 쓰고 **통신만 네이티브로** 뺐다.

## 왜 만들었나

브라우저에서 프록시가 필요한 이유는 IP 차단이 아니라 **CORS** 다. 토스·네이버는 응답에
`Access-Control-Allow-Origin` 을 주지 않아 브라우저가 읽기 자체를 막는다. 그래서 웹은
워커/Deno 프록시를 거쳐야 한다.

네이티브 HTTP(OkHttp)에는 CORS 가 없다. 앱에서는 그냥 직접 부르면 된다.

- 프록시 서버 불필요 — Deno 도, Termux 도, 공개 프록시도
- 호출 한도 없음, 남의 IP 를 공유하지 않음 (폰의 통신망 IP)
- 안드로이드 크롬은 확장을 지원하지 않아, 모바일에서 확장과 같은 이점을 얻는 유일한 길

## 구조

```
src/lib/nativeProxy.ts      네이티브 전송 계층 (확장과 같은 계약: (url, init) => Response)
src/lib/api.ts:130          fetchProxied — 네이티브 > 확장 > 전용 프록시 > 공개 프록시 순
src/lib/proxyConfig.ts      NATIVE_PROXY_URL — 앱을 '전용 프록시 한 개' 로 취급
capacitor.config.ts         앱 설정 (CapacitorHttp 전역 패치는 끔)
```

앱을 전용 프록시 목록의 항목으로 취급하는 이유는 확장 때와 같다 — 빠른 폴링, 장 마감
스로틀 해제, 헤더 배지, 온보딩 팝업 판정이 게이트를 따로 두지 않아도 자동으로 맞는다.

## 빌드

**Java 21 이 필요하다** (Capacitor 8). 시스템에 없으면 안드로이드 스튜디오 번들 JDK 를 쓴다.

```bash
# 웹 번들 → 안드로이드 프로젝트 동기화
npm run build:android

# APK (디버그)
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME=$HOME/Library/Android/sdk \
  ./android/gradlew -p android assembleDebug

# 산출물: android/app/build/outputs/apk/debug/app-debug.apk
```

안드로이드 스튜디오로 열려면 `npm run android:open`.

## 웹 빌드와 다른 점

`BUILD_TARGET=native` 일 때 (vite.config.ts):

- `base` 가 상대경로 — 웹뷰는 앱 루트에서 서빙하므로 `/portfolio-web/` 이면 자산을 못 찾는다
- **PWA(서비스워커) 제외** — 앱은 APK 로 갱신한다. SW 가 남으면 옛 번들을 붙잡아
  앱을 새로 깔아도 화면이 안 바뀌는 사고가 난다

## 알려진 제약

- **Yahoo 는 여기서도 막힐 수 있다.** 로컬 Node 프록시가 429 를 맞는 이유가 '비브라우저
  TLS 지문' 인데 OkHttp 도 브라우저가 아니다(크롬 확장은 진짜 브라우저라 통과한다).
  실패하면 기존 프록시 경로로 자동 폴백하므로 앱이 멈추지는 않는다.
- **배포는 APK 직접 설치**를 전제로 한다. 플레이스토어는 심사가 있고, 증권사 비공식 API 를
  쓰는 앱이라 약관 리스크가 있다. 확장처럼 GitHub 릴리스로 내보내는 편이 낫다.
- **iOS 는 사실상 불가.** 같은 방식이 동작하긴 하나 사이드로드가 막혀 있어 배포할 길이 없다.
