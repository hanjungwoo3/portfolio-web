// 기업 밸류업 꼬리표(저PBR·고배당·밸류업 우수) — PC 종목 카드·모바일 종목 카드·종목정보 창이 같이 쓴다.
//   누르기는 없다(사용자 2026-11-03 "클릭은 안 돼도 될 것 같아") — 마우스를 올리면 PBR·기준일 등. 명단 전체는 🏷️ 밸류업 명단 탭.
import { createPortal } from "react-dom";
import { useValueupTags } from "../lib/valueupTags";
import { useHoverLayer, layerStyle } from "../lib/useHoverLayer";

// 꼬리표 하나 — 마우스를 올리면 설명 레이어(사용자 2026-11-03 "고배당/밸류업도 레이어로, hover 로"). 기본 툴팁(title)은 느리고 작다
function Chip({ cls, label, head, lines }: { cls: string; label: string; head: string; lines: string[] }) {
  const hl = useHoverLayer();
  return (
    <>
      <span className={`${cls} cursor-default`} onMouseEnter={hl.enter} onMouseLeave={hl.leave}>{label}</span>
      {hl.pos && createPortal(
        <div className="fixed z-[1000] rounded-lg border border-gray-300 bg-white shadow-xl p-2 text-[11px] leading-snug pg-card"
             style={layerStyle(hl.pos, 280, 120)} onMouseEnter={hl.keep} onMouseLeave={hl.leave}>
          <div className="font-bold text-[12px] text-gray-800 mb-0.5">{head}</div>
          {lines.map((l, i) => <div key={i} className="text-gray-600">{l}</div>)}
        </div>, document.body)}
    </>
  );
}

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
      <Chip key="pbr" cls={`${base} border-slate-400 bg-slate-100 text-slate-700`} label={`저PBR${p.pbr != null ? ` ${p.pbr}` : ""}`}
            head={`저PBR 기업 — PBR ${p.pbr ?? "—"}배`}
            lines={[`거래소 공표 ${p.pub ?? ""} · PBR ${p.base ?? ""} 기준${p.sector ? ` · ${p.sector}` : ""}`, "3년 누적 PBR 이 시장·업종 하위권(유가 25%·코스닥 10%)인데 개선계획을 내지 않은 기업"]} />);
  }
  if (t.highdiv) {
    out.push(
      <Chip key="div" cls={`${base} border-emerald-300 bg-emerald-50 text-emerald-700`} label="고배당" head="고배당기업"
            lines={[`기업가치 제고 계획 공시의 '고배당기업 여부' 해당${t.highdiv.year ? ` (사업연도 ${t.highdiv.year})` : ""}`, "조세특례제한법 104조의27 — 배당소득 분리과세 대상"]} />);
  }
  if (t.excellent) {
    const a = t.excellent.awards;
    out.push(
      <Chip key="exc" cls={`${base} border-amber-300 bg-amber-50 text-amber-700`} label="밸류업★" head="밸류업 우수기업"
            lines={a.map(x => `${x.year} ${x.award}`)} />);
  }
  return <>{out}</>;
}
