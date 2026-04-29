import { useEffect, useRef, useState } from "react";
import { getPersonalProxyUrl } from "../lib/proxyConfig";

const GUIDE_URL =
  "https://github.com/hanjungwoo3/portfolio-web/blob/main/workers/proxy/DEPLOY-USER.md";

interface Props {
  onOpenSettings: () => void;
}

// 첫 접속 + 매 접속 시 전용 프록시 도입 권유 팝업.
// 전용 프록시 설정 전까지 계속 표시 — 공개 인프라 부담 분산이 목적.
// 1초 지연 후 등장 — 즉시 띄우면 부담.
export function OnboardingDialog({ onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    const personal = getPersonalProxyUrl();
    if (personal) return;  // 이미 전용 프록시 설정 → 영원히 안 띄움
    const t = setTimeout(() => setOpen(true), 1000);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;

  const close = () => setOpen(false);

  const openSettingsAndClose = () => {
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
          <p>
            현재 <b>공개 프록시 4개</b> (Cloudflare/Vercel/Deno/Render)를
            모든 사용자가 함께 사용하고 있습니다.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded p-2.5
                          text-xs text-amber-800">
            ⚠️ 사용자가 늘어나면서 공개 인프라 한도(일 합계 약 40만 req)가
            초과될 수 있습니다. 한도 초과 시 모두 갱신이 멈춥니다.
          </div>

          <p className="font-medium text-gray-800">
            💡 본인 전용 Cloudflare Worker 배포 시:
          </p>
          <ul className="text-xs space-y-1 pl-4 list-disc text-gray-600">
            <li>본인 <b>100k req/일 전용</b> (사실상 무제한)</li>
            <li>폴링 주기 <b>5초/10초/30초/60초</b> 선택 가능</li>
            <li>공개 인프라 한도 영향 없음</li>
            <li><b>무료</b>, 신용카드 불필요, 약 10분 소요</li>
            <li>코딩 지식 불필요 — 가이드 따라 클릭만</li>
          </ul>

          <div className="flex gap-2 pt-1">
            <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer"
               className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700
                          text-white text-xs text-center rounded font-medium">
              📖 배포 가이드 보기
            </a>
            <button onClick={openSettingsAndClose}
                    className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700
                               text-white text-xs rounded font-medium">
              ⚙️ 설정 열기
            </button>
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
