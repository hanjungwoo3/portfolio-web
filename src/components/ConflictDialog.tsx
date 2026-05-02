// 충돌 경고 다이얼로그 — Drive 가 마지막 sync 이후 변경됐을 때 표시
import { useRef } from "react";

interface Props {
  isOpen: boolean;
  driveTs: string;       // Drive 의 modifiedTime (ISO)
  lastTs: string | null; // 마지막 sync 한 시각 (ISO) — null 이면 "처음"
  onUseRemote: () => void;   // ↓ 최신 가져오기
  onOverwrite: () => void;   // ⚠ 내 변경 덮어쓰기
  onCancel: () => void;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
}

export function ConflictDialog({
  isOpen, driveTs, lastTs, onUseRemote, onOverwrite, onCancel,
}: Props) {
  const downOnBackdropRef = useRef(false);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                     bg-black/50 p-4"
         onMouseDown={e => { downOnBackdropRef.current = e.target === e.currentTarget; }}
         onClick={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onCancel();
         }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full
                       max-h-[92vh] overflow-y-auto">
        <header className="px-5 py-4 border-b bg-amber-50">
          <h2 className="text-lg font-bold text-amber-900 flex items-center gap-2">
            ⚠️ 다른 기기에서 변경됨
          </h2>
        </header>

        <div className="px-5 py-4 space-y-3 text-sm text-gray-800">
          <p>
            Google Drive 의 종목 데이터가 이 기기의 마지막 동기화 시점 이후로 변경되었습니다.
          </p>
          <div className="bg-gray-50 rounded p-3 text-xs space-y-1 border border-gray-200">
            <div>
              <span className="text-gray-500">이 기기 마지막 가져옴: </span>
              <b className="text-gray-900">{lastTs ? fmt(lastTs) : "(없음)"}</b>
            </div>
            <div>
              <span className="text-gray-500">Drive 최신 변경: </span>
              <b className="text-gray-900">{fmt(driveTs)}</b>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            "최신 가져오기" 를 권장합니다. 이 기기의 변경사항이 다른 기기에서 더 새로운 변경으로 덮어졌을 수 있어요.
          </p>
        </div>

        <footer className="px-5 py-3 border-t bg-gray-50 flex flex-col gap-2">
          <button onClick={onUseRemote}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700
                             text-white text-sm font-bold rounded">
            ↓ Drive 최신 가져오기 (권장)
          </button>
          <button onClick={onOverwrite}
                  className="w-full px-4 py-2 bg-rose-100 hover:bg-rose-200
                             text-rose-800 text-sm font-medium rounded
                             border border-rose-300">
            ⚠ 이 기기 데이터로 Drive 덮어쓰기
          </button>
          <button onClick={onCancel}
                  className="w-full px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700">
            취소
          </button>
        </footer>
      </div>
    </div>
  );
}
