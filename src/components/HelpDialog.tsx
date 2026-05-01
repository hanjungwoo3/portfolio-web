import { useEffect, useRef, useState } from "react";

// 첫 사용자 빠른 시작 가이드 — PC 6 step / 모바일 4 step.
// 헤더 ❓ 버튼으로 수동 호출 + 첫 방문 자동 노출 (localStorage flag).

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant?: "pc" | "mobile";
}

interface Step {
  title: string;
  caption: React.ReactNode;
  image: string;
  alt: string;
}

const PC_STEPS: Step[] = [
  {
    title: "1. 검색 열기",
    caption: (
      <>
        우상단 <b>🔍 검색</b> 버튼으로 시작합니다.
        <br />
        <span className="text-gray-500 text-xs">
          <b>❓ 사용법</b> = 이 가이드 / <b>⚙️ 설정</b> = 프록시·백업·폴링 주기 변경.
        </span>
      </>
    ),
    image: "./help/quickstart-1-header.png",
    alt: "헤더 — 검색·사용법·후원·설정 버튼",
  },
  {
    title: "2. 종목 검색",
    caption: (
      <>
        종목명 일부만 입력해도 자동완성됩니다 (예: <code>삼성</code> → 10개).
        <br />
        <span className="text-gray-500 text-xs">
          처음이면 <b>"관심"</b> 그룹이 자동 선택돼요. 원하는 행만 체크하거나 그대로 두세요.
        </span>
      </>
    ),
    image: "./help/quickstart-2-search.png",
    alt: "검색 다이얼로그 — 삼성 검색 결과 + 관심 그룹 자동 마킹",
  },
  {
    title: "3. 일괄적용",
    caption: (
      <>
        하단 <b>✅ 일괄적용</b> 클릭 — 체크된 모든 종목이 한 번에 추가됩니다.
        <br />
        <span className="text-gray-500 text-xs">
          수량 비워두면 <b>관심종목</b>, 수량/평단가 채우면 <b>보유종목</b>.
        </span>
      </>
    ),
    image: "./help/quickstart-3-apply.png",
    alt: "스크롤된 검색 결과 + 일괄적용 버튼",
  },
  {
    title: "4. 결과 확인",
    caption: (
      <>
        <b>관심 탭</b> 이 자동 생성되고 카드가 표시됩니다.
        <br />
        <span className="text-gray-500 text-xs">
          어제대비 변동률 내림차순 정렬. 가격·외국인/기관/연기금·외인비율이 5초마다 갱신.
        </span>
      </>
    ),
    image: "./help/quickstart-4-result.png",
    alt: "결과 — 관심 탭에 카드 표시",
  },
  {
    title: "5. 카드 위에 마우스",
    caption: (
      <>
        카드 위에 <b>마우스를 올리면</b> 책갈피 우측에 숨겨진 버튼이 등장합니다.
        <br />
        <span className="text-gray-500 text-xs">
          <b>📊</b> 기업가치 / <b>✏️</b> 수정 (수량·평단가) / <b>🗑</b> 삭제.
        </span>
      </>
    ),
    image: "./help/quickstart-5-hover.png",
    alt: "카드 호버 — 숨겨진 버튼 등장",
  },
  {
    title: "6. 기업가치 모달",
    caption: (
      <>
        <b>📊</b> 클릭 시 외국인·기관·연기금 누적 흐름과 기간별 합계가 표시됩니다.
        <br />
        <span className="text-gray-500 text-xs">
          좌측 외국인 / 우측 기관계 — 일별 막대 + 누적 라인. 표는 5/20/60/120/200일 합계.
        </span>
      </>
    ),
    image: "./help/quickstart-6-valuation.png",
    alt: "기업가치 모달 — 외국인/기관 차트 + 기간별 합계 표",
  },
];

const MOBILE_STEPS: Step[] = [
  {
    title: "1. 첫 화면",
    caption: (
      <>
        상단의 <b>🔍</b> 으로 종목 검색, <b>❓</b> 로 이 가이드, <b>⚙️</b> 로 설정.
        <br />
        <span className="text-gray-500 text-xs">
          기본은 미국 증시 탭. 본인 종목을 추가해보세요.
        </span>
      </>
    ),
    image: "./help/mobile-1-header.png",
    alt: "모바일 헤더 + 첫 화면",
  },
  {
    title: "2. 종목 검색",
    caption: (
      <>
        종목명 일부만 입력해도 자동완성 결과가 나옵니다.
        <br />
        <span className="text-gray-500 text-xs">
          처음이면 <b>"관심"</b> 그룹이 자동 선택돼요. 그대로 <b>일괄적용</b> 하면 등록 끝.
        </span>
      </>
    ),
    image: "./help/mobile-2-search.png",
    alt: "모바일 검색 다이얼로그",
  },
  {
    title: "3. 카드 + 편집",
    caption: (
      <>
        <b>관심 탭</b> 자동 생성. 카드 우측의 <b>✏️ 🗑</b> 으로 즉시 수정·삭제.
        <br />
        <span className="text-gray-500 text-xs">
          가격·수급·외인비율이 5초마다 갱신. 종목명 클릭 = 토스 앱으로 이동.
        </span>
      </>
    ),
    image: "./help/mobile-3-result.png",
    alt: "모바일 결과 — 카드 + 편집 버튼",
  },
  {
    title: "4. 그룹 길게 누르기",
    caption: (
      <>
        그룹 탭을 <b>0.5초 길게 누르면</b> 바텀시트가 올라와요.
        <br />
        <span className="text-gray-500 text-xs">
          ✏️ 이름 변경 / 🗑 그룹 삭제. 미국 증시 탭은 보호 (편집 불가).
        </span>
      </>
    ),
    image: "./help/mobile-4-action-sheet.png",
    alt: "모바일 그룹 액션 시트",
  },
];

// 이미지 — 없으면 플레이스홀더
function Shot({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded border border-dashed border-gray-300
                      bg-gray-50 flex items-center justify-center text-xs
                      text-gray-400 aspect-[16/9]">
        📷 스크린샷 ({alt})
      </div>
    );
  }
  return (
    <img src={src} alt={alt}
         onError={() => setFailed(true)}
         className="w-full rounded border border-gray-200 shadow-sm" />
  );
}

export function HelpDialog({ isOpen, onClose, variant = "pc" }: Props) {
  const STEPS = variant === "mobile" ? MOBILE_STEPS : PC_STEPS;
  const [step, setStep] = useState(0);
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen]);

  // ESC 닫기, ←→ 키 이동
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
      if (e.key === "ArrowRight" && step < STEPS.length - 1) setStep(step + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, step, onClose, STEPS.length]);

  if (!isOpen) return null;

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/50 p-2 sm:p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
         }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl
                       max-h-[92vh] flex flex-col overflow-hidden">

        {/* 헤더 */}
        <header className="px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50
                            flex items-center">
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <span>❓</span>빠른 시작 — {cur.title}
          </h2>
          <span className="ml-2 text-xs text-gray-500">
            ({step + 1} / {STEPS.length})
          </span>
          <button onClick={onClose}
                  className="ml-auto px-3 py-1 rounded hover:bg-white/60
                             text-sm text-gray-600">
            ✕
          </button>
        </header>

        {/* 본문 — 캡션 + 이미지 */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            {cur.caption}
          </p>
          <Shot src={cur.image} alt={cur.alt} />
        </div>

        {/* 풋터 — 페이저 */}
        <footer className="px-4 py-3 border-t bg-gray-50 flex items-center gap-2">
          <button onClick={() => setStep(s => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="px-3 py-1.5 rounded text-sm bg-white border
                             border-gray-300 hover:bg-gray-100
                             disabled:opacity-30 disabled:cursor-not-allowed">
            ◀ 이전
          </button>

          {/* 도트 */}
          <div className="flex items-center gap-1.5 mx-auto">
            {STEPS.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                      aria-label={`${i + 1} 단계로 이동`}
                      className={`w-2 h-2 rounded-full transition
                                 ${i === step ? "bg-blue-600 w-4" : "bg-gray-300"}`} />
            ))}
          </div>

          {!isLast ? (
            <button onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
                    className="px-3 py-1.5 rounded text-sm bg-blue-600
                               hover:bg-blue-700 text-white font-medium">
              다음 ▶
            </button>
          ) : (
            <button onClick={() => { markHelpSeen(); onClose(); }}
                    className="px-4 py-1.5 rounded text-sm bg-emerald-600
                               hover:bg-emerald-700 text-white font-bold">
              ✅ 시작하기
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// 첫 방문 자동 노출 헬퍼
const HELP_SEEN_KEY = "help_seen_v1";

export function markHelpSeen() {
  try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch { /* noop */ }
}

export function shouldShowHelpFirstTime(): boolean {
  try { return localStorage.getItem(HELP_SEEN_KEY) !== "1"; } catch { return false; }
}
