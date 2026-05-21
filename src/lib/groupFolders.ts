// 상단 그룹 탭을 폴더로 묶기 — localStorage 기반.
// 폴더에 담긴 그룹은 탭 바에서 "📁 폴더(선택그룹) ▾" 드롭다운 하나로 합쳐 표시.
// 폴더에 안 담긴 그룹은 그대로 개별 탭 유지.

const KEY = "portfolio_group_folders";

export interface GroupFolder {
  name: string;       // 폴더 이름 (예: "보따리")
  groups: string[];   // 이 폴더에 담긴 그룹(account) 이름들
}

export function getGroupFolders(): GroupFolder[] {
  try {
    const v = localStorage.getItem(KEY);
    if (!v) return [];
    const arr = JSON.parse(v);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(f => f && typeof f.name === "string" && Array.isArray(f.groups))
      .map(f => ({ name: f.name as string, groups: (f.groups as unknown[]).filter(g => typeof g === "string") as string[] }));
  } catch {
    return [];
  }
}

export function setGroupFolders(folders: GroupFolder[]): void {
  try {
    // 빈 폴더(그룹 0개)도 보관 — 설정에서 만들고 채우는 중일 수 있음
    localStorage.setItem(KEY, JSON.stringify(folders));
  } catch {
    /* noop */
  }
}

// 그룹 → 폴더 이름 역인덱스 (없으면 undefined)
export function folderOfGroup(folders: GroupFolder[], group: string): string | undefined {
  return folders.find(f => f.groups.includes(group))?.name;
}
