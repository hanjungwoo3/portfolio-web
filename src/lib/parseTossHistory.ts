// 토스 "거래내역" 붙여넣기 → 매수/매도 거래 후보 파싱.
//   거래내역 한 블록(빈 줄로 구분) 예:
//     12.11
//     카페24 16주
//     00:07 ㅣ 구매
//     -436,860원        ← 총 체결금액(부호 무시)
//     6,763원           ← 잔액(무시)
//   무상입고:
//     5.31 / 맘스터치 / 11:59 ㅣ 1주이벤트입고 / 1주
//   이체/이자(이체출금·이자입금 등)는 거래 아님 → 제외.
//   연도 구분선 "2023년" 이 더 오래된 블록들 위에 나타남(목록은 최신→과거 순).

export type TossTradeKind = "buy" | "sell" | "event";

export interface TossTradeRow {
  date: string;        // YYYY-MM-DD
  name: string;        // 토스 표시 종목명
  qty: number;
  amount: number;      // 총액(원, 양수). event 는 0
  kind: TossTradeKind;
}

export interface ParseResult {
  rows: TossTradeRow[];
  topYear: number;     // 맨 위(최신) 블록에 적용한 연도 (추정/입력값)
  skipped: number;     // 거래 아님(이체·이자 등)으로 건너뛴 블록 수
}

const DATE_RE = /^(\d{1,2})\.(\d{1,2})$/;       // 12.11
const YEAR_RE = /^(\d{4})\s*년$/;                // 2023년
const QTY_IN_NAME_RE = /^(.+?)\s+([\d,]+)\s*주$/; // 카페24 16주
const QTY_ONLY_RE = /^([\d,]+)\s*주$/;           // 1주
const AMOUNT_RE = /^-?([\d,]+)\s*원$/;           // -436,860원

const num = (s: string) => Number(s.replace(/,/g, "")) || 0;
const pad = (n: number) => String(n).padStart(2, "0");

type Token =
  | { t: "year"; year: number }
  | { t: "block"; month: number; day: number; body: string[] };

// 1차 토큰화 — 날짜 블록 + 연도 구분선
function tokenize(text: string): Token[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tokens: Token[] = [];
  let cur: { month: number; day: number; body: string[] } | null = null;
  const flush = () => { if (cur) { tokens.push({ t: "block", ...cur }); cur = null; } };
  for (const line of lines) {
    const ym = YEAR_RE.exec(line);
    if (ym) { flush(); tokens.push({ t: "year", year: Number(ym[1]) }); continue; }
    const dm = DATE_RE.exec(line);
    if (dm) { flush(); cur = { month: Number(dm[1]), day: Number(dm[2]), body: [] }; continue; }
    if (cur) cur.body.push(line);
  }
  flush();
  return tokens;
}

// 블록 본문 → 거래 종류/이름/수량/금액
function parseBlock(body: string[]): Omit<TossTradeRow, "date"> | null {
  const typeIdx = body.findIndex(l => l.includes("ㅣ") || l.includes("|"));
  const typeText = typeIdx >= 0 ? body[typeIdx].split(/ㅣ|\|/)[1]?.trim() ?? "" : "";
  const kind: TossTradeKind | null =
    typeText.includes("구매") ? "buy"
    : typeText.includes("판매") ? "sell"
    : typeText.includes("이벤트입고") ? "event"
    : null;
  if (!kind) return null;   // 이체·이자 등 거래 아님

  // 이름 + 수량 — 보통 첫 줄("카페24 16주") 또는 이름만 + 별도 "1주"
  const nameLine = body[0] ?? "";
  let name = nameLine, qty = 0;
  const mq = QTY_IN_NAME_RE.exec(nameLine);
  if (mq) { name = mq[1].trim(); qty = num(mq[2]); }
  else {
    const ql = body.find(l => QTY_ONLY_RE.test(l));
    if (ql) qty = num(QTY_ONLY_RE.exec(ql)![1]);
  }
  if (!name || qty <= 0) return null;

  // 금액 — type 줄 이후 첫 "±숫자원"(잔액은 그 다음 줄이라 무시)
  let amount = 0;
  for (let i = typeIdx + 1; i < body.length; i++) {
    const am = AMOUNT_RE.exec(body[i]);
    if (am) { amount = num(am[1]); break; }
  }
  if (kind === "event") amount = 0;
  return { name, qty, amount, kind };
}

// 연도 배정 — 구분선 우선, 그룹 내에선 '아래로 갈수록 과거' 월 롤오버(월이 커지면 연도-1).
//   topYear: 첫 구분선 위(최신) 블록들의 연도. 미지정 시 (첫 구분선+1) 추정, 구분선 없으면 fallbackYear.
export function parseTossHistory(text: string, topYear?: number, fallbackYear = new Date().getFullYear()): ParseResult {
  // new Date() 는 워크플로 외 일반 런타임에선 사용 가능 (호출 시점 평가)
  const tokens = tokenize(text);
  const firstYearMarker = tokens.find(t => t.t === "year") as Extract<Token, { t: "year" }> | undefined;
  const hasBlockBeforeMarker = (() => {
    for (const t of tokens) { if (t.t === "year") return false; if (t.t === "block") return true; }
    return false;
  })();
  const resolvedTop = topYear
    ?? (firstYearMarker
        ? firstYearMarker.year + (hasBlockBeforeMarker ? 1 : 0)
        : fallbackYear);

  const rows: TossTradeRow[] = [];
  let skipped = 0;
  let year = resolvedTop;
  let prevMonth: number | null = null;
  for (const tok of tokens) {
    if (tok.t === "year") { year = tok.year; prevMonth = null; continue; }
    // 같은 그룹 내 월 롤오버 — 아래로 가며 월이 커지면 전년도
    if (prevMonth != null && tok.month > prevMonth) year -= 1;
    prevMonth = tok.month;
    const parsed = parseBlock(tok.body);
    if (!parsed) { skipped += 1; continue; }
    rows.push({ ...parsed, date: `${year}-${pad(tok.month)}-${pad(tok.day)}` });
  }
  return { rows, topYear: resolvedTop, skipped };
}
