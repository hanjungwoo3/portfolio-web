// APK 새 버전 알림 — 안드로이드 앱에서만 뜬다.
//
// 왜 필요한가 — 앱은 웹을 원격 로드(server.url)해서 웹 변경은 자동으로 따라오지만,
//   네이티브 쪽(플러그인·매니페스트·권한)은 APK 를 갈아야 바뀐다. 그런데 사용자는
//   APK 가 새로 나온 걸 알 방법이 없었다 — 설정 안쪽에 작게 표시될 뿐이었다.
//   구글 로그인이 네이티브 플러그인으로 옮겨간 뒤로는 옛 APK 가 기능을 아예 못 쓰므로
//   화면 앞으로 끌어내야 한다.
//
// 웹 번들 갱신 알림(NewVersionToast)과는 다른 축이다 — 저건 웹, 이건 APK.

import { useEffect, useState } from "react";
import { isNativeApp } from "../lib/nativeProxy";
import {
  getInstalledAppVersion, fetchLatestRelease, openApkDownload, APK_DOWNLOAD_URL, type LatestRelease,
} from "../lib/appRelease";
// 버전 비교는 설정 화면과 같은 함수를 쓴다 — 규칙이 갈라지면 한쪽만 안 뜨는 일이 생긴다.
import { compareVersion } from "../lib/extensionProxy";

export function AppUpdateToast() {
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    void (async () => {
      const [v, rel] = await Promise.all([getInstalledAppVersion(), fetchLatestRelease()]);
      if (!alive) return;
      setInstalled(v);
      setLatest(rel);
    })();
    return () => { alive = false; };
  }, []);

  if (dismissed || !installed || !latest) return null;
  if (compareVersion(installed, latest.version) >= 0) return null;

  // ★ 닫아도 영구히 숨기지 않는다. 앱을 다시 켜면 또 뜬다.
  //   옛 APK 는 구글 로그인이 아예 안 되므로(네이티브 플러그인이 없다) 한 번 닫았다고
  //   영영 안 알리면 사용자가 고장난 채로 남는다. 지금 화면에서만 치운다.
  const close = () => setDismissed(true);

  return (
    <div className="fixed inset-x-2 top-2 z-[60] mx-auto max-w-md rounded-lg border border-emerald-300
                    bg-emerald-50 shadow-lg px-3 py-2 text-[12px] text-emerald-900">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">📦</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold">앱 새 버전 v{latest.version}</div>
          <div className="text-emerald-800 leading-relaxed">
            지금 v{installed} 입니다. 새 APK 를 설치하면 최신 기능이 적용됩니다.
          </div>
          <button onClick={() => { void openApkDownload(latest.apkUrl ?? APK_DOWNLOAD_URL); }}
                  className="inline-block mt-1.5 px-2 py-1 rounded bg-emerald-600 text-white font-bold">
            ↓ 내려받기
          </button>
        </div>
        <button onClick={close} aria-label="닫기"
                className="shrink-0 text-emerald-700 hover:text-emerald-900 text-lg leading-none">✕</button>
      </div>
    </div>
  );
}
