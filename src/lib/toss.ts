// 토스 외부 링크 — 모바일에서는 토스 앱(supertoss://) deep link 우선,
// 미설치/실패 시 1.2초 후 https 새 탭으로 폴백. PC 는 https 새 탭만.
// 참고: MobileStockCard 에 있던 패턴을 일반화해 추출.

const MOBILE_UA_RE = /Android|iPhone|iPad|iPod/i;

function isMobile(): boolean {
  return typeof navigator !== "undefined" && MOBILE_UA_RE.test(navigator.userAgent);
}

// Yahoo 심볼 → 토스 페이지 URL 매핑 (지수/환율/미국 ETF).
// 지수 탭 quoteUrl 들이 공통으로 참조 — 한 곳에서만 관리.
export const TOSS_SYMBOL_URL: Record<string, string> = {
  // 한국 지수
  "^KS11": "https://www.tossinvest.com/indices/KGG01P",
  "^KQ11": "https://www.tossinvest.com/indices/QGG01P",
  // 미국 지수·선물
  "^SOX":  "https://www.tossinvest.com/indices/SOX.NAI",
  "^IXIC": "https://www.tossinvest.com/indices/COMP.NAI",
  "NQ=F":  "https://www.tossinvest.com/indices/RFU.NQc1",
  "^GSPC": "https://www.tossinvest.com/indices/SPX.CBI",
  "ES=F":  "https://www.tossinvest.com/indices/RFU.ESc1",
  "^DJI":  "https://www.tossinvest.com/indices/DJI.DJI",
  "RTY=F": "https://www.tossinvest.com/indices/RFU.RTYc1",
  "^VIX":  "https://www.tossinvest.com/indices/RGI..VIX",
  // 환율
  "DX-Y.NYB": "https://www.tossinvest.com/indices/RGI..DXY",
  "KRW=X":    "https://www.tossinvest.com/indices/exchange-rate",
  // 미국 대표 ETF (토스 종목 페이지)
  "SPY": "https://www.tossinvest.com/stocks/US19930122001",
  "QQQ": "https://www.tossinvest.com/stocks/US19990310001",
  "DIA": "https://www.tossinvest.com/stocks/US19980120001",
  "IWM": "https://www.tossinvest.com/stocks/US20000526007",
  "VTI": "https://www.tossinvest.com/stocks/US20010531001",
  // 미국 반도체 개별주 (토스 종목 페이지)
  "MU":   "https://www.tossinvest.com/stocks/US19890516001",
  "NVDA": "https://www.tossinvest.com/stocks/US19990122001",
  "AMAT": "https://www.tossinvest.com/stocks/US19721012001",
  "LRCX": "https://www.tossinvest.com/stocks/US19840504001",
  "ASML": "https://www.tossinvest.com/stocks/US19950315001",
  // 미국 섹터 ETF (토스 종목 페이지)
  "SMH":  "https://www.tossinvest.com/stocks/US20191211007",
  "PAVE": "https://www.tossinvest.com/stocks/US20170308001",
  "LIT":  "https://www.tossinvest.com/stocks/US20100723002",
  "XBI":  "https://www.tossinvest.com/stocks/US20060206001",
  "KBE":  "https://www.tossinvest.com/stocks/US20051115001",
  "ITA":  "https://www.tossinvest.com/stocks/US20060505010",
  "XLV":  "https://www.tossinvest.com/stocks/US19981222008",
  "BOTZ": "https://www.tossinvest.com/stocks/US20160913001",
};

// tossinvest.com URL 을 받아 토스 앱 deep link 로 변환.
// 비(非) toss URL 은 그대로 반환.
function toDeepLink(httpsUrl: string): string | null {
  try {
    const u = new URL(httpsUrl);
    if (!/(^|\.)tossinvest\.com$/.test(u.hostname)) return null;
    // 앱 내부 navigation 용 service.tossinvest.com 래퍼 사용
    const inner = `https://service.tossinvest.com?nextLandingUrl=${u.pathname}${u.search}`;
    return `supertoss://securities?url=${encodeURIComponent(inner)}`;
  } catch {
    return null;
  }
}

// 임의의 URL 열기 — toss URL 이면 모바일에서 앱 시도 후 https 폴백, 그 외는 새 탭.
export function openExternal(url: string): void {
  const deep = toDeepLink(url);
  if (deep && isMobile()) {
    location.href = deep;
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }, 1200);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// <a href={url}> 의 onClick 핸들러로 사용.
// 모바일에서는 기본 동작 가로채 토스 앱 우선 → 폴백 https.
// 비-toss URL 은 기본 동작 유지 (네이버 금융 등 그대로 새 탭).
export function handleTossLinkClick(
  e: React.MouseEvent<HTMLAnchorElement | HTMLElement>,
  url: string,
): void {
  // 새 탭 modifier(중클릭·cmd·ctrl) 는 브라우저 기본 동작 유지
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
  const deep = toDeepLink(url);
  if (!deep || !isMobile()) return;
  e.preventDefault();
  e.stopPropagation();
  openExternal(url);
}

// 한국 종목 (6자리 ticker) — 토스 stocks 페이지.
export function openTossStock(ticker: string): void {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return;
  openExternal(`https://tossinvest.com/stocks/A${ticker}`);
}
