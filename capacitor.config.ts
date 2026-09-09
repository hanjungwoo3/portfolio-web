import type { CapacitorConfig } from "@capacitor/cli";

// 안드로이드 앱 껍데기 — 웹 코드는 그대로 쓰고 통신만 네이티브로 뺀다.
//   브라우저에서 프록시가 필요했던 이유는 CORS 다. 네이티브 HTTP 에는 CORS 가 없어서
//   앱에서는 토스·네이버를 직접 부른다(src/lib/nativeProxy.ts). → 프록시 서버 불필요.
//
//   빌드:  npm run build:android   (dist 를 네이티브용으로 만들고 android 프로젝트에 동기화)
//   실행:  npx cap open android    (안드로이드 스튜디오) 또는 android/gradlew assembleDebug
const config: CapacitorConfig = {
  appId: "io.github.hanjungwoo3.portfolio",
  appName: "포트폴리오",
  webDir: "dist",
  // ★ 원격 로드 — 배포된 웹을 그대로 불러온다. 웹만 배포하면 앱도 따라오므로
  //   웹 코드가 바뀔 때마다 APK 를 다시 낼 필요가 없다.
  //   네이티브 브릿지는 URL 과 무관하게 웹뷰에 주입되므로 CORS 우회(nativeProxy)는 그대로다.
  //
  //   대가 두 가지:
  //     · 오프라인이면 시작하지 못한다(번들 사본은 남아 있지만 자동 폴백은 없다).
  //     · gh-pages 가 죽으면 앱도 멈춘다.
  //   그리고 출처가 https://localhost → https://hanjungwoo3.github.io 로 바뀌므로
  //   그전에 앱에 쌓인 IndexedDB 데이터는 새 출처에서 안 보인다(전환 시 1회).
  //   앱 저장소는 크롬과 별개다 — 출처가 같아도 공유되지 않는다(안드로이드 웹뷰 특성).
  server: {
    url: "https://hanjungwoo3.github.io/portfolio-web/",
  },
  android: {
    // 웹뷰는 https(gh-pages)로 로드된다. http 자산을 섞을 일이 없으므로 꺼 둔다.
    allowMixedContent: false,
  },
  plugins: {
    // ★ 전역 fetch/XHR 패치는 끈다.
    //   켜면 모든 요청이 네이티브로 새어 나가 어디로 나가는지 흐려지고,
    //   raw.githubusercontent.com 처럼 CORS 가 열려 있어 웹뷰가 직접 받아도 되는 것까지 끌고 간다.
    //   필요한 호출만 nativeProxy.fetchViaNative 로 명시해서 보낸다.
    CapacitorHttp: { enabled: false },
  },
};

export default config;
