// 기업 밸류업 꼬리표 — 거래소 KIND 밸류업 메뉴의 저PBR기업·고배당기업·밸류업 우수기업(사용자 2026-11-02).
//   크롤러(portfolio-etf-index/scripts/valueup.js)가 매일 06:00 KST 에 받아 둔다(0콜, 프록시 화이트리스트 변경 없음).
//   저PBR 은 1년에 두 번(5월·11월) 공표 — 2026-11-02 첫 공표 151곳.
import { useQuery } from "@tanstack/react-query";

const URL_TAGS = "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/valueup-tags.json";

export interface ValueupFile {
  meta: { builtAt: string };
  lowpbr: Record<string, { name: string; pbr?: number; sector?: string; base?: string; pub?: string }>;
  highdiv: Record<string, { name: string; year?: string }>;
  excellent: Record<string, { name: string; awards: { year: string; award: string }[] }>;
}
export interface ValueupTagInfo {
  lowpbr?: ValueupFile["lowpbr"][string];
  highdiv?: ValueupFile["highdiv"][string];
  excellent?: ValueupFile["excellent"][string];
}

export const KIND_VALUEUP_URL = {
  lowpbr: "https://kind.krx.co.kr/valueup/lowpbr.do?method=valueupLowpbrMain",
  highdiv: "https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain",
  excellent: "https://kind.krx.co.kr/valueup/excntcorp.do?method=valueupExcntCorpMain",
} as const;

async function loadValueup(): Promise<ValueupFile> {
  const r = await fetch(URL_TAGS, { cache: "no-store" });
  if (!r.ok) throw new Error(`valueup-tags HTTP ${r.status}`);
  return await r.json() as ValueupFile;
}

/** 종목코드(6자리) → 꼬리표. 파일을 못 받았거나 해당 없으면 undefined. */
export function tagsFor(file: ValueupFile | undefined, code: string | null | undefined): ValueupTagInfo | undefined {
  if (!file || !code) return undefined;
  const k = code.replace(/^A/, "");
  const t: ValueupTagInfo = { lowpbr: file.lowpbr?.[k], highdiv: file.highdiv?.[k], excellent: file.excellent?.[k] };
  return t.lowpbr || t.highdiv || t.excellent ? t : undefined;
}

/** 파일 통째 — 카드 여러 장을 도는 화면(지수 탭)에서 tagsFor 로 꺼내 쓴다. */
export function useValueupFile(): ValueupFile | undefined {
  const { data } = useQuery({ queryKey: ["valueup-tags"], queryFn: loadValueup, staleTime: 6 * 3600_000, gcTime: 24 * 3600_000, retry: 1 });
  return data;
}

export function useValueupTags(code: string | undefined): ValueupTagInfo | undefined {
  const enabled = !!code && /^A?[\dA-Za-z]{6}$/.test(code);
  const { data } = useQuery({
    queryKey: ["valueup-tags"], queryFn: loadValueup, enabled,
    staleTime: 6 * 3600_000, gcTime: 24 * 3600_000, retry: 1,
  });
  return enabled ? tagsFor(data, code) : undefined;
}
