// 굴비 가계부 계산 모듈 — 순수 함수만 둔다. 합계는 항상 기록에서 다시 계산한다.

export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5); // b - a
export const today = () => iso(new Date());
export const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;

export const AMOUNT_MAX = 100_000_000;
export const MEMO_MAX = 100;
export const TRASH_DAYS = 30;

export const KINDS = {
  living: '생활비 (하루 한도 계산)',
  fixed: '매달 나가는 돈',
  saving: '저축',
  invest: '투자',
};

export const TYPES = {
  expense: '지출',
  income: '수입',
  trip: '출장비',
  extra: '큰 지출',
  invest: '투자',
};

// 입력 화면은 수입 / 지출 두 가지만 보여주고, 고른 아이콘에 따라 내부 유형이 정해진다
export const EXPENSE_CATS = [
  { k: '식비', icon: '🍚' },
  { k: '카페·간식', icon: '☕' },
  { k: '장보기', icon: '🛒' },
  { k: '쇼핑', icon: '🛍️' },
  { k: '교통', icon: '🚌' },
  { k: '생활', icon: '🏠' },
  { k: '병원', icon: '💊' },
  { k: '문화·여가', icon: '🎬' },
  { k: '경조사', icon: '🎁', type: 'extra', hint: '경조사는 하루 한도와 따로 계산해요' },
  { k: '큰 지출', icon: '📦', type: 'extra', hint: '가전·수리처럼 가끔 큰 돈은 하루 한도와 따로 계산해요' },
  { k: '출장비', icon: '💼', type: 'trip', hint: '회사에서 돌려받을 돈으로 따로 모아둘게요' },
  { k: '투자', icon: '📈', type: 'invest', hint: '계획에 없던 투자예요. 저장하기 전에 굴비가 한 번 말려요' },
  { k: '기타', icon: '✏️' },
];
export const INCOME_CATS = [
  { k: '월급', icon: '💰' },
  { k: '부수입', icon: '💵' },
  { k: '용돈', icon: '🧧' },
  { k: '환급', icon: '↩️' },
  { k: '이자·배당', icon: '🏦' },
  { k: '기타', icon: '✏️' },
];
export const SALARY_CAT = '월급';
export const INVEST_KINDS = ['지수 ETF', '예·적금', '채권', '개별 주식', '코인', '레버리지'];

export const typeOfExpenseCat = k => EXPENSE_CATS.find(c => c.k === k)?.type || 'expense';

export function iconOf(e) {
  if (e.type === 'fixed') return '📌';
  if (e.type === 'nospend') return '✨';
  if (e.type === 'income') return e.category === SALARY_CAT ? '💰' : (INCOME_CATS.find(c => c.k === e.category)?.icon || '💵');
  if (e.type === 'invest') return '📈';
  if (e.type === 'trip') return '💼';
  return EXPENSE_CATS.find(c => c.k === e.category)?.icon || '✏️';
}

// 안정형 투자 원칙: 이 종류나 메모 키워드가 나오면 강한 경고
export const RISKY_CATEGORIES = ['개별 주식', '코인', '레버리지', '레버리지·파생'];
export const RISKY_WORDS = /코인|비트|이더|레버리지|인버스|선물|옵션|테마|단타|급등|몰빵|대출|[23]배/;

export const isRiskyInvest = (kind, memo = '') =>
  RISKY_CATEGORIES.includes(kind) || RISKY_WORDS.test(memo);

export const LEVELS = [
  { min: 0, name: '멸치', line: '아직은 멸치지만 꿈은 굴비' },
  { min: 10, name: '노가리', line: '노가리 까는 실력보다 아끼는 실력' },
  { min: 30, name: '굴비', line: '천장에 매달릴 자격 획득' },
  { min: 70, name: '황금굴비', line: '자린고비 선생도 고개를 끄덕' },
  { min: 150, name: '영광굴비', line: '전설의 영광굴비, 가문의 영광' },
];

export function levelOf(total) {
  let i = 0;
  LEVELS.forEach((l, idx) => { if (total >= l.min) i = idx; });
  const next = LEVELS[i + 1] || null;
  return { ...LEVELS[i], index: i, next, toNext: next ? next.min - total : 0 };
}

// 월 시작일(1~28) 기준 기간
export function periodOf(dateStr, startDay = 1) {
  const d = parse(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() - (d.getDate() < startDay ? 1 : 0);
  const start = iso(new Date(y, m, startDay));
  const end = addDays(iso(new Date(y, m + 1, startDay)), -1);
  return { start, end };
}

export const shiftPeriod = (p, n, startDay = 1) => {
  const d = parse(p.start);
  return periodOf(iso(new Date(d.getFullYear(), d.getMonth() + n, startDay)), startDay);
};

const sum = arr => arr.reduce((s, e) => s + (e.amount || 0), 0);
export const alive = entries => entries.filter(e => !e.deletedAt);
const within = (e, p) => e.date >= p.start && e.date <= p.end;

export function summarize({ plan, entries, settings }, day) {
  const p = periodOf(day, settings.monthStartDay);
  const live = alive(entries);
  const inP = live.filter(e => within(e, p));
  const expenses = inP.filter(e => e.type === 'expense');

  const budget = sum(plan.filter(i => i.kind === 'living'));
  const planTotal = sum(plan);
  const spent = sum(expenses);
  const spentBeforeToday = sum(expenses.filter(e => e.date < day));
  const todaySpent = sum(expenses.filter(e => e.date === day));
  const daysLeft = diffDays(day, p.end) + 1;
  const todayLimit = Math.max(0, Math.floor((budget - spentBeforeToday) / daysLeft));

  const income = sum(inP.filter(e => e.type === 'income'));
  const extra = sum(inP.filter(e => e.type === 'extra'));
  const extraInvest = sum(inP.filter(e => e.type === 'invest'));
  const receivable = sum(live.filter(e => e.type === 'trip' && !e.settled));
  const overspend = Math.max(0, spent - budget);

  const investPlanned = sum(plan.filter(i => i.kind === 'invest'));
  const investLimit = settings.investLimit || investPlanned;

  const fixedItems = plan.filter(i => i.kind !== 'living').map(i => {
    const done = inP.find(e => e.type === 'fixed' && e.planId === i.id);
    return { ...i, done: !!done, doneEntry: done || null };
  });

  // 이번 달 돈 흐름: 들어온 돈(월급+수익) − 나간 돈(지출 전부 + 체크한 자동이체 + 정산 전 출장비)
  const inflow = income;
  const outflow = spent + extra + extraInvest
    + sum(inP.filter(e => e.type === 'fixed'))
    + sum(inP.filter(e => e.type === 'trip' && !e.settled));
  const salaryIn = inP.some(e => e.type === 'income' && e.category === SALARY_CAT);

  return {
    period: p, budget, planTotal, spent, remaining: budget - spent, daysLeft,
    todayLimit, todaySpent, todayLeft: todayLimit - todaySpent,
    income, extra, extraInvest, receivable, overspend,
    inflow, outflow, left: inflow - outflow, salaryIn,
    investPlanned, investLimit, investTotal: investPlanned + extraInvest,
    fixedItems,
  };
}

// 하루 보상: 기록(체크인)이 있는 지난 날만 판정한다. 무지출 2마리, 한도 지킴 1마리.
// 월 보너스: 끝난 달에 생활비를 지키고 체크인 10일 이상이면 +10마리, 남은 생활비는 저금통으로.
export function computeRewards({ plan, entries, settings, rewards }, day) {
  const sd = settings.monthStartDay;
  const live = alive(entries);
  const budget = sum(plan.filter(i => i.kind === 'living'));
  const expByDay = new Map();
  const active = new Set();
  const nospend = new Set();
  for (const e of live) {
    active.add(e.date);
    if (e.type === 'expense') expByDay.set(e.date, (expByDay.get(e.date) || 0) + e.amount);
    if (e.type === 'nospend') nospend.add(e.date);
  }

  const start = settings.onboardedAt || day;
  const days = [];
  let dailyFish = 0, bonus = 0, jar = 0, bonusMonths = 0;
  let p = periodOf(start, sd);
  while (p.start <= day) {
    let run = 0, checkins = 0;
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) {
      const exp = expByDay.get(d) || 0;
      if (d >= start && d < day) {
        const limit = Math.floor((budget - run) / (diffDays(d, p.end) + 1));
        let status = 'none', fish = 0;
        if (active.has(d) && budget > 0) {
          checkins++;
          if (exp === 0 && nospend.has(d)) { status = 'nospend'; fish = 2; }
          else if (exp <= limit) { status = 'kept'; fish = 1; }
          else status = 'missed';
        }
        dailyFish += fish;
        days.push({ date: d, status, fish, exp, limit });
      }
      run += exp;
    }
    if (p.end < day && budget > 0 && run <= budget && checkins >= 10) {
      bonus += 10; bonusMonths++; jar += budget - run;
    }
    p = periodOf(addDays(p.end, 1), sd);
  }

  const restraint = rewards.filter(r => r.type === 'restraint').length;
  const redeemed = rewards.filter(r => r.type === 'wish' && r.redeemedAt).reduce((s, r) => s + r.cost, 0);
  const total = dailyFish + bonus + restraint;

  const good = s => s === 'kept' || s === 'nospend';
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && good(days[i].status); i--) streak++;
  let maxStreak = 0, run = 0;
  for (const d of days) { run = good(d.status) ? run + 1 : 0; maxStreak = Math.max(maxStreak, run); }

  const trips = live.filter(e => e.type === 'trip');
  const badges = [
    { id: 'first', name: '첫 기록', desc: '장부에 첫 줄을 적었어요', got: live.length > 0 },
    { id: 'streak7', name: '일주일 굴비', desc: '7일 연속 한도 지키기', got: maxStreak >= 7 },
    { id: 'nospend3', name: '무지출 3회', desc: '무지출 데이 3번', got: days.filter(d => d.status === 'nospend').length >= 3 },
    { id: 'trip', name: '정산왕', desc: '출장비를 빠짐없이 돌려받기', got: trips.length > 0 && trips.every(t => t.settled) },
    { id: 'restraint3', name: '참을 인 세 번', desc: '추가 투자 경고에서 3번 참기', got: restraint >= 3 },
    { id: 'month', name: '한 달 완주', desc: '생활비를 지킨 달 1번', got: bonusMonths >= 1 },
    { id: 'jar', name: '저금통 10만', desc: '굴비 저금통 10만 원', got: jar >= 100_000 },
  ];

  return {
    days, dailyFish, bonus, restraint, total, redeemed, available: total - redeemed,
    jar, streak, maxStreak, level: levelOf(total), badges,
  };
}

export function validateEntry(e) {
  if (!TYPES[e.type] && e.type !== 'fixed' && e.type !== 'nospend') return '입력 유형이 올바르지 않아요';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return '날짜를 확인해주세요';
  if (e.type !== 'nospend') {
    if (!Number.isInteger(e.amount) || e.amount < 1) return '금액은 1원 이상 정수로 입력해주세요';
    if (e.amount > AMOUNT_MAX) return '한 번에 1억 원까지만 적을 수 있어요';
  }
  if ((e.memo || '').length > MEMO_MAX) return `메모는 ${MEMO_MAX}자까지예요`;
  if (e.type === 'invest' && e.warnedAck && !(e.reason || '').trim()) return '추가 투자 사유를 적어주세요';
  return null;
}

export const tagsOf = memo => (memo || '').match(/#[^\s#]+/g) || [];
