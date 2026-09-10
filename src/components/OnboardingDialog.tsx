import { APK_DOWNLOAD_URL as APK_URL } from "../lib/appRelease";
import { useEffect, useRef, useState } from "react";
import {
  getPersonalProxyUrl, getEnabledPersonalProxies, isSyntheticProxyUrl, hasDirectTransport,
} from "../lib/proxyConfig";

// 권장 순서: 확장(PC) → 앱(안드로이드) → 개인 프록시(그 외).
//   확장·앱은 브라우저·폰에서 직접 받아오므로 프록시가 아예 필요 없다 — 공개 인프라 부담이
//   0 이고 사용자도 설정할 게 없다. 프록시 배포는 그 둘이 안 되는 환경(iOS·기타 브라우저)에서만
//   권한다. 예전엔 이 팝업이 프록시 배포를 앞세웠는데, 설치 한 번이면 끝나는 길을 두고
//   더 번거로운 쪽으로 보내는 셈이었다.
//
//   프록시를 권할 때도 Deno 다. Cloudflare 는 배포해도 소용이 없을 수 있다 —
//   2026-09-09 실측: 토스 wts-info-api 가 Cloudflare Workers egress 를 400 으로 거부했고
//   공개·개인 워커(다른 계정)가 함께 막혔다. 같은 IP로 wts-cert-api 는 200 이라 호스트 한정이다.
const DENO_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/deno-proxy/README.md";
const CF_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md";
const EXT_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/extension/README.md";
// APK 는 gh-pages 직링크를 쓴다 — GitHub 릴리스 자산 링크는 안드로이드 다운로드 매니저가
//   못 이어받아 "다운로드 중…" 에서 멈추는 일이 있다(실측).


interface Props {
  onOpenSettings: () => void;
}

// 설명과 버튼을 따로 두면 같은 말을 두 번 읽게 된다 → 설명 줄 자체를 누르게 한다.
const ROW = "flex items-start gap-2 w-full text-left rounded-md border px-2.5 py-2 transition-colors";

function ChoiceRow({ href, icon, title, desc, tone, download }: {
  href: string; icon: string; title: string; desc: string;
  tone: "blue" | "emerald" | "indigo";
  // APK 는 '이동' 이 아니라 '내려받기' 여야 한다. target=_blank 로 이동시키면 서비스워커의
  //   SPA 폴백이 그 주소를 가로채 index.html 을 내주고, 앱 화면이 대신 뜬다(실측).
  download?: boolean;
}) {
  const tones = {
    blue:    "border-blue-200 bg-blue-50/60 hover:bg-blue-100",
    emerald: "border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100",
    indigo:  "border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100",
  };
  return (
    <a href={href}
       {...(download ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}
       className={`${ROW} ${tones[tone]}`}>
      <span className="shrink-0 text-base leading-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-gray-800">{title}</span>
        <span className="block text-[11px] text-gray-600">{desc}</span>
      </span>
      <span className="shrink-0 text-[11px] text-gray-400">{download ? "⬇" : "↗"}</span>
    </a>
  );
}

// 전용 프록시 도입 권유 팝업 — 공개 인프라(합계 40만 req/일) 부담 분산이 목적.
// 전용 프록시를 설정하면 영영 안 뜬다. 설정 안 한 사용자에게도 '매 새로고침'은 과해서
// 닫으면 SNOOZE_DAYS 동안 쉰다 (권유는 유지하되 잔소리는 안 되게).
const SNOOZE_KEY = "onboarding_snoozed_at";
const SNOOZE_DAYS = 7;
// ★ Cloudflare 경고에는 유예가 없다. 이건 권유가 아니라 '지금 설정이 제 일을 못 하고 있다' 는
//   사실 통지다. 숨겨 두면 사용자는 고칠 이유를 영영 모른 채 공용 자원만 쓰게 된다.
//   설정을 실제로 바꾸면(확장·앱·비-CF 프록시) 조건이 거짓이 되어 저절로 사라진다.

type Mode = "no-proxy" | "cf-only";

function isSnoozed(key: string): boolean {
  try {
    const ts = Number(localStorage.getItem(key) ?? "0");
    return Date.now() - ts < SNOOZE_DAYS * 24 * 3600 * 1000;
  } catch { return false; }
}
function snooze(key: string): void {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* 무시 */ }
}

// 켜 둔 전용 프록시에 Cloudflare 가 하나라도 있는가.
//   토스 wts-info-api 가 Cloudflare egress 를 거부하므로(실측) 그 워커는 종목 시세를 못 받는다.
//   ★ '전부 Cloudflare' 로 좁히면 CF + 죽은 다른 공급자를 함께 켜 둔 사람을 놓친다. 그 사람도
//     결국 공용에 얹혀 가므로 똑같이 알려야 한다. 켜져 있으면 매 요청마다 헛호출도 한 번 더 난다.
function hasCloudflareProxy(): boolean {
  return getEnabledPersonalProxies()
    .filter(u => !isSyntheticProxyUrl(u))
    .some(u => {
      try { return new URL(u).hostname.endsWith("workers.dev"); } catch { return false; }
    });
}

// 1초 지연 후 등장 — 즉시 띄우면 부담.
export function OnboardingDialog({ onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      // 1초 뒤에 판정 — 확장은 전용 프록시 목록에 합성되어 들어오는데 그 감지가
      // postMessage 핸드셰이크라 마운트 시점엔 아직 없을 수 있다. 먼저 보면
      // 확장 사용자에게 "프록시를 배포하세요" 팝업이 뜬다.
      if (hasDirectTransport()) return;                 // 확장·앱 사용자는 아무것도 안 띄움
      if (hasCloudflareProxy()) { setMode("cf-only"); return; }   // 유예 없음 — 고칠 때까지 뜬다
      if (getPersonalProxyUrl()) return;                // 다른 전용 프록시가 있으면 정상
      if (!isSnoozed(SNOOZE_KEY)) setMode("no-proxy");
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  if (!mode) return null;
  const cfMode = mode === "cf-only";

  // CF 경고는 닫아도 유예하지 않는다 — 다음 접속 때 다시 뜬다.
  const close = () => { if (!cfMode) snooze(SNOOZE_KEY); setMode(null); };
  const dismiss = close;

  const openSettingsAndClose = () => {
    if (!cfMode) snooze(SNOOZE_KEY);
    setMode(null);
    onOpenSettings();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) dismiss();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full
                       max-h-[90vh] overflow-y-auto">
        <header className={`px-5 py-3 border-b bg-gradient-to-r ${
              mode === "cf-only" ? "from-amber-50 to-rose-50" : "from-blue-50 to-indigo-50"}`}>
          <h2 className="text-base font-bold text-gray-800">
            {mode === "cf-only"
              ? "⚠️ 지금 공용 서버에 얹혀 가고 있습니다"
              : "🎉 포트폴리오 사용을 환영합니다"}
          </h2>
        </header>

        {mode === "cf-only" ? (
        <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
          <p>
            등록해 두신 <b>Cloudflare Worker</b> 로는 <b>종목 시세를 못 받아옵니다</b>.
            증권사가 Cloudflare 에서 나가는 요청만 거부합니다 — 워커 사용량이 남아 있어도
            소용이 없고, 그 부분은 <b>공용 서버가 대신 받고 있습니다</b>.
            요청마다 Cloudflare 로 한 번 헛걸음까지 합니다.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
            지금은 화면이 정상으로 보일 수 있습니다. 다만 <b>공용 서버가 막히면 함께 멈춥니다</b> —
            전용 서버를 두신 의미가 없어지는 셈입니다. 실제로 오늘 그렇게 멈춘 일이 있었습니다.
          </div>

          <p className="font-medium text-gray-800">💡 아래 중 하나면 공용 서버에 기대지 않습니다</p>

          <div className="space-y-1.5">
            <ChoiceRow href={EXT_GUIDE_URL} icon="🧩" tone="blue"
                       title="PC 크롬·엣지 — 확장 프로그램 설치"
                       desc="설치만 하면 끝. 중계 서버가 아예 필요 없습니다" />
            <ChoiceRow href={APK_URL} icon="📱" tone="emerald" download
                       title="안드로이드 — 앱(APK) 받기"
                       desc="앱이 직접 받아옵니다. 모바일에선 이 방법뿐입니다" />
            <ChoiceRow href={DENO_GUIDE_URL} icon="🦕" tone="indigo"
                       title="그 외(아이폰 등) — Deno 중계 서버"
                       desc="브라우저만으로 1~2분. 지금 정상 작동 확인됨" />
          </div>

          <button onClick={openSettingsAndClose}
                  className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-900
                             text-white text-xs rounded font-medium">
            ⚙️ 설정 열기 (중계 서버 교체)
          </button>

          <p className="text-[11px] text-gray-400">
            Cloudflare 워커는 지우지 않아도 됩니다 — 다른 중계 서버를 하나 더 등록하면
            앱이 알아서 살아있는 쪽으로 보냅니다. 증권사 정책이 바뀌면 다시 쓸 수 있습니다.
          </p>
        </div>
        ) : (
        <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
          <p>
            시세는 공개 중계 서버를 <b>모든 사용자가 함께</b> 쓰고 있습니다.
            한도가 차거나 증권사가 막으면 <b>다 같이 갱신이 멈춥니다</b>.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded p-2.5
                          text-xs text-amber-800">
            ⚠️ 실제로 오늘 공개 서버가 막혀 시세가 빈 칸으로 나온 일이 있었습니다.
          </div>

          <p className="font-medium text-gray-800">
            💡 설치 한 번이면 중계 서버를 아예 안 거칩니다
          </p>

          <div className="space-y-1.5">
            <ChoiceRow href={EXT_GUIDE_URL} icon="🧩" tone="blue"
                       title="PC 크롬·엣지 — 확장 프로그램 설치"
                       desc="설치만 하면 브라우저가 직접 받아옵니다. 설정할 것 없음" />
            <ChoiceRow href={APK_URL} icon="📱" tone="emerald" download
                       title="안드로이드 — 앱(APK) 받기"
                       desc="앱이 직접 받아옵니다. 모바일에선 이 방법뿐입니다" />
            <ChoiceRow href={DENO_GUIDE_URL} icon="🦕" tone="indigo"
                       title="아이폰·기타 — Deno 중계 서버"
                       desc="무료·카드 불필요·브라우저만으로 1~2분" />
          </div>

          <div className="text-[11px] text-emerald-800/80">
            확장·앱은 호출 한도가 없고, 남과 나눠 쓰지 않아 <b>5·10초 갱신</b>도 열립니다.
          </div>

          <div className="text-xs text-gray-500 pt-1">
            <div className="text-[11px] text-gray-400">
              ⚠️ Cloudflare 는 권하지 않습니다 — 증권사가 Cloudflare 쪽 요청을 막고 있어
              배포해도 증상이 그대로일 수 있습니다.
              (<a href={CF_GUIDE_URL} target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-gray-600">그래도 보려면</a>)
            </div>
          </div>

          <button onClick={openSettingsAndClose}
                  className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700
                             text-white text-xs rounded font-medium">
            ⚙️ 설정 열기 (중계 서버 등록)
          </button>
        </div>
        )}

        <footer className="px-5 py-3 border-t bg-gray-50 flex justify-end">
          <button onClick={close}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                             text-gray-700 text-xs rounded">
            {cfMode ? "닫기 (설정을 바꾸기 전까지 다시 안내됩니다)" : "나중에"}
          </button>
        </footer>
      </div>
    </div>
  );
}
