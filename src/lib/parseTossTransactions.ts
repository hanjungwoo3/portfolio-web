// 토스 wts-api 거래내역 JSON 파싱 → 매수/매도 거래 후보.
//   엔드포인트: GET wts-api.tossinvest.com/api/v3/my-assets/transactions/markets/kr
//   응답: { result: { body: [ {transactionType:{code}, stockCode:"A005930", stockName, quantity, amount, date|compositeKey.date, cancelTradeYn}, ... ] } }
//   code 5=매수(buy), 6=매도(sell), 1=입금/이자(제외). stockCode 의 'A' 접두어 제거 → 앱 6자리 코드.

export interface ImportTradeRow {
  ticker: string;            // 6자리(영숫자) — stockCode 에서 A 제거
  name: string;
  date: string;              // YYYY-MM-DD
  type: "buy" | "sell";
  qty: number;
  amount: number;            // 총액(원, gross)
}

export interface TossJsonParseResult {
  rows: ImportTradeRow[];
  total: number;             // body 전체 항목 수
  skipped: number;           // 거래 아님/취소로 제외
  lastPage?: boolean;        // 더 받을 페이지가 있는지(false 면 같은 구간에 더 있음)
  range?: { from: string; to: string };   // 붙여넣은 응답의 조회 범위(pagingParam.range) — 구간 버튼 완료 표시용
  oldestDate?: string;       // 이 페이지 body 의 가장 오래된 날짜 — 같은 구간 다음 페이지 to 로 사용
}

interface TossTx {
  transactionType?: { code?: string; displayName?: string };
  stockCode?: string;
  stockName?: string;
  productName?: string;
  quantity?: number;
  amount?: number;
  date?: string;
  settlementDate?: string;   // T+2 결제일 — 절대 사용 안 함(예수금 정산일)
  dateTime?: string;
  cancelTradeYn?: boolean;
  compositeKey?: { date?: string; orderDate?: string };
}

function pickBody(parsed: unknown): { body: TossTx[]; lastPage?: boolean; range?: { from: string; to: string } } | null {
  if (Array.isArray(parsed)) return { body: parsed as TossTx[] };
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const result = (o.result ?? o) as Record<string, unknown>;
    const body = result.body;
    const pp = result.pagingParam as { range?: { from?: string; to?: string } } | undefined;
    const range = pp?.range?.from && pp?.range?.to ? { from: pp.range.from, to: pp.range.to } : undefined;
    if (Array.isArray(body)) return { body: body as TossTx[], lastPage: result.lastPage as boolean | undefined, range };
  }
  return null;
}

function tickerOf(stockCode?: string): string {
  const c = (stockCode ?? "").trim();
  if (!c) return "";
  const t = c.replace(/^A/, "");
  return /^[\dA-Za-z]{6}$/.test(t) ? t : "";
}

// 체결/주문일 기준 — settlementDate(결제 T+2)는 절대 사용 안 함(중복·미래날짜 방지)
function dateOf(tx: TossTx): string {
  return (tx.compositeKey?.orderDate ?? tx.date ?? tx.compositeKey?.date ?? tx.dateTime?.slice(0, 10) ?? "").trim();
}

// 관대한 파싱 — 정식 JSON 우선, 실패 시 콘솔/JS객체 형식(키 따옴표 없음, 트레일링 콤마) 보정.
//   토스 탭에서 복사하면 보통 정식 JSON 이지만, 콘솔에서 펼친 객체를 복사하면 키가 따옴표 없음.
function lenientJsonParse(text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* 콘솔 형식 시도 */ }
  try {
    const fixed = t
      .replace(/([{,[]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')   // 키에 따옴표
      .replace(/,(\s*[}\]])/g, "$1");                            // 트레일링 콤마 제거
    return JSON.parse(fixed);
  } catch { return null; }
}

// JSON 문자열 → 거래 후보. JSON 아니면 null 반환(폴백 판단용).
export function parseTossTransactionsJson(text: string): TossJsonParseResult | null {
  const parsed = lenientJsonParse(text);
  if (parsed == null) return null;
  const picked = pickBody(parsed);
  if (!picked) return null;

  const rows: ImportTradeRow[] = [];
  let skipped = 0;
  for (const tx of picked.body) {
    const code = tx.transactionType?.code;
    if (code !== "5" && code !== "6") { skipped += 1; continue; }   // 매수/매도만
    if (tx.cancelTradeYn === true) { skipped += 1; continue; }       // 취소 거래 제외
    const ticker = tickerOf(tx.stockCode);
    const qty = Number(tx.quantity) || 0;
    const amount = Number(tx.amount) || 0;
    const date = dateOf(tx);
    if (!ticker || qty <= 0 || !date) { skipped += 1; continue; }
    rows.push({
      ticker,
      name: (tx.stockName ?? tx.productName ?? ticker).trim(),
      date,
      type: code === "5" ? "buy" : "sell",
      qty,
      amount,
    });
  }
  let oldestDate: string | undefined;
  for (const tx of picked.body) {
    const d = (tx.compositeKey?.date ?? tx.date ?? tx.dateTime?.slice(0, 10) ?? "").trim();
    if (d && (!oldestDate || d < oldestDate)) oldestDate = d;
  }
  return { rows, total: picked.body.length, skipped, lastPage: picked.lastPage, range: picked.range, oldestDate };
}

// 거래 식별 키 — 기존 거래와 비교(중복 판정)·재가져오기 멱등 id 생성용
export function tradeDedupeKey(t: { ticker: string; date: string; type: "buy" | "sell"; qty: number; amount: number }): string {
  return `${t.ticker}|${t.date}|${t.type}|${t.qty}|${Math.round(t.amount)}`;
}
