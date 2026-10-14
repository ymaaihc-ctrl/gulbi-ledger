import assert from 'node:assert/strict';
import { summarize, computeRewards, periodOf, shiftPeriod, validateEntry, isRiskyInvest, typeOfExpenseCat, iconOf } from '../calc.js';

const plan = [
  { id: 'p1', name: '보험료', amount: 80000, kind: 'fixed' },
  { id: 'p2', name: '적금', amount: 300000, kind: 'saving' },
  { id: 'p3', name: '용돈 통장', amount: 30000, kind: 'fixed' },
  { id: 'p4', name: '통신료', amount: 4000, kind: 'fixed' },
  { id: 'p5', name: '지수 ETF', amount: 700000, kind: 'invest' },
  { id: 'p6', name: '교통비', amount: 60000, kind: 'fixed' },
  { id: 'p7', name: '생활비', amount: 400000, kind: 'living' },
];
const settings = { monthStartDay: 1, salary: 0, investLimit: 0, onboardedAt: '2026-10-01' };
const e = (id, date, type, amount, extra = {}) => ({ id, date, type, amount, memo: '', ...extra });

// 기간
assert.deepEqual(periodOf('2026-10-13', 1), { start: '2026-10-01', end: '2026-10-31' });
assert.deepEqual(periodOf('2026-10-13', 25), { start: '2026-09-25', end: '2026-10-24' });
assert.deepEqual(periodOf('2026-01-05', 25), { start: '2025-12-25', end: '2026-01-24' });
assert.deepEqual(shiftPeriod(periodOf('2026-10-13', 1), -1, 1), { start: '2026-09-01', end: '2026-09-30' });

// 예시 계획(가상 금액), 10/13 기준
const entries = [
  e('a', '2026-10-05', 'expense', 120000),
  e('b', '2026-10-12', 'trip', 90000),
  e('c', '2026-10-12', 'extra', 50000),
  e('z', '2026-10-06', 'expense', 9999, { deletedAt: '2026-10-07T00:00:00Z' }),
];
let s = summarize({ plan, entries, settings }, '2026-10-13');
assert.equal(s.planTotal, 1574000);
assert.equal(s.remaining, 280000);
assert.equal(s.daysLeft, 19);
assert.equal(s.todayLimit, 14736);
assert.equal(s.receivable, 90000);
assert.equal(s.extra, 50000);
assert.equal(s.salaryIn, false);
assert.equal(s.fixedItems.length, 6);

// 오늘 쓴 돈은 오늘 한도를 바꾸지 않고 남은 한도만 줄인다
s = summarize({ plan, entries: [...entries, e('d', '2026-10-13', 'expense', 5000)], settings }, '2026-10-13');
assert.equal(s.todayLimit, 14736);
assert.equal(s.todayLeft, 9736);

// 출장비 정산 완료 → 받을 돈 0, 수입으로 잡지 않음
s = summarize({ plan, entries: entries.map(x => x.id === 'b' ? { ...x, settled: true } : x), settings }, '2026-10-13');
assert.equal(s.receivable, 0);
assert.equal(s.income, 0);

// 돈 흐름: 월급 + 수익 − (지출 + 큰 지출 + 정산 전 출장비 + 체크한 자동이체)
s = summarize({ plan, settings, entries: [...entries,
  e('w', '2026-10-10', 'income', 3_000_000, { category: '월급' }),
  e('x', '2026-10-11', 'income', 50_000, { category: '부수입' }),
  e('f', '2026-10-10', 'fixed', 80_000, { planId: 'p1' }),
] }, '2026-10-13');
assert.equal(s.salaryIn, true);
assert.equal(s.inflow, 3_050_000);
assert.equal(s.outflow, 120_000 + 50_000 + 90_000 + 80_000);
assert.equal(s.left, 3_050_000 - 340_000);
assert.equal(s.fixedItems.find(i => i.id === 'p1').done, true);

// 추가 투자 → 투자 합계가 한도를 넘음
s = summarize({ plan, entries: [e('i', '2026-10-10', 'invest', 300000)], settings }, '2026-10-13');
assert.equal(s.investTotal, 1_000_000);
assert.equal(s.investLimit, 700_000);

// 보상: 10/1 한도 12,903 지킴(1), 10/2 무지출(2), 10/3 초과(0), 10/4 기록 없음
const r = computeRewards({
  plan, settings, rewards: [{ id: 'r1', type: 'restraint', date: '2026-10-03' }],
  entries: [
    e('1', '2026-10-01', 'expense', 11000),
    e('2', '2026-10-02', 'nospend', 0),
    e('3', '2026-10-03', 'expense', 50000),
  ],
}, '2026-10-05');
assert.deepEqual(r.days.map(d => d.status), ['kept', 'nospend', 'missed', 'none']);
assert.equal(r.dailyFish, 3);
assert.equal(r.total, 4);
assert.equal(r.streak, 0);

// 월 보너스: 9월 전체 체크인, 생활비 40만 중 30만 사용 → +10, 저금통 10만
const sept = Array.from({ length: 30 }, (_, i) => e(`s${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, 'expense', 10000));
const r2 = computeRewards({ plan, rewards: [], entries: sept, settings: { ...settings, onboardedAt: '2026-09-01' } }, '2026-10-01');
assert.equal(r2.bonus, 10);
assert.equal(r2.jar, 100000);
assert.equal(r2.streak, 30);
assert.ok(r2.badges.find(b => b.id === 'streak7').got);

// 검증
assert.equal(validateEntry(e('v', '2026-10-13', 'expense', 0)), '금액은 1원 이상 정수로 입력해주세요');
assert.equal(validateEntry(e('v', '2026-10-13', 'expense', 100_000_001)), '한 번에 1억 원까지만 적을 수 있어요');
assert.equal(validateEntry(e('v', '2026-10-13', 'invest', 1000, { warnedAck: true, reason: ' ' })), '추가 투자 사유를 적어주세요');
assert.equal(validateEntry(e('v', '2026-10-13', 'expense', 1000)), null);
assert.ok(isRiskyInvest('코인'));
assert.ok(isRiskyInvest('지수 ETF', '나스닥 3배 레버리지'));
assert.ok(!isRiskyInvest('지수 ETF', 'S&P500 적립'));

// 아이콘만 고르면 내부 유형이 정해진다
assert.equal(typeOfExpenseCat('식비'), 'expense');
assert.equal(typeOfExpenseCat('경조사'), 'extra');
assert.equal(typeOfExpenseCat('출장비'), 'trip');
assert.equal(typeOfExpenseCat('투자'), 'invest');
assert.equal(iconOf({ type: 'income', category: '월급' }), '💰');
assert.ok(isRiskyInvest('레버리지'));

console.log('calc tests passed');
