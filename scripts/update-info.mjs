// 매주 공연 예매 일정과 문화 소식을 Claude(웹 검색)로 조사해서 public/data/info.json 을 갱신한다.
// 필요한 환경변수: ANTHROPIC_API_KEY
//
//   npm run update                       조사 후 info.json 갱신
//   npm run update -- --dry-run          조사만 하고 파일은 쓰지 않음 (변경 요약 출력)
//   npm run update -- --response=파일    API 를 부르지 않고 저장해 둔 응답 JSON 으로 병합만 테스트
//   npm run update -- --now=2026-11-16T07:00+09:00
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { mondayOf, weekRangeLabel } from '../public/lib/week.js';
import { dropSharedImages, enrichWithThumbnails } from './lib/thumbnail.mjs';
import {
  collectUrls,
  extractJson,
  mergeBriefings,
  mergeItems,
  summarizeChange,
  upcomingConcerts,
  validateAll,
  validateBriefing,
  CONCERT_SITES,
  CULTURE_TYPES,
} from './lib/merge.mjs';

// 쓸 수 있는 모델. 모델마다 웹 검색 도구 버전과 서버 fallback 지원이 달라서 여기에 함께 적어 둔다.
//   tools 'latest': web_search_20260209 / web_fetch_20260209 (동적 필터링)
//   tools 'basic' : web_search_20250305 / web_fetch_20250910
//   fallback      : 안전 분류기 거절 시 서버가 대체 모델로 이어서 처리 (beta server-side-fallback-2026-07-01)
const MODELS = {
  'claude-opus-5-5': { tools: 'latest', fallback: true },
  'claude-sonnet-5-5': { tools: 'latest', fallback: true },
  'claude-haiku-5-5': { tools: 'basic', fallback: false }, // 실험적: 이 조합은 아직 실제로 돌려 보지 못함
};
const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MAX_PAUSE_RESUMES = 5;
const INFO_PATH = new URL('../public/data/info.json', import.meta.url);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dryRun = process.argv.includes('--dry-run');
const now = arg('now') ? new Date(arg('now')) : new Date();

function fail(msg) {
  console.error(`오류: ${msg}`);
  process.exit(1);
}
if (Number.isNaN(now.getTime())) fail('--now 값이 올바른 날짜가 아닙니다.');

// 환경변수 CLAUDE_MODEL / CLAUDE_EFFORT (비어 있으면 기본값). GitHub Actions 에서는 수동 실행 입력이나 저장소 Variables 로 넘어온다.
const MODEL = (arg('model') || process.env.CLAUDE_MODEL || '').trim() || DEFAULT_MODEL;
const EFFORT = (arg('effort') || process.env.CLAUDE_EFFORT || '').trim() || 'medium';
const modelConfig = MODELS[MODEL];
if (!modelConfig) fail(`지원하지 않는 모델입니다: ${MODEL}\n  사용 가능: ${Object.keys(MODELS).join(', ')}`);
if (!EFFORTS.includes(EFFORT)) fail(`effort 는 ${EFFORTS.join('/')} 중 하나여야 합니다: ${EFFORT}`);

const info = JSON.parse(readFileSync(INFO_PATH, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
const week = mondayOf(now);

// ---------- 프롬프트 ----------

const SYSTEM = `당신은 한국에 사는 두 자매를 위해 "놓치기 쉬운 정보"를 매주 조사하는 리서처입니다.
두 사람은 유명 가수 콘서트 예매일과 문화 소식을 자주 놓쳐서, 예매 오픈 전에 미리 알고 싶어 합니다.
결과는 앱 화면과 푸시 알림에 그대로 표시되므로 정확성이 가장 중요합니다.

원칙:
- 웹 검색으로 직접 확인한 내용만 씁니다. 날짜, 시각, 순위, 평점을 기억이나 추측으로 채우지 마세요.
- 출처마다 날짜가 다르면 가장 신뢰할 만한 출처(예매처 공지, 소속사 공지)를 따르고, 충돌 사실을 summary에 적으세요.
- 예매처 공지나 상품 페이지를 직접 확인했을 때만 unverified를 false로 두세요. 기사나 블로그로만 확인했다면 true입니다.
- 모르는 값은 지어내지 말고, 항목 자체를 빼세요. 항목 수를 채우는 것보다 틀린 항목이 없는 것이 낫습니다.
- 모든 날짜와 시각은 한국 시간(KST, +09:00)입니다.
- summary는 한국어로 120자 안팎, 한눈에 읽히게 씁니다.`;

function buildPrompt() {
  const existing = upcomingConcerts(info.items, now).map((i) => ({
    artist: i.artist,
    title: i.title,
    openAt: i.openAt,
    subtype: i.subtype,
    url: i.url,
  }));

  return `오늘은 ${today}(KST)이고, 이번 주는 ${weekRangeLabel(week)}입니다. 아래 두 가지를 조사해 주세요.

## 1. 공연 예매 (concerts)
인터파크(NOL) 티켓, YES24 티켓, 티켓링크, 멜론티켓에서 앞으로 예매가 열리는 유명 가수·밴드·아이돌 콘서트(또는 최근 3일 안에 열려 아직 판매 중인 것)를 찾으세요.
각 사이트의 콘서트 랭킹과 티켓오픈 안내가 좋은 출발점입니다:
- https://tickets.interpark.com/contents/ranking?genre=CONCERT
- https://ticket.yes24.com/Rank/Concert
- https://ticket.melon.com/concert/index.htm
- https://www.ticketlink.co.kr
사이트를 직접 읽지 못하면 검색 결과와 기사로 보완하세요. 임영웅, 아이유, 세븐틴, BTS처럼 팬층이 큰 가수의 투어 일정도 놓치지 마세요.
팬클럽 선예매가 따로 있으면 summary에 선예매와 일반예매 시각을 구분해 적고, openAt에는 일반예매(없으면 가장 빠른 예매) 시각을 넣으세요.
최대 12건. 오픈 시각이 확인되지 않는 공연은 넣지 마세요.

${
  existing.length
    ? `이미 등록되어 있는 아직 오픈 전인 공연입니다. 일정이 바뀌었는지 확인해서 결과에 다시 포함해 주세요 (취소·변경·오픈 완료되었다면 현재 상태 기준으로):\n${JSON.stringify(existing, null, 2)}`
    : '현재 등록된 오픈 전 공연은 없습니다.'
}

## 2. 문화 소식 (culture)
- 영화: 박스오피스 상위작과 이번 주~다음 주 개봉 주목작, 평점(출처 명시)
- OTT: 넷플릭스 한국 TOP10과 티빙·웨이브·디즈니+·쿠팡플레이 주목작
- 도서: 교보문고·예스24·알라딘 주간 베스트셀러
- 전시: 수도권에서 곧 열리거나 화제인 전시
분야별로 한두 건의 요약 항목이면 충분하고, 전체 12건 안쪽으로 해 주세요. 순위 항목은 "TOP5"처럼 한 항목에 묶고, 집계 기준(서점명, 집계 기간)을 summary에 적으세요.
여러 작품을 한 항목으로 묶은 것(박스오피스 TOP3, 베스트셀러 TOP5, "요즘 화제" 모음 등)에는 "list": true 를 넣으세요. 포스터·표지 이미지는 앱이 항목의 url 페이지에서 직접 찾으니, 이미지 주소는 쓰지 마세요.
이미지는 url 페이지의 대표 이미지를 쓰므로, 가능하면 해당 공연·작품·전시 하나를 다루는 페이지(예매 상품 페이지, 공식 안내, 작품 소개)를 url 로 고르세요.
개봉·공개·개막일처럼 날짜가 있는 항목은 deadline과 deadlineText("개봉", "공개", "개막", "종료" 등)를 채우세요.

## 핵심 3줄 (briefing)
공연(concert)과 문화(culture) 각각에 대해, 이번 주 가장 주목할 만한 것 3가지를 한 줄씩(각 70자 안팎) 써 주세요. 위 목록을 그대로 옮기지 말고 "무엇이 왜 중요한지"를 요약하세요.
- 순위, 화제성, 팬층 규모, 매진 속도, 희소성처럼 **조사하면서 실제로 확인한 근거**로 고르세요. 근거 없이 "핫하다", "인기"라고 쓰지 마세요.
- 인기 순위를 읽지 못했다면 "예매가 가장 임박한" 같은 사실 기준으로 쓰고 그렇게 표현하세요.
- 시각이 있는 항목은 날짜와 시각을 함께 쓰세요. 날짜는 "11/12(목) 20:00"처럼 **절대 날짜**로만 쓰세요.
- **"오늘", "내일", "어제", "모레", "이번 주", "지난주", "다음 주", "현재", "지금", "방금", "곧", "D-3" 같은 상대적인 시점 표현은 쓰지 마세요.** 이 요약은 하루 이상 화면에 남아 있어서, 쓴 시점 기준의 표현은 보는 날에는 틀린 말이 됩니다.
  나쁜 예: "AKMU 일반예매 오늘 20:00" / 좋은 예: "AKMU 일반예매 11/10(화) 20:00".

## 출력
마지막에 아래 형식의 JSON 하나만 \`\`\`json 코드블록으로 출력하세요. 코드블록 밖에는 한두 문장의 메모(확인하지 못한 것 등)만 쓰세요.
\`\`\`json
{
  "concerts": [
    { "artist": "가수/그룹명", "title": "공연명", "summary": "장소·회차·선예매/일반예매 시각 등",
      "openAt": "2026-11-20T20:00+09:00", "subtype": "${CONCERT_SITES.join('|')}",
      "url": "근거로 삼은 페이지 URL", "unverified": true }
  ],
  "culture": [
    { "subtype": "${CULTURE_TYPES.join('|')}", "title": "제목", "summary": "요약",
      "deadline": "2026-11-20 또는 null", "deadlineText": "개봉", "rating": "출처 포함 평점 또는 null",
      "url": "근거 URL", "unverified": false, "list": false }
  ],
  "briefing": {
    "concert": ["핵심 한 줄", "핵심 한 줄", "핵심 한 줄"],
    "culture": ["핵심 한 줄", "핵심 한 줄", "핵심 한 줄"]
  }
}
\`\`\``;
}

// ---------- API 호출 ----------

async function research() {
  const client = new Anthropic(); // ANTHROPIC_API_KEY 사용
  const messages = [{ role: 'user', content: buildPrompt() }];
  const seenUrls = new Set();
  const usage = { input: 0, output: 0, searches: 0, fetches: 0 };
  let finalText = '';

  for (let turn = 0; turn <= MAX_PAUSE_RESUMES; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      ...(modelConfig.fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      output_config: { effort: EFFORT },
      system: SYSTEM,
      tools:
        modelConfig.tools === 'latest'
          ? [
              { type: 'web_search_20260209', name: 'web_search', max_uses: 30 },
              { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
            ]
          : [
              { type: 'web_search_20250305', name: 'web_search', max_uses: 30 },
              { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 12 },
            ],
      messages,
    });
    const response = await stream.finalMessage();

    usage.input += response.usage.input_tokens ?? 0;
    usage.output += response.usage.output_tokens ?? 0;
    usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    usage.fetches += response.usage.server_tool_use?.web_fetch_requests ?? 0;

    // 근거 URL: 실제 검색/조회 결과와 인용에 나온 것만. (모델이 요청한 server_tool_use 입력은 제외)
    collectUrls(
      response.content.filter((b) => b.type.endsWith('_tool_result') || b.type === 'text'),
      seenUrls,
    );

    if (response.stop_reason === 'refusal') {
      fail(`요청이 거절되었습니다 (${response.stop_details?.category ?? '사유 미상'}).`);
    }
    if (response.stop_reason === 'max_tokens') fail('출력이 max_tokens 에서 잘렸습니다.');

    if (response.stop_reason === 'pause_turn') {
      if (response.content.some((b) => b.type === 'fallback')) {
        fail('대체 모델로 전환된 뒤 pause_turn 이 발생해 이어가지 못했습니다. 다시 실행해 주세요.');
      }
      console.log(`  (서버 도구 작업이 길어져 이어서 진행합니다 ${turn + 1}/${MAX_PAUSE_RESUMES})`);
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (response.content.some((b) => b.type === 'fallback')) console.log('  (대체 모델로 전환되어 처리되었습니다)');
    console.log(`  모델: ${response.model}`);
    return { finalText, seenUrls, usage };
  }
  fail('pause_turn 이 계속되어 중단합니다.');
}

// ---------- 실행 ----------

let finalText;
let seenUrls;
if (arg('response')) {
  const saved = JSON.parse(readFileSync(arg('response'), 'utf8'));
  finalText = `\`\`\`json\n${JSON.stringify(saved.result ?? saved)}\n\`\`\``;
  seenUrls = new Set((saved.seenUrls ?? []).map((u) => u));
  console.log(`저장된 응답으로 병합만 테스트합니다: ${arg('response')}`);
} else {
  if (!process.env.ANTHROPIC_API_KEY) fail('ANTHROPIC_API_KEY 가 필요합니다.');
  console.log(`${today} 기준 조사 중… (${MODEL}, effort ${EFFORT}, 웹 검색)`);
  const r = await research();
  finalText = r.finalText;
  seenUrls = r.seenUrls;
  console.log(`  검색 ${r.usage.searches}회, 페이지 조회 ${r.usage.fetches}회, 토큰 입력 ${r.usage.input} / 출력 ${r.usage.output}`);
  console.log(`  근거로 확인된 URL ${seenUrls.size}개`);
}

let parsed;
try {
  parsed = extractJson(finalText);
} catch (err) {
  console.error(finalText.slice(-1500));
  fail(`응답 JSON 을 읽지 못했습니다: ${err.message}`);
}

const { accepted, rejected } = validateAll(parsed, { seenUrls, now });
for (const r of rejected) console.warn(`  제외: ${r}`);
console.log(`검증 통과: 공연 ${accepted.concerts.length}건, 문화 ${accepted.culture.length}건 (제외 ${rejected.length}건)`);

const { briefing, rejected: briefRejected } = validateBriefing(parsed.briefing);
for (const r of briefRejected) console.warn(`  제외: ${r}`);
console.log(`요약: ${Object.entries(briefing).map(([k, v]) => `${k} ${v.length}줄`).join(', ') || '없음 (앱이 임박한 순서로 대신 보여줍니다)'}`);

if (!accepted.concerts.length && !accepted.culture.length) {
  fail('검증을 통과한 항목이 하나도 없어 info.json 을 바꾸지 않습니다.');
}
if (!accepted.culture.length) console.warn('  주의: 문화 소식이 비어 있습니다. 이번 주 문화 항목은 비게 됩니다.');

const items = mergeItems(info.items, accepted, { now });
const briefings = mergeBriefings(info.briefings, briefing, { now });

// 포스터·표지 썸네일: 항목의 url 페이지에서 대표 이미지를 찾는다 (실패해도 항목은 그대로 둔다).
// 저장된 응답으로 테스트(--response)할 때나 --no-thumbs 일 때는 외부 접속을 하지 않는다.
if (!arg('response') && !process.argv.includes('--no-thumbs')) {
  const thumbs = await enrichWithThumbnails(items);
  const shared = dropSharedImages(items);
  console.log(`썸네일: 시도 ${thumbs.tried}건 → 성공 ${thumbs.ok}건, 실패 ${thumbs.failed.length}건${shared ? `, 공통 이미지 ${shared}건 제외` : ''}`);
  for (const f of thumbs.failed) console.warn(`  썸네일 실패: ${f.title.slice(0, 24)} — ${f.reason}`);
}
const change = summarizeChange(info.items, items);
console.log(`변경: +${change.added} / -${change.removed} (총 ${items.length}건)`);

for (const i of accepted.concerts) {
  console.log(`  🎤 ${i.artist} · ${i.openAt.slice(0, 16)} · ${i.subtype}${i.unverified ? ' (확인 필요)' : ''}`);
}

if (dryRun) {
  console.log('--dry-run: info.json 을 쓰지 않았습니다.');
} else {
  writeFileSync(INFO_PATH, `${JSON.stringify({ ...info, items, briefings }, null, 2)}\n`);
  console.log('public/data/info.json 을 갱신했습니다.');
}
