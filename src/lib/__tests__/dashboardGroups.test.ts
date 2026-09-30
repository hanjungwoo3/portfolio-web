import { describe, it, expect, vi, afterEach } from "vitest";
import { buildDashboardPage, defaultDashboardPage, PAGE_IDS, DASHBOARD_PAGES, INDEX_GROUP_KEYS, indexPageOf, type DashboardPage } from "../dashboardGroups";
import { US_MARKET_TAB_KEY, INDEX_NIGHT_TAB_KEY, INDEX_SEMI_TAB_KEY } from "../../components/Tabs";
import { US_PAIRS } from "../usMarketData";

// 지수 탭 — 나라가 아니라 **지금 움직이는 시장** 으로 나눈 세 페이지.
//   ⚠️ 기대값을 코드에 맞춰 베끼지 말 것. 각 테스트 이름의 **의도**가 먼저다.
const PAGES: DashboardPage[] = ["day", "night", "semi"];
const ids = (p: DashboardPage) => buildDashboardPage(p).map(s => s.id);

describe("지수 탭 페이지 구성", () => {
  it("페이지 목록의 그룹 id 가 전부 실제 그룹이다 (오타면 그 그룹이 소리 없이 사라진다)", () => {
    for (const p of PAGES) expect(ids(p)).toEqual(PAGE_IDS[p]);
  });

  it("한 페이지 안에서 같은 그룹이 두 번 나오지 않는다", () => {
    for (const p of PAGES) expect(new Set(ids(p)).size).toBe(ids(p).length);
  });

  it("주간 = 한국장 + 미국 야간선물 — 밤 전용 그룹(밤의 한국)은 없다", () => {
    const d = ids("day");
    expect(d[0]).toBe("kr");
    // 미국 지수 선물 4종은 한국 시장 그룹 둘째 줄에 같이 있다(따로 그룹을 두지 않는다)
    const kr = buildDashboardPage("day").find(s => s.id === "kr")!.rows.flat();
    for (const f of ["NQ=F", "ES=F", "RTY=F", "SOX=F"]) expect(kr).toContain(f);
    expect(d).not.toContain("krnight");
  });

  it("야간 = 미국장 + 한국 야간선물·24h — 미국 지수가 맨 위", () => {
    const n = ids("night");
    expect(n[0]).toBe("macro");
    expect(n).toContain("krnight");
    expect(n).not.toContain("etftop");   // 한국 ETF 랭킹은 밤엔 멈춰 있다
  });

  it("24시간 움직이는 그룹(현물·섹터·환율금리)은 주간·야간 둘 다에 있다 (한쪽에만 두면 반대 시간에 못 본다)", () => {
    for (const g of ["spot", "sector", "krfx"]) {
      expect(ids("day")).toContain(g);
      expect(ids("night")).toContain(g);
    }
  });

  it("주간·야간 맨 아래는 같은 한 세트(섹터 → 현물 → 환율·금리·투심) — 어느 페이지든 같은 자리에서 찾는다", () => {
    expect(ids("day").slice(-3)).toEqual(["sector", "spot", "krfx"]);
    expect(ids("night").slice(-3)).toEqual(["sector", "spot", "krfx"]);
  });

  it("야간엔 반도체 페이지 그룹이 없다 (따로 페이지가 있으니 겹쳐 두지 않는다)", () => {
    for (const g of ids("semi")) expect(ids("night")).not.toContain(g);
  });

  it("반도체 페이지 = 반도체 · 소부장 · AI 인프라 · AI 단계별 대장주 · 순환매(큰 블록) · 순환매 부가정보", () => {
    expect(ids("semi")).toEqual(["semi", "semieq", "aiinfra", "aiflow", "rotflow", "rotation"]);
  });

  it("순환매 = 큰 블록 하나에 단계별 줄 6개 — 줄마다 책갈피 이름, 첫 칸 미국 대장주, 나머지 한국 종목", () => {
    const g = buildDashboardPage("semi").find(s => s.id === "rotflow")!;
    expect(g.note).toBeTruthy();                                  // 미국→한국 영향이라는 설명 한 줄
    expect(g.rows).toHaveLength(6);
    expect(g.rowLabels).toEqual(["반도체", "전공정", "후공정", "전력기기", "원자력", "친환경"]);
    expect(g.lead).toBe(true);
    expect(g.tags).toBeUndefined();                               // 카드 책갈피는 뺐다 — 줄 책갈피가 대신한다
    for (const row of g.rows) {
      const [lead, ...kr] = row;
      expect(lead).not.toMatch(/\.KS$/);
      expect(kr.length).toBeGreaterThan(0);
      expect(kr.every(s => /^[\dA-Za-z]{6}\.KS$/.test(s))).toBe(true);
    }
  });

  it("지수 탭 셋(DASHBOARD_PAGES)과 페이지 정의(PAGE_IDS)가 같은 세 페이지다", () => {
    expect(DASHBOARD_PAGES.map(p => p.key).sort()).toEqual([...PAGES].sort());
  });

  it("카드 그룹에 넣은 심볼은 전부 등록돼 있다 (없으면 카드가 소리 없이 안 그려진다)", () => {
    const known = new Set(US_PAIRS.filter(p => p.tier === "T0").map(p => p.symbol));
    const special = new Set(["KVALUE", "SKHY-PERP", "SMSN-PERP"]);   // 전용 카드로 그린다
    const missing: string[] = [];
    for (const p of PAGES) {
      for (const s of buildDashboardPage(p)) {
        if (s.render) continue;   // 섹터·ETF TOP 은 별도 블록 — rows 는 폴백
        for (const sym of s.rows.flat()) if (!known.has(sym) && !special.has(sym)) missing.push(`${p}/${s.id}/${sym}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("지수 탭 키 ↔ 페이지", () => {
  it("lib 의 키 문자열이 Tabs.tsx 상수와 같다 (어긋나면 탭을 눌러도 엉뚱한 페이지가 뜬다)", () => {
    expect([...INDEX_GROUP_KEYS].sort()).toEqual([US_MARKET_TAB_KEY, INDEX_NIGHT_TAB_KEY, INDEX_SEMI_TAB_KEY].sort());
    expect(indexPageOf(US_MARKET_TAB_KEY)).toBe("day");
    expect(indexPageOf(INDEX_NIGHT_TAB_KEY)).toBe("night");
    expect(indexPageOf(INDEX_SEMI_TAB_KEY)).toBe("semi");
  });
});

describe("처음 여는 페이지 — 시간으로", () => {
  afterEach(() => { vi.useRealTimers(); });
  const at = (kstHour: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, kstHour - 9, 0)));   // KST = UTC+9
    return defaultDashboardPage();
  };
  it("한국 낮(07~18시)은 주간", () => {
    expect(at(7)).toBe("day"); expect(at(10)).toBe("day"); expect(at(17)).toBe("day");
  });
  it("그 외는 야간", () => {
    expect(at(18)).toBe("night"); expect(at(23)).toBe("night"); expect(at(30)).toBe("night");   // 30 = 다음날 06시
  });
});
