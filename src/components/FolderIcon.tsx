// 폴더 탭 아이콘 — 📁 이모지는 색을 못 바꾸므로 SVG 로. 증권사연결 폴더만 노란색(사용자 요청 2026-10-26: "배경이 아니라 폴더아이콘 색이 노랑").
import { BROKER_FOLDER } from "../lib/linkedGroups";

export function FolderIcon({ folder, className = "" }: { folder: string; className?: string }) {
  const amber = folder === BROKER_FOLDER;
  return (
    <svg viewBox="0 0 20 16" aria-hidden="true"
         className={`inline-block w-[1.05em] h-[0.85em] align-[-0.1em] shrink-0 ${amber ? "text-amber-400" : "text-gray-400"} ${className}`}>
      {/* 뒤판(어두운 톤) + 앞판 — 평범한 서류철 모양 */}
      <path d="M1 3a2 2 0 0 1 2-2h4.2l1.8 1.8H17a2 2 0 0 1 2 2V13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3z" fill="currentColor" opacity={0.55} />
      <path d="M1 6h18v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6z" fill="currentColor" />
    </svg>
  );
}
