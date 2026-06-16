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
  `6. 밸류에이션: PER·PBR(+추정 기준 멀티플) ` +
  `7. 수급: 외국인·기관 순매수, 신용융자 잔고, 거래대금 ` +
  `8. 컨센서스: 목표주가 분포·투자의견·커버리지 증권사 수 ` +
  `9. 업황/원자재·환율 등 이익 변수 ` +
  `10. 이벤트 리스크: 전환사채·유상증자·투자경고 지정 여부 ` +
  `[출력 형식] 한 줄 요약(핵심 베팅 포인트) / 회사가 뭐 하는 곳(쉽게) / 오늘 등락 이유(단일 뉴스 불명확 시 솔직히 명시) / 주요 뉴스·이슈 / 펀더멘탈(실적·재무, 표) / ` +
  `컨센서스 신뢰도(목표가 편차·커버리지 수→높음/중간/낮음 판정) / 투자 유의점(변동성·전망의존·마진·사이클·희석 등) / 더 확인이 필요한 정보(수집 못 한 항목 명시) / 출처(링크)+"투자 자문 아님" 면책 ` +
  `[규칙] 수치는 추정/실적/날짜를 구분해 표기. 모르면 지어내지 말고 "확인 필요"로. 목표가만으로 매수/매도 단정 금지. 균형 있게.`;

// 구글 AI 모드(udm=50) 검색을 앱 창 근처 팝업으로 오픈.
//   - iframe 은 구글이 프레이밍 차단 → 팝업 창으로만 가능
//   - AI 모드는 지시형 프롬프트도 처리 가능. 길이가 길면 간혹 웹결과 목록으로 떨어질 수 있음.
export function openGoogleAi(query: string): void {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 4000);
  const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
  const w = Math.min(900, (window.screen?.availWidth ?? 900) - 80);
  const h = Math.min(900, (window.screen?.availHeight ?? 900) - 80);
  const baseX = window.screenX ?? window.screenLeft ?? 0;
  const baseY = window.screenY ?? window.screenTop ?? 0;
  const left = Math.max(0, Math.round(baseX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(baseY + 60));
  window.open(url, "googleAi", `popup,width=${w},height=${h},left=${left},top=${top}`);
}
