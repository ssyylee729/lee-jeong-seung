// 라니(스코티시폴드 주황+흰 고양이) 캐릭터 SVG 를 만든다 → public/rani/*.svg
// 실제 모습의 특징만 옮겼다: 접힌 귀, 이마의 흰 줄무늬와 주황 줄무늬, 호박색 눈, 분홍 코.
// 표정을 고치고 싶으면 아래 EXPRESSIONS 를 수정하고 `npm run rani` 를 다시 실행한다. (앱 아이콘은 `npm run icons`)
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/rani/', import.meta.url);

const C = {
  line: '#7a4a2a',
  orange: '#f2a24f',
  orangeDark: '#d9822b',
  cream: '#fffaf2',
  earInner: '#fbd9b0',
  pink: '#f5a3a8',
  pinkDark: '#c9787a',
  amber: '#e8a936',
  pupil: '#2a1a10',
  mouth: '#8a2f3c',
  whisker: '#cdbfae',
  blush: '#ff9aa2',
  red: '#e5484d',
  gold: '#ffc83d',
};

const EYE_L = { cx: 84, cy: 124, out: -1, id: 'l' };
const EYE_R = { cx: 156, cy: 124, out: 1, id: 'r' };
const EYES = [EYE_L, EYE_R];

const sparkle = (x, y, s = 1, fill = C.gold) =>
  `<path d="M${x} ${y - 8 * s} L${x + 2.4 * s} ${y - 2.4 * s} L${x + 8 * s} ${y} L${x + 2.4 * s} ${y + 2.4 * s} L${x} ${y + 8 * s} L${x - 2.4 * s} ${y + 2.4 * s} L${x - 8 * s} ${y} L${x - 2.4 * s} ${y - 2.4 * s} Z" fill="${fill}"/>`;

const heart = (x, y, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 6 C-12 -2 -8 -12 0 -6 C8 -12 12 -2 0 6 Z" fill="${C.blush}" stroke="${C.red}" stroke-width="1.5"/>`;

// ---------- 눈 ----------

function eyeBall(e, { rx = 16, ry = 17, prx = 4.5, pry = 12, dx = 0, dy = 0, highlights = [[5, -6, 3.4]] } = {}) {
  return `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${rx}" ry="${ry}" fill="${C.amber}" stroke="${C.line}" stroke-width="2.5"/>
<ellipse cx="${e.cx + dx}" cy="${e.cy + dy}" rx="${prx}" ry="${pry}" fill="${C.pupil}"/>
${highlights.map(([x, y, r]) => `<circle cx="${e.cx + x}" cy="${e.cy + y}" r="${r}" fill="#fff"/>`).join('')}`;
}

// 눈꺼풀: 안쪽/바깥쪽 끝에서 눈꺼풀 아래선의 높이(cy 기준)
function lid(e, innerY, outerY) {
  const ox = e.cx + e.out * 22;
  const ix = e.cx - e.out * 22;
  return `<g clip-path="url(#eye-${e.id})">
<polygon points="${ox},${e.cy - 26} ${ix},${e.cy - 26} ${ix},${e.cy + innerY} ${ox},${e.cy + outerY}" fill="${C.orange}"/>
<line x1="${ix}" y1="${e.cy + innerY}" x2="${ox}" y2="${e.cy + outerY}" stroke="${C.line}" stroke-width="3.2" stroke-linecap="round"/>
</g>`;
}

const brow = (e, { inner, outer, w = 3.5, color = C.orangeDark }) =>
  `<path d="M${e.cx + e.out * 20} ${e.cy + outer} Q${e.cx} ${e.cy + (inner + outer) / 2 - 8} ${e.cx - e.out * 16} ${e.cy + inner}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;

const closedEye = (e) =>
  `<path d="M${e.cx - 15} ${e.cy + 5} Q${e.cx} ${e.cy - 15} ${e.cx + 15} ${e.cy + 5}" fill="none" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>`;

// ---------- 코·입 ----------

const nose = `<path d="M111 146 Q120 142 129 146 Q125 156 120 159 Q115 156 111 146 Z" fill="${C.pink}" stroke="${C.pinkDark}" stroke-width="1.6" stroke-linejoin="round"/>`;

const mouths = {
  flat: `<path d="M120 159 L120 165 M120 165 Q112 168 104 165 M120 165 Q128 168 136 165" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round"/>`,
  frown: `<path d="M120 159 L120 165 M120 166 Q112 160 104 168 M120 166 Q128 160 136 168" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round"/>`,
  open: `<path d="M98 163 Q120 157 142 163 Q140 193 120 195 Q100 193 98 163 Z" fill="${C.mouth}" stroke="${C.line}" stroke-width="2.4" stroke-linejoin="round"/>
<ellipse cx="120" cy="187" rx="11" ry="6.5" fill="${C.pink}"/>
<path d="M106 163 L112 163 L109 175 Z M128 163 L134 163 L131 175 Z" fill="#fff" stroke="${C.line}" stroke-width="1.2" stroke-linejoin="round"/>`,
  grin: `<path d="M103 163 Q120 166 137 163 Q134 186 120 187 Q106 186 103 163 Z" fill="${C.mouth}" stroke="${C.line}" stroke-width="2.4" stroke-linejoin="round"/>
<ellipse cx="120" cy="180" rx="8" ry="4.5" fill="${C.pink}"/>`,
};

// ---------- 표정 ----------
// face: 눈/눈썹 (코·입 제외), mouth: 입 종류, extras: 몸 바깥 장식

export const EXPRESSIONS = {
  neutral: {
    label: '기본',
    mouth: 'flat',
    face: () => EYES.map((e) => eyeBall(e)).join(''),
  },
  sad: {
    label: '시무룩',
    mouth: 'frown',
    face: () =>
      EYES.map((e) => eyeBall(e, { dy: 4, highlights: [[4, -1, 3]] }) + lid(e, -9, 2) + brow(e, { inner: -36, outer: -24 })).join(''),
    extras: () => `<path d="M198 92 C190 104 188 112 198 114 C208 112 206 104 198 92 Z" fill="#8fd3ff" stroke="#4a9fd6" stroke-width="2"/>`,
  },
  happy: {
    label: '신남',
    mouth: 'grin',
    blush: true,
    face: () => EYES.map((e) => closedEye(e)).join(''),
    extras: () => heart(200, 62, 1.2) + sparkle(40, 66, 0.9),
  },
};

// ---------- 조립 ----------

function whiskers() {
  const left = [
    [72, 150, 34, 142],
    [72, 157, 30, 158],
    [74, 164, 36, 174],
  ];
  return left
    .map(([x1, y1, x2, y2]) => [`<path d="M${x1} ${y1} L${x2} ${y2}"/>`, `<path d="M${240 - x1} ${y1} L${240 - x2} ${y2}"/>`].join(''))
    .join('');
}

function stripes() {
  const l = ['M99 66 Q94 76 96 88', 'M89 70 Q82 80 84 94', 'M79 79 Q72 90 75 102'];
  const r = ['M141 66 Q146 76 144 88', 'M151 70 Q158 80 156 94', 'M161 79 Q168 90 165 102'];
  return [...l, ...r].map((d) => `<path d="${d}"/>`).join('');
}

const ear = `<path d="M44 94 C32 64 50 44 90 54 C101 56 105 61 105 66 C84 67 63 77 55 101 Z" fill="${C.orange}" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"/>
<path d="M52 88 C58 70 76 61 98 60 C80 67 66 78 60 96 Z" fill="${C.earInner}"/>`;

export function renderSvg(name) {
  const x = EXPRESSIONS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="라니 ${x.label}">
<defs>
<clipPath id="head"><ellipse cx="120" cy="128" rx="88" ry="72"/></clipPath>
${EYES.map((e) => `<clipPath id="eye-${e.id}"><ellipse cx="${e.cx}" cy="${e.cy}" rx="16" ry="17"/></clipPath>`).join('')}
</defs>
<g stroke-linejoin="round">
<path d="M38 420 L38 242 C38 192 78 178 120 178 C162 178 202 192 202 242 L202 420 Z" fill="${C.cream}" stroke="${C.line}" stroke-width="3"/>
<path d="M170 189 C192 197 202 216 202 242 L202 420 L172 420 L172 242 C178 222 178 206 170 189 Z" fill="${C.orange}"/>
${ear}
<g transform="translate(240 0) scale(-1 1)">${ear}</g>
<ellipse cx="120" cy="128" rx="88" ry="72" fill="${C.orange}"/>
<g clip-path="url(#head)">
<path d="M114 56 C113 80 106 100 101 118 C98 128 90 142 72 144 L20 144 L20 220 L220 220 L220 144 L168 144 C150 142 142 128 139 118 C134 100 127 80 126 56 Z" fill="${C.cream}"/>
<g fill="none" stroke="${C.orangeDark}" stroke-width="3.6" stroke-linecap="round">${stripes()}</g>
</g>
<ellipse cx="120" cy="128" rx="88" ry="72" fill="none" stroke="${C.line}" stroke-width="3"/>
<g stroke="${C.whisker}" stroke-width="2" stroke-linecap="round" fill="none">${whiskers()}</g>
${x.blush ? `<ellipse cx="62" cy="152" rx="11" ry="7" fill="${C.blush}" opacity=".55"/><ellipse cx="178" cy="152" rx="11" ry="7" fill="${C.blush}" opacity=".55"/>` : ''}
${x.face()}
${nose}
${mouths[x.mouth]}
</g>
${x.extras ? x.extras() : ''}
</svg>
`;
}

// 직접 실행하면 파일로 저장
if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  for (const name of Object.keys(EXPRESSIONS)) {
    writeFileSync(new URL(`${name}.svg`, OUT), renderSvg(name));
    console.log(`public/rani/${name}.svg  (${EXPRESSIONS[name].label})`);
  }
}
