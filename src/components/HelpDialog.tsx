import { useEffect, useRef, useState } from "react";

// 첫 사용자 빠른 시작 가이드 — PC 6 step / 모바일 7 step(화면에 보이는 순서, 캡처 포함).
// 헤더 ❓ 버튼으로 수동 호출 + 첫 방문 자동 노출 (localStorage flag).
// 이미지 없이 텍스트만 — 한눈에 읽히는 간결한 캐러셀.
// 순서대로 따라가면: 1~4 기본 사용 완성(추가→카드→편집), 5~ 분석 탭 순회 소개.

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant?: "pc" | "mobile";
  initialStep?: number;   // 특정 탭에서 열면 해당 단계로 바로 점프
}

// 탭 키 → 사용법 단계 인덱스 (처음0·지수1·증시2·종목찾기3). App/Mobile 헤더에서 사용.
export const HELP_STEP_BY_TAB: Record<string, number> = {
  "__us-market__": 1, "__idx-night__": 1, "__idx-rot__": 1, "__semi-dash__": 1, "__semi-check__": 1,   // 지수
  "__market-money__": 2,                                                                                // 증시
  "__valuation__": 3, "__screener__": 3, "__close-bet__": 3, "__accum__": 3, "__sector-rank__": 3,      // 종목찾기
  "__earnings__": 3, "__consensus__": 3, "__etf-reverse__": 3, "__etf-ranking__": 3, "__etf-compare__": 3, "__heatmap__": 3,
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

// 캡처 이미지 — public/help/v2-*.png (2026-10-23 화면, 라이트 모드). 화면이 크게 바뀌면 다시 찍을 것
const IMG_BASE = `${import.meta.env.BASE_URL}help/`;
function Shot({ src, alt }: { src: string; alt: string }) {
  return <img src={IMG_BASE + src} alt={alt} loading="lazy"
              className="block mx-auto my-3 max-h-[260px] w-auto max-w-full rounded border border-gray-200 shadow-sm" />;
}
function MoonChip() {
  return <span className="inline-block align-baseline px-1.5 py-0 rounded text-[11px] bg-gray-100 border border-gray-200">🌙</span>;
}

// 사용법 — 화면에 보이는 것 순서대로: 기본 탭 3개 → 위 버튼들 → 내 데이터·앱(사용자 요청 2026-10-23 갱신)
function buildSteps(mobile: boolean): Step[] {
  const more = mobile ? <> 상단 <b>⋮ 더보기</b> 메뉴의 </> : null;
  const steps: Step[] = [
    {
      title: "1. 👀 처음 화면",
      caption: (
        <>
          처음엔 탭이 <b>3개</b>예요 — <b>📊 종목찾기</b> · <b>💰 증시</b> · <b>📈 지수</b>.
          <Shot src="v2-tabs.png" alt="기본 탭 3개" />
          <span className="block text-gray-500 text-xs">
            <b>▾</b> 가 붙은 탭은 {mobile ? "눌러서" : "마우스를 올려서"} 안의 페이지를 고릅니다.
            종목을 담으면 <b>📦 내주식</b> 탭이 새로 생겨요.
          </span>
        </>
      ),
    },
    {
      title: "2. 📈 지수 탭",
      caption: (
        <>
          한국 장에 영향을 주는 지수·환율·금리·선물·원자재·관련 종목을 카드로 한눈에.
          <Shot src="v2-index-menu.png" alt="지수 탭 페이지" />
          <span className="block text-left text-xs text-gray-600 space-y-0.5">
            <span className="block">🇰🇷 <b>한국/주간</b> · 🇺🇸 <b>미국/야간</b> · 🔄 <b>순환매</b> · 💾 <b>반도체 수급</b>(현물·선물·옵션 수급과 실시간 체결)</span>
            <span className="block">· 지수 탭을 누르면 시간에 맞춰 열립니다 — 한국 07~20시는 주간, 그 밖은 야간</span>
            <span className="block">· 카드: 큰 % = 오늘 등락, 노란 책갈피 = 정규장 종가, <b>흐린 카드 = 장 마감</b></span>
            <span className="block">· 카드 아래 <b>⚡체결</b> = 실시간 체결 크게 보기 · <b>🔍AI</b> = 구글 AI 분석</span>
          </span>
        </>
      ),
    },
    {
      title: "3. 💰 증시 탭",
      caption: (
        <>
          코스피·코스닥 <b>거래대금</b>, 증시 자금(예탁금·신용), <b>투자자별 순매수</b>, KRX 공지를 한 화면에.
          <Shot src="v2-market.png" alt="증시 탭" />
          <span className="block text-gray-500 text-xs">오늘 돈이 들어오는 날인지, 누가 사고 파는지 확인할 때.</span>
        </>
      ),
    },
    {
      title: "4. 📊 종목찾기 탭",
      caption: (
        <>
          종목을 고를 때 쓰는 도구 모음이에요.
          <Shot src="v2-tools-menu.png" alt="종목찾기 메뉴" />
          <span className="block text-left text-xs text-gray-600 space-y-0.5">
            <span className="block">· <b>섹터별</b> 업종 비교표 · <b>눌림목</b> 조건 검색+백테스트 · <b>종가배팅</b> · <b>수급 매집</b></span>
            <span className="block">· <b>섹터별등락</b> 돈의 흐름 · <b>실적 일정</b> · <b>컨센서스</b> 목표주가</span>
            <span className="block">· <b>ETF검색</b>(이 종목을 담은 ETF) · <b>ETF랭킹</b> · <b>ETF미국</b> 비교 · <b>히트맵</b></span>
          </span>
        </>
      ),
    },
    {
      title: "5. 🔘 위 버튼",
      caption: (
        <>
          {!mobile && <Shot src="v2-buttons.png" alt="상단 버튼" />}
          <span className="block text-left text-[13px] space-y-1">
            <span className="block"><SearchChip /> 종목 담기 — 수량을 비우면 <b>관심</b>, 수량·평단을 넣으면 <b>보유</b></span>
            <span className="block">{more}<b>사용법</b> 이 안내 · <AskChip /> 익명으로 질문·요청 · <b>후원하기</b> 카카오페이</span>
            <span className="block">{more}<SetChip /> 갱신 주기·백업·드라이브 동기화·중계 서버</span>
            <span className="block"><MoonChip /> 야간 배경 — 카드 바깥을 어둡게(다시 누르면 ☀️ 주간)</span>
          </span>
        </>
      ),
    },
  ];
  if (mobile) steps.push({
    title: "6. 그룹 길게 누르기",
    caption: (
      <>
        그룹 탭을 <b>0.5초 길게 누르면</b> 바텀시트가 올라와요.
        <span className="block mt-2 text-gray-500 text-xs">⚙️ 이름 변경 / 🗑 그룹 삭제. 기본 탭은 보호(편집 불가).</span>
      </>
    ),
  });
  steps.push({
    title: `${steps.length + 1}. 💾 내 데이터·앱`,
    caption: (
      <>
        담은 종목은 <b>이 기기에만</b> 저장돼요(운영자 서버로 보내지 않음).
        <span className="block mt-1 text-[13px]">다른 기기와 나누려면 설정 → <b>구글 드라이브 동기화</b> 또는 <b>파일로 저장</b>.</span>
        <span className="block mt-2 text-xs text-gray-600">
          📥 <b>맥·윈도우·안드로이드 앱</b>으로 보면 중계 서버 없이 직접 받아 <b>5초마다</b> 갱신돼요 —{" "}
          <a href="https://github.com/hanjungwoo3/portfolio-web/releases/tag/apps" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">앱 받기</a>{" · "}
          <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">개인정보·안전 안내</a>
        </span>
        <span className="block mt-4 font-bold text-gray-800">자, 그럼 시작해 볼까요? 🚀</span>
      </>
    ),
  });
  return steps;
}
const PC_STEPS = buildSteps(false);
const MOBILE_STEPS = buildSteps(true);

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
          <div className="text-[15px] text-gray-800 leading-relaxed text-center max-w-md">
            {cur.caption}
          </div>
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
