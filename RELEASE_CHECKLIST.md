# 릴리스 체크리스트 — obsidian-stacktube

> 2026-07-05 세션(0.2.0 디렉토리 리뷰 Fail → 0.2.1 복구)에서 확정된 절차.
> **핵심 교훈: 태그 push = 릴리스 끝이 아니다.** community.obsidian.md 는 릴리스마다
> 자동 리뷰를 돌리고, **Fail 이면 무음으로 옛 버전에 머문다** (페이지 버전/README 미갱신).

---

## 1. 릴리스 전 (코드)

- [ ] **정적 인라인 스타일 0건** — `grep -rn "\.style\." src/` 결과가 비어야 함.
      `obsidianmd/no-static-styles-assignment` 는 디렉토리 리뷰 **Error(차단)** 등급.
      정적 값은 `styles.css` 클래스로, 동적 토글은 `el.toggleClass(cls, bool)` 로.
      (0.2.0 이 이 룰 ~30건으로 Fail — 0.2.1 에서 전부 클래스 이동, f262298)
- [ ] 버전 3종 동기: `manifest.json` + `package.json` + `versions.json` (새 버전: minAppVersion)
- [ ] 태그는 **`v` 접두사 없이** (`0.2.1`, ~~v0.2.1~~) — manifest 버전과 문자열 일치 필수
- [ ] `npm run build` 통과 (tsc 0)
- [ ] E2E: `npx esbuild test/run.ts --bundle --platform=node --format=cjs --alias:obsidian=./test/obsidian-stub.ts --outfile=/tmp/testrun.cjs && node /tmp/testrun.cjs` → 28/28 PASS
      (`obsidian` npm 패키지는 타입 전용이라 stub alias 번들로만 실행 가능)

## 2. 릴리스 (터미널 — BUMJIN)

- [ ] 커밋 → `git tag <버전>` → `git push origin master --tags`
      ⚠️ **manifest 버전 bump 커밋과 태그 push 를 한 호흡에.** 사이가 벌어지면 디렉토리
      스캔이 그 틈에 돌아 "No release matches your manifest version" 에러 상태로 정지한다
      (0.2.0 때 실제 발생 — manifest 먼저 push, 릴리스는 다음 날).
      ⚠️ Cowork 샌드박스는 `.git/index.lock` EPERM 으로 커밋 불가 — 커밋·push 는 터미널에서.
- [ ] GitHub Actions "Release Obsidian plugin" 성공 확인 → 릴리스 Assets 에
      `main.js` / `manifest.json` / `styles.css` (attestation 은 워크플로가 자동)

## 3. 릴리스 후 (디렉토리 — 필수, 건너뛰면 페이지 미갱신)

- [ ] community.obsidian.md 로그인 → 공개 페이지 `…` 메뉴 → **Manage…**
      (계정 대시보드 "Your plugins" 목록이 비어 보이는 글리치가 있음 — 공개 페이지 경유가 확실)
- [ ] `…` → **Check for new releases** → "A scan has been queued" 확인
- [ ] 몇 분 뒤 Reviews 에서 새 버전 **Completed** 확인 (Failed 면 Error 항목 수정 → 패치 릴리스)
- [ ] 공개 페이지에서 Current version / Updates 탭 / Overview README 갱신 눈확인
      (README 는 GitHub master 를 스캔 시점에 다시 긁어감. 로그아웃 CDN 캐시는 잠시 옛 버전일 수 있음)
- 참고: 사전 검증하고 싶으면 대시보드 **Review branch** 로 브랜치 리뷰 가능

## 4. 알려진 비차단 지적 (백로그 — 다음 릴리스에 묶어 처리)

- Warning: `activeDocument` 대신 `document` 사용 — capture-modal.ts:111·179, main.ts:125
- Warning: 불필요한 type assertion — capture-modal.ts:186
- Warning: unsafe `any` 대입 — main.ts:96
- Warning: 정규식 제어문자 `\x00`,`\x1f` — writer.ts:13
- Recommendation: 미사용 `e` — api.ts:112
- README 스테일 문구: "(recommended, once approved)" 제거 / "연결 테스트 / Test connection" 영문화
- 기존 백로그: v0.1.1 트랙(403 친화 메시지 + 새 심볼 아이콘), ko/ja UI, 채널 필터
