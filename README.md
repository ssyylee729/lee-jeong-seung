# 주간정보 (이정승)

언니랑 나랑 쓰는 앱. 매주 놓치기 쉬운 정보를 모아 보여주고, 정해진 요일에 푸시 알림으로 알려준다.
서버 없이 **GitHub Pages(앱) + GitHub Actions cron(정보 조사·알림)** 으로만 돌아간다. GitHub 쪽은 무료이고, 매주 정보를 조사하는 Claude API 호출에만 비용이 든다.

```
public/            GitHub Pages 에 올라가는 PWA
  data/info.json   공연·문화 정보 (매주 자동 갱신됨)
  data/diet.json   다이어트 글귀 모음
  config.json      VAPID 공개키 (npm run vapid 가 채움)
scripts/update-info.mjs      Claude(웹 검색)로 공연·문화 정보를 조사해 info.json 갱신
scripts/send-push.mjs        알림 발송
.github/workflows/
  weekly-update.yml          월요일 07:07 KST 에 조사 → info.json 커밋 → 배포
  weekly-push.yml            월요일 09:03 KST 에 알림 발송 (요일/시간은 여기서 변경)
  deploy-pages.yml           public/ 을 GitHub Pages 에 배포
```

## 처음 한 번만 하는 설정

1. **키 만들기**: `npm install && npm run vapid`
   - `public/config.json` 에 공개키가 들어간다 → 커밋.
   - 출력된 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` 를 GitHub 저장소
     *Settings → Secrets and variables → Actions* 에 Secret 으로 등록.
     (비공개키는 `.vapid.local.json` 에도 저장되지만 gitignore 되어 있다. 잃어버리면 모든 구독이 무효가 된다.)
2. **Pages 켜기**: *Settings → Pages → Source* 를 **GitHub Actions** 로 설정하고 main 에 push.
   주소는 `https://ssyylee729.github.io/lee-jeong-seung/`.
3. **각자 폰에서 설치**
   - **iPhone (16.4+)**: Safari 로 주소 열기 → 공유 버튼 → *홈 화면에 추가* → **홈 화면 아이콘으로 다시 열기** → 알림 켜기.
   - **Android**: Chrome 으로 주소 열기 → 메뉴 → *앱 설치* (또는 홈 화면에 추가) → 알림 켜기.
4. **Claude API 키 등록**: Secret `ANTHROPIC_API_KEY` 에 키를 넣는다. 이 키로 매주 공연·문화 정보를 자동 조사한다.
   Actions 탭 → *Weekly update* → *Run workflow* → **dry_run 체크**로 먼저 한 번 돌려 결과를 로그로 확인한다.
5. **구독 정보 등록**: 앱의 *알림 켜기* 를 누르면 나오는 JSON 한 덩어리를 관리자(나)에게 보낸다.
   두 명분을 아래처럼 배열로 묶어 Secret `PUSH_SUBSCRIPTIONS` 에 등록한다.
   ```json
   [{"endpoint":"...","keys":{...}}, {"endpoint":"...","keys":{...}}]
   ```
6. Actions 탭 → *Weekly push* → *Run workflow* 로 수동 발송해서 두 폰에 알림이 오는지 확인.

## 어떤 정보가 나오나

| 구분 | 출처 | 매주 할 일 |
|---|---|---|
| 🎤 공연 예매 | `info.json` 의 `concert` 항목 (Claude 가 자동 조사) | 없음 |
| 🎂 가족 기념일 | `public/lib/family.js` 에서 **자동 계산** (음력 포함) | 없음. 새 기념일은 `FAMILY_EVENTS` 에 추가 |
| 💪 다이어트 글귀 | `public/data/diet.json` 을 주마다 하나씩 순환 | 없음. 글귀 추가/수정은 자유 |
| 🎬 문화 | `info.json` 의 `culture` 항목 (Claude 가 자동 조사) | 없음 |

알림 본문에는 7일 안에 열리는 공연 예매(최대 2건), 14일 안의 가족 기념일, 이번 주 문화 소식 건수, 이번 주 글귀가 들어간다.

## 닉네임과 공유

- **닉네임**: 화면 위쪽 "닉네임 변경"에서 바꾼다. 이 기기의 `localStorage` 에만 저장되고(서버로 가지 않는다), 기본값은 `정승자매`.
  공유 문구의 "보낸 사람"에 들어간다. 푸시 알림은 GitHub 서버가 모든 기기에 똑같이 보내는 것이라 닉네임이 들어가지 않는다.
- **공유**: 카드마다 `공유` 버튼, 상단에 `이 화면 공유` 버튼이 있다. 폰에서는 시스템 공유 시트(카카오톡 등)가 열리고, 지원하지 않는 브라우저에서는 클립보드에 복사된다.
- **공유 링크**: `?week=2026-11-09&cat=concert` 처럼 보고 있던 주와 카테고리가 주소에 들어간다. 링크를 열면 같은 화면이 뜬다.
- 호칭(마미·대디·철민·정연·승연·라니)과 기념일은 `public/lib/family.js`, 다이어트 글귀는 `public/data/diet.json` 에서 고친다.

## 매주 자동으로 일어나는 일

| 시각(KST) | workflow | 하는 일 |
|---|---|---|
| 월 07:07 | `weekly-update.yml` | Claude 가 웹 검색으로 공연 예매 일정·문화 소식을 조사 → 검증 → `info.json` 커밋 → Pages 배포 |
| 월 09:03 | `weekly-push.yml` | 갱신된 `info.json` 으로 알림 발송 |

조사 결과는 그대로 믿지 않고 `scripts/lib/merge.mjs` 에서 걸러서 합친다.

- 날짜·시각·종류(subtype)·URL 형식이 틀린 항목은 버린다 (로그에 `제외:` 로 남는다).
- `unverified: false`(확인됨)는 **Claude 가 실제로 검색/조회한 URL 을 근거로 댄 경우에만** 인정한다. 아니면 "⚠️ 공식 공지 확인 필요"가 붙는다.
- 이번 주 항목은 통째로 교체한다. 같은 주에 두 번 돌려도 중복되지 않는다.
- 이전 주에 올린 **아직 오픈 전인 공연**은 다시 확인시키고, 새 결과에 없으면 그대로 남겨 둔다 (놓치지 않으려고).
- 26주보다 오래된 항목은 정리한다.
- 유효한 항목이 하나도 없으면 `info.json` 을 건드리지 않고 workflow 를 실패시킨다 (Actions 알림 메일로 알 수 있다).

수동으로 고치고 싶으면 `info.json` 을 직접 편집해도 된다. 단, 같은 주의 항목은 다음 자동 실행 때 교체된다.

```json
{ "week": "2026-11-16", "category": "concert", "artist": "가수", "title": "공연명",
  "summary": "장소·회차·선예매 정보", "openAt": "2026-11-20T20:00+09:00", "subtype": "인터파크", "url": "https://…" }
{ "week": "2026-11-16", "category": "culture", "subtype": "전시", "title": "…", "summary": "…",
  "deadline": "2026-11-24", "deadlineText": "개막", "rating": "네이버 9.1", "url": "https://…" }
```

- `openAt` 은 **한국 시간(+09:00)**. 시각을 모르면 `T00:00+09:00` 으로 쓰면 날짜만 표시된다.
- `"unverified": true` 를 붙이면 화면에 "⚠️ 공식 공지 확인 필요"가 뜨고 알림에는 "(확인 필요)"가 붙는다.
- 아직 오픈 전인 공연은 `week` 가 지난 주여도 이번 주 화면에 계속 보인다.

## 비용과 한계

- 한 번 돌 때 Opus 5.5 + 웹 검색(최대 30회)·페이지 조회(최대 12회)를 쓴다. 정확한 비용은 첫 `dry_run` 로그의 토큰/검색 횟수와
  [요금표](https://platform.claude.com/docs/en/about-claude/pricing)로 계산해 보고, 많다 싶으면 `scripts/update-info.mjs` 의 `EFFORT` 를 `low` 로 낮춘다.
- 예매처 사이트는 JS 로 그려져서 직접 못 읽는 경우가 많다. 그럴 땐 기사·검색 결과로 보완하므로 **"확인 필요" 표시가 붙은 항목은 예매 전에 공식 공지를 꼭 확인**한다.
- 검색에 잘 안 잡히는 공연(특히 초대형 가수의 투어 일정)은 빠질 수 있다. 꼭 챙기고 싶은 가수가 있으면 `scripts/update-info.mjs` 의 프롬프트에 이름을 추가한다.

## 발송 요일/시간 바꾸기

`.github/workflows/weekly-push.yml` 의 `cron` 한 줄. **UTC 기준**이라 한국 시간에서 9시간을 뺀다.
현재는 월요일 09:03 KST (`3 0 * * 1`).

## 로컬에서 확인

- `npm run dev` → http://localhost:8080 (화면 확인, 서비스워커 동작)
- `npm run notify -- --dry-run` → 이번 주 알림 문구만 출력 (발송 안 함). `--now=2026-11-09T09:00+09:00` 로 날짜를 바꿔볼 수 있다
- `npm run update -- --dry-run` → 실제로 조사만 해 보기 (API 비용 발생, 파일은 안 씀)
- `npm test` → 검증·병합·공유 로직 테스트 (API 호출 없음)
- `npm run icons` → 아이콘 재생성 (원하는 이미지가 있으면 `public/icons/` 파일을 그냥 교체해도 된다)

## 알아둘 점

- GitHub Actions cron 은 몇 분~수십 분 늦게 돌 수 있다. 정각 알림이 필요하면 맞지 않는다.
- 저장소에 60일간 활동이 없으면 GitHub 이 예약 workflow 를 자동으로 끈다. 정보를 주기적으로 갱신하면 문제없고,
  꺼졌다면 Actions 탭에서 다시 켠다.
- 구독이 만료되면(앱 삭제, 알림 끄기 등) 로그에 404/410 이 찍힌다. 그 기기에서 알림을 다시 켜서 새 JSON 으로 Secret 을 갱신한다.
- 저장소가 public 이면 `info.json` 도 공개된다. 민감한 내용은 넣지 말 것.
