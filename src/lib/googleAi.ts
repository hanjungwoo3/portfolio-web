// 종목 분석 지시 프롬프트 — 🔍AI 검색에 앞에 붙여 전송. AI 모드가 10개 항목을 검색·종합하도록 유도.
export const STOCK_ANALYSIS_PROMPT =
  `당신은 주식 종목을 일반 투자자가 이해하기 쉽게 분석하는 AI다. ` +
  `종목명/코드를 받으면 아래 "검색 계획"의 각 항목을 반드시 한 번씩 검색·수집한 뒤, "출력 형식"에 맞춰 종합하라. 절대 한 번의 검색으로 끝내지 마라. ` +
  `[검색 계획 — 각 항목별로 개별 검색] ` +
  `1. 현재가·등락률·시가총액·52주 고저 ` +
  `2. 당일~최근 1주 뉴스/공시(등락 원인 단서) ` +
  `3. 사업 내용(무엇을 파는 회사인지, 주력 제품) ` +
  `4. 실적: 최근 분기·연간 매출/영업이익/순이익(YoY) ` +
  `5. 재무 안정성: 부채비율·순차입금·현금흐름 ` +
  `6. 밸류에이션: PER·PBR(+추정 기준 멀티플), 동종업계 평균 대비 ` +
  `7. 수급: 외국인·기관 순매수, 신용융자 잔고, 거래대금 ` +
  `8. 컨센서스: 목표주가 분포·투자의견·커버리지 증권사 수 ` +
  `9. 업황/원자재·환율 등 이익 변수 + 경쟁사 대비 위치(시장점유율·진입장벽/해자) ` +
  `10. 이벤트 리스크: 전환사채·유상증자·투자경고 지정 여부 ` +
  `11. 촉매: 예정 이벤트(실적발표·신제품·규제·수주·정책)를 단기(~3개월)/장기(6~12개월)로 구분 ` +
  `[출력 형식] 한 줄 요약(핵심 베팅 포인트) / 회사가 뭐 하는 곳(쉽게) / 오늘 등락 이유(단일 뉴스 불명확 시 솔직히 명시) / 주요 뉴스·이슈 / ` +
  `펀더멘탈: 표는 '지표×연도' 수치만 간결하게(행=매출·영업이익·순이익·부채비율·순차입금비율·PER/PBR, 열=연도/분기). 표 좌상단 칸은 '지표' 한 단어로만('지표/연도/분기' 식 표기 금지). 표 헤더 연도엔 '(실적)' 붙이지 말고(과거는 당연히 실적), 추정 연도만 '(추정)' 표시. 특이사항·코멘트는 표 칸에 넣지 말고 표 아래 지표별 짧은 불릿으로 따로. 가능하면 매출·영업이익 연도별 추세를 막대/선 그래프로도 시각화 / ` +
  `경쟁 포지셔닝(경쟁사 대비 강점·약점 한두 줄) / ` +
  `강세 근거 3가지 vs 리스크 2가지(변동성·전망의존·마진·사이클·희석 등) — 대칭으로 제시 / ` +
  `촉매: 단기 / 장기 나눠 불릿 / ` +
  `종합 시각: 강세 / 중립 / 약세 중 하나 + 근거 (매수·매도 지시가 아니라 균형 잡힌 견해) / ` +
  `컨센서스 신뢰도(목표가 편차·커버리지 수→높음/중간/낮음 판정) / 더 확인이 필요한 정보(수집 못 한 항목 명시) / 출처(링크)+"투자 자문 아님" 면책 ` +
  `[규칙] 제공된 '현재가'는 마감가가 아니라 [기준시각] 시점의 실시간/장중가다 — 지금이 장중인지 장후인지 판단해 해석하라. 수치는 추정/실적/날짜를 구분해 표기. 모르면 지어내지 말고 "확인 필요"로. 목표가만으로 매수/매도 단정 금지. 균형 있게.`;

// 현재 KST 시각 스탬프 — AI 가 '현재가=마감가' 로 오해하지 않게 기준시각 제공
export function aiNowStamp(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
  }).format(new Date()) + " KST";
}

// 직전에 연 AI 팝업 참조 — 같은 창을 계속 재사용하기 위함.
//   (구글 AI 모드 페이지가 팝업의 window.name 을 덮어쓰는 경우가 있어, 이름 타깃만으론 새 창이 또 열림.
//    JS 참조를 직접 들고 있으면 이름이 바뀌어도 그 창을 그대로 다시 띄울 수 있다.)
let aiWin: Window | null = null;

// 구글 AI 모드(udm=50) 검색을 앱 창 근처 팝업으로 오픈.
//   - iframe 은 구글이 프레이밍 차단 → 팝업 창으로만 가능
//   - AI 모드는 지시형 프롬프트도 처리 가능. 길이가 길면 간혹 웹결과 목록으로 떨어질 수 있음.
//   - 항상 동일한 하나의 팝업을 재사용 (이미 열려 있으면 그 창을 새 검색으로 이동시키고 앞으로 가져옴).
export function openGoogleAi(query: string): void {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 4000);
  const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
  // 이미 열린 AI 팝업이 살아 있으면 그 창을 재사용 — 새 팝업을 또 만들지 않음.
  if (aiWin && !aiWin.closed) {
    try {
      aiWin.location.href = url;   // cross-origin 이어도 '이동'은 허용 (읽기만 차단)
      aiWin.focus();
      return;
    } catch {
      /* 참조 접근 실패(드묾) — 아래에서 새로 연다 */
    }
  }
  const w = Math.min(900, (window.screen?.availWidth ?? 900) - 80);
  const h = Math.min(900, (window.screen?.availHeight ?? 900) - 80);
  const baseX = window.screenX ?? window.screenLeft ?? 0;
  const baseY = window.screenY ?? window.screenTop ?? 0;
  const left = Math.max(0, Math.round(baseX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(baseY + 60));
  aiWin = window.open(url, "googleAi", `popup,width=${w},height=${h},left=${left},top=${top}`);
  aiWin?.focus();
}
