import { isDesktopApp } from "./nativeProxy";
// 종목 분석 지시 프롬프트 — 🔍AI 검색에 앞에 붙여 전송. AI 모드가 10개 항목을 검색·종합하도록 유도.
// 답변 형식 — BLUF(결론 먼저, deep-research 스킬의 보고서 규칙). 예전 프롬프트는 11개 항목·표·그래프를 요구해 답이 너무 길었다
//   (사용자 2026-11-03 "AI 분석이 너무 장황 — 요점만 쉽게, 결론을 먼저 짧게, AI 검색은 모두").
export const AI_BRIEF_RULE =
  `[답변 형식 — 결론 먼저] 첫 줄에 결론 한 문장(무엇인지 + 좋은지·나쁜지·중립). 이어 핵심만 짧은 불릿 3~5개(숫자는 꼭 필요한 것만). ` +
  `전체 10줄 이내, 쉬운 말로(전문용어는 풀어서), 표·긴 배경 설명·출처 나열 없이. 모르면 지어내지 말고 "확인 필요". 마지막에 "투자 자문 아님" 한 줄.`;

export const STOCK_ANALYSIS_PROMPT =
  `일반 투자자에게 종목을 쉽게 설명하라. 최신 시세·뉴스·실적을 검색해 확인하되 답은 짧게. ` +
  `[순서] ① 결론 한 줄 — 지금 이 종목을 한마디로(강세·중립·약세 + 이유) ② 오늘 왜 움직였나 1~2줄(뚜렷한 이유가 없으면 그렇다고) ` +
  `③ 핵심 3가지(실적·밸류에이션·수급 중 중요한 것만, 숫자 하나씩) ④ 리스크 1~2개 ⑤ 다음 이벤트 1줄. ` +
  `[규칙] 제공된 '현재가'는 [기준시각] 실시간·장중가다(마감가 아님). ` + AI_BRIEF_RULE;

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
  // 모든 AI 검색에 '결론 먼저·짧게' 규칙(사용자 2026-11-03 "AI 검색은 모두") — 이미 붙어 있으면 그대로
  const raw = query.includes("[답변 형식 — 결론 먼저]") ? query : `${query} ${AI_BRIEF_RULE}`;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 4000);
  const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
  // 이미 열린 AI 팝업이 살아 있으면 그 창을 재사용 — 새 팝업을 또 만들지 않음.
  // 데스크톱 앱 — window.open 을 앱이 가로채 기본 브라우저로 넘기는데, 그 대체 함수가 null 을 돌려줘
  //   아래 '열린 창 재사용' 로직과 꼬였다. 앱 명령으로 바로 브라우저에 연다(2026-10-23 'AI 버튼 반응 없음').
  //   ★ 0.1.2 이전 앱은 앱 명령이 있어도 window.open 이 같은 일을 하니 그쪽도 안전하다.
  if (isDesktopApp()) {
    const t = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    // 실패하면 이유를 보여 준다 — 조용히 끝나면 '반응 없음'으로만 보인다
    //   0.1.3+ 는 앱 안 보기 창(open_viewer), 그 전 앱은 명령이 없어 실패 → 기본 브라우저(open_external)
    if (t) {
      void t.invoke("open_viewer", { url })
        .catch(() => t.invoke("open_external", { url }))
        .catch(e => window.alert(`구글 AI 를 열지 못했습니다\n\n${String(e)}`));
      return;
    }
  }
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

// 공시 한 건 AI 요약(사용자 요청 2026-10-28) — 종목정보 공시 칸·컨센서스 '최신공시' 공용. 원문 링크를 같이 넘겨 그 문서를 읽게 한다
//   body 를 주면 본문을 질문에 넣는다 — 구글 AI 는 DART 외부 접근 제한으로 원문 주소를 못 읽는다(사용자 2026-10-28).
export const discAiQuery = (name: string, code: string, title: string, when: string, url: string, body?: string) =>
  `[기준시각 ${aiNowStamp()}] ${name}(${code}) 공시 "${title}" (${when} 공시) 를 ` +
  (body ? `아래 [공시 본문] 으로 한국어로 요약하라(원문 링크는 참고만: ${url}). ` : `찾아 읽고 한국어로 요약하라. 원문: ${url} `) +
  `[순서] ① 결론 한 줄 — 무슨 공시이고 주가에 호재·악재·중립 ② 핵심 숫자 2~3개(금액·비율·일정) 한 줄씩 ③ 시가총액 대비 규모가 큰지 한 줄 ` +
  `(정정공시면 무엇이 바뀌었는지 한 줄). 원문에 없는 숫자는 지어내지 말 것. ` + AI_BRIEF_RULE +
  (body ? `\n[공시 본문]\n${body.slice(0, 2600)}` : "");

/** 질문을 만드는 데 시간이 드는 경우(공시 본문 받기) — 브라우저는 클릭 직후가 아니면 새 창을 막으므로
 *  누르는 순간 빈 창을 먼저 열고, 질문이 준비되면 그 창을 구글 AI 로 보낸다. 앱은 창 제한이 없어 기다렸다 연다. */
export async function openGoogleAiLater(makeQuery: () => Promise<string>): Promise<void> {
  if (!isDesktopApp() && !(aiWin && !aiWin.closed)) {
    const w = Math.min(900, (window.screen?.availWidth ?? 900) - 80), h = Math.min(900, (window.screen?.availHeight ?? 900) - 80);
    aiWin = window.open("about:blank", "googleAi", `popup,width=${w},height=${h}`);
    try { aiWin?.document.write("<p style='font:14px sans-serif;padding:16px'>공시 본문을 불러오는 중…</p>"); } catch { /* noop */ }
  }
  openGoogleAi(await makeQuery());
}
