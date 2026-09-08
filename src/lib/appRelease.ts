// 안드로이드 앱 버전 확인 — 설치된 APK 가 최신인지 알려준다.
//
//   확장은 버전을 앱 코드의 상수(EXPECTED_EXTENSION_VERSION)와 비교했다. 앱은 그 방식이
//   안 통한다 — 웹 번들이 APK 안에 들어 있어 '앱이 아는 기대 버전' 과 '설치된 버전' 이
//   항상 같기 때문이다. 그래서 바깥(GitHub 릴리스)에 물어본다.
//
//   릴리스 자체가 유일한 근거라 따로 관리할 버전 파일이 없다. api.github.com 은 CORS 가
//   열려 있어 프록시도 필요 없다(비인증 60회/시간 — 설정 화면에서만 부르므로 넉넉하다).

import { App } from "@capacitor/app";
import { isNativeApp } from "./nativeProxy";

export const RELEASE_PAGE = "https://github.com/hanjungwoo3/portfolio-web/releases";
// ★ /releases/latest 를 쓰면 안 된다 — 이 저장소는 확장(zip)과 앱(apk) 릴리스를 함께 낸다.
//   확장 릴리스가 최신이면 앱이 "최신입니다" 라고 잘못 말한다(실제로 그랬다).
//   → 목록을 받아 .apk 자산이 붙은 첫 릴리스를 앱 릴리스로 본다. 태그 규칙에 기대지 않는다.
const RELEASE_API = "https://api.github.com/repos/hanjungwoo3/portfolio-web/releases?per_page=20";

// 설치된 앱의 versionName (android/app/build.gradle). 웹에서는 null.
export async function getInstalledAppVersion(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const info = await App.getInfo();
    return info.version || null;
  } catch {
    return null;
  }
}

export interface LatestRelease {
  version: string;        // 태그에서 앞의 v 를 뗀 값 ("v1.2.0" → "1.2.0")
  apkUrl: string | null;  // .apk 자산 직링크 (없으면 릴리스 페이지로 보낸다)
  pageUrl: string;
}

interface GhRelease {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

// APK 가 붙은 가장 최근 릴리스. 아직 앱 릴리스를 안 냈으면 null (호출측이 "릴리스 없음" 으로 표시).
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const list = await r.json() as GhRelease[];
    if (!Array.isArray(list)) return null;
    for (const rel of list) {
      if (rel.draft) continue;
      const apk = (rel.assets ?? []).find(a => String(a.name ?? "").toLowerCase().endsWith(".apk"));
      if (!apk) continue;                       // 확장(zip) 릴리스 — 앱과 무관
      const version = String(rel.tag_name ?? "").replace(/^(app-)?v/i, "").trim();
      if (!version) continue;
      return { version, apkUrl: apk.browser_download_url ?? null, pageUrl: rel.html_url || RELEASE_PAGE };
    }
    return null;
  } catch {
    return null;
  }
}
