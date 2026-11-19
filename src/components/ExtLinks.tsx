// 섹션 설명 줄 안 바깥 링크(설명과 한 줄, 사용자 2026-11-20 "한줄로") — PC(UsMarketTab)·모바일(MobileSimpleView) 공용
//   KRX 공지(krxSeq)는 증시 탭 KRX 지수 공지와 같은 팝업으로 연다(사용자 2026-11-20 "팝업레이어로")
import { openExternal } from "../lib/toss";
import { KrxNoticeButton } from "./KrxNoticeCard";

const CLS = "inline-flex items-center rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11.5px] font-bold text-indigo-700 hover:bg-indigo-100";

export function ExtLinks({ links }: { links?: { label: string; url: string; krxSeq?: string }[] }) {
  if (!links?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {links.map(l => l.krxSeq
        ? <KrxNoticeButton key={l.url} seq={l.krxSeq} label={l.label} url={l.url} className={CLS} />
        : (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
           onClick={e => { e.preventDefault(); openExternal(l.url); }} className={CLS}>
          {l.label} ↗
        </a>
      ))}
    </span>
  );
}
