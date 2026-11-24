/* HACK THE LPIC 2 — PASS COUNTER
   データ（CSV）→ 純粋関数で集計 → 前回との差分を演出キューへ → 表示。
   名前・社員番号・スコアは画面に出さない（社員番号は集計の突き合わせにのみ使用）。 */
(() => {
  'use strict';

  /* =================== config =================== */
  const DEFAULTS = Object.freeze({
    csvUrl: '',
    pollSeconds: 20,
    phase: 'auto',
    phaseSwitchDate: '2026-12-07',
    exams: [
      { id: '201', start: '2026-12-05T09:00:00+09:00', label: '12月5日（土）・6日（日）' },
      { id: '202', start: '2026-12-26T09:00:00+09:00', label: '12月26日（土）・27日（日）' }
    ],
    milestones: [10, 25, 50, 100],
    tickerMax: 12
  });
  /** @param {unknown} raw */
  const readConfig = (raw) => {
    const c = (raw && typeof raw === 'object') ? /** @type {Record<string, unknown>} */ (raw) : {};
    const str = (v, d) => (typeof v === 'string' ? v : d);
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
    const exams = Array.isArray(c.exams) ? c.exams.filter((e) => e && typeof e.id === 'string') : DEFAULTS.exams;
    const milestones = Array.isArray(c.milestones) ? c.milestones.filter((m) => Number.isInteger(m) && m > 0) : DEFAULTS.milestones;
    return Object.freeze({
      csvUrl: str(c.csvUrl, DEFAULTS.csvUrl).trim(),
      pollSeconds: Math.max(5, num(c.pollSeconds, DEFAULTS.pollSeconds)),
      phase: ['auto', '201', '202'].includes(String(c.phase)) ? String(c.phase) : 'auto',
      phaseSwitchDate: str(c.phaseSwitchDate, DEFAULTS.phaseSwitchDate),
      exams,
      milestones,
      tickerMax: Math.floor(num(c.tickerMax, DEFAULTS.tickerMax))
    });
  };
  const CFG = readConfig(window.HTL_CONFIG);
  const DEMO = new URLSearchParams(location.search).get('demo') === '1';
  const SOURCE = CFG.csvUrl || 'data/sample.csv';
  const IS_SAMPLE = !CFG.csvUrl;
  const STORE_KEY = 'htl2-pass-counter:v1:' + SOURCE;
  const EXAMS = /** @type {const} */ (['201', '202']);
  const JST = 9 * 3600e3;

  /* =================== pure: CSV =================== */
  /** RFC4180 風。ダブルクォート内のカンマ・改行・"" に対応 @param {string} text @returns {string[][]} */
  const parseCSV = (text) => {
    const s = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
        continue;
      }
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  };

  const norm = (v) => String(v ?? '').normalize('NFKC').trim();

  /** "2026/12/05 10:12:03"（JST）→ epoch ms。読めなければ null */
  const parseTime = (v) => {
    const m = norm(v).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, se] = m.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, se || 0) - JST;
  };

  /** ヘッダーから列位置を決める（列が抜き出されていても動く） */
  const columnMap = (header) => {
    const find = (re) => header.findIndex((h) => re.test(norm(h)));
    const m = { time: find(/タイムスタンプ|timestamp/i), id: find(/社員番号/), exam: find(/^試験/), result: find(/結果/) };
    return (m.id >= 0 && m.exam >= 0 && m.result >= 0)
      ? { ...m, time: m.time >= 0 ? m.time : 0, skip: 1 }
      : { time: 0, id: 1, exam: 2, result: 3, skip: 0 };
  };

  /** @typedef {{t:number,id:string,exam:'201'|'202',pass:boolean}} Rec */
  /** @returns {Rec[]} 想定外の行は捨てる。時刻順 */
  const toRecords = (rows) => {
    if (!rows.length) return [];
    const cm = columnMap(rows[0]);
    return rows.slice(cm.skip).flatMap((r) => {
      const t = parseTime(r[cm.time]);
      const id = norm(r[cm.id]).toUpperCase();
      const examM = norm(r[cm.exam]).match(/^(201|202)(?!\d)/);
      const result = norm(r[cm.result]);
      if (t === null || !id || !examM || (result !== '合格' && result !== '不合格')) return [];
      return [{ t, id, exam: /** @type {'201'|'202'} */ (examM[1]), pass: result === '合格' }];
    }).sort((a, b) => a.t - b.t);
  };

  /* =================== pure: aggregation =================== */
  /** @param {Rec[]} recs */
  const computeStats = (recs) => {
    const exams = Object.fromEntries(EXAMS.map((ex) => {
      const r = recs.filter((x) => x.exam === ex);
      const first = new Map();
      r.forEach((x) => { if (x.pass && !first.has(x.id)) first.set(x.id, x.t); });
      const passes = [...first].map(([id, t]) => ({ id, t }))
        .sort((a, b) => a.t - b.t)
        .map((p, i) => ({ ...p, n: i + 1, exam: ex }));
      return [ex, { takers: new Set(r.map((x) => x.id)).size, passes }];
    }));
    const first201 = new Map(exams['201'].passes.map((p) => [p.id, p.t]));
    const certs = exams['202'].passes
      .filter((p) => first201.has(p.id))
      .map((p) => ({ id: p.id, t: Math.max(p.t, first201.get(p.id)) }))
      .sort((a, b) => a.t - b.t)
      .map((c, i) => ({ ...c, n: i + 1 }));
    return { exams, certs };
  };
  const EMPTY_STATS = computeStats([]);

  /** @typedef {{p201:number,p202:number,cert:number}} Counts */
  /** @returns {Counts} */
  const countsOf = (s) => ({ p201: s.exams['201'].passes.length, p202: s.exams['202'].passes.length, cert: s.certs.length });
  const minCounts = (a, b) => ({ p201: Math.min(a.p201, b.p201), p202: Math.min(a.p202, b.p202), cert: Math.min(a.cert, b.cert) });

  /** 前回から増えた分を「1件ずつ」の演出列にする。合格→認定→節目の順 */
  const newEvents = (stats, seen, milestones) => {
    const ev = [
      ...EXAMS.flatMap((ex) => stats.exams[ex].passes.slice(seen['p' + ex]).map((p) => ({ kind: 'pass', exam: ex, n: p.n, t: p.t }))),
      ...stats.certs.slice(seen.cert).map((c) => ({ kind: 'cert', exam: 'cert', n: c.n, t: c.t }))
    ].sort((a, b) => a.t - b.t || (a.kind === 'pass' ? -1 : 1) - (b.kind === 'pass' ? -1 : 1));
    const out = [];
    let pend = [];
    ev.forEach((e, i) => {
      out.push(e);
      if (milestones.includes(e.n)) pend.push({ kind: 'mile', exam: e.exam, n: e.n, t: e.t });
      const next = ev[i + 1];
      if (!(next && next.kind === 'cert' && next.t === e.t)) { out.push(...pend); pend = []; }
    });
    return out;
  };

  const switchMs = (() => {
    const s = CFG.phaseSwitchDate;
    const ms = Date.parse(s.includes('T') ? s : s + 'T00:00:00+09:00');
    return Number.isFinite(ms) ? ms : Date.parse(DEFAULTS.phaseSwitchDate + 'T00:00:00+09:00');
  })();
  const phaseFor = (now, override) => (override === '201' || override === '202') ? override : (now < switchMs ? '201' : '202');

  const pad = (n) => String(n).padStart(2, '0');
  const rate = (p, t) => (t ? Math.round((p / t) * 100) + '%' : '—');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtStamp = (t) => { const d = new Date(t + JST); return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* =================== storage (使えなくても動く) =================== */
  const store = {
    load() {
      try {
        const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        const ok = v && ['p201', 'p202', 'cert'].every((k) => Number.isInteger(v[k]) && v[k] >= 0);
        return ok ? v : null;
      } catch (e) { console.warn('[pass-counter] localStorage を読めません:', e); return null; }
    },
    save(v) {
      if (DEMO) return;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { console.warn('[pass-counter] localStorage に保存できません:', e); }
    }
  };

  /* =================== state =================== */
  const st = {
    stats: EMPTY_STATS,
    /** @type {Counts|null} 取得済みデータの件数（キュー投入済み） */ seen: null,
    /** @type {Counts} 画面に反映済みの件数 */ revealed: { p201: 0, p202: 0, cert: 0 },
    override: CFG.phase,
    phase: phaseFor(Date.now(), CFG.phase),
    builtPhase: '',
    phaseSeen: '',
    sound: false,
    queue: [], busy: false, transitioning: false,
    landCert: 0,
    lastText: '',
    /** @type {Rec[]} DEMO 用（メモリ上のみ。データは書き換えない） */ sim: []
  };
  const persist = () => store.save({ ...st.revealed, phaseSeen: st.phaseSeen });

  /* =================== DOM =================== */
  const $ = (s) => /** @type {HTMLElement} */ (document.querySelector(s));

  const odo = (el, v, red) => {
    if (!el) return;
    const s = pad(v);
    el.classList.toggle('red', !!red);
    if (el.children.length !== s.length) {
      el.innerHTML = s.split('').map(() => '<div class="col">' + Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join('') + '</div>').join('');
      void el.offsetWidth;
    }
    [...el.children].forEach((c, i) => { /** @type {HTMLElement} */ (c).style.transform = `translateY(${-Number(s[i])}em)`; });
  };

  const flankHTML = (o) => `<div class="stamp">${o.stamp}</div><div class="tag">${o.tag}</div><div class="num">${o.num}</div><div class="hl"></div>${o.meta ? `<div class="meta">${o.meta}</div>` : ''}<div class="jp">${o.jp}</div>`;
  const examCfg = (id) => CFG.exams.find((e) => e.id === id);

  const buildPhase = (ph) => {
    const left = $('#left'), right = $('#right');
    $('#phase').innerHTML = `PHASE <b>${ph}</b>　${ph} 試験 受験期間`;
    $('#heroTag').innerHTML = `EXAM <b>${ph}</b>`;
    if (ph === '201') {
      const lbl = examCfg('202')?.label ?? '';
      left.className = 'flank locked';
      left.innerHTML = flankHTML({ stamp: 'NEXT', tag: 'EXAM <b>202</b>', num: '202', jp: esc(lbl ? lbl.split('・')[0] + 'から' : '') });
      right.className = 'flank locked';
      right.innerHTML = flankHTML({ stamp: 'LOCKED', tag: 'LPIC-2', num: '00', jp: '201 と 202 の両方に合格で認定' });
    } else {
      left.className = 'flank final';
      left.innerHTML = flankHTML({ stamp: 'FINAL', tag: 'EXAM <b>201</b>', num: '<span class="odo" id="f201"></span>', meta: 'RATE<b id="f201r">—</b>', jp: '<span id="f201u"></span>' });
      right.className = 'flank cert';
      right.innerHTML = flankHTML({ stamp: 'CERTIFIED', tag: 'LPIC-2 · <b>認定</b>', num: '<span class="odo" id="fc"></span>', jp: '201 と 202 の両方に合格' });
      odo($('#f201'), 0); odo($('#fc'), 0, true);
    }
    st.builtPhase = ph;
  };

  /** 表示用モデル（純粋） */
  const viewModel = (stats, rev, ph) => {
    const shown = (ex) => stats.exams[ex].passes.slice(0, rev['p' + ex]);
    const ticker = (ph === '201' ? ['201'] : EXAMS).flatMap(shown).sort((a, b) => b.t - a.t).slice(0, CFG.tickerMax);
    return {
      hero: { passed: rev['p' + ph], takers: stats.exams[ph].takers },
      e201: { passed: rev.p201, takers: stats.exams['201'].takers },
      cert: ph === '202' ? rev.cert : 0,
      ticker
    };
  };

  let tickerKey = '';
  const renderTicker = (items) => {
    const key = items.map((p) => p.exam + p.n + ':' + p.t).join('|');
    if (key === tickerKey) return;
    tickerKey = key;
    const run = $('#run'), box = $('#tick');
    if (!items.length) {
      run.className = 'run still';
      run.innerHTML = '<span>WAITING FOR THE FIRST PASS</span>';
      return;
    }
    const one = items.map((p) => `<span>${fmtStamp(p.t)}　<i>EXAM ${p.exam}</i>　<b>${p.n}人目の合格</b></span>`).join('');
    run.className = 'run';
    run.style.animation = 'none';
    run.innerHTML = one;
    const unit = Math.max(1, run.scrollWidth);
    const reps = Math.max(1, Math.ceil((box.clientWidth + 80) / unit));
    const half = one.repeat(reps);
    run.innerHTML = half + half;
    const halfW = run.scrollWidth / 2;
    void run.offsetWidth;
    run.style.animation = '';
    run.style.animationDuration = Math.max(30, halfW / 55) + 's';
  };

  const renderPlates = (n) => {
    const MAX = 12;
    const from = Math.max(0, n - MAX);
    const filled = Array.from({ length: n - from }, (_, i) => from + i + 1)
      .map((no) => `<div class="plate${no === st.landCert ? ' land' : ''}"><small>CERTIFIED</small><em>No.${pad(no)}</em></div>`).join('');
    const empty = '<div class="plate empty"><small>NEXT</small>No.——</div>'.repeat(Math.max(2, 4 - n));
    $('#plates').innerHTML = filled + empty;
    st.landCert = 0;
  };

  let platesKey = '';
  const render = () => {
    const ph = st.phase;
    if (st.builtPhase !== ph) { buildPhase(ph); platesKey = ''; }
    const vm = viewModel(st.stats, st.revealed, ph);
    odo($('#heroNum'), vm.hero.passed);
    $('#heroRate').textContent = rate(vm.hero.passed, vm.hero.takers);
    $('#heroUnder').textContent = `合格 ${vm.hero.passed} ／ 受験報告 ${vm.hero.takers}`;
    if (ph === '202') {
      odo($('#f201'), vm.e201.passed);
      $('#f201r').textContent = rate(vm.e201.passed, vm.e201.takers);
      $('#f201u').textContent = `合格 ${vm.e201.passed} ／ 受験報告 ${vm.e201.takers}`;
      odo($('#fc'), vm.cert, true);
    }
    const pk = ph + vm.cert + ':' + st.landCert;
    if (pk !== platesKey) { platesKey = ph + vm.cert + ':0'; renderPlates(vm.cert); }
    renderTicker(vm.ticker);
  };

  /* =================== phase hand-off =================== */
  const setPhase = async (next) => {
    if (next === st.phase && st.builtPhase === next) return;
    const prev = st.phase;
    if (prev === '201' && next === '202' && st.builtPhase === '201') await handoff();
    else { st.phase = next; render(); }
    st.phaseSeen = next;
    persist();
  };
  /** 201 が左へ下がり、FINAL の刻印が入る */
  const handoff = async () => {
    const stage = $('#stage');
    st.transitioning = true;
    await wait(900);
    stage.classList.add('retire');
    await wait(1500);
    st.phase = '202';
    buildPhase('202');
    odo($('#heroNum'), 0);
    stage.classList.remove('retire');
    stage.classList.add('arrive');
    await wait(120);
    render();
    await wait(2200);
    stage.classList.remove('arrive');
    st.transitioning = false;
  };
  const checkPhase = () => { if (!st.transitioning) setPhase(phaseFor(Date.now(), st.override)); };

  /* =================== video =================== */
  const vPass = /** @type {HTMLVideoElement} */ ($('#vPass'));
  const vCert = /** @type {HTMLVideoElement} */ ($('#vCert'));
  const videoOK = { pass: false, cert: false };
  const videoExt = (() => {
    if (vPass.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) return 'mp4';
    if (vPass.canPlayType('video/webm; codecs="vp9, opus"') || vPass.canPlayType('video/webm; codecs="vp9"')) return 'webm';
    return '';
  })();
  [['pass', vPass], ['cert', vCert]].forEach(([name, v]) => {
    if (!videoExt) { console.warn('[pass-counter] 再生できる動画形式がありません。数字の演出のみで表示します'); return; }
    videoOK[name] = true;
    v.addEventListener('error', () => { videoOK[name] = false; console.warn(`[pass-counter] 動画 ${name}.${videoExt} を読み込めません。数字の演出のみで表示します`); });
    v.src = `assets/video/${name}.${videoExt}`;
    v.load();
  });
  const startVideo = async (v, name) => {
    if (!videoOK[name]) return false;
    try { v.currentTime = 0; } catch (e) { /* metadata 未読込時は無視して再生開始に任せる */ }
    v.muted = !st.sound;
    try { await v.play(); return true; } catch (e) {
      if (e && e.name === 'NotAllowedError' && !v.muted) {
        v.muted = true;
        try { await v.play(); return true; } catch (e2) { console.warn('[pass-counter] 動画を再生できません:', e2); }
      } else console.warn('[pass-counter] 動画を再生できません:', e);
      return false;
    }
  };

  /* =================== events =================== */
  const evEl = $('#ev');
  const setCard = (o) => {
    $('#eve').innerHTML = o.e1; $('#evn').textContent = o.n;
    $('#evl1').textContent = o.l1; $('#evl2').textContent = o.l2; $('#evj').textContent = o.jp;
  };

  const playClip = async (it) => {
    const cert = it.kind === 'cert';
    const name = cert ? 'cert' : 'pass';
    const v = cert ? vCert : vPass;
    setCard(cert
      ? { e1: 'LPIC-2 · <b>CERTIFIED</b>', n: pad(it.n), l1: 'CERTIFIED', l2: 'No.' + pad(it.n), jp: `LPIC-2 認定　${it.n}人目` }
      : { e1: `EXAM <b>${it.exam}</b> · PASSED`, n: pad(it.n), l1: 'PASSED', l2: 'No.' + pad(it.n), jp: `${it.exam} 試験　${it.n}人目の合格者` });
    evEl.className = `k-${name}${cert ? ' cert' : ''}${videoOK[name] ? '' : ' novideo'}`;
    void evEl.offsetWidth;
    evEl.classList.add('on');
    await wait(300);
    const playing = await startVideo(v, name);
    evEl.classList.toggle('novideo', !playing);
    if (playing) evEl.classList.add('play');
    await wait((cert ? (playing ? 2500 : 1000) : 1500) - 300);
    evEl.classList.add('show');
    await wait(cert ? (playing ? 4900 : 6400) : 5200);
    evEl.classList.remove('on', 'play', 'show');
    setTimeout(() => v.pause(), 900);
  };

  const playMilestone = async (it) => {
    const cert = it.exam === 'cert';
    setCard({ e1: 'MILESTONE', n: String(it.n), l1: cert ? 'CERTIFIED' : 'PASSED', l2: cert ? 'LPIC-2' : 'EXAM ' + it.exam, jp: '' });
    evEl.className = 'mile';
    void evEl.offsetWidth;
    evEl.classList.add('on');
    await wait(200);
    evEl.classList.add('show');
    await wait(3200);
    evEl.classList.remove('on', 'show');
  };

  const reveal = (it) => {
    if (it.kind === 'pass') st.revealed['p' + it.exam] = Math.max(st.revealed['p' + it.exam], it.n);
    if (it.kind === 'cert') { st.revealed.cert = Math.max(st.revealed.cert, it.n); st.landCert = it.n; }
  };

  const hiddenInPhase = (it) => st.phase === '201' && (it.exam === '202' || it.exam === 'cert');

  const nextEvent = async () => {
    if (st.transitioning) { setTimeout(nextEvent, 400); return; }
    const it = st.queue.shift();
    if (!it) { st.busy = false; return; }
    st.busy = true;
    if (hiddenInPhase(it)) { reveal(it); persist(); render(); nextEvent(); return; }
    try {
      if (it.kind === 'mile') await playMilestone(it);
      else await playClip(it);
    } catch (e) {
      console.error('[pass-counter] 演出中にエラー:', e);
      evEl.classList.remove('on', 'play', 'show');
    }
    reveal(it);
    persist();
    render();
    await wait(it.kind === 'mile' ? 1000 : 1600);
    nextEvent();
  };
  const enqueue = (items) => {
    if (!items.length) return;
    st.queue.push(...items);
    if (!st.busy) { st.busy = true; nextEvent(); }
  };

  /* =================== data =================== */
  const ingest = (text, { initial = false } = {}) => {
    const recs = [...toRecords(parseCSV(text)), ...st.sim].sort((a, b) => a.t - b.t);
    const stats = computeStats(recs);
    const now = countsOf(stats);
    st.stats = stats;
    if (st.seen === null) {
      const saved = DEMO ? null : store.load();
      st.revealed = saved ? minCounts(saved, now) : now;
      st.phaseSeen = saved && typeof saved.phaseSeen === 'string' ? saved.phaseSeen : '';
      st.seen = now;
      const pending = newEvents(stats, st.revealed, CFG.milestones);
      persist();
      return pending;
    }
    const pending = newEvents(stats, st.seen, CFG.milestones);
    st.seen = now;
    st.revealed = minCounts(st.revealed, now);
    if (!st.busy && !pending.length) persist();
    return pending;
  };

  const statusEl = $('#status');
  let first = true;
  const poll = async () => {
    try {
      const url = SOURCE + (SOURCE.includes('?') ? '&' : '?') + '_=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      if (/^\s*</.test(text)) throw new Error('CSV ではなく HTML が返されました。csvUrl が「ウェブに公開」の CSV URL か確認してください');
      st.lastText = text;
      const pending = ingest(text);
      statusEl.hidden = true;
      if (first) {
        first = false;
        const wantPhase = phaseFor(Date.now(), st.override);
        // 202 期間に入って最初の表示：201 で一度見せてから切り替える
        if (wantPhase === '202' && st.phaseSeen !== '202' && !DEMO) { st.phase = '201'; render(); await wait(600); await setPhase('202'); }
        else { st.phase = wantPhase; render(); st.phaseSeen = wantPhase; persist(); }
        if (pending.length) { await wait(3000); enqueue(pending); }
      } else {
        render();
        enqueue(pending);
      }
    } catch (e) {
      console.warn('[pass-counter] 更新できませんでした:', e);
      statusEl.hidden = false;
    }
  };

  /* =================== chrome: clock / countdown / atmosphere =================== */
  const tickClock = () => {
    const now = Date.now();
    $('#clock').textContent = new Date(now).toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' });
    const nx = CFG.exams.map((e) => ({ id: e.id, at: Date.parse(e.start) })).find((e) => Number.isFinite(e.at) && e.at > now);
    if (!nx) {
      $('#cdCap').textContent = 'EXAMS';
      $('#cd').innerHTML = '<span class="ex">すべての試験が終了しました</span>';
      return;
    }
    const ms = nx.at - now, D = Math.floor(ms / 864e5), H = Math.floor(ms / 36e5) % 24, M = Math.floor(ms / 6e4) % 60, S = Math.floor(ms / 1e3) % 60;
    $('#cdCap').textContent = 'COUNTDOWN · EXAM ' + nx.id;
    $('#cd').innerHTML = `<span class="ex">${esc(nx.id)} 試験まで</span><span class="v">${pad(D)}<span class="u">DAYS</span></span><span class="v">${pad(H)}:${pad(M)}<span class="u">${pad(S)}</span></span>`;
  };

  const PHOTOS = ['cables', 'hdd', 'chip', 'penguin', 'blueprint'].map((n) => `assets/img/${n}.jpg`);
  let bgI = 0, bgFlip = false;
  const nextBg = () => {
    const [on, off] = bgFlip ? [$('#bgB'), $('#bgA')] : [$('#bgA'), $('#bgB')];
    on.style.backgroundImage = `url("${PHOTOS[bgI % PHOTOS.length]}")`;
    on.classList.add('on'); off.classList.remove('on');
    bgI++; bgFlip = !bgFlip;
  };

  const startDust = () => {
    const cv = /** @type {HTMLCanvasElement} */ ($('#dust')), cx = cv.getContext('2d');
    if (!cx) return;
    let W = 0, H = 0, P = [];
    const resize = () => {
      const r = devicePixelRatio || 1;
      W = cv.width = innerWidth * r; H = cv.height = innerHeight * r;
      P = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), r: 0.4 + Math.random() * 1.4 }));
    };
    resize(); addEventListener('resize', resize);
    const frame = () => {
      const r = devicePixelRatio || 1;
      cx.clearRect(0, 0, W, H);
      for (const p of P) {
        p.y -= (0.08 + p.z * 0.25) * r; p.x += Math.sin((p.y + p.z * 900) / 240) * 0.12;
        if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
        cx.fillStyle = `rgba(200,214,232,${0.05 + p.z * 0.22})`;
        cx.beginPath(); cx.arc(p.x, p.y, p.r * r, 0, 7); cx.fill();
      }
      requestAnimationFrame(frame);
    };
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) frame();
  };

  /* =================== controls =================== */
  const soundBtn = $('#sound');
  soundBtn.addEventListener('click', () => {
    st.sound = !st.sound;
    soundBtn.textContent = st.sound ? 'SOUND ON' : 'SOUND OFF';
    soundBtn.classList.toggle('on', st.sound);
    soundBtn.setAttribute('aria-pressed', String(st.sound));
    [vPass, vCert].forEach((v) => { if (!v.paused) v.muted = !st.sound; });
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (p && p.catch) p.catch((err) => console.warn('[pass-counter] 全画面にできません:', err));
  });

  if (DEMO) {
    $('#demoBtn').hidden = false;
    $('#demoBtn').addEventListener('click', () => $('#ctl').classList.toggle('open'));
    const markPhase = () => document.querySelectorAll('[data-phase]').forEach((b) => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.phase === st.override));
    markPhase();
    document.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', async () => {
      st.override = /** @type {HTMLElement} */ (b).dataset.phase || 'auto';
      markPhase();
      if (!st.transitioning) await setPhase(phaseFor(Date.now(), st.override));
    }));
    let simId = 0;
    const reingest = () => { const p = ingest(st.lastText); render(); enqueue(p); };
    $('#simPass').addEventListener('click', () => {
      st.sim.push({ t: Date.now(), id: `__SIM${++simId}`, exam: st.phase, pass: true });
      reingest();
    });
    $('#simCert').addEventListener('click', async () => {
      if (st.phase === '201') { st.override = '202'; markPhase(); await setPhase('202'); }
      const id = `__SIM${++simId}`, t = Date.now();
      st.sim.push({ t: t - 1, id, exam: '201', pass: true }, { t, id, exam: '202', pass: true });
      // 201 側の合格は演出済み扱い（合格(202) → 認定 の順に流す）
      if (st.seen) st.seen = { ...st.seen, p201: st.seen.p201 + 1 };
      st.revealed = { ...st.revealed, p201: st.revealed.p201 + 1 };
      reingest();
    });
    $('#simMile').addEventListener('click', () => {
      const cur = st.revealed['p' + st.phase];
      const m = CFG.milestones.find((x) => x > cur) ?? CFG.milestones[0] ?? 10;
      enqueue([{ kind: 'mile', exam: st.phase, n: m, t: Date.now() }]);
    });
  }

  /* =================== boot =================== */
  $('#sample').hidden = !IS_SAMPLE;
  buildPhase(st.phase);
  render();
  tickClock(); setInterval(tickClock, 1000);
  nextBg(); setInterval(nextBg, 30000);
  startDust();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tickerKey = ''; render(); }).catch((e) => console.warn('[pass-counter] フォント読込待ちに失敗:', e));
  poll(); setInterval(poll, CFG.pollSeconds * 1000);
  setInterval(checkPhase, 30000);
})();
