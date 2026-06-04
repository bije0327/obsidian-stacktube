# StackTube 플러그인 — 배포·테스트 런북 (하이브리드)

> 역할 분담: **터미널 명령(=BUMJIN이 입력)** / **GUI·웹(=Cowork가 화면에서 운전)**.
> 화면 제어 승인 대화상자가 뜨면 **허용**을 눌러주세요. 그 뒤 GUI 단계는 제가 진행합니다.

---

## A. 서버 배포 (라이브 동기화 테스트의 전제)

서버 변경은 `youtube-knowledge-system` 레포에 이미 작성돼 있습니다:
- `supabase/migrations/040_api_keys.sql` (신규 테이블)
- `frontend/src/lib/apiKeys.ts`, `apiKeyAuth.ts`
- `frontend/src/app/api/v1/notes/route.ts`, `api/v1/health/route.ts`
- `frontend/src/app/api/api-keys/route.ts`, `api-keys/[id]/route.ts`
- 설정 UI: `frontend/src/app/[locale]/dashboard/settings/api-keys/page.tsx` + `SettingsTabs.tsx` + i18n 3종 + `lib/api.ts`

### A-1. 마이그레이션 040 적용 (DB)
**[BUMJIN 또는 화면으로 같이]** Supabase 대시보드 → SQL Editor 에 `040_api_keys.sql` 내용을 붙여넣고 실행.
(또는 평소 쓰는 마이그레이션 러너로 040 적용.) staging 먼저 → prod 권장.

### A-2. 배포 (터미널)
```bash
cd ~/Desktop/youtube-knowledge-system
git checkout -b feat/obsidian-api      # 또는 기존 작업 브랜치
git add supabase/migrations/040_api_keys.sql \
        frontend/src/lib/apiKeys.ts frontend/src/lib/apiKeyAuth.ts \
        frontend/src/app/api/v1 frontend/src/app/api/api-keys \
        "frontend/src/app/[locale]/dashboard/settings/api-keys" \
        frontend/src/components/SettingsTabs.tsx frontend/src/lib/api.ts \
        frontend/messages/ko.json frontend/messages/ja.json frontend/messages/en.json
git commit -m "feat(api): /api/v1/notes + API key issuance for Obsidian plugin"
# 검증(이미 통과 확인됨): cd frontend && npx tsc --noEmit && bash ../scripts/i18n_parity_check.sh
git push origin HEAD        # → Railway 자동 배포
```
> 검증은 세션에서 통과 확인됨: tsc 0 errors, i18n parity 1188 keys, 키/커서/태그 단위 + E2E 15/15.

### A-3. 배포 확인
Railway 빌드 완료 후 `https://stacktube.io` (또는 staging) 가동 확인.

---

## B. API 키 발급 (웹)
**[화면으로 같이]** 로그인 → **설정 → Obsidian** 탭 → **새 키 발급** → 표시된 `st_live_…` 키를 복사(1회만 노출).

---

## C. Obsidian 설치 + 연결 테스트 + 동기화 (GUI)
**[화면으로 같이]** 빌드 산출물은 `~/Desktop/obsidian-stacktube/` 에 있습니다 (`main.js`, `manifest.json`, `styles.css`).

수동 설치:
1. vault 의 `.obsidian/plugins/stacktube/` 폴더 생성.
2. 위 3개 파일 복사.
3. Obsidian → 설정 → 커뮤니티 플러그인 → (재시작/새로고침) → **StackTube** 활성화.
4. 설정 → StackTube → API 키 붙여넣기 → **연결 테스트** → "연결 성공 · 플랜: …" 확인.
5. 명령 팔레트 → **StackTube: Sync new notes** → `StackTube/<채널>/<날짜>-<제목>.md` 생성 확인.

### Stage 1 게이트 체크 (스펙 §4)
- [ ] 연결 테스트 200
- [ ] 수동 동기화 → 새 노트 .md 생성
- [ ] frontmatter video_id 등 정상
- [ ] 재동기화 → 중복 0
- [ ] 자동 폴링(주기) → 새 결과만
- [ ] 키 오류/네트워크 끊김 → 앱 안 죽고 Notice
- [ ] 재시작 후 lastSyncedAt 유지(이어받기)
- [ ] 비밀값 로그 미노출

---

## D. GitHub 레포 + 릴리스 (하이브리드)
로컬 레포는 `~/Desktop/obsidian-stacktube` 에 커밋됨(`d0b7b98`).

### D-1. 레포 생성 + 푸시 (터미널)
```bash
cd ~/Desktop/obsidian-stacktube
gh repo create obsidian-stacktube --public --source=. --remote=origin --push
# gh 미설치 시: GitHub 웹에서 빈 repo 생성 후
#   git remote add origin https://github.com/bije0327/obsidian-stacktube.git
#   git push -u origin main
```

### D-2. 릴리스 (태그 → CI 자동 빌드·업로드)
```bash
git tag 0.1.0 && git push origin 0.1.0
```
→ `.github/workflows/release.yml` 가 `main.js`/`manifest.json`/`styles.css` 를 릴리스에 첨부.
(CI 없이 수동: GitHub Releases → tag 0.1.0 → 위 3개 파일 업로드.)

---

## E. BRAT 베타 배포
**[화면으로 같이]** Obsidian 에 BRAT 설치 → *Add beta plugin* → `bije0327/obsidian-stacktube` → 활성화.
(릴리스가 있어야 BRAT 가 받아옴.)

---

## F. 커뮤니티 디렉토리 등재 PR
1. `obsidianmd/obsidian-releases` 포크.
2. `community-plugins.json` 끝에 추가:
```json
{
  "id": "stacktube",
  "name": "StackTube",
  "author": "unstackd",
  "description": "Sync your StackTube YouTube knowledge notes into your vault.",
  "repo": "bije0327/obsidian-stacktube"
}
```
3. PR 생성 → 자동 검증 봇 통과 → 리뷰 대기.
> 제출 시점에 공식 개발자 문서(플러그인 가이드라인) 재확인 필수 — 정책이 자주 바뀜. 머지/라이브는 Obsidian 팀 일정에 달림.

### 등재 전 점검(가이드라인 흔한 지적)
- manifest `id`에 "obsidian"/"plugin" 미포함 ✓ (`stacktube`)
- `isDesktopOnly: true` ✓
- 비밀값 로그 미출력 ✓
- 네트워크는 `requestUrl` 사용(fetch 금지) ✓
- README 설치/설정/프라이버시 명시 ✓
