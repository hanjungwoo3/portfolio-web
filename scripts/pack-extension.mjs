#!/usr/bin/env node
// 확장 배포용 zip 만들기 — extension/ 을 그대로 담는다.
//   사용자가 저장소 전체를 받아 하위 폴더를 찾을 필요 없이 zip 하나만 받으면 되게 한다.
//   결과: dist-extension/portfolio-proxy-extension-<version>.zip
//   릴리스: gh release create v<version> dist-extension/*.zip

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";

const SRC = "extension";
const OUT_DIR = "dist-extension";

const manifest = JSON.parse(readFileSync(`${SRC}/manifest.json`, "utf8"));

// 버전은 두 곳에 있다 — manifest.json(확장이 보고하는 값)과 앱의 EXPECTED_EXTENSION_VERSION
// (앱이 "낡았다" 고 판단하는 기준). 어긋나면 사용자에게 잘못된 업데이트 안내가 뜬다.
const appSrc = readFileSync("src/lib/extensionProxy.ts", "utf8");
const expected = appSrc.match(/EXPECTED_EXTENSION_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (expected !== manifest.version) {
  console.error(`❌ 버전 불일치`);
  console.error(`   extension/manifest.json        : ${manifest.version}`);
  console.error(`   EXPECTED_EXTENSION_VERSION     : ${expected ?? "(못 찾음)"}`);
  console.error(`   두 값을 같게 맞춘 뒤 다시 실행하세요.`);
  process.exit(1);
}
const zipName = `portfolio-proxy-extension-${manifest.version}.zip`;
const zipPath = `${OUT_DIR}/${zipName}`;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// README 는 빼고 실행에 필요한 것만 — 사용자가 압축을 풀었을 때 헷갈리지 않게.
execFileSync("zip", ["-r", "-q", `../${zipPath}`, ".", "-x", "README.md", ".DS_Store"], {
  cwd: SRC, stdio: "inherit",
});

if (!existsSync(zipPath)) {
  console.error("❌ zip 생성 실패");
  process.exit(1);
}
const kb = (readFileSync(zipPath).length / 1024).toFixed(1);
console.log(`✅ ${zipPath}  (${kb} KB)`);
console.log(`   릴리스: gh release create v${manifest.version} ${zipPath} --title "확장 v${manifest.version}"`);
