// 증권사연결 폴더는 자동 관리 — 연동 그룹은 들어가고, 수동 그룹은 빠지고, 연동 해제하면 폴더에서도 빠진다.
import { beforeEach, describe, expect, it } from "vitest";
import { getGroupFolders, setGroupFolders } from "../groupFolders";
import { BROKER_FOLDER, ensureLinkedGroupsInFolder, removeLinkedGroup, setLinkedGroups } from "../linkedGroups";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => true } });
});

const brokerGroups = () => getGroupFolders().find(f => f.name === BROKER_FOLDER)?.groups;

describe("증권사연결 폴더 자동 관리", () => {
  it("연동 그룹은 폴더에 들어가고, 손으로 넣은 수동 그룹은 빠진다", () => {
    setLinkedGroups({ "토스": { broker: "toss", accountSeq: "1" } });
    setGroupFolders([{ name: BROKER_FOLDER, groups: ["0416", "토스"] }, { name: "보따리", groups: ["0421"] }]);
    expect(ensureLinkedGroupsInFolder()).toBe(true);
    expect(brokerGroups()).toEqual(["토스"]);
    expect(getGroupFolders().find(f => f.name === "보따리")?.groups).toEqual(["0421"]);   // 다른 폴더는 건드리지 않음
    expect(ensureLinkedGroupsInFolder()).toBe(false);   // 멱등
  });
  it("폴더가 없으면 만들어 넣는다", () => {
    setLinkedGroups({ "한국투자": { broker: "kis", accountSeq: "2" } });
    setGroupFolders([]);
    expect(ensureLinkedGroupsInFolder()).toBe(true);
    expect(brokerGroups()).toEqual(["한국투자"]);
  });
  it("연동 해제하면 폴더에서도 자동으로 빠진다", () => {
    setLinkedGroups({ "토스": { broker: "toss", accountSeq: "1" }, "한국투자": { broker: "kis", accountSeq: "2" } });
    setGroupFolders([{ name: BROKER_FOLDER, groups: ["토스", "한국투자"] }]);
    removeLinkedGroup("토스");
    expect(brokerGroups()).toEqual(["한국투자"]);
  });
});
