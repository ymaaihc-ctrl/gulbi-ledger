import * as C from './calc.js';
import * as DB from './db.js';
import { mascot, lineFor } from './mascot.js';

const APP_VERSION = '1.0.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const won = C.won;
const digits = v => String(v ?? '').replace(/\D/g, '').slice(0, 9);
const fmtInput = v => (digits(v) ? Number(digits(v)).toLocaleString('ko-KR') : '');
const WEEK = '일월화수목금토';
const fmtDate = s => { const d = C.parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const md = s => { const d = C.parse(s); return `${d.getMonth() + 1}.${d.getDate()}`; };

const DEFAULT_SETTINGS = { monthStartDay: 1, salary: 0, investLimit: 0, onboardedAt: null, lastBackupAt: null, persistAsked: false };
const ICON = { expense: '지', income: '수', trip: '출', extra: '추', invest: '투', fixed: '고', nospend: '무' };
const VIEWS = ['onboarding', 'home', 'ledger', 'rewards', 'settings'];

let state = { plan: [], entries: [], rewards: [], settings: { ...DEFAULT_SETTINGS } };
const ui = { tab: 'home', ledgerOffset: 0, filter: 'all', query: '', planDraft: null };
let installPrompt = null;

const withDefaults = s => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } });
const periodLabel = p => (state.settings.monthStartDay === 1
  ? `${C.parse(p.start).getFullYear()}년 ${C.parse(p.start).getMonth() + 1}월`
  : `${md(p.start)} ~ ${md(p.end)}`);

/* ---------- 시작 ---------- */

async function init() {
  try {
    state = withDefaults(await DB.loadAll());
    const purged = await DB.purgeTrash(state.entries);
    if (purged.length) state.entries = state.entries.filter(e => !purged.includes(e.id));
  } catch (err) {
    document.querySelector('main').innerHTML = `<div class="card"><h2>저장소를 열 수 없어요</h2><p class="muted">사파리 개인정보 보호 모드이거나 저장 공간이 꺼져 있을 수 있어요. 일반 모드에서 다시 열어주세요.</p><p class="small muted">${esc(err?.message)}</p></div>`;
    return;
  }
  bindChrome();
  await handleSetupLink();
  go(state.plan.length ? 'home' : 'onboarding');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function bindChrome() {
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('#fab').addEventListener('click', () => openSheet());
  document.addEventListener('click', onAction);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (ui.tab === 'settings' || ui.tab === 'onboarding') render(); });
}

function go(tab) {
  ui.tab = tab;
  if (tab === 'settings') ui.planDraft = null;
  render();
  window.scrollTo(0, 0);
}

/* ---------- 설정 링크(#setup=...) : 친구 계획을 첫 실행에 넣는다. 해시는 서버로 전송되지 않는다 ---------- */

function decodeSetup(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const json = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  const data = JSON.parse(json);
  if (!Array.isArray(data.plan) || !data.plan.length) throw new Error('empty');
  const plan = data.plan.map(i => {
    const amount = Number(i.amount);
    if (typeof i.name !== 'string' || !i.name.trim() || !Number.isInteger(amount) || amount < 0 || amount > C.AMOUNT_MAX || !C.KINDS[i.kind]) throw new Error('item');
    const payDay = Number(i.payDay) || null;
    return { id: uid(), name: i.name.trim().slice(0, 20), amount, kind: i.kind, payDay: payDay && payDay >= 1 && payDay <= 31 ? payDay : null };
  });
  return { plan, settings: data.settings || {} };
}

async function handleSetupLink() {
  const m = location.hash.match(/^#setup=([\w\-+/=]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let data;
  try { data = decodeSetup(m[1]); } catch { toast('설정 링크가 올바르지 않아요'); return; }
  if (state.plan.length) {
    const ok = await confirmModal({ title: '계획을 바꿀까요?', body: '설정 링크에 담긴 월 계획으로 지금 계획을 바꿔요. 지금까지의 기록은 그대로 남아요.', ok: '계획 바꾸기' });
    if (!ok) return;
  }
  await savePlan(data.plan);
  const sd = Number(data.settings.monthStartDay);
  if (sd >= 1 && sd <= 28) await setSetting('monthStartDay', sd);
  const salary = Number(data.settings.salary);
  if (Number.isInteger(salary) && salary > 0 && salary <= C.AMOUNT_MAX) await setSetting('salary', salary);
  toast('친구가 보낸 월 계획을 불러왔어요');
}

/* ---------- 저장 ---------- */

async function setSetting(key, value) {
  state.settings[key] = value;
  await DB.saveSetting(key, value);
}

async function savePlan(items) {
  await DB.replaceStore('plan', items);
  state.plan = items;
  if (!state.settings.onboardedAt) await setSetting('onboardedAt', C.today());
}

async function saveEntry(entry) {
  await DB.put('entries', entry);
  const i = state.entries.findIndex(e => e.id === entry.id);
  if (i >= 0) state.entries[i] = entry; else state.entries.push(entry);
  if (!state.settings.persistAsked) { await setSetting('persistAsked', true); DB.requestPersist(); }
}

async function trashEntry(entry) {
  await saveEntry({ ...entry, deletedAt: new Date().toISOString() });
  render();
  toast('휴지통으로 옮겼어요 (30일 보관)', { label: '되돌리기', fn: async () => { await saveEntry({ ...entry, deletedAt: null }); render(); } });
}

/* ---------- 렌더 ---------- */

function render() {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== ui.tab;
  const onboarding = ui.tab === 'onboarding';
  $('#tabbar').hidden = onboarding || !state.plan.length;
  $('#fab').hidden = onboarding || ui.tab === 'settings' || !state.plan.length;
  document.querySelectorAll('#tabbar [data-tab]').forEach(b => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });

  const t = C.today();
  const s = C.summarize(state, t);
  const rw = C.computeRewards(state, t);
  $('#topbar-right').innerHTML = state.plan.length
    ? `<button class="chip" data-go="rewards" type="button">${esc(rw.level.name)} · 굴비 ${rw.available}마리</button>` : '';
  ({ onboarding: renderOnboarding, home: renderHome, ledger: renderLedger, rewards: renderRewards, settings: renderSettings })[ui.tab](t, s, rw);
}

function moodOf(t, s) {
  const live = C.alive(state.entries);
  if (!live.some(e => e.date === t)) return 'sleepy';
  if (s.todaySpent === 0) return 'happy';
  if (s.todaySpent > s.todayLimit) return 'bitten';
  return s.todaySpent / s.todayLimit <= 0.7 ? 'happy' : 'worried';
}

function renderOnboarding() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#view-onboarding').innerHTML = `
  <div class="onboard">
    <div class="mascot happy">${mascot('happy', '반갑게 웃는 굴비')}</div>
    <h1>굴비 가계부</h1>
    <p class="muted">천장의 굴비를 쳐다보기만 하며 밥을 먹던 자린고비처럼.<br>계획만큼만 쓰면 굴비가 쌓여요.</p>
    <ol class="steps card">
      <li><div><b>홈 화면에 추가하기</b><br><span class="small muted">${isIOS ? '사파리 아래 공유 버튼 → ‘홈 화면에 추가’' : '브라우저 메뉴 → ‘앱 설치’ 또는 ‘홈 화면에 추가’'}. 설치해야 기록이 오래 안전하게 남아요.</span></div></li>
      <li><div><b>월 계획 입력하기</b><br><span class="small muted">보험료, 적금, 투자, 생활비처럼 매달 나가는 돈을 적어요.</span></div></li>
      <li><div><b>쓸 때마다 + 누르기</b><br><span class="small muted">오늘 한도를 지키면 다음 날 굴비가 들어와요.</span></div></li>
    </ol>
    ${installPrompt ? '<button class="btn gold block" data-act="install" type="button">앱으로 설치하기</button><div style="height:8px"></div>' : ''}
    <button class="btn primary block" data-act="start-plan" type="button">내 월 계획 입력하기</button>
    <div style="height:8px"></div>
    <button class="btn ghost block" data-act="import" type="button">백업 파일로 시작하기</button>
  </div>`;
}

function renderHome(t, s, rw) {
  const mood = moodOf(t, s);
  const live = C.alive(state.entries);
  const todayNospend = live.some(e => e.type === 'nospend' && e.date === t);
  const left = s.todayLeft;
  const pct = s.todayLimit > 0 ? Math.min(100, Math.round(s.todaySpent / s.todayLimit * 100)) : (s.todaySpent ? 100 : 0);
  const barCls = left < 0 ? 'over' : pct <= 70 ? 'good' : '';
  const backupBase = state.settings.lastBackupAt || state.settings.onboardedAt;
  const needBackup = live.length >= 5 && !!backupBase && Date.now() - Date.parse(backupBase) > 7 * 864e5;
  const investPct = s.investLimit ? Math.round(s.investTotal / s.investLimit * 100) : 0;
  const fixedDone = s.fixedItems.filter(i => i.done).length;

  $('#view-home').innerHTML = `
  ${s.budget === 0 ? `<div class="banner"><span>생활비 항목을 설정하면 오늘의 한도가 보여요</span><button class="link" data-go="settings" type="button">설정</button></div>` : ''}
  ${needBackup ? `<div class="banner"><span>일주일 넘게 백업을 안 했어요. 폰을 바꾸면 기록이 사라질 수 있어요.</span><button class="link" data-act="export" type="button">백업</button></div>` : ''}
  <div class="card hero">
    <div class="hero-ceiling"></div>
    <div class="hero-row">
      <div class="mascot ${mood}">${mascot(mood, { happy: '웃는 굴비', worried: '땀 흘리는 굴비', bitten: '한 입 뜯긴 굴비', sleepy: '자는 굴비' }[mood])}</div>
      <div class="bubble">${esc(lineFor(mood, t))}</div>
    </div>
    <p class="limit-label">오늘 더 쓸 수 있는 돈</p>
    <p class="limit num ${left < 0 ? 'over' : ''}">${left >= 0 ? won(left) : `${won(-left)} 초과`}</p>
    <div class="bar ${barCls}"><span style="width:${pct}%"></span></div>
    <div class="bar-legend num"><span>오늘 쓴 돈 ${won(s.todaySpent)}</span><span>오늘 한도 ${won(s.todayLimit)}</span></div>
    ${s.todaySpent === 0 && s.budget > 0 ? (todayNospend
      ? `<p class="small" style="margin:12px 0 0"><span class="chip">무지출 데이 도전 중</span> 자정이 지나면 굴비 2마리가 들어와요</p>`
      : `<div style="margin-top:14px"><button class="btn gold block" data-act="nospend" type="button">오늘은 무지출! (굴비 2마리 도전)</button></div>`) : ''}
  </div>

  <div class="stats">
    <div class="stat ${s.remaining < 0 ? 'alert' : ''}"><span>생활비 남음</span><b class="num">${won(s.remaining)}</b><span class="num">/ ${won(s.budget)}</span></div>
    <button class="stat" style="border:0;text-align:left" data-act="show-trips" type="button"><span>받을 출장비</span><b class="num">${won(s.receivable)}</b><span>${s.receivable ? '정산 대기' : '없음'}</span></button>
    <div class="stat ${s.free !== null && s.free < 0 ? 'alert' : ''}"><span>이번 달 여유</span><b class="num">${s.free === null ? '–' : won(s.free)}</b><span>${s.free === null ? '<button class="link small" data-go="settings" type="button">실수령액 입력</button>' : '실수령 기준'}</span></div>
  </div>

  <div class="card">
    <h2>안정형 투자 <span class="chip ${s.extraInvest ? 'red' : 'green'}">${s.extraInvest ? '계획 밖 투자 있음' : '안정형 유지 중'}</span></h2>
    <div class="meter num"><span>이번 달 ${won(s.investTotal)}</span><span class="muted">한도 ${won(s.investLimit)}</span></div>
    <div class="bar ${investPct > 100 ? 'over' : 'good'}"><span style="width:${Math.min(100, investPct)}%"></span></div>
    <p class="small muted" style="margin:8px 0 0">계획한 투자만 꾸준히. 추가 투자는 + 버튼의 ‘추가 투자’로 적으면 굴비가 한 번 말려요.</p>
  </div>

  <div class="card">
    <h2>${esc(periodLabel(s.period))} 고정 지출 <span class="chip ghost num">${fixedDone}/${s.fixedItems.length}</span></h2>
    ${s.fixedItems.length ? `<ul class="check-list">${s.fixedItems.map(i => `
      <li class="check-item ${i.done ? 'done' : ''}">
        <button class="check-btn ${i.done ? 'on' : ''}" data-act="toggle-fixed" data-id="${esc(i.id)}" type="button" aria-pressed="${i.done}" aria-label="${esc(i.name)} ${i.done ? '완료 취소' : '완료'}">${i.done ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>
        <div class="check-main">
          <div class="name"><span>${esc(i.name)}</span>${i.kind === 'invest' ? '<span class="chip green">안정형</span>' : i.kind === 'saving' ? '<span class="chip">저축</span>' : ''}</div>
          <div class="small muted">${i.payDay ? `매월 ${i.payDay}일` : '결제일 미정'}</div>
        </div>
        <b class="num">${won(i.done ? i.doneEntry.amount : i.amount)}</b>
      </li>`).join('')}</ul>` : '<p class="muted small">고정 지출 항목이 없어요.</p>'}
  </div>`;
}

function ledgerEntries(p) {
  const q = ui.query.trim().toLowerCase();
  return C.alive(state.entries)
    .filter(e => e.date >= p.start && e.date <= p.end)
    .filter(e => ui.filter === 'all' || e.type === ui.filter || (ui.filter === 'trip-open' && e.type === 'trip' && !e.settled))
    .filter(e => !q || [e.memo, e.category, C.TYPES[e.type], e.reason].some(v => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function renderLedger(t) {
  const sd = state.settings.monthStartDay;
  const p = C.shiftPeriod(C.periodOf(t, sd), ui.ledgerOffset, sd);
  const all = C.alive(state.entries).filter(e => e.date >= p.start && e.date <= p.end);
  const total = type => all.filter(e => e.type === type).reduce((s, e) => s + e.amount, 0);
  const filters = [['all', '전체'], ['expense', '지출'], ['income', '수입'], ['trip', '출장비'], ['trip-open', '정산 대기'], ['extra', '추가 지출'], ['invest', '추가 투자'], ['fixed', '고정']];

  $('#view-ledger').innerHTML = `
  <div class="period-nav">
    <button class="icon-btn" data-act="period" data-step="-1" type="button" aria-label="이전 달">‹</button>
    <b>${esc(periodLabel(p))}</b>
    <button class="icon-btn" data-act="period" data-step="1" type="button" aria-label="다음 달" ${ui.ledgerOffset >= 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card summary-grid num">
    <div><span class="muted">생활비 지출</span><b>${won(total('expense'))}</b></div>
    <div><span class="muted">수입</span><b>${won(total('income'))}</b></div>
    <div><span class="muted">추가 지출</span><b>${won(total('extra'))}</b></div>
    <div><span class="muted">추가 투자</span><b>${won(total('invest'))}</b></div>
    <div><span class="muted">출장비</span><b>${won(total('trip'))}</b></div>
    <div><span class="muted">고정 완료</span><b>${won(total('fixed'))}</b></div>
  </div>
  <input class="search" id="ledger-search" type="search" placeholder="메모·분류·#태그 검색" value="${esc(ui.query)}" aria-label="장부 검색">
  <div class="filters" role="group" aria-label="유형 필터">${filters.map(([k, l]) => `<button class="filter" data-act="filter" data-k="${k}" aria-pressed="${ui.filter === k}" type="button">${l}</button>`).join('')}</div>
  <div id="ledger-list"></div>`;

  renderLedgerList(p);
  // 검색은 목록만 다시 그린다: 입력창을 다시 만들면 한글 조합이 끊긴다
  $('#ledger-search').addEventListener('input', e => { ui.query = e.target.value; renderLedgerList(p); });
}

function renderLedgerList(p) {
  const list = ledgerEntries(p);
  const groups = new Map();
  list.forEach(e => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
  $('#ledger-list').innerHTML = list.length ? [...groups].map(([d, items]) => {
    const daySpent = items.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    return `<div class="day-group"><div class="day-head"><span>${fmtDate(d)}</span><span class="num">${daySpent ? `생활비 ${won(daySpent)}` : ''}</span></div>${items.map(entryRow).join('')}</div>`;
  }).join('') : `<div class="empty">${ui.query || ui.filter !== 'all' ? '조건에 맞는 기록이 없어요' : '아직 기록이 없어요.<br>+ 버튼으로 첫 줄을 적어보세요'}</div>`;
}

function entryRow(e) {
  const plus = e.type === 'income';
  const badge = e.type === 'trip' ? (e.settled ? '<span class="chip green">정산 완료</span>' : '<span class="chip">받을 돈</span>')
    : e.type === 'invest' ? `<span class="chip red">${C.isRiskyInvest(e.category, e.memo) ? '공격형 경고' : '경고 확인'}</span>`
    : e.type === 'extra' ? '<span class="chip ghost">계획 밖</span>' : '';
  const title = e.type === 'nospend' ? '무지출 데이' : (e.category || C.TYPES[e.type] || '고정 지출');
  const sub = [e.memo, e.type === 'invest' && e.reason ? `사유: ${e.reason}` : ''].filter(Boolean).join(' · ');
  return `<button class="entry" data-act="edit" data-id="${esc(e.id)}" type="button">
    <span class="entry-icon ${e.type}" aria-hidden="true">${ICON[e.type]}</span>
    <span class="entry-main"><span class="title">${esc(title)} ${badge}</span>${sub ? `<span class="memo">${esc(sub)}</span>` : ''}</span>
    <span class="entry-amt num ${plus ? 'plus' : ''}">${e.type === 'nospend' ? '0원' : `${plus ? '+' : '−'}${won(e.amount)}`}</span>
  </button>`;
}

function renderRewards(t, s, rw) {
  const lv = rw.level;
  const span = lv.next ? lv.next.min - lv.min : 1;
  const prog = lv.next ? Math.round((rw.total - lv.min) / span * 100) : 100;
  const byDate = new Map(rw.days.map(d => [d.date, d]));
  const cal = Array.from({ length: 28 }, (_, i) => C.addDays(t, i - 27));
  const wishes = state.rewards.filter(r => r.type === 'wish').sort((a, b) => (a.redeemedAt ? 1 : 0) - (b.redeemedAt ? 1 : 0) || a.cost - b.cost);

  $('#view-rewards').innerHTML = `
  <div class="card level-card">
    <div class="mascot happy">${mascot('happy', `${lv.name} 레벨 굴비`)}</div>
    <p class="level-name">${esc(lv.name)}</p>
    <p class="muted" style="margin:2px 0 12px">${esc(lv.line)}</p>
    <div class="bar"><span style="width:${prog}%"></span></div>
    <div class="bar-legend"><span class="num">총 굴비 ${rw.total}마리</span><span>${lv.next ? `${esc(lv.next.name)}까지 ${lv.toNext}마리` : '최고 레벨!'}</span></div>
  </div>

  <div class="reward-grid">
    <div class="stat"><span>쓸 수 있는 굴비</span><b class="num">${rw.available}마리</b></div>
    <div class="stat"><span>연속 달성</span><b class="num">${rw.streak}일</b><span class="num">최고 ${rw.maxStreak}일</span></div>
    <div class="stat"><span>굴비 저금통</span><b class="num">${won(rw.jar)}</b><span>지킨 달의 남은 생활비</span></div>
    <div class="stat"><span>굴비 내역</span><b class="num small">하루 ${rw.dailyFish} · 월 ${rw.bonus} · 참기 ${rw.restraint}</b></div>
  </div>

  <div class="card">
    <h2>최근 4주</h2>
    <div class="calendar">${cal.map(d => {
      const r = byDate.get(d);
      const cls = d === t ? 'today' : r?.status || '';
      const label = d === t ? '오늘' : { kept: '한도 지킴', nospend: '무지출', missed: '한도 초과', none: '기록 없음' }[r?.status] || '기록 전';
      return `<div class="cal-day ${cls}" title="${fmtDate(d)} ${label}" aria-label="${fmtDate(d)} ${label}">${C.parse(d).getDate()}</div>`;
    }).join('')}</div>
    <div class="legend"><span><i style="background:var(--gold-fill)"></i>무지출 +2</span><span><i style="background:var(--gold-soft)"></i>지킴 +1</span><span><i style="background:var(--red-soft)"></i>초과</span><span><i style="background:var(--surface-2)"></i>기록 없음</span></div>
  </div>

  <div class="card">
    <h2>뱃지 <span class="chip ghost num">${rw.badges.filter(b => b.got).length}/${rw.badges.length}</span></h2>
    <div class="badges">${rw.badges.map(b => `<div class="badge ${b.got ? 'got' : ''}"><div class="medal" aria-hidden="true">${b.got ? '★' : '?'}</div><b>${esc(b.name)}</b>${esc(b.desc)}</div>`).join('')}</div>
  </div>

  <div class="card">
    <h2>나에게 주는 상</h2>
    <p class="small muted" style="margin-top:-6px">모은 굴비로 스스로에게 상을 줘요. 예: 치킨 30마리, 새 운동화 100마리</p>
    ${wishes.map(w => {
      const p = Math.min(100, Math.round(rw.available / w.cost * 100));
      return `<div class="wish">
        <div class="wish-main"><b>${esc(w.name)}</b> <span class="muted small num">${w.cost}마리</span>
          ${w.redeemedAt ? `<div class="small muted">${fmtDate(w.redeemedAt.slice(0, 10))}에 받았어요</div>` : `<div class="bar ${p >= 100 ? 'good' : ''}"><span style="width:${p}%"></span></div>`}</div>
        ${w.redeemedAt ? '<span class="chip green">받음</span>'
          : `<button class="btn small ${rw.available >= w.cost ? 'gold' : ''}" data-act="redeem" data-id="${esc(w.id)}" type="button" ${rw.available >= w.cost ? '' : 'disabled'}>받기</button>
             <button class="del-btn" data-act="del-wish" data-id="${esc(w.id)}" type="button" aria-label="${esc(w.name)} 삭제">×</button>`}
      </div>`;
    }).join('')}
    <form class="btn-row" id="wish-form" style="margin-top:12px">
      <input class="input" id="wish-name" placeholder="받고 싶은 상" maxlength="20" required style="flex:2">
      <input class="input num" id="wish-cost" placeholder="굴비 수" inputmode="numeric" required style="flex:1">
      <button class="btn primary" type="submit" style="flex:none">추가</button>
    </form>
  </div>
  <p class="small muted">굴비는 기록을 바탕으로 매번 다시 계산돼요. 지난 기록을 고치면 굴비 수도 바뀔 수 있어요.</p>`;

  $('#wish-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = $('#wish-name').value.trim();
    const cost = Number(digits($('#wish-cost').value));
    if (!name || !cost || cost > 9999) { toast('상 이름과 1~9999 사이 굴비 수를 적어주세요'); return; }
    const w = { id: uid(), type: 'wish', name, cost, createdAt: new Date().toISOString(), redeemedAt: null };
    await DB.put('rewards', w);
    state.rewards.push(w);
    render();
  });
}

function renderSettings(t, s) {
  ui.planDraft ??= state.plan.length ? state.plan.map(i => ({ ...i })) : [{ id: uid(), name: '생활비', amount: 0, kind: 'living', payDay: null }];
  const draft = ui.planDraft;
  const trashCount = state.entries.filter(e => e.deletedAt).length;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  $('#view-settings').innerHTML = `
  <div class="card">
    <h2>월 계획 <span class="chip ghost">고정 지출 · 저축 · 투자 · 생활비</span></h2>
    <div id="plan-rows">${draft.map((i, idx) => `
      <div class="plan-row" data-idx="${idx}">
        <input class="input" data-f="name" value="${esc(i.name)}" placeholder="항목 이름" maxlength="20" aria-label="항목 이름">
        <input class="input num" data-f="amount" value="${fmtInput(i.amount)}" placeholder="금액" inputmode="numeric" aria-label="${esc(i.name)} 금액" style="text-align:right">
        <button class="del-btn" data-act="plan-del" data-idx="${idx}" type="button" aria-label="${esc(i.name)} 삭제">×</button>
        <div class="sub">
          <select class="input" data-f="kind" aria-label="종류">${Object.entries(C.KINDS).map(([k, l]) => `<option value="${k}" ${i.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input class="input num" data-f="payDay" value="${i.payDay ?? ''}" placeholder="결제일" inputmode="numeric" aria-label="결제일">
        </div>
      </div>`).join('')}</div>
    <button class="btn ghost block small" data-act="plan-add" type="button" style="margin:10px 0">+ 항목 추가</button>
    <div class="plan-total num"><span>월 합계</span><span id="plan-total">${won(draft.reduce((a, i) => a + (Number(i.amount) || 0), 0))}</span></div>
    <p class="form-error" id="plan-error"></p>
    <div class="btn-row">
      <button class="btn ghost" data-act="plan-reset" type="button">되돌리기</button>
      <button class="btn primary" data-act="plan-save" type="button">계획 저장</button>
    </div>
  </div>

  <div class="card">
    <h2>기준 설정</h2>
    <label class="field"><span>한 달 시작일 (월급날로 맞추면 편해요)</span>
      <select class="input" id="set-start">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${state.settings.monthStartDay === i + 1 ? 'selected' : ''}>매월 ${i + 1}일</option>`).join('')}</select></label>
    <label class="field"><span>월 실수령액 (여유 자금 계산용)</span>
      <input class="input num" id="set-salary" inputmode="numeric" value="${fmtInput(state.settings.salary || '')}" placeholder="예: 3,200,000"></label>
    <label class="field"><span>월 투자 한도 (비우면 계획한 투자 금액 ${won(s.investPlanned)})</span>
      <input class="input num" id="set-invest" inputmode="numeric" value="${fmtInput(state.settings.investLimit || '')}" placeholder="${fmtInput(s.investPlanned)}"></label>
  </div>

  <div class="card">
    <h2>내 데이터</h2>
    <div class="setting-row"><div><b>백업 내보내기</b><div class="small muted">${state.settings.lastBackupAt ? `마지막 백업 ${fmtDate(state.settings.lastBackupAt.slice(0, 10))}` : '아직 백업한 적 없어요'}</div></div><button class="btn small gold" data-act="export" type="button">내보내기</button></div>
    <div class="setting-row"><div><b>백업 불러오기</b><div class="small muted">지금 데이터가 백업 내용으로 바뀌어요</div></div><button class="btn small" data-act="import" type="button">불러오기</button></div>
    <div class="setting-row"><div><b>휴지통</b><div class="small muted">삭제한 기록 ${trashCount}건 · 30일 뒤 자동 삭제</div></div><button class="btn small" data-act="trash" type="button">열기</button></div>
    <div class="setting-row"><div><b>전체 초기화</b><div class="small muted">모든 계획·기록·굴비를 지워요</div></div><button class="btn small danger" data-act="reset" type="button">초기화</button></div>
  </div>

  ${standalone ? '' : `<div class="card"><h2>앱으로 설치</h2>
    <p class="small muted" style="margin-top:-4px">${isIOS ? '사파리 아래 공유 버튼 → ‘홈 화면에 추가’를 눌러주세요. 아이폰은 설치하지 않으면 7일 넘게 안 열 때 기록이 지워질 수 있어요.' : '설치하면 앱처럼 열리고 기록이 더 안전하게 남아요.'}</p>
    ${installPrompt ? '<button class="btn gold block" data-act="install" type="button">앱으로 설치하기</button>' : ''}</div>`}

  <div class="card">
    <details class="policy">
      <summary>데이터·운영 정책</summary>
      <ul>
        <li>모든 기록은 이 폰 안에만 저장돼요. 서버로 보내지 않고, 만든 사람도 볼 수 없어요.</li>
        <li>새로고침하거나 앱을 다시 열어도 기록은 그대로예요. 브라우저 데이터를 지우거나 폰을 바꾸면 사라지니 백업 파일을 보관하세요.</li>
        <li>삭제한 기록은 휴지통에 30일 보관 후 자동으로 영구 삭제돼요. 휴지통에서 복원할 수 있어요.</li>
        <li>영구 삭제와 전체 초기화는 되돌릴 수 없어요. 그래서 한 번 더 확인해요.</li>
        <li>금액은 1원 ~ 1억 원 정수, 메모는 100자까지 적을 수 있어요.</li>
        <li>출장비는 생활비에서 빼지 않고 ‘받을 돈’으로 따로 쌓여요. 정산 완료로 바꾸면 사라져요.</li>
        <li>추가 투자는 막지 않지만, 기록하기 전에 경고를 보여주고 사유를 남겨요. 코인·레버리지 같은 공격형 신호는 더 강하게 경고해요.</li>
        <li>굴비는 기록이 있는 지난 날만 계산해요. 한도 지킴 1마리, 무지출 2마리, 생활비를 지킨 달 10마리, 추가 투자를 참으면 하루 1마리.</li>
      </ul>
    </details>
  </div>
  <p class="small muted" style="text-align:center">굴비 가계부 v${APP_VERSION}</p>`;

  const rows = $('#plan-rows');
  rows.addEventListener('input', e => {
    const row = e.target.closest('.plan-row');
    if (!row) return;
    const item = draft[Number(row.dataset.idx)];
    const f = e.target.dataset.f;
    if (f === 'amount') { e.target.value = fmtInput(e.target.value); item.amount = Number(digits(e.target.value)) || 0; }
    else if (f === 'payDay') { e.target.value = digits(e.target.value).slice(0, 2); item.payDay = Number(e.target.value) || null; }
    else item[f] = e.target.value;
    $('#plan-total').textContent = won(draft.reduce((a, i) => a + (Number(i.amount) || 0), 0));
  });
  rows.addEventListener('change', e => { if (e.target.dataset.f === 'kind') draft[Number(e.target.closest('.plan-row').dataset.idx)].kind = e.target.value; });

  $('#set-start').addEventListener('change', async e => { await setSetting('monthStartDay', Number(e.target.value)); toast('한 달 시작일을 바꿨어요'); });
  for (const [id, key] of [['#set-salary', 'salary'], ['#set-invest', 'investLimit']]) {
    const el = $(id);
    el.addEventListener('input', () => { el.value = fmtInput(el.value); });
    el.addEventListener('change', async () => { await setSetting(key, Number(digits(el.value)) || 0); toast('저장했어요'); });
  }
}

/* ---------- 액션 ---------- */

async function onAction(ev) {
  const goBtn = ev.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }
  const el = ev.target.closest('[data-act]');
  if (!el || el.closest('dialog')) return;
  const { act, id } = el.dataset;
  const t = C.today();

  switch (act) {
    case 'start-plan': go('settings'); break;
    case 'install': installPrompt?.prompt(); installPrompt = null; break;
    case 'nospend':
      await saveEntry({ id: uid(), type: 'nospend', amount: 0, date: t, category: '무지출', memo: '', createdAt: new Date().toISOString() });
      render(); toast('무지출 데이 도전! 자정까지 버텨봐요'); break;
    case 'toggle-fixed': {
      const s = C.summarize(state, t);
      const item = s.fixedItems.find(i => i.id === id);
      if (!item) break;
      if (item.done) { await trashEntry(item.doneEntry); break; }
      const date = item.payDay ? clampToPeriod(item.payDay, s.period) : t;
      await saveEntry({ id: uid(), type: 'fixed', planId: item.id, amount: item.amount, date, category: item.name, memo: '', createdAt: new Date().toISOString() });
      render(); toast(`${item.name} 완료! 계획대로 착착`); break;
    }
    case 'show-trips': ui.filter = 'trip-open'; ui.ledgerOffset = 0; go('ledger'); break;
    case 'period': ui.ledgerOffset = Math.min(0, ui.ledgerOffset + Number(el.dataset.step)); render(); break;
    case 'filter': ui.filter = el.dataset.k; render(); break;
    case 'edit': { const e = state.entries.find(x => x.id === id); if (e) openSheet(e); break; }
    case 'redeem': {
      const w = state.rewards.find(r => r.id === id);
      if (!w || !(await confirmModal({ title: `${w.name}, 받을까요?`, body: `굴비 ${w.cost}마리를 써요. 받은 상은 되돌릴 수 없어요.`, ok: '상 받기' }))) break;
      w.redeemedAt = new Date().toISOString();
      await DB.put('rewards', w); render(); toast(`축하해요! ${w.name} 획득`); break;
    }
    case 'del-wish': {
      const w = state.rewards.find(r => r.id === id);
      if (!w || !(await confirmModal({ title: '상을 지울까요?', body: `‘${w.name}’을(를) 목록에서 지워요.`, ok: '지우기', danger: true }))) break;
      await DB.del('rewards', id); state.rewards = state.rewards.filter(r => r.id !== id); render(); break;
    }
    case 'plan-add': ui.planDraft.push({ id: uid(), name: '', amount: 0, kind: 'fixed', payDay: null }); renderSettings(t, C.summarize(state, t)); break;
    case 'plan-del': {
      const item = ui.planDraft[Number(el.dataset.idx)];
      if (item.name && !(await confirmModal({ title: `‘${item.name}’ 항목을 뺄까요?`, body: '계획 저장을 눌러야 반영돼요. 지난 기록은 그대로 남아요.', ok: '빼기', danger: true }))) break;
      ui.planDraft.splice(Number(el.dataset.idx), 1); renderSettings(t, C.summarize(state, t)); break;
    }
    case 'plan-reset': ui.planDraft = null; renderSettings(t, C.summarize(state, t)); break;
    case 'plan-save': await onPlanSave(); break;
    case 'export': await exportBackup(); break;
    case 'import': pickBackup(); break;
    case 'trash': openTrash(); break;
    case 'reset': await resetAll(); break;
  }
}

function clampToPeriod(payDay, p) {
  // 결제일을 이번 기간 안의 날짜로 맞춘다 (31일이 없는 달은 말일)
  for (let d = p.start; d <= p.end; d = C.addDays(d, 1)) {
    const dt = C.parse(d);
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    if (dt.getDate() === Math.min(payDay, last)) return d;
  }
  return C.today();
}

async function onPlanSave() {
  const draft = ui.planDraft.map(i => ({ ...i, name: (i.name || '').trim() }));
  const err = $('#plan-error');
  if (!draft.length) { err.textContent = '항목을 하나 이상 넣어주세요'; return; }
  if (draft.some(i => !i.name)) { err.textContent = '이름이 빈 항목이 있어요'; return; }
  if (draft.some(i => !Number.isInteger(i.amount) || i.amount < 0 || i.amount > C.AMOUNT_MAX)) { err.textContent = '금액은 0 ~ 1억 원으로 적어주세요'; return; }
  if (draft.some(i => i.payDay && (i.payDay < 1 || i.payDay > 31))) { err.textContent = '결제일은 1 ~ 31일이에요'; return; }
  if (!draft.some(i => i.kind === 'living')) {
    const ok = await confirmModal({ title: '생활비 항목이 없어요', body: '생활비(변동 예산) 항목이 있어야 오늘의 굴비 한도와 보상이 계산돼요. 그래도 저장할까요?', ok: '그래도 저장' });
    if (!ok) return;
  }
  const first = !state.plan.length;
  await savePlan(draft);
  ui.planDraft = null;
  toast('월 계획을 저장했어요');
  if (first) go('home'); else render();
}

/* ---------- 입력 시트 ---------- */

let sheet = null;

function openSheet(entry = null) {
  sheet = entry
    ? { ...entry, editing: true, original: entry }
    : { id: uid(), type: 'expense', amount: 0, date: C.today(), category: C.CATEGORIES.expense[0], memo: '', editing: false };
  renderSheet();
  const dlg = $('#entry-sheet');
  if (!dlg.open) dlg.showModal();
  if (!entry) setTimeout(() => $('#f-amount')?.focus(), 60);
}

function readSheet() {
  const a = $('#f-amount');
  if (a) sheet.amount = Number(digits(a.value)) || 0;
  if ($('#f-date')) sheet.date = $('#f-date').value;
  if ($('#f-memo')) sheet.memo = $('#f-memo').value;
  if ($('#f-settled')) sheet.settled = $('#f-settled').checked;
}

function renderSheet() {
  const dlg = $('#entry-sheet');
  const { type, editing } = sheet;
  const t = C.today();
  const s = C.summarize(state, t);
  const special = type === 'fixed' || type === 'nospend';
  const notices = {
    expense: `생활비에서 빠져요. 오늘 더 쓸 수 있는 돈 <b class="num">${won(Math.max(0, s.todayLeft))}</b>`,
    income: '수입은 이번 달 여유 자금에 더해져요.',
    trip: '회사에서 돌려받을 돈이에요. 생활비에서 빼지 않고 <b>받을 돈</b>에 쌓여요. 정산되면 기록을 눌러 ‘정산 완료’로 바꿔주세요.',
    extra: '경조사·병원비처럼 계획에 없던 지출이에요. 생활비 대신 이번 달 여유 자금에서 빠져요.',
    fixed: '월 계획의 고정 지출이에요. 이번 달만 금액이 달랐다면 고쳐주세요.',
    nospend: '오늘을 무지출 데이로 표시했어요. 지출을 적으면 일반 한도 판정으로 바뀌어요.',
  };
  const cats = C.CATEGORIES[type] || [];

  dlg.innerHTML = `
  <form id="entry-form" novalidate>
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2 id="entry-title">${editing ? '기록 고치기' : '빠른 입력'}</h2>
      <button class="icon-btn" data-sheet="close" type="button" aria-label="닫기">✕</button>
    </div>
    ${special ? `<p class="chip" style="margin:0 0 12px">${type === 'fixed' ? `고정 지출 · ${esc(sheet.category)}` : '무지출 데이'}</p>` : `
    <div class="seg" role="group" aria-label="입력 유형">${Object.entries(C.TYPES).map(([k, l]) => `<button type="button" data-sheet="type" data-k="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}</div>`}
    ${type === 'nospend' ? '' : `
    <div class="amount-wrap"><input class="amount-input num" id="f-amount" inputmode="numeric" autocomplete="off" placeholder="0" value="${fmtInput(sheet.amount || '')}" aria-label="금액"></div>
    <div class="quick">${[1000, 5000, 10000, 50000].map(v => `<button type="button" data-sheet="plus" data-v="${v}">+${v.toLocaleString('ko-KR')}</button>`).join('')}<button type="button" data-sheet="clear">지우기</button></div>`}
    <div class="notice ${type === 'invest' ? 'red' : ''}">${type === 'invest'
      ? '<b>계획 밖 추가 투자예요.</b> 계획한 투자(SP500 등)는 홈의 고정 지출 체크로 기록돼요. 저장하기 전에 굴비가 한 번 말립니다.'
      : notices[type]}</div>
    ${cats.length ? `<div class="cats" role="group" aria-label="분류">${cats.map(c => `<button type="button" class="${C.RISKY_CATEGORIES.includes(c) && type === 'invest' ? 'risky' : ''}" data-sheet="cat" data-k="${esc(c)}" aria-pressed="${sheet.category === c}">${esc(c)}</button>`).join('')}</div>` : ''}
    <label class="field"><span>날짜</span><input class="input" id="f-date" type="date" value="${esc(sheet.date)}" max="${C.addDays(t, 31)}"></label>
    ${type === 'nospend' ? '' : `<label class="field"><span>메모 (#태그 가능) <span id="memo-count" class="num">${(sheet.memo || '').length}/${C.MEMO_MAX}</span></span>
      <textarea class="input" id="f-memo" maxlength="${C.MEMO_MAX}" rows="2" placeholder="${type === 'trip' ? '예: 부산 출장 KTX #부산출장' : '예: 점심 김치찌개'}">${esc(sheet.memo)}</textarea></label>`}
    ${type === 'trip' && editing ? `<label class="check-line"><input type="checkbox" id="f-settled" ${sheet.settled ? 'checked' : ''} style="accent-color:var(--green)"> 회사에서 정산받았어요 (받을 돈에서 빠져요)</label>` : ''}
    ${type === 'invest' && sheet.reason ? `<p class="small muted">기록된 사유: ${esc(sheet.reason)}</p>` : ''}
    <p class="form-error" id="f-error" role="alert"></p>
    <div class="btn-row">
      ${editing ? '<button class="btn ghost" data-sheet="delete" type="button">삭제</button>' : ''}
      ${type === 'nospend' ? '' : `<button class="btn primary" type="submit">${editing ? '고친 내용 저장' : '기록하기'}</button>`}
    </div>
  </form>`;

  const amount = $('#f-amount');
  amount?.addEventListener('input', () => { amount.value = fmtInput(amount.value); });
  const memo = $('#f-memo');
  memo?.addEventListener('input', () => { $('#memo-count').textContent = `${memo.value.length}/${C.MEMO_MAX}`; });
  $('#entry-form').addEventListener('submit', e => { e.preventDefault(); submitSheet(); });
  dlg.onclick = onSheetClick;
}

async function onSheetClick(ev) {
  const dlg = $('#entry-sheet');
  if (ev.target === dlg) { dlg.close(); return; } // 바깥 영역 탭
  const b = ev.target.closest('[data-sheet]');
  if (!b) return;
  const act = b.dataset.sheet;
  readSheet();
  if (act === 'close') dlg.close();
  else if (act === 'type') { sheet.type = b.dataset.k; sheet.category = C.CATEGORIES[sheet.type][0]; renderSheet(); }
  else if (act === 'cat') { sheet.category = b.dataset.k; renderSheet(); }
  else if (act === 'plus') { sheet.amount = Math.min(C.AMOUNT_MAX, sheet.amount + Number(b.dataset.v)); $('#f-amount').value = fmtInput(sheet.amount); }
  else if (act === 'clear') { sheet.amount = 0; $('#f-amount').value = ''; }
  else if (act === 'delete') { dlg.close(); await trashEntry(sheet.original); }
}

async function submitSheet() {
  readSheet();
  const now = new Date().toISOString();
  const { editing, original } = sheet;
  const entry = {
    id: sheet.id, type: sheet.type, amount: sheet.amount, date: sheet.date,
    category: sheet.category, memo: (sheet.memo || '').trim(),
    createdAt: original?.createdAt || now, updatedAt: now, deletedAt: null,
  };
  if (sheet.planId) entry.planId = sheet.planId;
  if (entry.type === 'trip') entry.settled = !!sheet.settled;
  if (entry.type === 'invest') { entry.reason = sheet.reason || ''; entry.warnedAck = !!sheet.warnedAck; }

  const err = C.validateEntry({ ...entry, warnedAck: false });
  if (err) { $('#f-error').textContent = err; return; }

  // 추가 투자: 새로 적거나 금액을 늘릴 때마다 경고 단계를 거친다
  if (entry.type === 'invest' && (!editing || original.type !== 'invest' || entry.amount > original.amount)) {
    const extraBefore = editing && original.type === 'invest' ? original.amount : 0;
    const result = await investWarning(entry, extraBefore);
    if (result.action === 'cancel') return;
    if (result.action === 'restraint') { $('#entry-sheet').close(); await onRestraint(); return; }
    entry.reason = result.reason;
    entry.warnedAck = true;
    entry.risky = C.isRiskyInvest(entry.category, entry.memo);
  }

  const t = C.today();
  const before = C.summarize(state, t);
  await saveEntry(entry);
  $('#entry-sheet').close();
  render();
  const after = C.summarize(state, t);
  if (entry.type === 'expense' && entry.date === t && before.todayLeft >= 0 && after.todayLeft < 0) toast('앗, 굴비가 한 입 뜯겼어요! 내일 만회해요');
  else if (entry.type === 'trip' && !entry.settled) toast('받을 돈에 넣어뒀어요. 정산 잊지 마세요');
  else toast(editing ? '고쳤어요' : '기록했어요');
}

async function onRestraint() {
  const t = C.today();
  const already = state.rewards.some(r => r.type === 'restraint' && r.date === t);
  if (already) { toast('참았다! (참기 굴비는 하루 1마리까지)'); return; }
  const r = { id: uid(), type: 'restraint', date: t, createdAt: new Date().toISOString() };
  await DB.put('rewards', r);
  state.rewards.push(r);
  render();
  toast('참았다! 굴비 +1마리');
}

/* ---------- 안정형 투자 경고 ---------- */

function investWarning(entry, extraBefore) {
  const t = C.today();
  const s = C.summarize(state, t);
  const total = s.investTotal - extraBefore + entry.amount;
  const pct = s.investLimit ? Math.round(total / s.investLimit * 100) : 0;
  const risky = C.isRiskyInvest(entry.category, entry.memo);
  const signal = C.RISKY_CATEGORIES.includes(entry.category) ? entry.category : (entry.memo.match(C.RISKY_WORDS) || [])[0];
  const canReward = !state.rewards.some(r => r.type === 'restraint' && r.date === t);

  return new Promise(resolve => {
    const dlg = $('#modal');
    dlg.innerHTML = `
      <div class="mascot worried">${mascot('worried', '말리는 굴비')}</div>
      <h2>잠깐! 굴비가 말립니다</h2>
      <p style="margin:0">우리 원칙은 <b>안정형 투자만</b>이에요. 이 금액을 더하면 이번 달 투자는 <b class="num">${won(total)}</b>이 돼요.</p>
      <div class="meter num"><span class="muted">월 투자 한도 ${won(s.investLimit)}</span><b style="color:var(--red)">${pct}%</b></div>
      <div class="bar over"><span style="width:${Math.min(100, pct)}%"></span></div>
      ${risky ? `<div class="notice red" style="margin-top:12px"><b>공격형 신호: ${esc(signal)}</b><br>원금이 크게 줄 수 있는 투자예요. 하루만 더 생각해보는 건 어때요?</div>` : ''}
      <div class="modal-actions" id="w-first">
        <button class="btn gold block" data-w="restraint" type="button">참을게요${canReward ? ' (굴비 +1마리)' : ''}</button>
        <button class="btn ghost block" data-w="more" type="button">그래도 기록할래요</button>
      </div>
      <div id="w-proceed" hidden>
        <label class="field" style="margin-top:12px"><span>추가 투자 사유 (5자 이상, 기록에 남아요)</span>
          <textarea class="input" id="w-reason" maxlength="100" rows="2" placeholder="예: 보너스 일부를 지수 ETF에"></textarea></label>
        ${risky ? '<label class="check-line"><input type="checkbox" id="w-ack"> 원금 손실 가능성을 이해했고, 잃어도 생활에 지장 없는 돈이에요</label>' : ''}
        <div class="modal-actions">
          <button class="btn danger block" data-w="proceed" type="button" disabled>경고 확인하고 기록</button>
          <button class="btn ghost block" data-w="cancel" type="button">취소</button>
        </div>
      </div>`;
    let result = { action: 'cancel' };
    const check = () => {
      const ok = $('#w-reason').value.trim().length >= 5 && (!risky || $('#w-ack').checked);
      dlg.querySelector('[data-w="proceed"]').disabled = !ok;
    };
    dlg.onclick = e => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const w = b.dataset.w;
      if (w === 'more') { $('#w-first').hidden = true; $('#w-proceed').hidden = false; $('#w-reason').focus(); return; }
      if (w === 'restraint') result = { action: 'restraint' };
      if (w === 'proceed') result = { action: 'proceed', reason: $('#w-reason').value.trim() };
      dlg.close();
    };
    dlg.oninput = dlg.onchange = e => { if (e.target.id === 'w-reason' || e.target.id === 'w-ack') check(); };
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
  });
}

/* ---------- 모달 공통 ---------- */

function confirmModal({ title, body, ok = '확인', cancel = '취소', danger = false, requireText = '' }) {
  return new Promise(resolve => {
    const dlg = $('#modal');
    dlg.innerHTML = `
      <h2>${esc(title)}</h2>
      <p style="margin:0" class="muted">${esc(body)}</p>
      ${requireText ? `<label class="field" style="margin-top:12px"><span>확인을 위해 ‘${esc(requireText)}’를 입력하세요</span><input class="input" id="m-text" autocomplete="off"></label>` : ''}
      <div class="modal-actions">
        <button class="btn ${danger ? 'danger' : 'primary'} block" data-m="ok" type="button" ${requireText ? 'disabled' : ''}>${esc(ok)}</button>
        <button class="btn ghost block" data-m="cancel" type="button">${esc(cancel)}</button>
      </div>`;
    let result = false;
    dlg.onclick = e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      result = b.dataset.m === 'ok';
      dlg.close();
    };
    dlg.oninput = () => { if (requireText) dlg.querySelector('[data-m="ok"]').disabled = $('#m-text').value.trim() !== requireText; };
    dlg.onchange = null;
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
  });
}

function openTrash() {
  const dlg = $('#modal');
  const draw = () => {
    const items = state.entries.filter(e => e.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    dlg.innerHTML = `
      <h2>휴지통 <span class="chip ghost num">${items.length}건</span></h2>
      <p class="small muted" style="margin:0 0 10px">삭제 후 30일이 지나면 자동으로 영구 삭제돼요.</p>
      <div style="max-height:50dvh;overflow:auto">${items.length ? items.map(e => {
        const daysLeft = Math.max(0, C.TRASH_DAYS - Math.floor((Date.now() - Date.parse(e.deletedAt)) / 864e5));
        return `<div class="wish"><div class="wish-main"><b>${esc(e.category || C.TYPES[e.type])}</b> <span class="num">${won(e.amount)}</span>
          <div class="small muted">${fmtDate(e.date)} · ${daysLeft}일 뒤 삭제</div></div>
          <button class="btn small" data-t="restore" data-id="${esc(e.id)}" type="button">복원</button>
          <button class="del-btn" data-t="purge" data-id="${esc(e.id)}" type="button" aria-label="영구 삭제">×</button></div>`;
      }).join('') : '<div class="empty">휴지통이 비어 있어요</div>'}</div>
      <div class="modal-actions">
        ${items.length ? '<button class="btn danger block" data-t="empty" type="button">휴지통 비우기</button>' : ''}
        <button class="btn ghost block" data-t="close" type="button">닫기</button>
      </div>`;
  };
  dlg.onclick = async e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const { t: act, id } = b.dataset;
    if (act === 'close') { dlg.close(); render(); return; }
    if (act === 'restore') {
      const entry = state.entries.find(x => x.id === id);
      await saveEntry({ ...entry, deletedAt: null }); draw(); toast('복원했어요'); return;
    }
    // 영구 삭제는 되돌릴 수 없으므로 한 번 더 묻는다 (네이티브 확인창: 열린 모달 위에서 동작)
    if (act === 'purge') {
      if (!confirm('이 기록을 영구 삭제할까요? 되돌릴 수 없어요.')) return;
      await DB.del('entries', id); state.entries = state.entries.filter(x => x.id !== id); draw(); return;
    }
    if (act === 'empty') {
      const ids = state.entries.filter(x => x.deletedAt).map(x => x.id);
      if (!confirm(`휴지통의 ${ids.length}건을 영구 삭제할까요? 되돌릴 수 없어요.`)) return;
      for (const i of ids) await DB.del('entries', i);
      state.entries = state.entries.filter(x => !x.deletedAt); draw();
    }
  };
  dlg.oninput = dlg.onchange = null;
  draw();
  dlg.showModal();
}

async function resetAll() {
  const ok = await confirmModal({
    title: '정말 전부 지울까요?', body: '월 계획, 모든 기록, 굴비와 상이 지워지고 되돌릴 수 없어요. 먼저 백업을 내보내 두는 걸 추천해요.',
    ok: '전부 지우기', danger: true, requireText: '굴비',
  });
  if (!ok) return;
  await DB.replaceAll({});
  state = withDefaults({ plan: [], entries: [], rewards: [], settings: {} });
  ui.planDraft = null;
  go('onboarding');
  toast('모두 지웠어요. 새로 시작해요');
}

/* ---------- 백업 ---------- */

async function exportBackup() {
  const data = JSON.stringify(DB.toBackup(state), null, 2);
  const name = `gulbi-backup-${C.today().replaceAll('-', '')}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '굴비 가계부 백업' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('백업 파일을 만들지 못했어요');
    return;
  }
  await setSetting('lastBackupAt', new Date().toISOString());
  render();
  toast('백업 파일을 저장했어요. 카톡 나에게 보내기나 클라우드에 보관하세요');
}

function pickBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data;
    try { data = DB.parseBackup(await file.text()); } catch (err) { toast(err.message); return; }
    const ok = await confirmModal({
      title: '백업을 불러올까요?',
      body: `${data.exportedAt ? `${fmtDate(data.exportedAt.slice(0, 10))}에 만든 ` : ''}백업(기록 ${data.entries.length}건)으로 지금 데이터가 모두 바뀌어요.`,
      ok: '불러오기',
    });
    if (!ok) return;
    // 불러온 백업 자체가 그 시점의 백업이므로 마지막 백업 시각으로 기록한다
    await DB.replaceAll({ ...data, settings: { ...data.settings, lastBackupAt: data.exportedAt || new Date().toISOString() } });
    state = withDefaults(await DB.loadAll());
    ui.planDraft = null;
    go(state.plan.length ? 'home' : 'onboarding');
    toast('백업을 불러왔어요');
  };
  input.click();
}

/* ---------- 토스트 ---------- */

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2800);
}

init();
