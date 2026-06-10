import { useEffect, useRef, useState } from "react";

// 첫 사용자 빠른 시작 가이드 — PC 8 step / 모바일 7 step.
// 헤더 ❓ 버튼으로 수동 호출 + 첫 방문 자동 노출 (localStorage flag).
// 이미지 없이 텍스트만 — 한눈에 읽히는 간결한 캐러셀.
// 순서대로 따라가면: 1~4 기본 사용 완성(추가→카드→편집), 5~ 분석 탭 순회 소개.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant?: "pc" | "mobile";
  initialStep?: number;   // 특정 탭에서 열면 해당 단계로 바로 점프
}

// 탭 키 → 빠른 시작 단계 인덱스 (지수0·섹터1·컨센서스2·ETF검색3). App/Mobile 헤더에서 사용.
export const HELP_STEP_BY_TAB: Record<string, number> = {
  "__us-market__": 0, "__kr__": 0, "__us__": 0, "__semi__": 0,  // 지수 계열
  "__sector-rank__": 1, "__sector__": 1,                        // 섹터
  "__consensus__": 2,                                           // 컨센서스
  "__etf-reverse__": 3, "__etf__": 3,                           // ETF검색
};

interface Step {
  title: string;
  caption: React.ReactNode;
}

// 헤더 버튼 칩 — 실제 버튼 색을 따라감
function SearchChip({ label = "검색" }: { label?: string }) {
  return (
    <span className="inline-block align-baseline px-1.5 py-0 rounded text-[11px]
                     bg-blue-600 text-white font-medium">{label}</span>
  );
}
function AskChip() {
  return (
    <span className="inline-block align-baseline px-1.5 py-0 rounded text-[11px]
                     bg-emerald-50 text-emerald-700 border border-emerald-200">질문하기</span>
  );
}
function SetChip() {
  return (
    <span className="inline-block align-baseline px-1.5 py-0 rounded text-[11px]
                     bg-gray-100 text-gray-700 border border-gray-200">설정</span>
  );
}

const PC_STEPS: Step[] = [
  {
    title: "1. 📈 지수 탭",
    caption: (
      <>
        📈 지수 탭에서는 <b>한국시장</b>은 물론 환율·공포지수·야간 선물 등<br />
        한국 증시에 영향을 주는 지표를 한눈에 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          한국 장이 열리기 전에 시장 전체 분위기를 확인할 수 있습니다.
        </span>
      </>
    ),
  },
  {
    title: "2. 🧩 섹터 탭",
    caption: (
      <>
        🧩 섹터 탭에서는 한국 업종별 ETF 순위로 <b>돈의 흐름</b>을 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          거래대금·등락률 순으로 어느 업종에 자금이 몰리는지 한눈에 파악할 수 있습니다.
        </span>
      </>
    ),
  },
  {
    title: "3. 🔮 컨센서스 탭",
    caption: (
      <>
        🔮 컨센서스 탭에서는 내 종목의 증권사 <b>목표주가·투자의견</b>을 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          최근 리포트 기준 <b>상승여력</b>이 큰 순으로 정렬돼요.
        </span>
      </>
    ),
  },
  {
    title: "4. 🍱 ETF검색 탭",
    caption: (
      <>
        🍱 ETF검색 탭에서는 한 종목이 <b>담긴 ETF</b>를 거꾸로 찾을 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          예: 삼성전자를 담은 ETF를 비중 순으로 볼 수 있기 때문에 분산 점검에 유용합니다.
        </span>
      </>
    ),
  },
  {
    title: "5. 🔍 검색",
    caption: (
      <>
        이제 내 종목을 담아볼까요? <SearchChip /> 버튼을 눌러요.
        <span className="block mt-1">
          종목명 일부만 입력해도 자동완성되고<br />
          체크 후 <b>✅ 일괄적용</b> 하면 한 번에 추가됩니다.
        </span>
        <span className="block mt-2 text-gray-500 text-xs">
          수량 비우면 <b>관심종목</b>, 수량·평단가 채우면 <b>보유종목</b>이 됩니다.<br />
          추가한 카드에 마우스를 올려 <b>📊</b> 기업가치 · <b>⚙️</b> 수정 · <b>🗑</b> 삭제로 편집할 수 있어요.
        </span>
      </>
    ),
  },
  {
    title: "6. 💬 질문하기",
    caption: (
      <>
<AskChip /> 에서 가입 없이 익명으로 의견을 남길 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          기능 요청 · 버그 신고 · 문의 무엇이든 환영합니다.
        </span>
      </>
    ),
  },
  {
    title: "7. ⚙️ 설정",
    caption: (
      <>
        <SetChip /> 에서 전용 프록시 · 자동 백업 · 갱신 주기 등 환경을 바꿀 수 있어요.
        <span className="block mt-4 font-bold text-gray-800">
          자, 그럼 포트폴리오 앱 사용을 시작해 볼까요? 🚀
        </span>
      </>
    ),
  },
];

const MOBILE_STEPS: Step[] = [
  {
    title: "1. 📈 지수 탭",
    caption: (
      <>
        📈 지수 탭에서는 <b>한국시장</b>은 물론 환율·공포지수·야간 선물 등<br />
        한국 증시에 영향을 주는 지표를 한눈에 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          한국 장이 열리기 전에 시장 전체 분위기를 확인할 수 있습니다.
        </span>
      </>
    ),
  },
  {
    title: "2. 🧩 섹터 탭",
    caption: (
      <>
        🧩 섹터 탭에서는 한국 업종별 ETF 순위로 <b>돈의 흐름</b>을 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          거래대금·등락률 순으로 어느 업종에 자금이 몰리는지 한눈에 파악할 수 있습니다.
        </span>
      </>
    ),
  },
  {
    title: "3. 🔮 컨센서스 탭",
    caption: (
      <>
        🔮 컨센서스 탭에서는 내 종목의 증권사 <b>목표주가·투자의견</b>을 볼 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          최근 리포트 기준 <b>상승여력</b>이 큰 순으로 정렬돼요.
        </span>
      </>
    ),
  },
  {
    title: "4. 🍱 ETF검색 탭",
    caption: (
      <>
        🍱 ETF검색 탭에서는 한 종목이 <b>담긴 ETF</b>를 거꾸로 찾을 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          예: 삼성전자를 담은 ETF를 비중 순으로 볼 수 있기 때문에 분산 점검에 유용합니다.
        </span>
      </>
    ),
  },
  {
    title: "5. 🔍 검색",
    caption: (
      <>
        이제 내 종목을 담아볼까요? 상단 <SearchChip /> 버튼을 눌러요.
        <span className="block mt-1">
          종목명 일부만 입력해도 자동완성되고<br />
          체크 후 <b>✅ 일괄적용</b> 하면 한 번에 추가됩니다.
        </span>
        <span className="block mt-2 text-gray-500 text-xs">
          수량 비우면 관심, 채우면 보유. 관심 탭 카드 우측 <b>📊 ⚙️ 🗑</b> 로 편집. 종목명 클릭 = 토스 앱 이동.
        </span>
      </>
    ),
  },
  {
    title: "6. 그룹 길게 누르기",
    caption: (
      <>
        그룹 탭을 <b>0.5초 길게 누르면</b> 바텀시트가 올라와요.
        <span className="block mt-2 text-gray-500 text-xs">
          ⚙️ 이름 변경 / 🗑 그룹 삭제. 주요 지수 탭은 보호 (편집 불가).
        </span>
      </>
    ),
  },
  {
    title: "7. 💬 질문하기",
    caption: (
      <>
        상단 <b>더보기</b> 메뉴의 <AskChip /> 에서 가입 없이 익명으로 의견을 남길 수 있어요.
        <span className="block mt-2 text-gray-500 text-xs">
          기능 요청 · 버그 신고 · 문의 무엇이든 환영합니다.
        </span>
      </>
    ),
  },
  {
    title: "8. ⚙️ 설정",
    caption: (
      <>
        상단 <b>더보기</b> 메뉴의 <SetChip /> 에서 전용 프록시 · 자동 백업 · 갱신 주기 등 환경을 바꿀 수 있어요.
        <span className="block mt-4 font-bold text-gray-800">
          자, 그럼 포트폴리오 앱 사용을 시작해 볼까요? 🚀
        </span>
      </>
    ),
  },
];

// 책갈피 칩 라벨 — 제목에서 번호·"종목 추가"·끝 "탭" 제거 (예: "1. 📈 지수 탭" → "📈 지수")
function bookmarkLabel(title: string): string {
  return title
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*·.*$/, "")
    .replace(/\s*탭$/, "");
}

export function HelpDialog({ isOpen, onClose, variant = "pc", initialStep = 0 }: Props) {
  const STEPS = variant === "mobile" ? MOBILE_STEPS : PC_STEPS;
  const [step, setStep] = useState(0);
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    if (isOpen) setStep(Math.min(Math.max(0, initialStep), STEPS.length - 1));
  }, [isOpen, initialStep, STEPS.length]);

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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg
                       max-h-[92vh] flex flex-col overflow-hidden">

        {/* 헤더 */}
        <header className="px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50
                            flex items-center">
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <span>❓</span>사용법
          </h2>
          <button onClick={onClose}
                  className="ml-auto px-3 py-1 rounded hover:bg-white/60
                             text-sm text-gray-600">
            ✕
          </button>
        </header>

        {/* 책갈피 — 각 단계(탭)로 바로 점프 */}
        <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b bg-gray-50/70
                        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => setStep(i)}
                    className={`shrink-0 px-2 py-1 rounded text-xs whitespace-nowrap transition
                               ${i === step
                                 ? "bg-blue-600 text-white font-medium"
                                 : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"}`}>
              {bookmarkLabel(s.title)}
            </button>
          ))}
        </div>

        {/* 본문 — 캡션만 (가운데 정렬) */}
        <div className="flex-1 overflow-y-auto px-6 py-10 min-h-[160px]
                        flex items-center justify-center">
          <p className="text-[15px] text-gray-800 leading-relaxed text-center max-w-md">
            {cur.caption}
          </p>
        </div>

        {/* 풋터 — 이전/다음 (페이지 표시는 상단 책갈피가 대신) */}
        <footer className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between gap-2">
          <button onClick={() => setStep(s => Math.max(0, s - 1))}
                  disabled={step === 0}
                  className="px-3 py-1.5 rounded text-sm bg-white border
                             border-gray-300 hover:bg-gray-100
                             disabled:opacity-30 disabled:cursor-not-allowed">
            ◀ 이전
          </button>

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
