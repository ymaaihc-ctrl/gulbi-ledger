// 천장 리본 끈에 매달린 통통한 아기 굴비. mood: happy | worried | bitten | sleepy
let seq = 0;

const LINE = '#b8742a';
const PUPIL = '#3a2614';

const shinyEye = (cx, cy, r = 8.5) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PUPIL}"/><circle cx="${cx - 2.8}" cy="${cy - 3}" r="3.2" fill="#fff"/><circle cx="${cx + 2.6}" cy="${cy + 2.6}" r="1.5" fill="#fff"/>`;

export function mascot(mood = 'happy', label = '굴비') {
  const id = `g${++seq}`;
  const eye = {
    happy: shinyEye(74, 90),
    worried: `${shinyEye(74, 91, 8)}<path d="M64 76 Q72 72 82 76" fill="none" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>`,
    bitten: `${shinyEye(74, 91, 8)}<path d="M71 100 C71 100 66 108 66 112 a5 5 0 0 0 10 0 C76 108 71 100 71 100Z" fill="#9ed4f5"/>`,
    sleepy: `<path d="M65 90 Q74 98 83 90" fill="none" stroke="${PUPIL}" stroke-width="3.4" stroke-linecap="round"/>`,
  }[mood];
  const mouth = {
    happy: `<path d="M47 103 Q51 109 55 103 Q59 109 63 103" fill="none" stroke="${PUPIL}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    worried: `<path d="M48 107 Q55 101 62 107" fill="none" stroke="${PUPIL}" stroke-width="2.6" stroke-linecap="round"/>`,
    bitten: `<path d="M48 107 q3.5 -4 7 0 q3.5 4 7 0" fill="none" stroke="${PUPIL}" stroke-width="2.6" stroke-linecap="round"/>`,
    sleepy: `<ellipse cx="55" cy="105" rx="3.4" ry="2.6" fill="${PUPIL}"/>`,
  }[mood];
  const extra = {
    happy: `<path d="M24 50 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z M172 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#ffc94d"/><path d="M160 62 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" fill="#ffc94d"/>`,
    worried: `<path d="M120 56 C120 56 112 67 112 72 a8 8 0 0 0 16 0 C128 67 120 56 120 56Z" fill="#9ed4f5"/><ellipse cx="117" cy="70" rx="2" ry="3" fill="#fff" opacity=".8"/>`,
    bitten: `<circle cx="146" cy="40" r="2.4" fill="#f0b45a"/><circle cx="156" cy="48" r="1.8" fill="#f0b45a"/><circle cx="138" cy="34" r="1.6" fill="#f0b45a"/>`,
    sleepy: `<text x="142" y="40" font-size="18" font-weight="700" fill="${LINE}" font-family="sans-serif">z</text><text x="158" y="24" font-size="13" font-weight="700" fill="${LINE}" font-family="sans-serif">z</text>`,
  }[mood];
  const bite = mood === 'bitten'
    ? `<mask id="${id}m"><rect width="200" height="170" fill="#fff"/><circle cx="134" cy="56" r="10" fill="#000"/><circle cx="121" cy="51" r="8" fill="#000"/></mask>`
    : '';
  const masked = mood === 'bitten' ? `mask="url(#${id}m)"` : '';

  return `<svg viewBox="0 0 200 170" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc759"/><stop offset=".6" stop-color="#ffdb84"/><stop offset="1" stop-color="#fff0c4"/>
    </linearGradient>${bite}
  </defs>
  <path d="M104 0 V50" stroke="#c99a62" stroke-width="2.6" stroke-linecap="round"/>
  <g ${masked}>
    <path d="M146 96 C158 76 178 70 183 80 C186 88 175 95 170 98 C175 101 186 108 183 116 C178 126 158 120 146 104Z" fill="#ffc759" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M90 56 C93 40 112 36 120 52" fill="#ffb53d" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M38 100 C38 66 76 50 108 52 C138 54 154 74 154 96 C154 120 132 138 100 139 C64 140 38 128 38 100Z" fill="url(#${id}b)" stroke="${LINE}" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="96" cy="122" rx="38" ry="11" fill="#fff6dc" opacity=".9"/>
    <path d="M110 82 q6 7 0 14 M124 80 q6 8 0 16" fill="none" stroke="#f0a83a" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M100 108 C110 100 124 104 122 114 C114 118 104 116 100 108Z" fill="#ffb53d" stroke="${LINE}" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
  <path d="M100 48 C86 36 82 56 100 52 Z M108 48 C122 36 126 56 108 52 Z" fill="#ff8fa3" stroke="#e0607a" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="104" cy="50" r="4.2" fill="#ff8fa3" stroke="#e0607a" stroke-width="1.6"/>
  <ellipse cx="62" cy="110" rx="8" ry="5" fill="#ff9aa8" opacity=".55"/>
  ${eye}${mouth}${extra}
</svg>`;
}

export const LINES = {
  happy: ['오늘도 알뜰살뜰, 최고예요!', '이 페이스면 황금굴비 간다~', '지갑이 웃고 있어요', '굴비 한 번 보고 밥 한 숟갈!'],
  worried: ['어… 한도가 얼마 안 남았어요', '남은 돈, 소중히 써주세요', '지금 멈추면 굴비를 지켜요!'],
  bitten: ['흑, 한도를 넘었어요… 내일 같이 힘내요', '괜찮아요, 굴비는 다시 말리면 돼요', '오늘은 여기까지! 내일 만회해요'],
  sleepy: ['오늘 쓴 돈을 알려주세요', '안 썼다면 무지출 버튼을 꾹!'],
};

// 날짜로 고르면 새로고침해도 문구가 바뀌지 않는다
export function lineFor(mood, day) {
  const list = LINES[mood];
  const n = [...day].reduce((s, c) => s + c.charCodeAt(0), 0);
  return list[n % list.length];
}
