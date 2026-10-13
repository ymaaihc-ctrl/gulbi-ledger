// 천장에 매달린 굴비 마스코트. mood: happy | worried | bitten | sleepy
let seq = 0;

export function mascot(mood = 'happy', label = '굴비') {
  const id = `g${++seq}`;
  const ink = '#5a3d14';
  const eye = {
    happy: `<circle cx="48" cy="88" r="8.5" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="46" cy="86" r="4" fill="${ink}"/><circle cx="44.5" cy="84.5" r="1.4" fill="#fff"/>`,
    worried: `<circle cx="48" cy="88" r="8.5" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="49" cy="90" r="3.6" fill="${ink}"/><path d="M38 75 L57 80" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
    bitten: `<circle cx="48" cy="88" r="8.5" fill="#fff" stroke="${ink}" stroke-width="2"/><path d="M43 83 L53 93 M53 83 L43 93" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
    sleepy: `<path d="M40 88 Q48 95 56 88" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`,
  }[mood];
  const mouth = {
    happy: `<path d="M29 100 Q35 109 44 103" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="60" cy="104" rx="6" ry="3.5" fill="#f08a6b" opacity=".55"/>`,
    worried: `<path d="M29 104 q4 -4 8 0 q4 4 8 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`,
    bitten: `<ellipse cx="35" cy="103" rx="4" ry="5" fill="${ink}"/>`,
    sleepy: `<path d="M30 102 Q36 105 42 102" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`,
  }[mood];
  const extra = {
    happy: `<path d="M22 46 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z M176 34 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#f3c34f"/>`,
    worried: `<path d="M70 52 C70 52 62 64 62 69 a8 8 0 0 0 16 0 C78 64 70 52 70 52z" fill="#8cc8f0" stroke="#4a8cbf" stroke-width="1.5"/>`,
    bitten: `<circle cx="150" cy="140" r="2.5" fill="#d79a3a"/><circle cx="160" cy="146" r="2" fill="#d79a3a"/><circle cx="138" cy="148" r="1.8" fill="#d79a3a"/>`,
    sleepy: `<text x="62" y="62" font-size="16" font-weight="700" fill="${ink}" font-family="sans-serif">z</text><text x="74" y="48" font-size="12" font-weight="700" fill="${ink}" font-family="sans-serif">z</text>`,
  }[mood];
  const bite = mood === 'bitten'
    ? `<mask id="${id}m"><rect width="200" height="170" fill="#fff"/><circle cx="124" cy="122" r="13" fill="#000"/><circle cx="141" cy="117" r="11" fill="#000"/></mask>`
    : '';
  const masked = mood === 'bitten' ? `mask="url(#${id}m)"` : '';

  return `<svg viewBox="0 0 200 170" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9a83a"/><stop offset=".55" stop-color="#f3c463"/><stop offset="1" stop-color="#fbe3a6"/>
    </linearGradient>${bite}
  </defs>
  <path d="M110 0 V64" stroke="#8a6a3e" stroke-width="3"/>
  <g ${masked}>
    <path d="M30 95 C48 64 118 58 148 84 L181 61 C172 84 172 106 181 129 L148 106 C118 132 48 126 30 95Z" fill="url(#${id}b)" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M77 70 C88 50 114 50 128 69" fill="#d48f22" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M60 80 Q68 95 60 111" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>
    <path d="M86 84 q7 8 0 16 M100 82 q7 9 0 18 M114 84 q7 8 0 16 M128 88 q5 6 0 12" fill="none" stroke="#c07e1c" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M161 78 L176 70 M161 95 L177 95 M161 112 L176 120" stroke="#c07e1c" stroke-width="1.6" stroke-linecap="round"/>
  </g>
  <rect x="105" y="60" width="10" height="56" rx="3" fill="#a07a44" opacity=".9"/>
  <path d="M105 72 h10 M105 84 h10 M105 96 h10 M105 108 h10" stroke="#7a5a2e" stroke-width="1.2"/>
  ${eye}${mouth}${extra}
</svg>`;
}

export const LINES = {
  happy: ['오늘도 천장 보고 밥 한 숟갈!', '이 페이스면 황금굴비 간다', '지갑이 편안해 보여요', '굴비 한 번 쳐다보고 아껴봐요'],
  worried: ['어… 굴비가 땀 흘리기 시작했어요', '남은 한도, 소중히 다뤄주세요', '지금 멈추면 굴비를 지켜요!'],
  bitten: ['아야! 굴비 한 입 뜯겼어요', '오늘 한도를 넘었어요. 내일 만회해요', '괜찮아요, 굴비는 다시 말리면 돼요'],
  sleepy: ['오늘 쓴 돈을 알려주세요', '안 썼다면 무지출 버튼을 꾹!'],
};

// 날짜로 고르면 새로고침해도 문구가 바뀌지 않는다
export function lineFor(mood, day) {
  const list = LINES[mood];
  const n = [...day].reduce((s, c) => s + c.charCodeAt(0), 0);
  return list[n % list.length];
}
