import { mondayOf, weekRangeLabel } from './lib/week.js';
import { buildWeek, quoteForWeek, summarize } from './lib/briefing.js';
import { MOODS, pickMood } from './lib/mood.js';
import { oldestKeptWeek } from './lib/retention.js';
import { safeImageUrl } from './lib/thumb.js';
import {
  DEFAULT_CATEGORY,
  DEFAULT_NICKNAME,
  NICKNAME_MAX,
  cardShareText,
  normalizeNickname,
  parseView,
  viewShareText,
  viewUrl,
} from './lib/share.js';

const $ = (id) => document.getElementById(id);

const state = { info: null, diet: null, weeks: [], weekIndex: 0, category: DEFAULT_CATEGORY, nickname: DEFAULT_NICKNAME };

// ---------- 닉네임 (이 기기에만 저장) ----------

const NICKNAME_KEY = 'nickname';

function loadNickname() {
  try {
    return normalizeNickname(localStorage.getItem(NICKNAME_KEY));
  } catch {
    return DEFAULT_NICKNAME; // 저장소 접근이 막힌 환경(시크릿 모드 등)
  }
}

function saveNickname(value) {
  state.nickname = normalizeNickname(value);
  try {
    // 기본 닉네임은 저장하지 않는다 (나중에 기본값이 바뀌어도 따라가도록)
    if (state.nickname === DEFAULT_NICKNAME) localStorage.removeItem(NICKNAME_KEY);
    else localStorage.setItem(NICKNAME_KEY, state.nickname);
  } catch {
    // 저장 실패해도 이번 접속 동안은 계속 쓴다
  }
  renderNickname();
}

function renderNickname() {
  $('nickname-label').textContent = state.nickname;
  $('nickname-input').value = state.nickname;
}

$('nickname-edit').addEventListener('click', () => {
  $('nickname-form').hidden = false;
  $('nickname-edit').hidden = true;
  $('nickname-input').focus();
  $('nickname-input').select();
});
$('nickname-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveNickname($('nickname-input').value);
  $('nickname-form').hidden = true;
  $('nickname-edit').hidden = false;
});
$('nickname-reset').addEventListener('click', () => {
  saveNickname('');
  $('nickname-form').hidden = true;
  $('nickname-edit').hidden = false;
});
$('nickname-input').maxLength = NICKNAME_MAX;

// ---------- 공유 ----------

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

// 시스템 공유 시트(iOS/Android)가 있으면 그걸, 없으면 클립보드 복사
async function share({ title, text }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 사용자가 닫음
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요. 붙여넣어 보내세요 📋');
  } catch {
    window.prompt('복사해서 보내세요', text);
  }
}

const currentWeek = () => state.weeks[state.weekIndex];
const currentLink = () => viewUrl(new URL('./', location.href).href, { week: currentWeek(), category: state.category });

function categoryLabel(id) {
  const c = state.info.categories.find((x) => x.id === id);
  return c ? `${c.emoji} ${c.name}` : id;
}

function shareCard(card) {
  const label = categoryLabel(card.category);
  return share({
    title: card.title,
    text: cardShareText(card, {
      categoryLabel: card.subtype ? `${label} · ${card.subtype}` : label,
      nickname: state.nickname,
      link: viewUrl(new URL('./', location.href).href, { week: currentWeek(), category: card.category }),
    }),
  });
}

$('share-view').addEventListener('click', () => {
  const isCurrent = currentWeek() === mondayOf();
  share({
    title: '라니네 전용 앱',
    text: viewShareText({
      weekLabel: `${isCurrent ? '이번 주 ' : ''}${weekRangeLabel(currentWeek())}`,
      categoryLabel: categoryLabel(state.category),
      nickname: state.nickname,
      link: currentLink(),
    }),
  });
});

// 보고 있는 화면을 주소에 반영 (새로고침·북마크·홈 화면 재실행에서도 유지)
function syncUrl() {
  history.replaceState(null, '', viewUrl(location.href, { week: currentWeek(), category: state.category }));
}

// ---------- 정보 목록 ----------

async function loadInfo() {
  const [info, diet] = await Promise.all(
    ['data/info.json', 'data/diet.json'].map((p) => fetch(p, { cache: 'no-cache' }).then((r) => r.json())),
  );
  state.info = info;
  state.diet = diet;

  const thisWeek = mondayOf();
  // 오래된 데이터가 파일에 남아 있어도 최근 8주만 넘겨볼 수 있다
  const oldest = oldestKeptWeek(thisWeek);
  const weeks = [...new Set(info.items.map((i) => i.week))].filter((w) => w >= oldest);
  if (!weeks.includes(thisWeek)) weeks.push(thisWeek);
  state.weeks = weeks.sort().reverse(); // 최신 주가 index 0
  state.weekIndex = state.weeks.indexOf(thisWeek);

  // 공유 링크(?week=&cat=)로 열었으면 그 화면으로
  const view = parseView(location.search, { weeks: state.weeks, categories: info.categories.map((c) => c.id) });
  if (view.week) state.weekIndex = state.weeks.indexOf(view.week);
  state.category = view.category;
}

function renderRani(mood) {
  $('rani').src = `rani/${mood}.svg`;
  $('rani').alt = `라니 (${MOODS[mood].label})`;
  $('rani-say').textContent = MOODS[mood].say;
}

// 다이어트 문구는 탭이 아니라 상단에 고정해서 늘 보여준다
function renderDietQuote() {
  $('diet-quote').textContent = `💪 ${quoteForWeek(state.diet, currentWeek())}`;
}

// Claude 가 매주 써 둔 핵심 3줄이 있으면 그것을, 없으면 앱이 임박한 순서로 고른 줄을 보여준다.
// 후자는 "핫한 것"이 아니라 날짜순이므로 제목을 다르게 달아 구분한다.
const FALLBACK_TITLE = { concert: '곧 열리는 공연', family: '가까운 기념일', culture: '분야별 가장 가까운 소식' };

function renderSummary(cards) {
  const written = state.info.briefings?.[currentWeek()]?.[state.category];
  const lines = written?.length ? written : summarize(state.category, cards);
  $('summary-title').textContent = written?.length ? '이번 주 핵심 3줄' : (FALLBACK_TITLE[state.category] ?? '요약');
  $('summary').hidden = !lines.length;
  $('summary-list').replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function renderFilters() {
  const nav = $('filters');
  nav.replaceChildren();
  for (const c of state.info.categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = `${c.emoji} ${c.name}`.trim();
    b.setAttribute('aria-pressed', String(state.category === c.id));
    b.addEventListener('click', () => {
      state.category = c.id;
      render();
    });
    nav.append(b);
  }
}

function renderItems() {
  const week = state.weeks[state.weekIndex];
  const cats = new Map(state.info.categories.map((c) => [c.id, c]));
  const items = buildWeek({ info: state.info, diet: state.diet, week })
    .filter((i) => i.category === state.category)
    .sort((a, b) => a.sort.localeCompare(b.sort));

  renderRani(pickMood({ category: state.category, cards: items }));
  renderSummary(items);

  const root = $('items');
  root.replaceChildren();

  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = '이 주에 등록된 정보가 없어요.';
    root.append(p);
    return;
  }

  for (const item of items) {
    const cat = cats.get(item.category);
    const card = document.createElement('article');
    card.className = `card cat-${item.category}`;
    const body = document.createElement('div');
    body.className = 'card-body';

    const catEl = document.createElement('div');
    catEl.className = 'cat';
    const sub = item.subtype ? ` · ${item.subtype}` : '';
    catEl.textContent = cat ? `${cat.emoji} ${cat.name}${sub}` : item.category;

    const h = document.createElement('h3');
    h.textContent = item.title;
    body.append(catEl, h);

    if (item.summary) {
      const p = document.createElement('p');
      p.textContent = item.summary;
      body.append(p);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (item.when) {
      const d = document.createElement('span');
      d.className = 'deadline';
      d.textContent = item.when;
      meta.append(d);
    }
    if (item.unverified) {
      const w = document.createElement('span');
      w.className = 'warn';
      w.textContent = '⚠️ 공식 공지 확인 필요';
      meta.append(w);
    }
    if (item.rating) {
      const r = document.createElement('span');
      r.textContent = `⭐ ${item.rating}`;
      meta.append(r);
    }
    if (item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '바로가기 →';
      meta.append(a);
    }
    if (meta.childElementCount) body.append(meta);

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'card-share';
    shareBtn.textContent = '공유';
    shareBtn.setAttribute('aria-label', `${item.title} 공유하기`);
    shareBtn.addEventListener('click', () => shareCard(item));
    body.append(shareBtn);

    // 포스터·표지 썸네일 (https 이미지만). 불러오지 못하면 조용히 없앤다.
    const imageUrl = safeImageUrl(item.image);
    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = imageUrl;
      img.alt = '';
      img.width = 72;
      img.height = 96;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer'; // 출처 페이지를 알리지 않는다 (서버 쪽 확인도 Referer 없이 했다)
      img.addEventListener('error', () => {
        img.remove();
        card.classList.remove('has-thumb');
      });
      card.classList.add('has-thumb');
      card.append(img);
    }
    card.append(body);

    root.append(card);
  }
}

function renderWeekNav() {
  const week = state.weeks[state.weekIndex];
  const isCurrent = week === mondayOf();
  $('week-label').textContent = `${isCurrent ? '이번 주 ' : ''}${weekRangeLabel(week)}`;
  $('prev-week').disabled = state.weekIndex >= state.weeks.length - 1;
  $('next-week').disabled = state.weekIndex <= 0;
}

function render() {
  renderDietQuote();
  renderWeekNav();
  renderFilters();
  renderItems();
  syncUrl();
}

$('prev-week').addEventListener('click', () => {
  state.weekIndex += 1;
  render();
});
$('next-week').addEventListener('click', () => {
  state.weekIndex -= 1;
  render();
});

// ---------- 알림 ----------

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function urlBase64ToUint8Array(base64) {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function showSubscription(sub) {
  $('sub-json').value = JSON.stringify(sub.toJSON());
  $('sub-box').hidden = false;
  $('enable-notify').hidden = true;
  $('notify-status').textContent = '✅ 이 기기에서 알림이 켜져 있어요.';
}

async function setupNotifications(registration, vapidPublicKey) {
  const status = $('notify-status');

  if (isIos && !isStandalone) {
    status.textContent = '알림을 받으려면 먼저 홈 화면에 추가해주세요.';
    $('ios-guide').hidden = false;
    return;
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    status.textContent = '이 브라우저는 푸시 알림을 지원하지 않아요.';
    return;
  }
  if (!vapidPublicKey) {
    status.textContent = '아직 알림 서버 키가 설정되지 않았어요. (README 참고)';
    return;
  }
  if (Notification.permission === 'denied') {
    status.textContent = '알림이 차단되어 있어요. 기기 설정에서 이 앱의 알림을 허용해주세요.';
    return;
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing && Notification.permission === 'granted') {
    showSubscription(existing);
    return;
  }

  status.textContent = '라니네 주간 브리핑을 알림으로 받아보세요.';
  const btn = $('enable-notify');
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        status.textContent = '알림 권한이 허용되지 않았어요.';
        return;
      }
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      showSubscription(sub);
    } catch (err) {
      status.textContent = `알림을 켜지 못했어요: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

$('copy-sub').addEventListener('click', async () => {
  const text = $('sub-json').value;
  try {
    await navigator.clipboard.writeText(text);
    $('copy-sub').textContent = '복사됨 ✓';
  } catch {
    $('sub-json').select();
    $('copy-sub').textContent = '직접 복사해주세요';
  }
});

if (navigator.share) {
  $('share-sub').hidden = false;
  $('share-sub').addEventListener('click', () => {
    navigator.share({ title: '주간정보 알림 구독 정보', text: $('sub-json').value }).catch(() => {});
  });
}

// ---------- 시작 ----------

async function main() {
  state.nickname = loadNickname();
  renderNickname();
  await loadInfo();
  render();

  if (!('serviceWorker' in navigator)) {
    $('notify-status').textContent = '이 브라우저는 앱 설치를 지원하지 않아요.';
    return;
  }
  const [registration, config] = await Promise.all([
    navigator.serviceWorker.register('sw.js'),
    fetch('config.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  await navigator.serviceWorker.ready;
  await setupNotifications(registration, config.vapidPublicKey);
}

main().catch((err) => {
  console.error(err);
  $('items').textContent = '정보를 불러오지 못했어요. 잠시 후 다시 열어주세요.';
});
