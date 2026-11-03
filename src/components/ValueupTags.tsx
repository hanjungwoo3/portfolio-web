// 기업 밸류업 꼬리표(저PBR·고배당·밸류업 우수) — PC 종목 카드·모바일 종목 카드·종목정보 창이 같이 쓴다.
//   누르기는 없다(사용자 2026-11-03 "클릭은 안 돼도 될 것 같아") — 마우스를 올리면 PBR·기준일 등. 명단 전체는 🏷️ 밸류업 명단 탭.
import { useValueupTags } from "../lib/valueupTags";

export function ValueupTags({ code, size = "sm", bookmark, flat }: {
  code: string | undefined;
  size?: "xs" | "sm";
  bookmark?: boolean;   // PC 종목 카드 책갈피 줄 — 위만 둥글게
  flat?: boolean;       // 지수 탭 카드 아래 책갈피 줄(📊·🔍 칩과 같은 높이)
}) {
  const t = useValueupTags(code);
  if (!t) return null;
  const base = flat
    ? "px-1.5 py-0 rounded text-[9px] font-bold leading-tight border whitespace-nowrap"
    : `inline-flex items-center px-1.5 py-0.5 ${bookmark ? "rounded-t-md" : "rounded"} border font-bold leading-none whitespace-nowrap
                ${size === "xs" ? "text-[9px]" : "text-[10px]"}`;
  const out = [];
  if (t.lowpbr) {
    const p = t.lowpbr;
    out.push(
      <span key="pbr"
         title={`거래소 저PBR 기업 공표(${p.pub ?? ""}) — 3년 누적 PBR 이 시장·업종 하위권(유가 25%·코스닥 10%)이고 개선계획 미제출.\nPBR ${p.pbr ?? "—"}배 (${p.base ?? ""} 기준)${p.sector ? ` · ${p.sector}` : ""}`}
         className={`${base} border-slate-400 bg-slate-100 text-slate-700`}>
        저PBR{p.pbr != null ? ` ${p.pbr}` : ""}
      </span>);
  }
  if (t.highdiv) {
    out.push(
      <span key="div"
         title={`고배당기업 — 기업가치 제고 계획 공시의 고배당기업 여부 '해당'(조세특례제한법 104조의27)${t.highdiv.year ? `, 사업연도 ${t.highdiv.year}` : ""}`}
         className={`${base} border-emerald-300 bg-emerald-50 text-emerald-700`}>
        고배당
      </span>);
  }
  if (t.excellent) {
    const a = t.excellent.awards;
    out.push(
      <span key="exc"
         title={`밸류업 우수기업 — ${a.map(x => `${x.year} ${x.award}`).join(", ")}`}
         className={`${base} border-amber-300 bg-amber-50 text-amber-700`}>
        밸류업★
      </span>);
  }
  return <>{out}</>;
}
