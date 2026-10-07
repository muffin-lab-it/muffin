# 🧁 머핀랩 협업 가이드 (브랜치 · PR)

이 문서는 코드를 고쳐서 레포에 올리는 방법을 처음부터 끝까지 적은 것입니다.
Git이 처음이어도 위에서부터 순서대로 따라 하면 됩니다. 막히면 Discord #질문에 에러 화면을 올려 주세요.

## 한 줄 요약

```
main 에서 새 브랜치 만들기 → 코드 수정 → 커밋 → push → PR 올리기 → 리뷰 반영 → 리더가 머지
```

- `main`은 배포되는 브랜치입니다. **직접 push 하지 않습니다.** (설정으로 막혀 있어서 되지도 않습니다)
- 모든 변경은 **브랜치 + PR**로 올리고, **리더가 최종 머지**합니다.
- PR 하나 = 기능 하나. 작게 자주 올리는 게 리뷰도 빠르고 충돌도 적습니다.

---

## 0. 처음 한 번만 하는 설정

```bash
# 내 이름·이메일 (커밋에 찍힙니다. GitHub 가입 이메일과 같게)
git config --global user.name "홍길동"
git config --global user.email "me@example.com"

# 레포 받기
git clone https://github.com/muffin-lab-it/muffin.git
cd muffin
pnpm install
cp .env.example .env.local      # 키는 여기에만. 이 파일은 절대 커밋되지 않습니다
pnpm dev                        # http://localhost:3000 열리면 성공
```

GitHub 로그인이 터미널에서 안 되면 `gh auth login` (GitHub CLI) 을 한 번 해 두면 편합니다.

---

## 1. 작업 시작: 브랜치 만들기

**항상 최신 main 에서** 브랜치를 만듭니다.

```bash
git switch main
git pull origin main
git switch -c feat/fx-rate-change
```

### 브랜치 이름 규칙

`<종류>/<tool 또는 영역>-<무엇을>` 형식, 영어 소문자와 하이픈만.

| 종류 | 언제 | 예시 |
|---|---|---|
| `feat/` | 기능 추가 | `feat/fx-rate-change`, `feat/news-rss-parser` |
| `fix/` | 버그 수정 | `fix/etf-timeout` |
| `docs/` | 문서만 | `docs/rate-readme` |
| `test/` | 테스트만 | `test/macro-fixture` |
| `chore/` | 설정·정리 | `chore/ci-node-version` |

4주차 이후 화면·API 작업은 `feat/web-home`, `feat/api-stream` 처럼 영역 이름을 씁니다.

---

## 2. 코드 수정하기

- 자기 tool 은 `src/tools/<이름>/` 안에서만 수정합니다. 다른 폴더를 고쳐야 하면 먼저 Discord 에 한 줄 남겨 주세요.
- 수정하면서 수시로 확인:

```bash
pnpm test src/tools/<이름>        # 테스트
pnpm tool src/tools/<이름>/run.ts  # 실제 API 호출해 보기
pnpm lint                         # 문법·스타일 검사
```

- Codex 에게 시킬 때: "이 tool 규격에 맞춰 … 만들어줘" + `src/tools/_template` 경로를 같이 줍니다. Codex 가 만든 코드도 **본인이 읽고 이해한 뒤** 올립니다.

---

## 3. 커밋하기

```bash
git status                       # 뭐가 바뀌었는지 확인
git add src/tools/fx             # 올릴 파일/폴더만 지정 (git add . 보다 안전)
git commit -m "feat: 환율 변동률 계산 추가"
```

### 커밋 메시지 규칙

`<종류>: <무엇을 했는지 한국어로>`

```
feat: 환율 변동률 계산 추가
fix: ETF API 타임아웃 8초로 조정
docs: rate tool README 에 키 발급 방법 추가
test: macro fixture 기반 테스트 추가
chore: eslint 경고 정리
```

- 종류는 브랜치 종류와 같습니다 (`feat` `fix` `docs` `test` `chore`).
- 한 커밋에 한 가지 일. "이것저것 수정" 같은 메시지는 피합니다.
- 커밋은 여러 번 해도 됩니다. PR 에 합쳐서 보입니다.

### 커밋 전 확인

- [ ] `.env.local` 이나 API 키가 들어간 파일이 `git status` 에 안 보이는가
- [ ] `pnpm test` 가 통과하는가

---

## 4. push 하고 PR 올리기

```bash
git push -u origin feat/fx-rate-change
```

터미널에 뜨는 링크를 누르거나, GitHub 레포에 들어가면 노란 "Compare & pull request" 버튼이 보입니다.

### PR 작성

- **제목**: `[fx] 환율 변동률 계산 추가` 처럼 `[tool이름]` + 한 줄 설명
- **본문**: 템플릿이 자동으로 채워집니다. 무엇을 / 왜 / 테스트 방법을 적고 체크리스트를 확인합니다
- **Reviewers**: 리더를 지정합니다
- `Create pull request` 클릭

### PR 올린 뒤 자동으로 일어나는 일

- CI 가 돌아서 lint · typecheck · test 결과가 PR 아래에 ✅ / ❌ 로 표시됩니다
- Vercel 이 미리보기 주소를 댓글로 달아 줍니다 (화면 작업일 때 유용)
- ❌ 가 뜨면 "Details" 를 눌러 어떤 검사가 실패했는지 보고 고칩니다

---

## 5. 리뷰 반영하기

리뷰 댓글을 받으면 **같은 브랜치에서** 고치고 다시 push 하면 PR 에 자동 반영됩니다. PR 을 새로 만들지 않습니다.

```bash
# (feat/fx-rate-change 브랜치에 있는 상태에서)
git add src/tools/fx
git commit -m "fix: 리뷰 반영 - 에러 메시지에 상태코드 포함"
git push
```

고친 뒤 리뷰 댓글에 "반영했습니다" 라고 답글을 달면 리더가 확인하고 머지합니다.

---

## 6. 머지된 뒤

머지되면 브랜치는 자동으로 삭제됩니다. 로컬도 정리하고 다음 작업은 다시 1번부터.

```bash
git switch main
git pull origin main
git branch -d feat/fx-rate-change
```

---

## 7. 자주 생기는 상황

### main 이 바뀌어서 내 브랜치가 뒤처졌을 때

작업이 길어지면 그 사이 main 에 다른 사람 코드가 머지됩니다. 내 브랜치에 main 을 가져옵니다.

```bash
git switch feat/fx-rate-change
git pull origin main
```

충돌이 없으면 그대로 끝. 충돌이 나면 아래로.

### 충돌(conflict)이 났을 때

파일 안에 이런 표시가 생깁니다.

```
<<<<<<< HEAD
내가 고친 줄
=======
main 에 있던 줄
>>>>>>> main
```

1. 둘 중 맞는 쪽을 남기고 `<<<<<<<` `=======` `>>>>>>>` 줄을 지웁니다 (VS Code 는 "Accept Current / Incoming" 버튼을 줍니다)
2. `pnpm test` 로 확인
3. `git add <파일>` → `git commit -m "chore: main 병합 충돌 해결"` → `git push`

자기 tool 폴더만 건드리면 충돌은 거의 안 납니다. 판단이 안 서면 건드리지 말고 Discord 에 올려 주세요.

### 실수로 main 에서 작업했을 때

아직 커밋 전이면 그냥 브랜치를 만들면 됩니다. 수정 내용이 따라옵니다.

```bash
git switch -c feat/fx-rate-change
```

### 키나 `.env.local` 을 커밋해 버렸을 때

push 전이면 `git reset HEAD~1` 로 커밋을 풀고 파일을 뺀 뒤 다시 커밋합니다.
**이미 push 했으면 즉시 그 키를 폐기하고 재발급한 뒤** Discord 에 알려 주세요. 레포가 public 이라 되돌려도 노출된 것으로 봅니다.

### 터미널이 어려우면

VS Code 왼쪽 "소스 제어" 탭이나 GitHub Desktop 으로 같은 일을 할 수 있습니다. 브랜치 만들기 → 변경 파일 체크 → 메시지 쓰고 Commit → Publish/Push → GitHub 에서 PR. 이름 규칙과 순서는 같습니다.

---

## 8. 리더가 하는 일

- PR 리뷰와 머지는 리더가 합니다. 조건: CI ✅ + 리더 Approve
- 머지 방식은 **Merge commit** 으로 고정돼 있습니다 (배포 자동화 때문). Squash · Rebase 버튼은 없습니다
- 머지되면 Vercel 이 main 을 자동 배포합니다

---

## 금지 사항

- `main` 에 직접 push
- `git push --force`
- API 키를 코드나 문서에 적기
- 다른 사람 브랜치에 말 없이 커밋
