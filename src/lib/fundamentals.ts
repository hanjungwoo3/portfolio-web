// 데스크톱 v2 fundamentals.py 의 web 포팅
// - finance.naver.com 메인 페이지 (PER/PBR/시총/52주/외국인 등)
// - navercomp.wisereport.co.kr cF1001 (영업이익/ROE/부채비율/배당)
// - navercomp.wisereport.co.kr c1080001 (애널리스트 리포트)
// - navercomp.wisereport.co.kr c1010001 (주요주주)

import { fetchProxied, decodeHtmlBuf } from "./api";
// PROXY_URLS는 api.ts에서 4-way로 자동 확장됨 (이 파일은 fetchProxied만 사용)

async function fetchHtml(url: string): Promise<Document | null> {
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const html = decodeHtmlBuf(buf, resp.headers.get("Content-Type") || "");
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

// ─────────── 지표 정의 (v2 fundamentals.py 동일) ───────────
export interface IndicatorSpec {
  title: string;
  sub: string;
  keys: string[];
}

export const INDICATOR_SECTIONS: IndicatorSpec[] = [
  {
    title: "📊 가치평가",
    sub: "주가가 비싼지 싼지 판단",
    keys: ["market_cap_text", "per", "pbr", "eps", "bps", "industry_per"],
  },
  {
    title: "💰 수익성",
    sub: "회사가 얼마나 잘 버는지",
    keys: ["revenue", "operating_income", "operating_margin", "net_margin", "roe"],
  },
  {
    title: "🎁 주주환원",
    sub: "주주에게 돌려주는 정도",
    keys: ["dividend_yield", "dps", "dividend_payout"],
  },
  {
    title: "🏦 재무건전성",
    sub: "빚이 너무 많지 않은지",
    keys: ["debt_ratio"],
  },
  {
    title: "📈 가격 통계",
    sub: "최근 1년 가격 흐름과 외국인 매수세",
    keys: ["high_52w", "low_52w", "foreign_ownership"],
  },
];

export const INDICATOR_LABELS: Record<string, string> = {
  market_cap_text:   "시가총액",
  per:               "PER",
  pbr:               "PBR",
  eps:               "EPS",
  bps:               "BPS",
  industry_per:      "동일업종 PER",
  revenue:           "매출액",
  operating_income:  "영업이익",
  operating_margin:  "영업이익률",
  net_margin:        "순이익률",
  roe:               "ROE",
  dividend_yield:    "배당수익률",
  dps:               "DPS",
  dividend_payout:   "배당성향",
  debt_ratio:        "부채비율",
  high_52w:          "52주 최고",
  low_52w:           "52주 최저",
  foreign_ownership: "외국인 보유율",
};

export const INDICATOR_UNITS: Record<string, string> = {
  market_cap_text:   "",
  per:               "배",
  pbr:               "배",
  eps:               "원",
  bps:               "원",
  industry_per:      "배",
  revenue:           "억원",
  operating_income:  "억원",
  operating_margin:  "%",
  net_margin:        "%",
  roe:               "%",
  dividend_yield:    "%",
  dps:               "원",
  dividend_payout:   "%",
  debt_ratio:        "%",
  high_52w:          "원",
  low_52w:           "원",
  foreign_ownership: "%",
};

export const INDICATOR_DESCRIPTIONS: Record<string, string> = {
  market_cap_text:
    "회사 전체의 시장 가격. 발행주식수 × 주가. 회사 규모 판단 기준.",
  per:
    "주가 ÷ 1주당 순이익(EPS). 회사가 번 돈으로 투자금을 회수하는 데 몇 년 걸리는지 의미. 낮을수록 저평가. 시장 평균 약 15배.",
  pbr:
    "주가 ÷ 1주당 순자산(BPS). 회사를 청산했을 때 받을 자산가치 대비 주가 수준. 1 미만이면 자산가치보다 싸게 거래되는 중.",
  eps:
    "1주당 순이익. 회사가 1년 동안 번 순이익을 발행주식수로 나눈 값. 클수록 수익성 좋음.",
  bps:
    "1주당 순자산. 회사 총자산에서 부채를 뺀 후 주식수로 나눈 값. 청산가치의 기준.",
  industry_per:
    "같은 업종 평균 PER. 종목의 PER 가 이 값보다 낮으면 동종업계 대비 저평가, 높으면 고평가.",
  revenue:
    "1년 동안 회사가 판매한 총금액(연간). 회사의 외형 크기를 보여줌.",
  operating_income:
    "본업으로 번 이익(연간). 매출 − 매출원가 − 판관비. 영업외 손익 제외.",
  operating_margin:
    "영업이익 ÷ 매출액. 본업으로 매출 100원 중 몇 원을 남기는지. 높을수록 경쟁력 있음.",
  net_margin:
    "순이익 ÷ 매출액. 모든 비용·세금 제하고 매출 중 남는 비율.",
  roe:
    "자기자본수익률(ROE). 주주 돈 100원으로 1년 동안 몇 원을 벌었는지. 워런 버핏 기준 15% 이상 선호.",
  dividend_yield:
    "1주당 연 배당금 ÷ 주가. 주식 보유만으로 받는 이자율 같은 개념.",
  dps:
    "1주당 연간 배당금. 100주 보유 시 연간 받는 배당금 = DPS × 100.",
  dividend_payout:
    "순이익 중 배당으로 푸는 비율. 너무 높으면 성장 재투자가 줄어들 수 있음.",
  debt_ratio:
    "부채총계 ÷ 자기자본. 빚이 자기자본의 몇 배인지. 200% 이하 권장, 100% 이하 우량.",
  high_52w:
    "최근 1년간 최고가. 현재가가 여기 가까우면 신고가 부근.",
  low_52w:
    "최근 1년간 최저가. 현재가가 여기 가까우면 바닥권.",
  foreign_ownership:
    "외국인이 보유한 주식 비율. 높고 꾸준히 늘면 외국인이 좋게 평가.",
};

// ─────────── 파서 헬퍼 ───────────
function _toFloat(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—" || cleaned === "N/A") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}
function _toInt(s: string | null | undefined): number | null {
  const v = _toFloat(s);
  return v == null ? null : Math.trunc(v);
}
function _cleanWs(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// ─────────── Naver 메인 페이지 ───────────
export interface FundamentalData {
  name?: string;
  price?: number;
  description?: string[];   // 기업개요 — 상세 API 의 comment1~3 (출처: 에프앤가이드)
  market_cap_text?: string;
  per?: number;
  pbr?: number;
  eps?: number;
  bps?: number;
  industry_per?: number;
  high_52w?: number;
  low_52w?: number;
  foreign_ownership?: number;
  // 네이버 공식 컨센서스 (목표주가/투자의견)
  consensus_target_official?: number;
  consensus_opinion?: string;
  consensus_score?: number;
  // wisereport
  revenue?: number;
  operating_income?: number;
  operating_margin?: number;
  net_margin?: number;
  roe?: number;
  dividend_yield?: number;
  dps?: number;
  dividend_payout?: number;
  debt_ratio?: number;
}

// ★ 2026-09-12: finance.naver.com/item/main.naver 이 SPA 로 바뀌어 이 표가 통째로 사라졌다.
//   새 증권의 종목 상세 API 한 방이면 다 나온다 — 2KB 에 시총·PER·PBR·EPS·BPS·52주·
//   외인보유율·배당수익률·업종명·**동일업종 PER**·**기업개요(comment1~3)** 까지 들어 있다.
//   값이 단위 없는 순수 숫자 문자열이라 파싱도 안전하다(integration 의 totalInfos 는 "27.13배").
//   컨센서스(목표주가·투자의견)만 여기 없어서 integration 을 따로 본다 — 팝업에서만 쓴다.
interface NaverDetailRaw {
  itemname?: string;
  nowPrice?: string;
  marketSum?: string;        // 원 단위
  per?: string; pbr?: string; eps?: string; bps?: string;
  sameIndustryPer?: string;
  week52HighPrice?: string; week52LowPrice?: string;
  frgnHoldRate?: string;
  dividendRate?: string;     // %
  upJongName?: string;
  comment1?: string; comment2?: string; comment3?: string;
}

// "원" 단위 시총 → 네이버 표기("5조 8,450억"). marketCapEok 이 다시 숫자로 되돌린다.
function formatMarketSum(won: number): string | undefined {
  if (!Number.isFinite(won) || won <= 0) return undefined;
  const eok = Math.round(won / 1e8);
  const jo = Math.floor(eok / 10_000);
  const rest = eok % 10_000;
  return jo > 0 ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억` : `${rest.toLocaleString()}억`;
}

export async function fetchNaverDetail(ticker: string): Promise<FundamentalData> {
  const out: FundamentalData = {};
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return out;
  let d: NaverDetailRaw;
  try {
    const resp = await fetchProxied(
      `https://stock.naver.com/api/domestic/detail/${ticker}/detail?codeType=KRX`);
    if (!resp.ok) return out;
    d = await resp.json() as NaverDetailRaw;
  } catch { return out; }

  const f = (v?: string) => { const n = _toFloat(v); return n == null ? undefined : n; };
  const n = (v?: string) => { const x = f(v); return x == null ? undefined : Math.trunc(x); };

  if (d.itemname) out.name = d.itemname;
  out.price = n(d.nowPrice);
  out.market_cap_text = formatMarketSum(Number(d.marketSum));
  out.per = f(d.per);
  out.pbr = f(d.pbr);
  out.eps = n(d.eps);
  out.bps = n(d.bps);
  out.industry_per = f(d.sameIndustryPer);
  out.high_52w = n(d.week52HighPrice);
  out.low_52w = n(d.week52LowPrice);
  out.foreign_ownership = f(d.frgnHoldRate);
  out.dividend_yield = f(d.dividendRate);
  const desc = [d.comment1, d.comment2, d.comment3]
    .map(c => (c ?? "").trim()).filter(c => c.length > 0);
  if (desc.length > 0) out.description = desc;
  return out;
}

// 공식 컨센서스(평균 목표주가·투자의견) — 상세 API 에 없어서 integration 에서만 얻는다.
interface NaverIntegrationConsensus {
  consensusInfo?: { recommMean?: string; priceTargetMean?: string };
}
async function fetchNaverConsensusFields(ticker: string): Promise<Partial<FundamentalData>> {
  const out: Partial<FundamentalData> = {};
  try {
    const resp = await fetchProxied(`https://m.stock.naver.com/api/stock/${ticker}/integration`);
    if (!resp.ok) return out;
    const d = await resp.json() as NaverIntegrationConsensus;
    const ci = d.consensusInfo;
    if (!ci) return out;
    const target = _toInt(ci.priceTargetMean);
    const score = _toFloat(ci.recommMean);
    if (target != null && target > 0) out.consensus_target_official = target;
    if (score != null && score > 0) {
      out.consensus_score = score;
      out.consensus_opinion = score >= 4.5 ? "적극매수" : score >= 3.5 ? "매수"
                            : score >= 2.5 ? "중립"     : score >= 1.5 ? "매도" : "적극매도";
    }
  } catch { /* 컨센서스가 없어도 나머지는 보여준다 */ }
  return out;
}

// 팝업용 — 상세 + 컨센서스. (표는 컨센서스를 안 써서 fetchNaverDetail 만 부른다)
export async function fetchNaverMain(ticker: string): Promise<FundamentalData> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return {};
  const [detail, consensus] = await Promise.all([
    fetchNaverDetail(ticker),
    fetchNaverConsensusFields(ticker),
  ]);
  return { ...detail, ...consensus };
}

// ─────────── Wisereport cF1001 (재무) ───────────
export async function fetchWisereport(ticker: string): Promise<Partial<FundamentalData>> {
  const url = `https://navercomp.wisereport.co.kr/v2/company/cF1001.aspx?cmp_cd=${ticker}&fin_typ=0&freq_typ=Y`;
  const doc = await fetchHtml(url);
  if (!doc) return {};
  const tbl = doc.querySelector("table#cTB26");
  if (!tbl) return {};

  const rowMap = new Map<string, string>();
  tbl.querySelectorAll("tbody tr").forEach(tr => {
    const th = tr.querySelector("th");
    if (!th) return;
    const key = _cleanWs(th.textContent);
    const tds = Array.from(tr.querySelectorAll("td"))
      .map(td => _cleanWs(td.textContent));
    if (tds.length === 0) return;
    // 4번째 (idx=3) 우선, 비어있으면 3번째
    const val = (tds.length > 3 && tds[3]) ? tds[3]
              : (tds.length > 2 ? tds[2] : "");
    rowMap.set(key, val);
  });
  const get = (k: string) => rowMap.get(k) || null;
  return {
    revenue:          _toInt(get("매출액")) ?? undefined,
    operating_income: _toInt(get("영업이익")) ?? undefined,
    operating_margin: _toFloat(get("영업이익률")) ?? undefined,
    net_margin:       _toFloat(get("순이익률")) ?? undefined,
    roe:              _toFloat(get("ROE(%)")) ?? undefined,
    debt_ratio:       _toFloat(get("부채비율")) ?? undefined,
    dps:              _toInt(get("현금DPS(원)")) ?? undefined,
    dividend_payout:  _toFloat(get("현금배당성향(%)")) ?? undefined,
  };
}

// ─────────── Wisereport c1080001 (애널리스트 리포트) ───────────
export interface ConsensusReport {
  date: string;
  title: string;
  analyst: string;
  broker: string;
  opinion: string;
  target?: number;
}

export async function fetchConsensusReports(
  ticker: string, limit = 8
): Promise<ConsensusReport[]> {
  const url = `https://navercomp.wisereport.co.kr/v2/company/c1080001.aspx?cmp_cd=${ticker}`;
  const doc = await fetchHtml(url);
  if (!doc) return [];

  let target: HTMLTableElement | null = null;
  doc.querySelectorAll("table").forEach(tbl => {
    if (target) return;
    const cap = tbl.querySelector("caption");
    if (cap?.textContent?.includes("최근리포트")) target = tbl as HTMLTableElement;
  });
  if (!target) return [];

  const rows: ConsensusReport[] = [];
  (target as HTMLTableElement).querySelectorAll("tr").forEach(tr => {
    if (rows.length >= limit) return;
    const tds = tr.querySelectorAll("td");
    if (tds.length < 7) return;
    const cells = Array.from(tds).map(td => _cleanWs(td.textContent));
    const [date, title, analyst, broker, opinion, targetS] = cells;
    if (!date || !broker) return;
    rows.push({
      date, title, analyst, broker,
      opinion: opinion || "",
      target: targetS ? (_toInt(targetS) ?? undefined) : undefined,
    });
  });
  return rows;
}

// ─────────── Wisereport c1010001 (주요주주) ───────────
export interface Shareholder {
  name: string;
  shares?: number;
  pct?: number;
}

export async function fetchMajorShareholders(ticker: string): Promise<Shareholder[]> {
  const doc = await fetchHtml(`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`);
  if (!doc) return [];

  let target: HTMLTableElement | null = null;
  doc.querySelectorAll("table").forEach(tbl => {
    if (target) return;
    const cap = tbl.querySelector("caption");
    if (cap?.textContent?.includes("주요주주")) target = tbl as HTMLTableElement;
  });
  if (!target) return [];

  const rows: Shareholder[] = [];
  (target as HTMLTableElement).querySelectorAll("tbody tr").forEach(tr => {
    const cells = Array.from(tr.querySelectorAll("th, td"))
      .map(td => _cleanWs(td.textContent));
    if (cells.length < 3) return;
    let [name, sharesS, pctS] = cells;
    if (!name || name === "주요주주") return;
    // 같은 어절 두 번 반복 정리
    const toks = name.split(" ");
    const half = Math.floor(toks.length / 2);
    if (half > 0 && toks.slice(0, half).join(" ") === toks.slice(half, half * 2).join(" ")) {
      name = toks.slice(0, half).join(" ");
    }
    const shares = _toInt(sharesS);
    const pct = _toFloat(pctS);
    if (shares == null && pct == null) return;
    rows.push({
      name,
      shares: shares ?? undefined,
      pct: pct ?? undefined,
    });
  });
  return rows;
}

// ─────────── 시계열 (연간 4년치, Wisereport cF1001 같은 페이지) ───────────
// 단위:
//   금액 (revenue/op_income/net_income/total_assets/total_debt/total_equity/cf_*/capex/fcf/dps) — 억원 또는 원
//   비율 (op_margin/net_margin/roe/roa/debt_ratio/dividend_*) — %
// (n/null) 값은 결측 (포커스트 미공시 등).
export interface FinancialSeries {
  years: string[];                  // ["2022", "2023", "2024", "2025"]
  revenue:        (number | null)[]; // 매출액 (억원)
  op_income:      (number | null)[]; // 영업이익 (억원)
  net_income:     (number | null)[]; // 당기순이익 (억원)
  total_assets:   (number | null)[]; // 자산총계 (억원)
  total_debt:     (number | null)[]; // 부채총계 (억원)
  total_equity:   (number | null)[]; // 자본총계 (억원)
  op_margin:      (number | null)[]; // 영업이익률 (%)
  net_margin:     (number | null)[]; // 순이익률 (%)
  roe:            (number | null)[]; // ROE (%)
  roa:            (number | null)[]; // ROA (%)
  debt_ratio:     (number | null)[]; // 부채비율 (%)
  cf_operating:   (number | null)[]; // 영업활동현금흐름 (억원)
  cf_investing:   (number | null)[]; // 투자활동현금흐름 (억원)
  cf_financing:   (number | null)[]; // 재무활동현금흐름 (억원)
  capex:          (number | null)[]; // CAPEX (억원)
  fcf:            (number | null)[]; // FCF (억원)
  dps:            (number | null)[]; // 현금DPS (원)
  dividend_yield: (number | null)[]; // 배당수익률 (%)
  dividend_payout:(number | null)[]; // 배당성향 (%)
}

export async function fetchWisereportSeries(ticker: string): Promise<FinancialSeries | null> {
  const url = `https://navercomp.wisereport.co.kr/v2/company/cF1001.aspx?cmp_cd=${ticker}&fin_typ=0&freq_typ=Y`;
  const doc = await fetchHtml(url);
  if (!doc) return null;
  const tbl = doc.querySelector("table#cTB26");
  if (!tbl) return null;

  // 헤더에서 연간 연도 추출 (첫 4개 col) — "2022/12" → "2022"
  const headerCells = Array.from(tbl.querySelectorAll("thead th[scope='col']"));
  const yearLabels: string[] = [];
  for (const th of headerCells) {
    const txt = _cleanWs(th.textContent);
    const m = /^(\d{4})\//.exec(txt);
    if (m && yearLabels.length < 4) yearLabels.push(m[1]);
    if (yearLabels.length >= 4) break;
  }

  // 각 행 — th = 항목명, td 의 처음 4개 = 연간
  const collect = (label: string): (number | null)[] => {
    const result: (number | null)[] = [null, null, null, null];
    tbl.querySelectorAll("tbody tr").forEach(tr => {
      const th = tr.querySelector("th");
      if (!th) return;
      if (_cleanWs(th.textContent) !== label) return;
      const tds = Array.from(tr.querySelectorAll("td"));
      for (let i = 0; i < 4 && i < tds.length; i++) {
        const raw = _cleanWs(tds[i].textContent);
        if (!raw || raw === "-" || raw === "N/A") { result[i] = null; continue; }
        const clean = raw.replace(/,/g, "").replace(/\((.+?)\)/, "-$1");
        const n = Number(clean);
        result[i] = Number.isFinite(n) ? n : null;
      }
    });
    return result;
  };

  return {
    years: yearLabels,
    revenue:         collect("매출액"),
    op_income:       collect("영업이익"),
    net_income:      collect("당기순이익"),
    total_assets:    collect("자산총계"),
    total_debt:      collect("부채총계"),
    total_equity:    collect("자본총계"),
    op_margin:       collect("영업이익률"),
    net_margin:      collect("순이익률"),
    roe:             collect("ROE(%)"),
    roa:             collect("ROA(%)"),
    debt_ratio:      collect("부채비율"),
    cf_operating:    collect("영업활동현금흐름"),
    cf_investing:    collect("투자활동현금흐름"),
    cf_financing:    collect("재무활동현금흐름"),
    capex:           collect("CAPEX"),
    fcf:             collect("FCF"),
    dps:             collect("현금DPS(원)"),
    dividend_yield:  collect("현금배당수익률"),
    dividend_payout: collect("현금배당성향(%)"),
  };
}

// ─────────── 통합: 모든 데이터 한 번에 ───────────
export interface FullValuation {
  fundamental: FundamentalData;
  reports: ConsensusReport[];
  shareholders: Shareholder[];
  avgTarget?: number;
}

export async function fetchFullValuation(ticker: string): Promise<FullValuation> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) {
    return { fundamental: {}, reports: [], shareholders: [] };
  }
  const [naver, wise, reports, shareholders] = await Promise.all([
    fetchNaverMain(ticker),
    fetchWisereport(ticker),
    fetchConsensusReports(ticker),
    fetchMajorShareholders(ticker),
  ]);
  const fundamental: FundamentalData = { ...naver, ...wise };
  const targets = reports.map(r => r.target).filter((t): t is number => typeof t === "number");
  const avgTarget = targets.length > 0
    ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length)
    : undefined;
  return { fundamental, reports, shareholders, avgTarget };
}

// 브로커-주주 매칭
const BROKER_ALIASES: Record<string, string[]> = {
  "KB":     ["KB", "케이비"],
  "미래에셋": ["미래에셋"],
  "한국투자": ["한국투자", "한투"],
  "한투":   ["한국투자", "한투"],
  "NH":     ["NH", "농협"],
  "신한":   ["신한"],
  "키움":   ["키움"],
  "삼성":   ["삼성증권"],
  "하나":   ["하나증권", "하나금융투자"],
  "메리츠": ["메리츠"],
  "유진":   ["유진"],
  "BNK":    ["BNK"],
  "DB":     ["DB금융", "DB증권"],
  "iM":     ["iM증권", "아이엠증권"],
  "현대차": ["현대차"],
  "교보":   ["교보"],
  "대신":   ["대신"],
  "이베스트": ["이베스트"],
  "SK":     ["SK증권"],
  "다올":   ["다올"],
  "유안타": ["유안타"],
  "한화":   ["한화"],
  "하이":   ["하이투자"],
  "IBK":    ["IBK"],
};

function brokerMatchTokens(broker: string): string[] {
  const b = broker.trim();
  if (!b) return [];
  for (const [key, tokens] of Object.entries(BROKER_ALIASES)) {
    if (b.toLowerCase().includes(key.toLowerCase())) return tokens;
  }
  return [b, `${b}증권`];
}

export function matchBrokerToShareholder(
  broker: string, shareholders: Shareholder[]
): Shareholder | null {
  const tokens = brokerMatchTokens(broker);
  if (tokens.length === 0 || shareholders.length === 0) return null;
  for (const sh of shareholders) {
    for (const tok of tokens) {
      if (tok && sh.name.includes(tok)) return sh;
    }
  }
  return null;
}

// 지표 판정 — v2 fundamentals.judge_indicator 동일 로직
// 한국 증시 컨벤션: 빨강 = 긍정, 파랑 = 부정.
export type Judgement = "good" | "bad" | "neutral";
const INFO_KEYS = new Set([
  "market_cap_text", "bps", "revenue", "high_52w", "low_52w", "industry_per",
]);
export function judgeIndicator(
  key: string, value: unknown, data: FundamentalData
): Judgement {
  if (value == null || value === "") return "neutral";
  if (INFO_KEYS.has(key)) return "neutral";
  const v = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(v)) return "neutral";

  if (key === "per") {
    const ind = data.industry_per;
    if (typeof ind === "number" && ind > 0) {
      if (v < ind * 0.8) return "good";
      if (v > ind * 1.5) return "bad";
    }
    if (v <= 0) return "bad";
    if (v < 10) return "good";
    if (v > 30) return "bad";
    return "neutral";
  }
  if (key === "pbr") {
    if (v <= 0) return "bad";
    if (v < 1.0) return "good";
    if (v > 3.0) return "bad";
    return "neutral";
  }
  if (key === "eps") return v > 0 ? "good" : "bad";
  if (key === "operating_income") return v > 0 ? "good" : "bad";
  if (key === "operating_margin") {
    if (v >= 15) return "good";
    if (v < 5) return "bad";
    return "neutral";
  }
  if (key === "net_margin") {
    if (v >= 10) return "good";
    if (v < 3) return "bad";
    return "neutral";
  }
  if (key === "roe") {
    if (v >= 15) return "good";
    if (v < 5) return "bad";
    return "neutral";
  }
  if (key === "dividend_yield") {
    if (v >= 4) return "good";
    if (v < 1) return "bad";
    return "neutral";
  }
  if (key === "dps") return v > 0 ? "good" : "bad";
  if (key === "dividend_payout") {
    if (v === 0) return "bad";
    if (v >= 20 && v <= 50) return "good";
    if (v > 80) return "bad";
    return "neutral";
  }
  if (key === "debt_ratio") {
    if (v < 100) return "good";
    if (v > 200) return "bad";
    return "neutral";
  }
  if (key === "foreign_ownership") {
    if (v >= 30) return "good";
    if (v < 5) return "bad";
    return "neutral";
  }
  return "neutral";
}

// 값 포맷
export function formatIndicator(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (typeof val === "string") return val;
  const num = Number(val);
  if (!Number.isFinite(num)) return "—";
  const unit = INDICATOR_UNITS[key] || "";
  const isInt = ["eps", "bps", "dps", "high_52w", "low_52w",
                  "revenue", "operating_income"].includes(key);
  const formatted = isInt ? Math.round(num).toLocaleString() : num.toFixed(2);
  return unit ? `${formatted}${unit}` : formatted;
}

// ─────────── 관심종목 가치지표 표 (ValuationTableTab) ───────────
// 표는 종목 수만큼 호출이 나간다(종목당 네이버 메인 1 + 와이즈리포트 1 = 2콜).
// 한꺼번에 쏘면 프록시가 막히므로 동시 실행을 제한하고, 도착하는 대로 표에 채운다.
const VALUATION_CONCURRENCY = 3;
let valuationRunning = 0;
const valuationQueue: (() => void)[] = [];

function acquireValuationSlot(): Promise<void> {
  if (valuationRunning < VALUATION_CONCURRENCY) {
    valuationRunning++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => valuationQueue.push(() => { valuationRunning++; resolve(); }));
}
function releaseValuationSlot(): void {
  valuationRunning--;
  const next = valuationQueue.shift();
  if (next) next();
}

// "2,838" / "1조 2,345" 형태 시총 텍스트 → 억원 숫자 (정렬·포맷용)
export function marketCapEok(text?: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[,\s]/g, "");
  const jo = /([\d.]+)조/.exec(cleaned);
  const eok = /([\d.]+)억/.exec(cleaned);
  if (!jo && !eok) {
    const n = Number(cleaned.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const v = (jo ? Number(jo[1]) * 10_000 : 0) + (eok ? Number(eok[1]) : 0);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface ValuationRow extends FundamentalData {
  ticker: string;
  market_cap?: number;   // 억원 (정렬용 숫자)
}

// 표 한 줄 — 네이버 메인(시총/PER/PBR/EPS/BPS/동일업종PER) + 와이즈리포트(매출/영업이익/이익률/ROE).
//   기업가치 팝업(fetchFullValuation)과 달리 리포트·주주 조회는 하지 않는다(표에 안 쓰므로 2콜만).
export async function fetchValuationRow(ticker: string): Promise<ValuationRow> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return { ticker };
  await acquireValuationSlot();
  try {
    // 표는 컨센서스를 안 쓰므로 상세 1콜이면 된다(동일업종 PER 도 여기 들어 있다).
    const [naver, wise] = await Promise.all([
      fetchNaverDetail(ticker),
      fetchWisereport(ticker),
    ]);
    const merged: ValuationRow = { ...naver, ...wise, ticker };
    merged.market_cap = marketCapEok(merged.market_cap_text) ?? undefined;
    return merged;
  } finally {
    releaseValuationSlot();
  }
}

// ─────────── Wisereport cF1002 v3 — 3년 실적 + 2년 추정 ───────────
// 4KB 짜리 조각이라 가볍다. 여기서만 얻는 게 둘 있다:
//   · **추정치(E)** — 컨센서스 기반 내년·내후년 실적과 그에 따른 forward PER/PBR/ROE
//   · EV/EBITDA·순부채비율 — cF1001 시계열에는 없는 지표
// cF1001(재무 추이 차트)은 실적만 다루므로 역할이 겹치지 않는다.
export interface EarningsRow {
  label: string;                  // "2025(A)" / "2026(E)"
  estimate: boolean;              // (E) 여부
  revenue: number | null;         // 매출액 (억원)
  revenue_yoy: number | null;     // 매출 YoY (%)
  op_income: number | null;       // 영업이익 (억원)
  net_income: number | null;      // 당기순이익 (억원)
  eps: number | null;             // EPS (원)
  per: number | null;             // PER (배)
  pbr: number | null;             // PBR (배)
  roe: number | null;             // ROE (%)
  ev_ebitda: number | null;       // EV/EBITDA (배)
  net_debt_ratio: number | null;  // 순부채비율 (%)
}

export async function fetchEarningsEstimates(ticker: string): Promise<EarningsRow[]> {
  if (!/^[\dA-Za-z]{6}$/.test(ticker)) return [];
  const doc = await fetchHtml(
    `https://navercomp.wisereport.co.kr/v3/company/cF1002.aspx?cmp_cd=${ticker}&finGubun=MAIN&frq=0`);
  if (!doc) return [];
  const tbl = doc.querySelector("table#cTB25");
  if (!tbl) return [];

  // 결측은 "N/A" 또는 "-". 괄호는 음수 표기다("(1,234)" → -1234).
  const num = (raw: string): number | null => {
    const t = _cleanWs(raw);
    if (!t || t === "-" || t === "N/A") return null;
    const v = Number(t.replace(/,/g, "").replace(/\((.+?)\)/, "-$1"));
    return Number.isFinite(v) ? v : null;
  };

  const out: EarningsRow[] = [];
  tbl.querySelectorAll("tbody tr").forEach(tr => {
    const cells = Array.from(tr.querySelectorAll("td")).map(td => _cleanWs(td.textContent));
    // 재무년월 + 10개 값 + 주재무제표 = 12칸. 모자라면 헤더 잔여행이다.
    if (cells.length < 11) return;
    const label = cells[0];
    if (!/^\d{4}\(/.test(label)) return;
    out.push({
      label,
      estimate: label.includes("(E)"),
      revenue:        num(cells[1]),
      revenue_yoy:    num(cells[2]),
      op_income:      num(cells[3]),
      net_income:     num(cells[4]),
      eps:            num(cells[5]),
      per:            num(cells[6]),
      pbr:            num(cells[7]),
      roe:            num(cells[8]),
      ev_ebitda:      num(cells[9]),
      net_debt_ratio: num(cells[10]),
    });
  });
  // 적자기업 등은 (E) 행이 자리만 있고 값이 전부 비어 있다 — 빈 칸만 늘어나므로 뒤에서 잘라낸다.
  const hasAny = (r: EarningsRow) =>
    [r.revenue, r.op_income, r.net_income, r.eps, r.per, r.pbr, r.roe,
     r.ev_ebitda, r.net_debt_ratio].some(v => v != null);
  while (out.length > 0 && !hasAny(out[out.length - 1])) out.pop();
  return out;
}
