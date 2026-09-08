#!/usr/bin/env node
// 안드로이드 APK 배포 준비 — 빌드된 릴리스 APK 를 public/app/ 으로 옮기고 release.json 을 쓴다.
//
// 왜 gh-pages 로 직접 배포하나 —
//   GitHub 릴리스 자산 링크는 release-assets.githubusercontent.com 으로 리다이렉트되고
//   서명 토큰이 붙는데, 안드로이드 브라우저 다운로드 매니저가 이걸 못 이어받아
//   "다운로드 중..." 에서 멈추는 일이 있다(실측). gh-pages 는 웹 앱과 같은 출처라
//   리다이렉트도 토큰도 없어서 그 경로를 통째로 피한다.
//   GitHub 릴리스는 그대로 낸다 — 이건 어디까지나 '받기 쉬운 경로' 를 하나 더 두는 것.
//
//   사용:  npm run pack:app        (assembleRelease 를 먼저 돌린 뒤)
//   결과:  public/app/portfolio-app.apk
//          public/app/release.json  { version, url }

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";

const APK_SRC = "android/app/build/outputs/apk/release/app-release.apk";
const OUT_DIR = "public/app";
const APK_NAME = "portfolio-app.apk";   // 고정 이름 — 링크가 버전마다 안 바뀌게
const BASE = "https://hanjungwoo3.github.io/portfolio-web";

if (!existsSync(APK_SRC)) {
  console.error(`❌ 릴리스 APK 가 없습니다: ${APK_SRC}`);
  console.error("   먼저 빌드하세요:");
  console.error('   npm run build:android && (cd android && ./gradlew assembleRelease)');
  process.exit(1);
}

// 버전은 build.gradle 의 versionName 이 유일한 근거 — 손으로 두 곳을 맞추다 어긋나지 않게.
const gradle = readFileSync("android/app/build.gradle", "utf8");
const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (!version) {
  console.error("❌ android/app/build.gradle 에서 versionName 을 못 찾았습니다.");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(APK_SRC, `${OUT_DIR}/${APK_NAME}`);
writeFileSync(
  `${OUT_DIR}/release.json`,
  JSON.stringify({ version, url: `${BASE}/app/${APK_NAME}` }, null, 2) + "\n",
);

const mb = (statSync(`${OUT_DIR}/${APK_NAME}`).size / 1048576).toFixed(1);
console.log(`  ${OUT_DIR}/${APK_NAME}  (${mb}MB)`);
console.log(`  ${OUT_DIR}/release.json  v${version}`);
console.log("완료 — 배포(npm run deploy)하면 앱 설정의 다운로드 링크가 이 파일을 가리킵니다.");
