import { useEffect, useRef, useState } from "react";
import { getPersonalProxyUrl } from "../lib/proxyConfig";

// 권장은 Deno — 브라우저만으로 1~2분이고, 무엇보다 Cloudflare 와 나가는 IP 풀이 다르다.
//   토스는 IP 풀 단위로 막기 때문에, 공개 프록시(Cloudflare 포함)가 막힐 때 개인
//   Cloudflare 워커를 배포해봐야 같이 막힌다. 안내가 그걸 권하면 사용자가 10분을 쓰고도
//   증상이 그대로다. Cloudflare 가이드는 보조 링크로만 남긴다.
const DENO_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/deno-proxy/README.md";
const CF_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md";
const EXT_GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/extension/README.md";

interface Props {
  onOpenSettings: () => void;
}

// 전용 프록시 도입 권유 팝업 — 공개 인프라(합계 40만 req/일) 부담 분산이 목적.
// 전용 프록시를 설정하면 영영 안 뜬다. 설정 안 한 사용자에게도 '매 새로고침'은 과해서
// 닫으면 SNOOZE_DAYS 동안 쉰다 (권유는 유지하되 잔소리는 안 되게).
const SNOOZE_KEY = "onboarding_snoozed_at";
const SNOOZE_DAYS = 7;

function isSnoozed(): boolean {
  try {
    const ts = Number(localStorage.getItem(SNOOZE_KEY) ?? "0");
    return Date.now() - ts < SNOOZE_DAYS * 24 * 3600 * 1000;
  } catch { return false; }
}
function snooze(): void {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* 무시 */ }
}

// 1초 지연 후 등장 — 즉시 띄우면 부담.
export function OnboardingDialog({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    if (getPersonalProxyUrl()) return;  // 이미 전용 프록시 설정 → 영원히 안 띄움
    if (isSnoozed()) return;
    const t = setTimeout(() => {
      // 1초 뒤 재확인 — 확장은 전용 프록시 목록에 합성되어 들어오는데 그 감지가
      // postMessage 핸드셰이크라 마운트 시점엔 아직 없을 수 있다. 여기서 다시 보지 않으면
      // 확장 사용자에게 "프록시를 배포하세요" 팝업이 뜬다.
      if (getPersonalProxyUrl()) return;
      setOpen(true);
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;

  // 어떤 경로로 닫든 유예 시작 — 배경 클릭·나중에·설정 열기 모두 '봤다'로 친다.
  const close = () => { snooze(); setOpen(false); };

  const openSettingsAndClose = () => {
    snooze();
    setOpen(false);
    onOpenSettings();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/40 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) close();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full
                       max-h-[90vh] overflow-y-auto">
        <header className="px-5 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <h2 className="text-base font-bold text-gray-800">
            🎉 포트폴리오 사용을 환영합니다
          </h2>
        </header>

        <div className="px-5 py-4 space-y-3 text-sm text-gray-700">
          {/* 활성 공개 프록시 — .env(VITE_PROXY_URL*) 변동 시 함께 갱신.
              현재 활성: Cloudflare / Netlify / Supabase (Vercel·Deno·Render는 한도초과로 일시 제외) */}
          <p>
            현재 <b>공개 프록시 3개</b> (Cloudflare/Netlify/Supabase)를
            모든 사용자가 함께 사용하고 있습니다.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded p-2.5
                          text-xs text-amber-800">
            ⚠️ 사용자가 늘어나면서 공개 인프라 한도(일 합계 약 40만 req)가
            초과될 수 있습니다. 한도 초과 시 모두 갱신이 멈춥니다.
          </div>

          <p className="font-medium text-gray-800">
            💡 본인 전용 프록시를 하나 두시면:
          </p>
          <ul className="text-xs space-y-1 pl-4 list-disc text-gray-600">
            <li>본인 <b>100k req/일 전용</b> (사실상 무제한)</li>
            <li>폴링 주기 <b>5초/10초/30초/60초</b> 선택 가능</li>
            <li>공개 인프라 한도 영향 없음</li>
            <li><b>시세가 빈 칸으로 나오는 문제</b>도 같이 해결됩니다</li>
            <li><b>무료</b>, 신용카드 불필요, 코딩 지식 불필요</li>
          </ul>

          <div className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-xs text-emerald-900">
            👍 <b>Deno Deploy 를 권합니다</b> — GitHub 로 1클릭 가입 후 코드를 붙여넣고
            저장하면 끝. 터미널 없이 <b>브라우저만으로 1~2분</b>입니다.
            <div className="mt-1 text-emerald-800/80">
              Cloudflare 도 되지만 가입 절차가 길고(약 10분), 공개 프록시와 나가는 IP 를
              공유해서 시세가 막히는 문제는 그대로일 수 있습니다.
            </div>
          </div>

          <div className="text-xs text-gray-500">
            🧩 <b>PC 크롬·엣지</b>를 쓰신다면 <b>확장 프로그램</b>이 더 간편합니다 —
            설치만 하면 프록시 배포가 아예 필요 없습니다(휴대폰은 불가).&nbsp;
            <a href={EXT_GUIDE_URL} target="_blank" rel="noopener noreferrer"
               className="text-blue-600 underline">확장 안내 ↗</a>
          </div>

          <div className="flex gap-2 pt-1">
            <a href={DENO_GUIDE_URL} target="_blank" rel="noopener noreferrer"
               className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700
                          text-white text-xs text-center rounded font-medium">
              📖 Deno 배포 가이드 (1~2분)
            </a>
            <button onClick={openSettingsAndClose}
                    className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700
                               text-white text-xs rounded font-medium">
              ⚙️ 설정 열기
            </button>
          </div>

          <div className="text-[11px] text-gray-400 pt-0.5">
            다른 방법:&nbsp;
            <a href={CF_GUIDE_URL} target="_blank" rel="noopener noreferrer"
               className="underline hover:text-gray-600">Cloudflare Worker 배포 (약 10분)</a>
          </div>
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50 flex justify-end">
          <button onClick={close}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200
                             text-gray-700 text-xs rounded">
            나중에
          </button>
        </footer>
      </div>
    </div>
  );
}
