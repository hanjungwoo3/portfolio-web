// 구글 AI 모드(udm=50) 검색을 앱 창 근처 팝업으로 오픈.
//   - iframe 은 구글이 프레이밍 차단 → 팝업 창으로만 가능
//   - AI 모드는 '짧은 자연어 질문'이어야 답을 생성(긴 데이터 덤프는 웹결과 목록으로 떨어짐)
export function openGoogleAi(query: string): void {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 1500);
  const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(q)}`;
  const w = Math.min(900, (window.screen?.availWidth ?? 900) - 80);
  const h = Math.min(900, (window.screen?.availHeight ?? 900) - 80);
  const baseX = window.screenX ?? window.screenLeft ?? 0;
  const baseY = window.screenY ?? window.screenTop ?? 0;
  const left = Math.max(0, Math.round(baseX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(baseY + 60));
  window.open(url, "googleAi", `popup,width=${w},height=${h},left=${left},top=${top}`);
}
