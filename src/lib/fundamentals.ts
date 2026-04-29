// 데스크톱 v2 fundamentals.py 의 web 포팅
// - finance.naver.com 메인 페이지 (PER/PBR/시총/52주/외국인 등)
// - navercomp.wisereport.co.kr cF1001 (영업이익/ROE/부채비율/배당)
// - navercomp.wisereport.co.kr c1080001 (애널리스트 리포트)
// - navercomp.wisereport.co.kr c1010001 (주요주주)

import { fetchProxied } from "./api";

async function fetchHtml(url: string): Promise<Document | null> {
  try {
    const resp = await fetchProxied(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const ct = resp.headers.get("Content-Type") || "";
    const charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() || "euc-kr";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(buf);
    } catch {
      html = new TextDecoder("euc-kr").decode(buf);
    }
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

export async function fetchNaverMain(ticker: string): Promise<FundamentalData> {
  const doc = await fetchHtml(`https://finance.naver.com/item/main.naver?code=${ticker}`);
  const out: FundamentalData = {};
  if (!doc) return out;

  // 종목명
  const titleNode = doc.querySelector("div.wrap_company h2 a");
  if (titleNode) out.name = _cleanWs(titleNode.textContent);
  // 현재가
  const curNode = doc.querySelector("p.no_today span.blind");
  if (curNode) {
    const v = _toInt(curNode.textContent);
    if (v != null) out.price = v;
  }

  // em#_xxx 매핑
  const emMap: { id: string; key: keyof FundamentalData; isInt?: boolean; isText?: boolean }[] = [
    { id: "_market_sum",  key: "market_cap_text", isText: true },
    { id: "_per",         key: "per" },
    { id: "_eps",         key: "eps", isInt: true },
    { id: "_pbr",         key: "pbr" },
    { id: "_dvr",         key: "dividend_yield" },
  ];
  for (const { id, key, isInt, isText } of emMap) {
    const node = doc.querySelector(`em#${id}`);
    if (!node) continue;
    const raw = _cleanWs(node.textContent);
    if (isText) {
      (out as Record<string, unknown>)[key] = raw ? `${raw}억원` : undefined;
    } else if (isInt) {
      const v = _toInt(raw);
      if (v != null) (out as Record<string, unknown>)[key] = v;
    } else {
      const v = _toFloat(raw);
      if (v != null) (out as Record<string, unknown>)[key] = v;
    }
  }

  // BPS — PBR 행에 함께 (PBR/BPS th 옆)
  const trs = doc.querySelectorAll("div.aside_invest_info table tr");
  trs.forEach(tr => {
    const txt = tr.textContent ?? "";
    if (txt.includes("PBR") && txt.includes("BPS")) {
      const ems = tr.querySelectorAll("td em");
      if (ems.length >= 2) {
        const bps = _toInt(ems[1].textContent);
        if (bps != null) out.bps = bps;
      }
    }
    // 52주 최고/최저
    if (txt.includes("52주")) {
      const ems = tr.querySelectorAll("td em");
      if (ems.length >= 2) {
        const hi = _toInt(ems[0].textContent);
        const lo = _toInt(ems[1].textContent);
        if (hi != null) out.high_52w = hi;
        if (lo != null) out.low_52w = lo;
      }
    }
    // 외국인 소진율
    if (txt.includes("외국인소진율") || txt.includes("외국인 소진율")) {
      const em = tr.querySelector("td em");
      const v = _toFloat(em?.textContent);
      if (v != null) out.foreign_ownership = v;
    }
    // 동일업종 PER
    if (txt.includes("동일업종 PER")) {
      const em = tr.querySelector("td em");
      const v = _toFloat(em?.textContent);
      if (v != null) out.industry_per = v;
    }
    // 투자의견 + 컨센서스 목표주가 — <th>...목표주가 행
    if (txt.includes("목표주가")) {
      const td = tr.querySelector("td");
      if (!td) return;
      // 1) f_* 클래스 span 안에 점수(em) + 의견 텍스트
      const opSpan = Array.from(td.querySelectorAll("span"))
        .find(s => Array.from(s.classList).some(c => c.startsWith("f_")));
      if (opSpan) {
        const em = opSpan.querySelector("em");
        const emText = _cleanWs(em?.textContent);
        if (emText) {
          const score = _toFloat(emText);
          if (score != null) out.consensus_score = score;
        }
        const full = _cleanWs(opSpan.textContent);
        const opinion = emText ? full.replace(emText, "").trim() : full;
        if (opinion) out.consensus_opinion = opinion;
      }
      // 2) span 외부의 em = 공식 컨센서스 목표가
      td.querySelectorAll("em").forEach(em => {
        if (out.consensus_target_official != null) return;
        if (em.closest("span")) return;  // f_* span 내 em 제외
        const val = _toInt(em.textContent);
        if (val != null) out.consensus_target_official = val;
      });
    }
  });
  return out;
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
  const url = `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`;
  const doc = await fetchHtml(url);
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

// ─────────── 통합: 모든 데이터 한 번에 ───────────
export interface FullValuation {
  fundamental: FundamentalData;
  reports: ConsensusReport[];
  shareholders: Shareholder[];
  avgTarget?: number;
}

export async function fetchFullValuation(ticker: string): Promise<FullValuation> {
  if (!/^\d{6}$/.test(ticker)) {
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
