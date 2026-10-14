import * as C from './calc.js';
import * as DB from './db.js';
import { mascot, lineFor } from './mascot.js';

const APP_VERSION = '1.3.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const won = C.won;
const digits = v => String(v ?? '').replace(/\D/g, '').slice(0, 9);
const fmtInput = v => (digits(v) ? Number(digits(v)).toLocaleString('ko-KR') : '');
const WEEK = '일월화수목금토';
const fmtDate = s => { const d = C.parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const md = s => { const d = C.parse(s); return `${d.getMonth() + 1}.${d.getDate()}`; };

const DEFAULT_SETTINGS = { monthStartDay: 1, monthlyIncome: 0, theme: 'light', investLimit: 0, onboardedAt: null, lastBackupAt: null, persistAsked: false, tipDismissed: false };
const VIEWS = ['onboarding', 'home', 'ledger', 'rewards', 'settings'];

let state = { plan: [], entries: [], rewards: [], settings: { ...DEFAULT_SETTINGS } };
const ui = { tab: 'home', ledgerView: 'list', ledgerOffset: 0, filter: 'all', query: '', planDraft: null, day: null, statMode: 'out' };
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
  applyTheme();
  bindChrome();
  await handleSetupLink();
  go(state.plan.length ? 'home' : 'onboarding');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function applyTheme() {
  const t = state.settings.theme;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('gulbi-theme', t); } catch {}
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#meta-theme').content = dark ? '#17171a' : '#f7f6f2';
}

function bindChrome() {
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  $('#fab').addEventListener('click', () => openSheet());
  document.addEventListener('click', onAction);
  document.addEventListener('keydown', onKeypadKey);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('설치됐어요! 홈 화면의 굴비를 눌러 열어주세요'); render(); });
}

function go(tab) {
  ui.tab = tab;
  if (tab === 'settings') ui.planDraft = null;
  render();
  $('main').scrollTo(0, 0);
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

function encodeSetup() {
  const data = { plan: state.plan.map(({ name, amount, kind, payDay }) => ({ name, amount, kind, payDay })), settings: { monthStartDay: state.settings.monthStartDay } };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#setup=${b64}`;
}

const setupCodeOf = text => (String(text).trim().match(/#setup=([\w\-+/=]+)/) || String(text).trim().match(/^([\w\-+/=]{20,})$/) || [])[1];

async function handleSetupLink() {
  const m = location.hash.match(/^#setup=([\w\-+/=]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  await applySetup(m[1]);
}

async function applySetup(code) {
  let data;
  try { data = decodeSetup(code); } catch { toast('설정 링크가 올바르지 않아요'); return false; }
  if (state.plan.length) {
    const ok = await confirmModal({ title: '계획을 바꿀까요?', body: '설정 링크에 담긴 월 계획으로 지금 계획을 바꿔요. 지금까지의 기록은 그대로 남아요.', ok: '계획 바꾸기' });
    if (!ok) return false;
  }
  await savePlan(data.plan);
  await setSetting('monthlyIncome', data.plan.reduce((a, i) => a + i.amount, 0));
  const sd = Number(data.settings.monthStartDay);
  if (sd >= 1 && sd <= 28) await setSetting('monthStartDay', sd);
  toast('월 계획을 불러왔어요. 반가워요!');
  return true;
}

/* ---------- 저장 ---------- */

async function setSetting(key, value) {
  state.settings[key] = value;
  await DB.saveSetting(key, value);
}

async function savePlan(list) {
  // IndexedDB는 id 순으로 돌려주므로 화면 순서를 order로 저장한다
  const items = list.map((i, order) => ({ ...i, order }));
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
    ? `<button class="chip" data-go="rewards" type="button">🐟 ${esc(rw.level.name)} · ${rw.available}마리</button>` : '';
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
    <p class="muted">천장의 굴비를 쳐다보며 아끼던 자린고비처럼.<br>계획만큼만 쓰면 굴비가 쌓여요.</p>
    <ol class="steps card">
      <li><div><b>홈 화면에 추가하기</b><br><span class="small muted">${isIOS ? '사파리 아래 공유 버튼 → ‘홈 화면에 추가’' : '브라우저 메뉴 → ‘앱 설치’ 또는 ‘홈 화면에 추가’'}. 설치해야 기록이 오래 안전하게 남아요.</span></div></li>
      <li><div><b>한 달 수입과 계획 적기</b><br><span class="small muted">한 달에 얼마 들어오는지 적고, 보험료·적금·투자 같은 정해진 돈을 빼면 남는 돈이 생활비예요.</span></div></li>
      <li><div><b>쓸 때마다 + 기록</b><br><span class="small muted">쓴 돈을 적으면 오늘 써도 되는 생활비가 바로 계산돼요.</span></div></li>
    </ol>
    ${isStandalone() ? '' : '<button class="btn gold block" data-act="install" type="button">📲 앱으로 설치하기</button><div style="height:8px"></div>'}
    <button class="btn primary block" data-act="paste-setup" type="button">🔗 받은 설정 링크 붙여넣기</button>
    <div style="height:8px"></div>
    <button class="btn ghost block" data-act="start-plan" type="button">한 달 수입·계획 적기</button>
    <div style="height:8px"></div>
    <button class="btn ghost block" data-act="import" type="button">백업 파일로 시작하기</button>
  </div>`;
}

function renderHome(t, s) {
  const mood = moodOf(t, s);
  const live = C.alive(state.entries);
  const todayNospend = live.some(e => e.type === 'nospend' && e.date === t);
  const left = s.todayLeft;
  const pct = s.todayLimit > 0 ? Math.min(100, Math.round(s.todaySpent / s.todayLimit * 100)) : (s.todaySpent ? 100 : 0);
  const barCls = left < 0 ? 'over' : pct <= 70 ? 'good' : '';
  const backupBase = state.settings.lastBackupAt || state.settings.onboardedAt;
  const needBackup = live.length >= 5 && !!backupBase && Date.now() - Date.parse(backupBase) > 7 * 864e5;
  const fixedDone = s.fixedItems.filter(i => i.done).length;
  const livingPct = s.budget ? Math.max(0, Math.min(100, Math.round(s.remaining / s.budget * 100))) : 0;

  $('#view-home').innerHTML = `
  ${state.settings.tipDismissed ? '' : `
  <div class="card tip">
    <h2>이렇게 써요 <button class="link small" data-act="dismiss-tip" type="button">알겠어요</button></h2>
    <ol>
      <li>돈을 쓰거나 받으면 아래 <b>+ 기록</b>을 눌러요</li>
      <li><b>수입 · 지출</b> 중 하나 고르고 금액만 누르면 끝</li>
      <li>맨 위 숫자가 <b>오늘 써도 되는 돈</b>이에요. 지키면 다음 날 굴비가 와요</li>
    </ol>
  </div>`}
  ${s.budget === 0 ? `<div class="banner"><span>설정에서 생활비를 적으면 오늘 써도 되는 돈이 보여요</span><button class="link" data-go="settings" type="button">설정</button></div>` : ''}
  ${needBackup ? `<div class="banner"><span>일주일 넘게 백업을 안 했어요. 폰을 바꾸면 기록이 사라질 수 있어요.</span><button class="link" data-act="export" type="button">백업</button></div>` : ''}

  <div class="card hero">
    <div class="hero-ceiling"></div>
    <div class="hero-row">
      <div class="mascot ${mood}">${mascot(mood, { happy: '웃는 굴비', worried: '땀 흘리는 굴비', bitten: '울먹이는 굴비', sleepy: '자는 굴비' }[mood])}</div>
      <div class="bubble">${esc(lineFor(mood, t))}</div>
    </div>
    <p class="limit-label">오늘 써도 되는 돈</p>
    <p class="limit num ${left < 0 ? 'over' : ''}">${left >= 0 ? won(left) : `${won(-left)} 넘었어요`}</p>
    <div class="bar ${barCls}"><span style="width:${pct}%"></span></div>
    <div class="bar-legend num"><span>오늘 쓴 돈 ${won(s.todaySpent)}</span><span>하루 한도 ${won(s.todayLimit)}</span></div>
    ${s.todaySpent === 0 && s.budget > 0 ? (todayNospend
      ? `<p class="small" style="margin:12px 0 0"><span class="chip">✨ 무지출 도전 중</span> 자정이 지나면 굴비 2마리!</p>`
      : `<div style="margin-top:14px"><button class="btn gold block" data-act="nospend" type="button">✨ 오늘은 한 푼도 안 썼어요</button></div>`) : ''}
  </div>

  <div class="card">
    <h2>${esc(periodLabel(s.period))} 돈 흐름</h2>
    <div class="receipt num">
      <div><span>💰 들어온 돈</span><b class="plus">+${won(s.inflow)}</b></div>
      <div><span>💸 나간 돈</span><b class="minus-c">−${won(s.outflow)}</b></div>
      <div class="total"><span>남은 돈</span><b class="${s.left < 0 ? 'minus' : ''}">${won(s.left)}</b></div>
    </div>
    ${s.salaryIn ? '' : '<button class="btn gold block" data-act="add-salary" type="button" style="margin-top:14px">💰 이번 달 월급 적기</button>'}
    <div class="living">
      <div class="living-head"><span>생활비</span><span class="num"><b>${won(s.remaining)}</b> <span class="muted">남음 / ${won(s.budget)}</span></span></div>
      <div class="bar ${s.remaining < 0 ? 'over' : 'good'}"><span style="width:${livingPct}%"></span></div>
    </div>
    ${s.receivable ? `<button class="receivable" data-act="show-trips" type="button"><span>💼 회사에서 받을 출장비</span><b class="num">${won(s.receivable)} ›</b></button>` : ''}
  </div>

  <div class="card">
    <h2>자동이체 체크 <span class="chip ghost num">${fixedDone}/${s.fixedItems.length}</span></h2>
    <p class="small muted" style="margin:-6px 0 6px">통장에서 빠져나갔으면 동그라미를 눌러주세요</p>
    ${s.fixedItems.length ? `<ul class="check-list">${s.fixedItems.map(i => `
      <li class="check-item ${i.done ? 'done' : ''}">
        <button class="check-btn ${i.done ? 'on' : ''}" data-act="toggle-fixed" data-id="${esc(i.id)}" type="button" aria-pressed="${i.done}" aria-label="${esc(i.name)} ${i.done ? '체크 취소' : '빠져나감'}">${i.done ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>
        <div class="check-main">
          <div class="name"><span>${esc(i.name)}</span>${i.kind === 'invest' ? '<span class="chip green">안정형 투자</span>' : i.kind === 'saving' ? '<span class="chip">저축</span>' : ''}</div>
          ${i.payDay ? `<div class="small muted">매월 ${i.payDay}일</div>` : ''}
        </div>
        <b class="num">${won(i.done ? i.doneEntry.amount : i.amount)}</b>
      </li>`).join('')}</ul>` : '<p class="muted small">자동이체 항목이 없어요.</p>'}
  </div>

  ${s.extraInvest ? `
  <div class="card warn-card">
    <h2>📈 계획 밖 투자 <span class="chip red num">${won(s.extraInvest)}</span></h2>
    <p class="small" style="margin:0">이번 달 투자 ${won(s.investTotal)} · 한도 ${won(s.investLimit)}의 ${s.investLimit ? Math.round(s.investTotal / s.investLimit * 100) : 0}%. 안정형 원칙, 잊지 않았죠?</p>
  </div>` : ''}`;
}

function ledgerEntries(p) {
  const q = ui.query.trim().toLowerCase();
  return C.alive(state.entries)
    .filter(e => e.date >= p.start && e.date <= p.end)
    .filter(e => ui.filter === 'all' || e.type === ui.filter || (ui.filter === 'trip-open' && e.type === 'trip' && !e.settled))
    .filter(e => !q || [e.memo, e.category, e.investKind, C.TYPES[e.type], e.reason].some(v => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// 달력 칸에 들어가도록 큰 금액은 만 단위로 줄인다
const compact = n => (n < 10000 ? n.toLocaleString('ko-KR') : `${(Math.round(n / 1000) / 10).toLocaleString('ko-KR')}만`);
const OUT_TYPES = ['expense', 'extra', 'invest', 'fixed', 'trip'];
const isOut = e => OUT_TYPES.includes(e.type) && !(e.type === 'trip' && e.settled);

function renderLedger(t) {
  const sd = state.settings.monthStartDay;
  const p = C.shiftPeriod(C.periodOf(t, sd), ui.ledgerOffset, sd);
  const s = C.summarize(state, p.end < t ? p.end : t);
  const views = [['list', '내역'], ['calendar', '달력'], ['stats', '통계']];

  $('#view-ledger').innerHTML = `
  <div class="period-nav">
    <button class="icon-btn" data-act="period" data-step="-1" type="button" aria-label="이전 달">‹</button>
    <b>${esc(periodLabel(p))}</b>
    <button class="icon-btn" data-act="period" data-step="1" type="button" aria-label="다음 달" ${ui.ledgerOffset >= 0 ? 'disabled' : ''}>›</button>
  </div>
  <div class="subtabs" role="tablist">${views.map(([k, l]) => `<button type="button" role="tab" data-act="lview" data-k="${k}" aria-selected="${ui.ledgerView === k}">${l}</button>`).join('')}</div>
  <div class="card receipt num">
    <div><span>💰 들어온 돈</span><b class="plus">+${won(s.inflow)}</b></div>
    <div><span>💸 나간 돈</span><b class="minus-c">−${won(s.outflow)}</b></div>
    <div class="total"><span>남은 돈</span><b class="${s.left < 0 ? 'minus' : ''}">${won(s.left)}</b></div>
  </div>
  <div id="ledger-body"></div>`;

  ({ list: renderListView, calendar: renderCalendarView, stats: renderStatsView })[ui.ledgerView](p, t);
}

function renderListView(p) {
  const filters = [['all', '전체'], ['income', '수입'], ['expense', '지출'], ['fixed', '자동이체'], ['extra', '큰 지출'], ['trip', '출장비'], ['trip-open', '정산 대기'], ['invest', '투자']];
  $('#ledger-body').innerHTML = `
  <input class="search" id="ledger-search" type="search" placeholder="🔍 메모·항목·#태그 검색" value="${esc(ui.query)}" aria-label="내역 검색">
  <div class="filters" role="group" aria-label="종류 필터">${filters.map(([k, l]) => `<button class="filter" data-act="filter" data-k="${k}" aria-pressed="${ui.filter === k}" type="button">${l}</button>`).join('')}</div>
  <div id="ledger-list"></div>`;
  renderLedgerList(p);
  // 검색은 목록만 다시 그린다: 입력창을 다시 만들면 한글 조합이 끊긴다
  $('#ledger-search').addEventListener('input', e => { ui.query = e.target.value; renderLedgerList(p); });
}

function renderCalendarView(p, t) {
  const live = C.alive(state.entries).filter(e => e.date >= p.start && e.date <= p.end);
  const byDay = new Map();
  for (const e of live) {
    const d = byDay.get(e.date) || { inc: 0, out: 0, cats: new Map() };
    if (e.type === 'income') d.inc += e.amount;
    else if (isOut(e)) {
      d.out += e.amount;
      if (e.type !== 'fixed') d.cats.set(C.iconOf(e), (d.cats.get(C.iconOf(e)) || 0) + e.amount);
    }
    if (e.type === 'nospend') d.nospend = true;
    byDay.set(e.date, d);
  }
  const lead = C.parse(p.start).getDay();
  const days = [];
  for (let d = p.start; d <= p.end; d = C.addDays(d, 1)) days.push(d);
  if (!ui.day || ui.day < p.start || ui.day > p.end) ui.day = t >= p.start && t <= p.end ? t : p.start;
  const picked = live.filter(e => e.date === ui.day).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  $('#ledger-body').innerHTML = `
  <div class="card cal">
    <div class="cal-head">${[...WEEK].map((w, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
    <div class="cal-grid">
      ${'<span></span>'.repeat(lead)}
      ${days.map(d => {
        const v = byDay.get(d);
        const top = v ? [...v.cats].sort((a, b) => b[1] - a[1])[0]?.[0] : null;
        const dow = C.parse(d).getDay();
        return `<button type="button" class="cd ${d === ui.day ? 'sel' : ''} ${d === t ? 'today' : ''}" data-act="pick-day" data-d="${d}" aria-label="${fmtDate(d)}">
          <span class="n ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${C.parse(d).getDate()}</span>
          <span class="em" aria-hidden="true">${top || (v?.nospend ? '✨' : '')}</span>
          ${v?.inc ? `<span class="pi num">+${compact(v.inc)}</span>` : ''}
          ${v?.out ? `<span class="po num">-${compact(v.out)}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
  </div>
  <div class="day-head"><span>${fmtDate(ui.day)}</span><button class="link small" data-act="add-on-day" type="button">+ 이 날 기록</button></div>
  ${picked.length ? picked.map(entryRow).join('') : '<div class="empty">이 날은 기록이 없어요</div>'}`;
}

const PIE = ['#f5a623', '#2fbf8f', '#4c8df6', '#ef6b6b', '#a77bf3', '#f7c948', '#45c4d9', '#c9b79c'];

function renderStatsView(p) {
  const live = C.alive(state.entries).filter(e => e.date >= p.start && e.date <= p.end);
  const out = ui.statMode === 'out';
  const rows = new Map();
  for (const e of live) {
    if (out ? !isOut(e) : e.type !== 'income') continue;
    const name = e.type === 'fixed' ? '자동이체' : e.type === 'invest' ? '투자' : e.type === 'trip' ? '출장비' : e.category;
    const icon = e.type === 'fixed' ? '📌' : C.iconOf(e);
    const r = rows.get(name) || { name, icon, amount: 0 };
    r.amount += e.amount;
    rows.set(name, r);
  }
  const list = [...rows.values()].sort((a, b) => b.amount - a.amount);
  const total = list.reduce((a, r) => a + r.amount, 0);
  // 8개를 넘으면 나머지는 하나로 묶는다
  const shown = list.length > 8 ? [...list.slice(0, 7), { name: '그 밖', icon: '➕', amount: list.slice(7).reduce((a, r) => a + r.amount, 0) }] : list;

  let acc = 0;
  const R = 70, CX = 100, CY = 100, SW = 34;
  const arcs = total ? shown.map((r, i) => {
    const a0 = acc / total * Math.PI * 2, a1 = (acc += r.amount) / total * Math.PI * 2;
    if (shown.length === 1) return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${PIE[i]}" stroke-width="${SW}"><title>${esc(r.name)} ${won(r.amount)}</title></circle>`;
    const pt = a => `${(CX + R * Math.sin(a)).toFixed(2)} ${(CY - R * Math.cos(a)).toFixed(2)}`;
    return `<path d="M${pt(a0)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}" fill="none" stroke="${PIE[i]}" stroke-width="${SW}"><title>${esc(r.name)} ${won(r.amount)}</title></path>`;
  }).join('') : '';

  $('#ledger-body').innerHTML = `
  <div class="card">
    <h2>${out ? '어디에 썼을까?' : '어디서 들어왔을까?'}
      <span class="toggle2" role="group"><button type="button" data-act="stat-mode" data-k="in" aria-pressed="${!out}">수입</button><button type="button" data-act="stat-mode" data-k="out" aria-pressed="${out}">지출</button></span>
    </h2>
    ${total ? `
    <div class="donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="${out ? '지출' : '수입'} 항목별 비율">${arcs}</svg>
      <div class="donut-center"><span>${out ? '나간 돈' : '들어온 돈'}</span><b class="num">${won(total)}</b></div>
    </div>
    <ul class="stat-list">${shown.map((r, i) => `
      <li><span class="pct num" style="background:${PIE[i]}">${Math.round(r.amount / total * 100)}%</span><span class="nm">${r.icon} ${esc(r.name)}</span><b class="num ${out ? 'minus-c' : 'plus'}">${out ? '−' : '+'}${won(r.amount)}</b></li>`).join('')}</ul>`
    : `<div class="empty">이번 달 ${out ? '지출' : '수입'} 기록이 없어요</div>`}
  </div>`;
}

function renderLedgerList(p) {
  const list = ledgerEntries(p);
  const groups = new Map();
  list.forEach(e => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
  $('#ledger-list').innerHTML = list.length ? [...groups].map(([d, items]) => {
    const net = items.reduce((s, e) => s + (e.type === 'income' ? e.amount : e.type === 'nospend' || (e.type === 'trip' && e.settled) ? 0 : -e.amount), 0);
    return `<div class="day-group"><div class="day-head"><span>${fmtDate(d)}</span><span class="num">${net ? `${net > 0 ? '+' : '−'}${won(Math.abs(net))}` : ''}</span></div>${items.map(entryRow).join('')}</div>`;
  }).join('') : `<div class="empty">${ui.query || ui.filter !== 'all' ? '조건에 맞는 기록이 없어요' : '아직 기록이 없어요.<br>아래 <b>+ 기록</b>으로 첫 줄을 적어보세요'}</div>`;
}

function entryRow(e) {
  const plus = e.type === 'income';
  const badge = e.type === 'trip' ? (e.settled ? '<span class="chip green">돌려받음</span>' : '<span class="chip">받을 돈</span>')
    : e.type === 'invest' ? `<span class="chip red">${C.isRiskyInvest(e.investKind || e.category, e.memo) ? '공격형 경고' : '경고 확인'}</span>`
    : e.type === 'extra' ? '<span class="chip ghost">한도 밖</span>'
    : e.type === 'fixed' ? '<span class="chip ghost">자동이체</span>' : '';
  const title = e.type === 'nospend' ? '무지출 데이' : e.type === 'invest' ? `투자 · ${e.investKind || e.category}` : (e.category || C.TYPES[e.type]);
  const sub = [e.memo, e.type === 'invest' && e.reason ? `사유: ${e.reason}` : ''].filter(Boolean).join(' · ');
  return `<button class="entry" data-act="edit" data-id="${esc(e.id)}" type="button">
    <span class="entry-icon ${e.type}" aria-hidden="true">${C.iconOf(e)}</span>
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
    <div class="bar-legend"><span class="num">모은 굴비 ${rw.total}마리</span><span>${lv.next ? `${esc(lv.next.name)}까지 ${lv.toNext}마리` : '최고 레벨!'}</span></div>
  </div>

  <div class="card how">
    <h2>굴비 받는 법</h2>
    <ul>
      <li><span>✨ 하루 한 푼도 안 쓰기</span><b>+2마리</b></li>
      <li><span>🐟 하루 한도 지키기</span><b>+1마리</b></li>
      <li><span>🏆 한 달 생활비 지키기</span><b>+10마리</b></li>
      <li><span>🙅 추가 투자 참기</span><b>+1마리</b></li>
    </ul>
    <p class="small muted" style="margin:6px 0 0">그날 기록이 하나라도 있어야 하고, 다음 날 들어와요.</p>
  </div>

  <div class="reward-grid">
    <div class="stat"><span>쓸 수 있는 굴비</span><b class="num">${rw.available}마리</b></div>
    <div class="stat"><span>연속 성공</span><b class="num">${rw.streak}일</b><span class="num">최고 ${rw.maxStreak}일</span></div>
    <div class="stat"><span>굴비 저금통</span><b class="num">${won(rw.jar)}</b><span>지킨 달의 남은 생활비</span></div>
    <div class="stat"><span>뱃지</span><b class="num">${rw.badges.filter(b => b.got).length} / ${rw.badges.length}</b></div>
  </div>

  <div class="card">
    <h2>최근 4주</h2>
    <div class="calendar">${cal.map(d => {
      const r = byDate.get(d);
      const cls = d === t ? 'today' : r?.status || '';
      const label = d === t ? '오늘' : { kept: '한도 지킴', nospend: '무지출', missed: '한도 넘음', none: '기록 없음' }[r?.status] || '기록 전';
      return `<div class="cal-day ${cls}" title="${fmtDate(d)} ${label}" aria-label="${fmtDate(d)} ${label}">${C.parse(d).getDate()}</div>`;
    }).join('')}</div>
    <div class="legend"><span><i style="background:var(--gold-fill)"></i>무지출</span><span><i style="background:var(--gold-soft)"></i>지킴</span><span><i style="background:var(--red-soft)"></i>넘음</span><span><i style="background:var(--surface-2)"></i>기록 없음</span></div>
  </div>

  <div class="card">
    <h2>뱃지</h2>
    <div class="badges">${rw.badges.map(b => `<div class="badge ${b.got ? 'got' : ''}"><div class="medal" aria-hidden="true">${b.got ? '🏅' : '🔒'}</div><b>${esc(b.name)}</b>${esc(b.desc)}</div>`).join('')}</div>
  </div>

  <div class="card">
    <h2>나에게 주는 상 🎁</h2>
    <p class="small muted" style="margin-top:-6px">굴비를 모아 스스로에게 상을 줘요. 예: 치킨 30마리, 새 운동화 100마리</p>
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
  <p class="small muted">굴비는 기록을 바탕으로 매번 다시 세요. 지난 기록을 고치면 굴비 수도 바뀔 수 있어요.</p>`;

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
  ui.planDraft ??= {
    income: state.settings.monthlyIncome || state.plan.reduce((a, i) => a + i.amount, 0),
    items: state.plan.filter(i => i.kind !== 'living').map(i => ({ ...i })),
    livingId: state.plan.find(i => i.kind === 'living')?.id || uid(),
  };
  const draft = ui.planDraft;
  const itemsSum = () => draft.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const trashCount = state.entries.filter(e => e.deletedAt).length;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = isStandalone();

  $('#view-settings').innerHTML = `
  <div class="card">
    <h2>① 한 달 수입</h2>
    <p class="small muted" style="margin:-6px 0 8px">월급 등 한 달에 들어오는 돈을 합쳐서 적어요.</p>
    <input class="input num amount-big" id="plan-income" inputmode="numeric" value="${fmtInput(draft.income || '')}" placeholder="예: 3,000,000" aria-label="한 달 수입">
  </div>

  <div class="card">
    <h2>② 정해진 돈 빼기</h2>
    <p class="small muted" style="margin:-6px 0 4px">보험료, 적금, 투자처럼 매달 빠져나가는 돈을 적어요. 없으면 비워도 돼요.</p>
    <div id="plan-rows">${draft.items.map((i, idx) => `
      <div class="plan-row" data-idx="${idx}">
        <input class="input" data-f="name" value="${esc(i.name)}" placeholder="이름 (예: 보험료)" maxlength="20" aria-label="항목 이름">
        <input class="input num" data-f="amount" value="${fmtInput(i.amount)}" placeholder="금액" inputmode="numeric" aria-label="${esc(i.name)} 금액" style="text-align:right">
        <button class="del-btn" data-act="plan-del" data-idx="${idx}" type="button" aria-label="${esc(i.name)} 삭제">×</button>
        <div class="sub">
          <select class="input" data-f="kind" aria-label="종류">${Object.entries(C.KINDS).filter(([k]) => k !== 'living').map(([k, l]) => `<option value="${k}" ${i.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input class="input num" data-f="payDay" value="${i.payDay ?? ''}" placeholder="빠지는 날" inputmode="numeric" aria-label="자동이체 날짜">
        </div>
      </div>`).join('')}</div>
    <button class="btn ghost block small" data-act="plan-add" type="button" style="margin:10px 0">+ 항목 추가</button>
    <div class="plan-total num"><span>정해진 돈 합계</span><span id="plan-total"></span></div>
  </div>

  <div class="card plan-living">
    <h2>③ 남는 돈 = 한 달 생활비</h2>
    <p class="limit num" id="plan-living" style="margin:0"></p>
    <p class="small muted" id="plan-living-sub" style="margin:4px 0 0"></p>
    <p class="form-error" id="plan-error"></p>
    <div class="btn-row">
      <button class="btn ghost" data-act="plan-reset" type="button">되돌리기</button>
      <button class="btn primary" data-act="plan-save" type="button">계획 저장</button>
    </div>
  </div>

  <div class="card">
    <h2>화면 색</h2>
    <div class="seg3" role="group" aria-label="화면 색" style="margin:0">${[['light', '☀️ 밝게'], ['dark', '🌙 어둡게'], ['auto', '📱 기기 따라']].map(([k, l]) => `<button type="button" data-act="theme" data-k="${k}" aria-pressed="${state.settings.theme === k}">${l}</button>`).join('')}</div>
  </div>

  <div class="card">
    <h2>기준 설정</h2>
    <label class="field"><span>한 달 시작일 (월급날로 맞추면 편해요)</span>
      <select class="input" id="set-start">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${state.settings.monthStartDay === i + 1 ? 'selected' : ''}>매월 ${i + 1}일</option>`).join('')}</select></label>
    <label class="field"><span>한 달 투자 한도 (비우면 계획한 투자 ${won(s.investPlanned)})</span>
      <input class="input num" id="set-invest" inputmode="numeric" value="${fmtInput(state.settings.investLimit || '')}" placeholder="${fmtInput(s.investPlanned)}"></label>
    <button class="btn ghost block small" data-act="show-tip" type="button">사용법 다시 보기</button>
  </div>

  <div class="card">
    <h2>내 데이터</h2>
    <div class="setting-row"><div><b>백업 내보내기</b><div class="small muted">${state.settings.lastBackupAt ? `마지막 백업 ${fmtDate(state.settings.lastBackupAt.slice(0, 10))}` : '아직 백업한 적 없어요'}</div></div><button class="btn small gold" data-act="export" type="button">내보내기</button></div>
    <div class="setting-row"><div><b>백업 불러오기</b><div class="small muted">지금 데이터가 백업 내용으로 바뀌어요</div></div><button class="btn small" data-act="import" type="button">불러오기</button></div>
    <div class="setting-row"><div><b>계획 링크 복사</b><div class="small muted">다른 브라우저·설치한 앱·새 폰에 한 달 계획만 옮겨요</div></div><button class="btn small" data-act="copy-setup" type="button">복사</button></div>
    <div class="setting-row"><div><b>휴지통</b><div class="small muted">지운 기록 ${trashCount}건 · 30일 뒤 자동 삭제</div></div><button class="btn small" data-act="trash" type="button">열기</button></div>
    <div class="setting-row"><div><b>전체 초기화</b><div class="small muted">모든 계획·기록·굴비를 지워요</div></div><button class="btn small danger" data-act="reset" type="button">초기화</button></div>
  </div>

  ${standalone ? '' : `<div class="card"><h2>앱으로 설치</h2>
    <p class="small muted" style="margin-top:-4px">${isIOS ? '사파리 아래 공유 버튼 → ‘홈 화면에 추가’를 눌러주세요. 아이폰은 설치하지 않으면 7일 넘게 안 열 때 기록이 지워질 수 있어요.' : '설치하면 앱처럼 열리고 기록이 더 안전하게 남아요.'}</p>
    <button class="btn gold block" data-act="install" type="button">📲 앱으로 설치하기</button></div>`}

  <div class="card">
    <details class="policy">
      <summary>데이터·운영 정책</summary>
      <ul>
        <li>모든 기록은 이 폰 안에만 저장돼요. 서버로 보내지 않고, 만든 사람도 볼 수 없어요.</li>
        <li>새로고침하거나 앱을 다시 열어도 기록은 그대로예요. 브라우저 데이터를 지우거나 폰을 바꾸면 사라지니 백업 파일을 보관하세요.</li>
        <li>지운 기록은 휴지통에 30일 보관 후 자동으로 영구 삭제돼요. 휴지통에서 복원할 수 있어요.</li>
        <li>영구 삭제와 전체 초기화는 되돌릴 수 없어서 한 번 더 확인해요.</li>
        <li>금액은 1원 ~ 1억 원, 메모는 100자까지 적을 수 있어요.</li>
        <li>출장비는 생활비에서 빼지 않고 ‘받을 돈’으로 따로 쌓여요. 돌려받았다고 체크하면 사라져요.</li>
        <li>추가 투자는 막지 않지만, 기록하기 전에 경고를 보여주고 사유를 남겨요. 코인·레버리지 같은 공격형은 더 강하게 경고해요.</li>
        <li>굴비는 기록이 있는 지난 날만 세요. 한도 지킴 1마리, 무지출 2마리, 생활비를 지킨 달 10마리, 추가 투자를 참으면 하루 1마리.</li>
      </ul>
    </details>
  </div>
  <p class="small muted" style="text-align:center">굴비 가계부 v${APP_VERSION}</p>`;

  const rows = $('#plan-rows');
  rows.addEventListener('input', e => {
    const row = e.target.closest('.plan-row');
    if (!row) return;
    const item = draft.items[Number(row.dataset.idx)];
    const f = e.target.dataset.f;
    if (f === 'amount') { e.target.value = fmtInput(e.target.value); item.amount = Number(digits(e.target.value)) || 0; }
    else if (f === 'payDay') { e.target.value = digits(e.target.value).slice(0, 2); item.payDay = Number(e.target.value) || null; }
    else item[f] = e.target.value;
    refreshPlan();
  });
  const refreshPlan = () => {
    const left = draft.income - itemsSum();
    $('#plan-total').textContent = won(itemsSum());
    $('#plan-living').textContent = won(left);
    $('#plan-living').classList.toggle('over', left < 0);
    $('#plan-living-sub').textContent = left < 0 ? '정해진 돈이 수입보다 많아요' : draft.income ? `하루 약 ${won(Math.floor(left / 30))} 쓸 수 있어요` : '';
    $('#plan-error').textContent = '';
  };
  const incomeEl = $('#plan-income');
  incomeEl.addEventListener('input', () => { incomeEl.value = fmtInput(incomeEl.value); draft.income = Number(digits(incomeEl.value)) || 0; refreshPlan(); });
  refreshPlan();
  rows.addEventListener('change', e => { if (e.target.dataset.f === 'kind') draft.items[Number(e.target.closest('.plan-row').dataset.idx)].kind = e.target.value; });

  $('#set-start').addEventListener('change', async e => { await setSetting('monthStartDay', Number(e.target.value)); toast('한 달 시작일을 바꿨어요'); });
  const inv = $('#set-invest');
  inv.addEventListener('input', () => { inv.value = fmtInput(inv.value); });
  inv.addEventListener('change', async () => { await setSetting('investLimit', Number(digits(inv.value)) || 0); toast('저장했어요'); });
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
    case 'install': await installApp(); break;
    case 'paste-setup': await pasteSetup(); break;
    case 'copy-setup': await copySetup(); break;
    case 'theme': await setSetting('theme', el.dataset.k); applyTheme(); render(); break;
    case 'dismiss-tip': await setSetting('tipDismissed', true); render(); break;
    case 'show-tip': await setSetting('tipDismissed', false); go('home'); break;
    case 'add-salary': openSheet(null, 'income'); break;
    case 'nospend':
      await saveEntry({ id: uid(), type: 'nospend', amount: 0, date: t, category: '무지출', memo: '', createdAt: new Date().toISOString() });
      render(); toast('무지출 도전! 자정까지 버텨봐요'); break;
    case 'toggle-fixed': {
      const s = C.summarize(state, t);
      const item = s.fixedItems.find(i => i.id === id);
      if (!item) break;
      if (item.done) { await trashEntry(item.doneEntry); break; }
      const date = item.payDay ? clampToPeriod(item.payDay, s.period) : t;
      await saveEntry({ id: uid(), type: 'fixed', planId: item.id, amount: item.amount, date, category: item.name, memo: '', createdAt: new Date().toISOString() });
      render(); toast(`${item.name} 체크! 계획대로 착착`); break;
    }
    case 'show-trips': ui.filter = 'trip-open'; ui.ledgerView = 'list'; ui.ledgerOffset = 0; go('ledger'); break;
    case 'period': ui.ledgerOffset = Math.min(0, ui.ledgerOffset + Number(el.dataset.step)); render(); break;
    case 'filter': ui.filter = el.dataset.k; render(); break;
    case 'lview': ui.ledgerView = el.dataset.k; render(); break;
    case 'pick-day': ui.day = el.dataset.d; render(); break;
    case 'stat-mode': ui.statMode = el.dataset.k; render(); break;
    case 'add-on-day': openSheet(null, 'expense'); sheet.date = ui.day; renderSheet(); break;
    case 'edit': { const e = state.entries.find(x => x.id === id); if (e) openSheet(e); break; }
    case 'redeem': {
      const w = state.rewards.find(r => r.id === id);
      if (!w || !(await confirmModal({ title: `${w.name}, 받을까요?`, body: `굴비 ${w.cost}마리를 써요. 받은 상은 되돌릴 수 없어요.`, ok: '상 받기' }))) break;
      w.redeemedAt = new Date().toISOString();
      await DB.put('rewards', w); render(); toast(`축하해요! ${w.name} 획득 🎉`); break;
    }
    case 'del-wish': {
      const w = state.rewards.find(r => r.id === id);
      if (!w || !(await confirmModal({ title: '상을 지울까요?', body: `‘${w.name}’을(를) 목록에서 지워요.`, ok: '지우기', danger: true }))) break;
      await DB.del('rewards', id); state.rewards = state.rewards.filter(r => r.id !== id); render(); break;
    }
    case 'plan-add': ui.planDraft.items.push({ id: uid(), name: '', amount: 0, kind: 'fixed', payDay: null }); renderSettings(t, C.summarize(state, t)); break;
    case 'plan-del': {
      const item = ui.planDraft.items[Number(el.dataset.idx)];
      if (item.name && !(await confirmModal({ title: `‘${item.name}’ 항목을 뺄까요?`, body: '계획 저장을 눌러야 반영돼요. 지난 기록은 그대로 남아요.', ok: '빼기', danger: true }))) break;
      ui.planDraft.items.splice(Number(el.dataset.idx), 1); renderSettings(t, C.summarize(state, t)); break;
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
  // 빠지는 날을 이번 기간 안의 날짜로 맞춘다 (31일이 없는 달은 말일)
  for (let d = p.start; d <= p.end; d = C.addDays(d, 1)) {
    const dt = C.parse(d);
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    if (dt.getDate() === Math.min(payDay, last)) return d;
  }
  return C.today();
}

async function onPlanSave() {
  const d = ui.planDraft;
  const items = d.items.map(i => ({ ...i, name: (i.name || '').trim() }));
  const err = $('#plan-error');
  if (!(d.income > 0)) { err.textContent = '한 달 수입을 먼저 적어주세요'; return; }
  if (d.income > C.AMOUNT_MAX) { err.textContent = '수입은 1억 원까지 적을 수 있어요'; return; }
  if (items.some(i => !i.name)) { err.textContent = '이름이 빈 항목이 있어요'; return; }
  if (items.some(i => !Number.isInteger(i.amount) || i.amount < 0 || i.amount > C.AMOUNT_MAX)) { err.textContent = '금액은 0 ~ 1억 원으로 적어주세요'; return; }
  if (items.some(i => i.payDay && (i.payDay < 1 || i.payDay > 31))) { err.textContent = '빠지는 날은 1 ~ 31일이에요'; return; }
  const living = d.income - items.reduce((a, i) => a + i.amount, 0);
  if (living < 0) { err.textContent = '정해진 돈이 수입보다 많아요. 금액을 줄여주세요'; return; }
  if (living === 0) {
    const ok = await confirmModal({ title: '생활비가 0원이에요', body: '수입을 전부 정해진 돈으로 나눴어요. 그래도 저장할까요?', ok: '그래도 저장' });
    if (!ok) return;
  }
  const first = !state.plan.length;
  await setSetting('monthlyIncome', d.income);
  await savePlan([...items, { id: d.livingId, name: '생활비', amount: living, kind: 'living', payDay: null }]);
  ui.planDraft = null;
  toast('한 달 계획을 저장했어요');
  if (first) go('home'); else render();
}

/* ---------- 입력 시트: 수입 / 지출 + 계산기 키패드 ---------- */

let sheet = null;
const MODES = { income: '💵 수입', expense: '💸 지출' };

function modeOf(e) {
  return e.type === 'income' ? 'income' : 'expense';
}

function sheetCategoryOf(e) {
  if (e.type === 'invest') return '투자';
  if (e.type === 'trip') return '출장비';
  return e.category;
}

function openSheet(entry = null, mode = 'expense') {
  if (entry) {
    const locked = entry.type === 'fixed' || entry.type === 'nospend';
    sheet = {
      ...entry, editing: true, original: entry, locked,
      mode: locked ? null : modeOf(entry),
      category: locked ? entry.category : sheetCategoryOf(entry),
      investKind: entry.investKind || (entry.type === 'invest' ? entry.category : null),
      terms: [], cur: entry.amount ? String(entry.amount) : '',
    };
  } else {
    sheet = {
      id: uid(), editing: false, locked: false, mode,
      category: mode === 'expense' ? C.EXPENSE_CATS[0].k : C.INCOME_CATS[0].k,
      investKind: null, date: C.today(), memo: '', terms: [], cur: '',
    };
  }
  renderSheet();
  const dlg = $('#entry-sheet');
  if (!dlg.open) dlg.showModal();
}

const sheetTotal = () => sheet.terms.reduce((a, b) => a + b, 0) + (Number(sheet.cur) || 0);

function sheetType() {
  if (sheet.locked) return sheet.type;
  if (sheet.mode === 'expense') return C.typeOfExpenseCat(sheet.category);
  return 'income';
}

function readSheet() {
  if ($('#f-date')) sheet.date = $('#f-date').value;
  if ($('#f-memo')) sheet.memo = $('#f-memo').value;
  if ($('#f-settled')) sheet.settled = $('#f-settled').checked;
}

function updateAmount() {
  const total = sheetTotal();
  $('#k-val').textContent = won(total);
  $('#k-val').classList.toggle('zero', total === 0);
  const parts = [...sheet.terms, ...(sheet.cur ? [Number(sheet.cur)] : [])];
  $('#k-expr').textContent = parts.length > 1 ? parts.map(n => n.toLocaleString('ko-KR')).join(' + ') : '';
  $('#f-error').textContent = '';
}

function sheetHint(s) {
  if (sheet.locked) return sheet.type === 'fixed' ? '한 달 계획의 자동이체예요. 이번 달만 금액이 달랐다면 고쳐주세요.' : '무지출 데이로 표시한 날이에요.';
  if (sheet.mode === 'income') return sheet.category === C.SALARY_CAT ? '이번 달 월급을 적으면 들어온 돈·남은 돈이 계산돼요.' : '월급 말고 들어온 돈이에요. 남은 돈에 더해져요.';
  const cat = C.EXPENSE_CATS.find(c => c.k === sheet.category);
  return cat?.hint || `하루 한도에서 빠져요 · 오늘 남은 한도 <b class="num">${won(Math.max(0, s.todayLeft))}</b>`;
}

function renderSheet() {
  const dlg = $('#entry-sheet');
  const t = C.today();
  const s = C.summarize(state, t);
  const type = sheetType();
  const nospend = sheet.locked && sheet.type === 'nospend';
  const cats = sheet.mode === 'expense' ? C.EXPENSE_CATS : C.INCOME_CATS;
  const yesterday = C.addDays(t, -1);

  dlg.innerHTML = `
  <form id="entry-form" novalidate>
    <div class="grabber" aria-hidden="true"></div>
    <div class="sheet-head">
      <h2 id="entry-title">${sheet.editing ? '기록 고치기' : '기록하기'}</h2>
      <button class="icon-btn" data-sheet="close" type="button" aria-label="닫기">✕</button>
    </div>
    ${sheet.locked
      ? `<p class="chip" style="margin:0 0 10px">${sheet.type === 'fixed' ? `📌 자동이체 · ${esc(sheet.category)}` : '✨ 무지출 데이'}</p>`
      : `<div class="seg3" role="group" aria-label="무엇을 적을까요">${Object.entries(MODES).map(([k, l]) => `<button type="button" data-sheet="mode" data-k="${k}" aria-pressed="${sheet.mode === k}">${l}</button>`).join('')}</div>`}
    ${nospend ? '' : `
    <div class="amt" aria-live="polite"><div class="expr num" id="k-expr"></div><div class="amt-val num" id="k-val">0원</div></div>`}
    ${cats.length ? `<div class="cat-grid" role="group" aria-label="항목">${cats.map(c => `<button type="button" class="cat-tile ${c.type === 'invest' || c.type === 'extra' || c.type === 'trip' ? 'special' : ''}" data-sheet="cat" data-k="${esc(c.k)}" aria-pressed="${sheet.category === c.k}"><span class="ci" aria-hidden="true">${c.icon}</span><span>${esc(c.k)}</span></button>`).join('')}</div>` : ''}
    ${type === 'invest' ? `<div class="invest-kinds"><span class="small muted">어디에 투자해요?</span><div class="cats">${C.INVEST_KINDS.map(k => `<button type="button" class="${C.RISKY_CATEGORIES.includes(k) ? 'risky' : ''}" data-sheet="ikind" data-k="${esc(k)}" aria-pressed="${(sheet.investKind || '지수 ETF') === k}">${esc(k)}</button>`).join('')}</div></div>` : ''}
    <p class="hint ${type === 'invest' ? 'red' : ''}">${sheetHint(s)}</p>
    <div class="meta-row">
      <div class="date-chips">
        <button type="button" data-sheet="day" data-d="${t}" aria-pressed="${sheet.date === t}">오늘</button>
        <button type="button" data-sheet="day" data-d="${yesterday}" aria-pressed="${sheet.date === yesterday}">어제</button>
        <label class="date-pick ${sheet.date !== t && sheet.date !== yesterday ? 'on' : ''}"><span>${sheet.date !== t && sheet.date !== yesterday ? md(sheet.date) : '📅'}</span><input type="date" id="f-date" value="${esc(sheet.date)}" max="${C.addDays(t, 31)}" aria-label="날짜 고르기"></label>
      </div>
      ${nospend ? '' : `<input class="input memo" id="f-memo" maxlength="${C.MEMO_MAX}" placeholder="메모 (선택)" value="${esc(sheet.memo || '')}">`}
    </div>
    ${type === 'trip' && sheet.editing ? `<label class="check-line"><input type="checkbox" id="f-settled" ${sheet.settled ? 'checked' : ''} style="accent-color:var(--green)"> 회사에서 돌려받았어요</label>` : ''}
    ${type === 'invest' && sheet.reason ? `<p class="small muted" style="margin:4px 0">적어둔 사유: ${esc(sheet.reason)}</p>` : ''}
    <p class="form-error" id="f-error" role="alert"></p>
    ${nospend ? '' : `
    <div class="keypad" role="group" aria-label="금액 키패드">
      ${['1', '2', '3', 'back', '4', '5', '6', 'plus', '7', '8', '9', 'clear', '00', '0', '000'].map(k => `<button type="button" class="key ${['back', 'plus', 'clear'].includes(k) ? 'fn' : ''}" data-key="${k}" aria-label="${{ back: '지우기', plus: '더하기', clear: '전체 지우기' }[k] || k}">${{ back: '⌫', plus: '+', clear: 'C' }[k] || k}</button>`).join('')}
      <button type="submit" class="key save">${sheet.editing ? '저장' : '기록'}</button>
    </div>`}
    ${sheet.editing ? `<button class="btn ghost block small" data-sheet="delete" type="button" style="margin-top:10px">🗑 이 기록 지우기</button>` : ''}
  </form>`;

  if (!nospend) updateAmount();
  $('#f-date').addEventListener('change', () => { readSheet(); renderSheet(); });
  $('#entry-form').addEventListener('submit', e => { e.preventDefault(); submitSheet(); });
  dlg.onclick = onSheetClick;
}

function pressKey(k) {
  if (/^\d+$/.test(k)) {
    if (!sheet.cur && /^0+$/.test(k)) return; // 앞자리 0 무시
    const next = (sheet.cur + k).slice(0, 9);
    if (sheetTotal() - (Number(sheet.cur) || 0) + Number(next) > C.AMOUNT_MAX) return;
    sheet.cur = next;
  } else if (k === 'back') {
    if (sheet.cur) sheet.cur = sheet.cur.slice(0, -1);
    else if (sheet.terms.length) sheet.cur = String(sheet.terms.pop());
  } else if (k === 'plus') {
    if (sheet.cur) { sheet.terms.push(Number(sheet.cur)); sheet.cur = ''; }
  } else if (k === 'clear') {
    sheet.terms = []; sheet.cur = '';
  }
  updateAmount();
}

async function onSheetClick(ev) {
  const dlg = $('#entry-sheet');
  if (ev.target === dlg) { dlg.close(); return; } // 바깥 영역 탭
  const key = ev.target.closest('[data-key]');
  if (key) { pressKey(key.dataset.key); return; }
  const b = ev.target.closest('[data-sheet]');
  if (!b) return;
  const act = b.dataset.sheet;
  readSheet();
  if (act === 'close') dlg.close();
  else if (act === 'mode') {
    sheet.mode = b.dataset.k;
    sheet.category = sheet.mode === 'expense' ? C.EXPENSE_CATS[0].k : C.INCOME_CATS[0].k;
    renderSheet();
  }
  else if (act === 'cat') { sheet.category = b.dataset.k; renderSheet(); }
  else if (act === 'ikind') { sheet.investKind = b.dataset.k; renderSheet(); }
  else if (act === 'day') { sheet.date = b.dataset.d; renderSheet(); }
  else if (act === 'delete') { dlg.close(); await trashEntry(sheet.original); }
}

// 컴퓨터에서는 숫자 키·백스페이스·+·엔터로도 입력된다
function onKeypadKey(e) {
  if (!$('#entry-sheet').open || !sheet || !$('#k-val')) return;
  if (e.target.matches('input, textarea, select')) return;
  const map = { Backspace: 'back', '+': 'plus', Delete: 'clear' };
  if (/^\d$/.test(e.key)) pressKey(e.key);
  else if (map[e.key]) pressKey(map[e.key]);
  else if (e.key === 'Enter') submitSheet();
  else return;
  e.preventDefault();
}

async function submitSheet() {
  readSheet();
  if (sheet.cur === '' && sheet.terms.length === 0 && !(sheet.locked && sheet.type === 'nospend')) { $('#f-error').textContent = '금액을 눌러주세요'; return; }
  const now = new Date().toISOString();
  const { editing, original } = sheet;
  const type = sheetType();
  const entry = {
    id: sheet.id, type, amount: sheetTotal(), date: sheet.date,
    category: sheet.category, memo: (sheet.memo || '').trim(),
    createdAt: original?.createdAt || now, updatedAt: now, deletedAt: null,
  };
  if (sheet.planId) entry.planId = sheet.planId;
  if (type === 'trip') entry.settled = !!sheet.settled;
  if (type === 'invest') { entry.investKind = sheet.investKind || '지수 ETF'; entry.reason = sheet.reason || ''; entry.warnedAck = !!sheet.warnedAck; }

  const err = C.validateEntry({ ...entry, warnedAck: false });
  if (err) { $('#f-error').textContent = err; return; }

  // 추가 투자: 새로 적거나 금액을 늘릴 때마다 경고 단계를 거친다
  if (type === 'invest' && (!editing || original.type !== 'invest' || entry.amount > original.amount)) {
    const extraBefore = editing && original.type === 'invest' ? original.amount : 0;
    const result = await investWarning(entry, extraBefore);
    if (result.action === 'cancel') return;
    if (result.action === 'restraint') { $('#entry-sheet').close(); await onRestraint(); return; }
    entry.reason = result.reason;
    entry.warnedAck = true;
    entry.risky = C.isRiskyInvest(entry.investKind, entry.memo);
  }

  const t = C.today();
  const before = C.summarize(state, t);
  await saveEntry(entry);
  $('#entry-sheet').close();
  render();
  const after = C.summarize(state, t);
  if (type === 'expense' && entry.date === t && before.todayLeft >= 0 && after.todayLeft < 0) toast('앗, 오늘 한도를 넘었어요. 내일 같이 힘내요!');
  else if (type === 'trip' && !entry.settled) toast('받을 돈에 넣어뒀어요. 정산 잊지 마세요');
  else if (entry.category === C.SALARY_CAT && !editing) toast('월급 들어왔어요! 이번 달도 알뜰하게 💰');
  else toast(editing ? '고쳤어요' : '기록했어요');
}

async function onRestraint() {
  const t = C.today();
  const already = state.rewards.some(r => r.type === 'restraint' && r.date === t);
  if (already) { toast('잘 참았어요! (참기 굴비는 하루 1마리까지)'); return; }
  const r = { id: uid(), type: 'restraint', date: t, createdAt: new Date().toISOString() };
  await DB.put('rewards', r);
  state.rewards.push(r);
  render();
  toast('잘 참았어요! 굴비 +1마리 🐟');
}

/* ---------- 안정형 투자 경고 ---------- */

function investWarning(entry, extraBefore) {
  const t = C.today();
  const s = C.summarize(state, t);
  const total = s.investTotal - extraBefore + entry.amount;
  const pct = s.investLimit ? Math.round(total / s.investLimit * 100) : 0;
  const risky = C.isRiskyInvest(entry.investKind, entry.memo);
  const signal = C.RISKY_CATEGORIES.includes(entry.investKind) ? entry.investKind : (entry.memo.match(C.RISKY_WORDS) || [])[0];
  const canReward = !state.rewards.some(r => r.type === 'restraint' && r.date === t);

  return new Promise(resolve => {
    const dlg = $('#modal');
    dlg.innerHTML = `
      <div class="mascot worried">${mascot('worried', '말리는 굴비')}</div>
      <h2>잠깐! 굴비가 말려요</h2>
      <p style="margin:0">우리 약속은 <b>안정형 투자만</b>이에요. 이 금액을 더하면 이번 달 투자는 <b class="num">${won(total)}</b>이 돼요.</p>
      <div class="meter num"><span class="muted">한 달 투자 한도 ${won(s.investLimit)}</span><b style="color:var(--red)">${pct}%</b></div>
      <div class="bar over"><span style="width:${Math.min(100, pct)}%"></span></div>
      ${risky ? `<div class="notice red" style="margin-top:12px"><b>공격형 투자예요: ${esc(signal)}</b><br>원금이 크게 줄 수 있어요. 하루만 더 생각해보는 건 어때요?</div>` : ''}
      <div class="modal-actions" id="w-first">
        <button class="btn gold block" data-w="restraint" type="button">참을게요${canReward ? ' (굴비 +1마리)' : ''}</button>
        <button class="btn ghost block" data-w="more" type="button">그래도 기록할래요</button>
      </div>
      <div id="w-proceed" hidden>
        <label class="field" style="margin-top:12px"><span>왜 투자하는지 적어주세요 (5자 이상)</span>
          <textarea class="input" id="w-reason" maxlength="100" rows="2" placeholder="예: 보너스 일부를 지수 ETF에"></textarea></label>
        ${risky ? '<label class="check-line"><input type="checkbox" id="w-ack"> 원금을 잃을 수 있다는 걸 알고, 잃어도 생활에 지장 없는 돈이에요</label>' : ''}
        <div class="modal-actions">
          <button class="btn danger block" data-w="proceed" type="button" disabled>알고 기록할게요</button>
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

/* ---------- 앱 설치 ---------- */

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function platform() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = (ua.match(/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i) || [])[0];
  return {
    ios, android: /android/i.test(ua), inApp: inApp ? (/KAKAOTALK/i.test(inApp) ? '카카오톡' : '앱') : null,
    samsung: /SamsungBrowser/i.test(ua), iosChrome: ios && /CriOS/i.test(ua),
  };
}

async function installApp() {
  // 크롬·엣지·안드로이드: 브라우저 설치 창을 바로 띄운다
  if (installPrompt) {
    const ev = installPrompt;
    installPrompt = null;
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome !== 'accepted') toast('설치를 취소했어요. 나중에 다시 눌러도 돼요');
    } catch { showInstallGuide(); }
    return;
  }
  // 아이폰·카톡 같은 인앱 브라우저·삼성 인터넷: 자동 설치 창이 없어서 순서를 안내한다
  showInstallGuide();
}

function showInstallGuide() {
  const pf = platform();
  let title = '홈 화면에 추가하기', steps;
  if (pf.inApp) {
    title = `${pf.inApp} 안에서는 설치가 안 돼요`;
    steps = pf.ios
      ? ['오른쪽 아래 <b>⋯</b> 또는 공유 버튼을 눌러요', '<b>Safari로 열기</b>를 눌러요', 'Safari에서 다시 <b>📲 앱으로 설치하기</b>를 눌러요']
      : ['오른쪽 위 <b>⋮</b> 메뉴를 눌러요', '<b>다른 브라우저로 열기</b> (Chrome)를 눌러요', 'Chrome에서 다시 <b>📲 앱으로 설치하기</b>를 눌러요'];
  } else if (pf.ios) {
    steps = [
      pf.iosChrome ? '주소창 오른쪽 <b>공유 버튼(□↑)</b>을 눌러요' : '화면 아래 가운데 <b>공유 버튼(□↑)</b>을 눌러요',
      '메뉴를 아래로 내려 <b>홈 화면에 추가</b>를 눌러요',
      '오른쪽 위 <b>추가</b>를 누르면 끝!',
    ];
  } else if (pf.samsung) {
    steps = ['화면 아래 <b>≡ 메뉴</b>를 눌러요', '<b>현재 페이지 추가</b> → <b>홈 화면</b>을 눌러요', '<b>추가</b>를 누르면 끝!'];
  } else if (pf.android) {
    steps = ['오른쪽 위 <b>⋮ 메뉴</b>를 눌러요', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요', '<b>설치</b>를 누르면 끝!'];
  } else {
    steps = ['주소창 오른쪽 <b>설치 아이콘(⊕)</b>을 눌러요', '없으면 <b>⋮ 메뉴</b> → <b>굴비 가계부 설치</b> 또는 <b>앱 → 이 사이트를 앱으로 설치</b>', '<b>설치</b>를 누르면 끝!'];
  }
  // 아이폰 홈 화면 앱은 사파리와 저장 공간이 따로라서, 계획을 링크로 옮겨야 한다
  const iosCarry = pf.ios && !pf.inApp && state.plan.length;
  const dlg = $('#modal');
  dlg.innerHTML = `
    <div class="mascot happy">${mascot('happy', '설치를 도와주는 굴비')}</div>
    <h2>${esc(title)}</h2>
    ${iosCarry ? `<div class="notice" style="margin-bottom:10px"><b>먼저 계획 링크를 복사해 두세요.</b><br>아이폰은 홈 화면 앱이 사파리와 저장 공간이 달라요. 설치한 앱을 처음 열면 <b>🔗 받은 설정 링크 붙여넣기</b>로 계획을 넣어주세요.<div style="height:8px"></div><button class="btn small gold" data-g="copy" type="button">계획 링크 복사</button></div>` : ''}
    <ol class="guide">${steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <div class="modal-actions"><button class="btn primary block" data-g="close" type="button">알겠어요</button></div>`;
  dlg.onclick = async e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'copy') { await copySetup(); return; }
    dlg.close();
  };
  dlg.oninput = dlg.onchange = null;
  dlg.showModal();
}

async function copySetup() {
  if (!state.plan.length) { toast('먼저 한 달 계획을 저장해주세요'); return; }
  const link = encodeSetup();
  try { await navigator.clipboard.writeText(link); toast('계획 링크를 복사했어요'); }
  catch { prompt('아래 링크를 길게 눌러 복사하세요', link); }
}

async function pasteSetup() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* 권한이 없으면 직접 붙여넣기 */ }
  if (!setupCodeOf(text)) {
    const dlg = $('#modal');
    text = await new Promise(resolve => {
      dlg.innerHTML = `
        <h2>설정 링크 붙여넣기</h2>
        <p class="small muted" style="margin:0 0 8px">카톡 등으로 받은 굴비 가계부 링크를 길게 눌러 붙여넣어 주세요.</p>
        <textarea class="input" id="s-link" rows="3" placeholder="https://…#setup=…"></textarea>
        <div class="modal-actions">
          <button class="btn primary block" data-s="ok" type="button">계획 불러오기</button>
          <button class="btn ghost block" data-s="cancel" type="button">취소</button>
        </div>`;
      let val = '';
      dlg.onclick = e => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (b.dataset.s === 'ok') val = $('#s-link').value;
        dlg.close();
      };
      dlg.oninput = dlg.onchange = null;
      dlg.addEventListener('close', () => resolve(val), { once: true });
      dlg.showModal();
      $('#s-link').focus();
    });
  }
  if (!text) return;
  const code = setupCodeOf(text);
  if (!code) { toast('설정 링크가 아니에요. 링크 전체를 붙여넣어 주세요'); return; }
  if (await applySetup(code)) go('home');
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
      <p class="small muted" style="margin:0 0 10px">지운 지 30일이 지나면 자동으로 영구 삭제돼요.</p>
      <div style="max-height:50dvh;overflow:auto">${items.length ? items.map(e => {
        const daysLeft = Math.max(0, C.TRASH_DAYS - Math.floor((Date.now() - Date.parse(e.deletedAt)) / 864e5));
        return `<div class="wish"><div class="wish-main"><b>${C.iconOf(e)} ${esc(e.category || C.TYPES[e.type])}</b> <span class="num">${won(e.amount)}</span>
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
    title: '정말 전부 지울까요?', body: '한 달 계획, 모든 기록, 굴비와 상이 지워지고 되돌릴 수 없어요. 먼저 백업을 내보내 두는 걸 추천해요.',
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
