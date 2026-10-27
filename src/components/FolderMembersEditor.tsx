// 설정 > 그룹 폴더 — 폴더마다 전체 그룹 체크박스. 그룹은 한 폴더에만: 다른 폴더의 그룹을 체크하면 그쪽에서 빠져 옮겨진다.
// 같은 그룹이 폴더마다 다시 보이는 건 "어느 폴더로 옮길지" 고르기 위한 것(사용자 2026-10-27 "중복 ?" → 설명,
// 탭으로 나뉘면 체크박스 그대로 두기로). 다른 폴더에 있는 그룹은 흐리게 + 폴더명 힌트.
// PC 설정(SettingsDialog)·모바일 설정(MobileSimpleView) 공용 — 한 벌만 둔다.
import type { GroupFolder } from "../lib/groupFolders";
import { FolderIcon } from "./FolderIcon";
import { BROKER_FOLDER, isLinkedGroup } from "../lib/linkedGroups";

export function moveGroupToFolder(folders: GroupFolder[], folderName: string, group: string): GroupFolder[] {
  return folders.map(f => f.name === folderName
    ? { ...f, groups: f.groups.includes(group) ? f.groups : [...f.groups, group] }
    : { ...f, groups: f.groups.filter(g => g !== group) });
}
export function removeGroupFromFolder(folders: GroupFolder[], folderName: string, group: string): GroupFolder[] {
  return folders.map(f => f.name === folderName ? { ...f, groups: f.groups.filter(g => g !== group) } : f);
}

export function FolderMembersEditor({ folders, groups, onChange, deleteLabel = "폴더 삭제" }: {
  folders: GroupFolder[];
  groups: string[];                       // 사용자 그룹 전체(보유 기준)
  onChange: (next: GroupFolder[]) => void;
  deleteLabel?: string;
}) {
  const folderOf = new Map<string, string>();
  for (const f of folders) for (const g of f.groups) folderOf.set(g, f.name);
  return (
    <>
      {folders.map(f => {
        // 증권사연결 폴더는 연동 그룹(토스·한투)만 — 수동 그룹은 들어갈 수 없고, 연동 그룹은 다른 폴더로 못 옮긴다
        // (사용자 2026-10-27: "증권사 연결에는 그룹이 수동은 없어야 할거 같은데"). 넣고 빼는 건 연결/해제가 한다
        // (ensureLinkedGroupsInFolder/removeLinkedGroup) → 체크박스는 읽기 전용, 삭제 버튼도 없다.
        const broker = f.name === BROKER_FOLDER;
        const list = groups.filter(g => broker ? isLinkedGroup(g) : !isLinkedGroup(g));
        return (
        <div key={f.name} className="mb-2 p-2 border border-gray-200 rounded">
          <div className="flex items-center mb-1 gap-1">
            <span className="text-xs font-bold text-gray-800 inline-flex items-center gap-1">
              <FolderIcon folder={f.name} />{f.name}
            </span>
            <span className="text-[10px] text-gray-400">{f.groups.length}개</span>
            {broker
              ? <span className="ml-auto text-[10px] text-gray-400">연동 그룹만 — 연결/해제 때 자동으로 넣고 뺍니다</span>
              : <button type="button" onClick={() => onChange(folders.filter(x => x.name !== f.name))}
                        className="ml-auto text-[10px] text-rose-500 hover:underline">{deleteLabel}</button>}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {list.length === 0 && <span className="text-[11px] text-gray-400">{broker ? "연결된 증권사가 없습니다" : "그룹이 없습니다"}</span>}
            {list.map(g => {
              const checked = f.groups.includes(g);
              const other = checked ? undefined : folderOf.get(g);
              return (
                <label key={g} className={`flex items-center gap-1 cursor-pointer select-none ${other ? "opacity-50" : ""}`}
                       title={other ? `지금은 "${other}" 폴더 — 체크하면 이쪽으로 옮겨집니다` : undefined}>
                  <input type="checkbox" checked={checked} disabled={broker}
                         title={broker ? "연결 해제하면 자동으로 빠집니다" : undefined}
                         onChange={e => onChange(e.target.checked ? moveGroupToFolder(folders, f.name, g) : removeGroupFromFolder(folders, f.name, g))}
                         className="w-3.5 h-3.5 accent-blue-600 disabled:opacity-60" />
                  <span className="text-[11px] text-gray-700">{g}{other && <span className="text-gray-400"> ({other})</span>}</span>
                </label>
              );
            })}
          </div>
        </div>
        );
      })}
    </>
  );
}
