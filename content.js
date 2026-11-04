// Bossfrommars Analysis Arrows — content script for chess.com
(function () {
  const Chess = window.BFMChess;
  const S = { on: true, moves: 4, depth: 20, evalbar: 1, min: false, x: null, y: null };
  let pageFen = null, pageFlipped = null;
  let loadingText = '', port = null, lastFen = null, lines = [], linesFen = null, engineName = '', state = 'idle', nps = 0;

  // ---------- settings ----------
  try {
    chrome.storage.local.get('bfm', (r) => { const v = (r && r.bfm) || {}; for (const k in S) if (k in v) S[k] = v[k]; buildPanel(); });
  } catch (e) { buildPanel(); }
  function save() { try { chrome.storage.local.set({ bfm: S }); } catch (e) {} }

  // ---------- data from page world ----------
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__bfm !== 'pos') return;
    pageFen = e.data.fen || null;
    pageFlipped = typeof e.data.flipped === 'boolean' ? e.data.flipped : null;
  });

  // ---------- engine port ----------
  function getPort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: 'tab' });
      port.onMessage.addListener(onEngine);
      port.onDisconnect.addListener(() => { port = null; if (lastFen) { const f = lastFen; lastFen = null; setTimeout(() => request(f), 200); } });
    } catch (e) { port = null; }
    return port;
  }
  function request(fen) {
    lastFen = fen; lines = []; linesFen = fen; state = 'thinking';
    loadingText = '';
    const p = getPort();
    if (p) p.postMessage({ type: 'go', fen, multipv: S.moves, depth: S.depth, engine: 'lite' });
    renderAll();
  }
  function stop() {
    if (lastFen && port) { try { port.postMessage({ type: 'stop' }); } catch (e) {} }
    lastFen = null; lines = []; linesFen = null; state = 'idle';
  }
  function onEngine(m) {
    if (m.type === 'error') { state = 'error'; renderPanel(); return; }
    if (m.type === 'status') { if (m.fen === lastFen && !lines[0]) { loadingText = m.text; renderPanel(); } return; }
    if (m.fen !== lastFen) return;
    if (m.engine) engineName = m.engine;
    if (m.type === 'info') { lines[m.mpv - 1] = m; if (m.mpv === 1) nps = m.nps; schedule(); }
    else if (m.type === 'done') { state = 'done'; schedule(); }
  }
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); }); }

  // ---------- board reading ----------
  function boardEl() {
    const cands = document.querySelectorAll('wc-chess-board, chess-board, #board-single, #board-play-computer, #board-vs-personalities, .board');
    for (const b of cands) if (b.querySelector('.piece')) return b;
    return null;
  }
  function sqOf(el) { for (const c of el.classList) { const m = /^square-(\d)(\d)$/.exec(c); if (m) return [+m[1] - 1, +m[2] - 1]; } return null; }
  function domFen(b) {
    const g = Array.from({ length: 8 }, () => Array(8).fill(null));
    let n = 0;
    b.querySelectorAll('.piece').forEach((p) => {
      let t = null; for (const c of p.classList) if (/^[wb][prnbqk]$/.test(c)) t = c;
      const s = sqOf(p); if (!t || !s) return;
      g[7 - s[1]][s[0]] = t[0] === 'w' ? t[1].toUpperCase() : t[1]; n++;
    });
    if (n < 2) return null;
    // whoever moved last sits on a highlighted square -> the other side is to move
    let turn = 'w';
    for (const h of b.querySelectorAll('.highlight')) {
      const s = sqOf(h); if (!s) continue;
      const pc = g[7 - s[1]][s[0]];
      if (pc) { turn = pc === pc.toUpperCase() ? 'b' : 'w'; break; }
    }
    const place = g.map((r) => { let o = '', e = 0; for (const c of r) { if (!c) e++; else { if (e) o += e; e = 0; o += c; } } return o + (e || ''); }).join('/');
    let cs = '';
    if (g[7][4] === 'K') { if (g[7][7] === 'R') cs += 'K'; if (g[7][0] === 'R') cs += 'Q'; }
    if (g[0][4] === 'k') { if (g[0][7] === 'r') cs += 'k'; if (g[0][0] === 'r') cs += 'q'; }
    let fen = `${place} ${turn} ${cs || '-'} - 0 1`;
    // if the side NOT to move is in check, our guess was wrong
    if (!legalFen(fen)) { fen = `${place} ${turn === 'w' ? 'b' : 'w'} ${cs || '-'} - 0 1`; if (!legalFen(fen)) return null; }
    return fen;
  }
  function legalFen(fen) {
    try {
      const c = new Chess();
      if (!c.validate_fen(fen).valid) return false;
      c.load(fen);
      const p = fen.split(' '); p[1] = p[1] === 'w' ? 'b' : 'w'; p[3] = '-';
      const o = new Chess(p.join(' '));
      if (o.in_check()) return false; // opponent's king can be captured
      const b = c.board().flat().filter(Boolean);
      return b.filter((x) => x.type === 'k' && x.color === 'w').length === 1 && b.filter((x) => x.type === 'k' && x.color === 'b').length === 1;
    } catch (e) { return false; }
  }
  function currentFen(b) {
    if (pageFen && legalFen(pageFen)) return pageFen;
    return domFen(b);
  }
  function isFlipped(b) { return pageFlipped !== null ? pageFlipped : b.classList.contains('flipped'); }

  // ---------- where it's allowed ----------
  function allowedHere() {
    const p = location.pathname;
    if (/^\/analysis(\/|$)/.test(p)) return 'ok';
    // unrated games vs Chess.com bots
    if (/^\/(play\/)?(computer|bots?)(\/|$)/.test(p)) return 'ok';
    if (/^\/game\/(computer|bot)(\/|$)/.test(p)) return 'ok';
    if (/^\/play(\/|$)/.test(p)) return 'ok';
    if (/^\/game(\/|$)/.test(p)) return 'ok';
    return 'off';
  }

  // ---------- arrows ----------
  const BEST = '#5cb82e', ALT = '#3f95e6';
  let hoverIdx = -1;
  function xy(sq, flip) { const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1; return flip ? [7 - f + .5, r + .5] : [f + .5, 7 - r + .5]; }
  function arrow(u, flip, color, w, opacity, num) {
    const [ax, ay] = xy(u.slice(0, 2), flip), [bx, by] = xy(u.slice(2, 4), flip);
    const fx = Math.abs(bx - ax), fy = Math.abs(by - ay);
    const knight = (fx === 1 && fy === 2) || (fx === 2 && fy === 1);
    const hl = .36, hw = w * 2.5;
    let path, ex, ey, nx, ny;
    if (knight) {
      const mx = fy === 2 ? ax : bx, my = fy === 2 ? by : ay;
      const l = Math.hypot(bx - mx, by - my); nx = (bx - mx) / l; ny = (by - my) / l;
      ex = bx - nx * hl; ey = by - ny * hl;
      path = `<polyline points="${ax},${ay} ${mx},${my} ${ex},${ey}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round"/>`;
    } else {
      const l = Math.hypot(bx - ax, by - ay); nx = (bx - ax) / l; ny = (by - ay) / l;
      ex = bx - nx * hl; ey = by - ny * hl;
      path = `<line x1="${ax + nx * .2}" y1="${ay + ny * .2}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${w}"/>`;
    }
    const head = `<polygon points="${bx},${by} ${ex - ny * hw / 2},${ey + nx * hw / 2} ${ex + ny * hw / 2},${ey - nx * hw / 2}" fill="${color}"/>`;
    // small numbered badge in the corner of the target square
    const badge = num ? `<g opacity="${Math.max(opacity, .9)}"><circle cx="${bx + .3}" cy="${by - .3}" r=".16" fill="${color}" stroke="#fff" stroke-width=".03"/><text x="${bx + .3}" y="${by - .245}" font-size=".19" font-weight="800" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif">${num}</text></g>` : '';
    return { a: `<g opacity="${opacity}">${path}${head}</g>`, badge };
  }
  function svgFor(b) {
    let s = b.querySelector(':scope > svg.bfm-svg');
    if (!s) {
      if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
      s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('class', 'bfm-svg'); s.setAttribute('viewBox', '0 0 8 8');
      b.appendChild(s);
    }
    return s;
  }
  function drawArrows() {
    const b = boardEl(); if (!b) return;
    const s = svgFor(b);
    if (!S.on || allowedHere() !== 'ok' || linesFen !== lastFen) { s.innerHTML = ''; return; }
    const flip = isFlipped(b);
    let h = '', badges = '';
    const n = Math.min(S.moves, lines.length);
    for (let i = n - 1; i >= 0; i--) {   // best move drawn last = on top
      const L = lines[i]; if (!L || !L.pv[0]) continue;
      let op = i === 0 ? .9 : .5;
      if (hoverIdx >= 0) op = i === hoverIdx ? .95 : .12;
      const r = arrow(L.pv[0], flip, i === 0 ? BEST : ALT, i === 0 ? .22 : .14, op, n > 1 ? i + 1 : 0);
      h += r.a; if (hoverIdx < 0 || hoverIdx === i) badges = r.badge + badges;
    }
    s.innerHTML = h + badges;
  }

  // ---------- formatting ----------
  const isMate = (L) => L.mate !== null && L.mate !== undefined;
  function fmt(L) { if (isMate(L)) return (L.mate > 0 ? 'M' : '-M') + Math.abs(L.mate); const v = L.cp / 100; return (v > 0 ? '+' : '') + v.toFixed(1); }
  function neg(L) { return isMate(L) ? L.mate < 0 : L.cp < 0; }
  function cpWhite(L) { return isMate(L) ? (L.mate > 0 ? 10000 - L.mate * 10 : -10000 - L.mate * 10) : L.cp; }
  function bestSan(L) {
    try { const c = new Chess(linesFen); const u = L.pv[0]; const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); return m ? m.san : u; } catch (e) { return L.pv[0]; }
  }
  function verdict(L) {
    if (isMate(L)) return `${L.mate > 0 ? 'White' : 'Black'} can force mate in ${Math.abs(L.mate)}`;
    const a = Math.abs(L.cp), side = L.cp > 0 ? 'White' : 'Black';
    if (a < 35) return 'The position is equal';
    if (a < 100) return `${side} is slightly better`;
    if (a < 250) return `${side} is better`;
    return `${side} is winning`;
  }
  // how much worse than the best move, from the side to move's point of view
  function quality(i, best, M, turn) {
    if (i === 0) return ['Best', 'q-best'];
    const loss = (cpWhite(best) - cpWhite(M)) * (turn === 'w' ? 1 : -1);
    if (loss <= 30) return ['Excellent', 'q-exc'];
    if (loss <= 80) return ['Good', 'q-good'];
    if (loss <= 200) return ['Inaccuracy', 'q-inac'];
    return ['Mistake', 'q-mis'];
  }
  function barPct(L) {
    if (isMate(L)) return L.mate > 0 ? 100 : 0;
    const cp = Math.max(-1500, Math.min(1500, L.cp));
    return Math.max(4, Math.min(96, 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)));
  }

  // ---------- panel ----------
  let panel = null;
  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'bfm-panel';
    panel.innerHTML = `
      <div class="bfm-head"><span class="bfm-logo"></span><b>Bossfrommars</b><span class="bfm-sp"></span>
        <button class="bfm-tg" title="Arrows on/off (Alt+A)"></button>
        <button class="bfm-ib bfm-gear" title="Settings">⚙</button>
        <button class="bfm-ib bfm-min" title="Minimise">–</button></div>
      <div class="bfm-body">
        <div class="bfm-evalrow">
          <div class="bfm-score">…</div>
          <div class="bfm-bar"><div class="bfm-barw"></div></div>
        </div>
        <div class="bfm-verdict">Waiting for board…</div>
        <div class="bfm-turn"></div>
        <div class="bfm-list"></div>
        <div class="bfm-foot"></div>
        <div class="bfm-set">
          <label>Eval bar <select data-k="evalbar"><option value="1">Left of board</option><option value="2">Right of board</option><option value="0">Off</option></select></label>
          <label>Moves shown <select data-k="moves"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
          <label>Engine depth <select data-k="depth"><option value="14">14 · fast</option><option value="18">18</option><option value="20">20 · normal</option><option value="24">24 · strong</option><option value="99">∞ · keep thinking</option></select></label>
        </div>
      </div>`;
    document.documentElement.appendChild(panel);
    if (S.x !== null) { panel.style.left = S.x + 'px'; panel.style.top = S.y + 'px'; panel.style.right = 'auto'; }
    panel.querySelectorAll('select').forEach((sel) => {
      sel.value = String(S[sel.dataset.k]);
      sel.onchange = () => { S[sel.dataset.k] = +sel.value; save(); if (sel.dataset.k !== 'evalbar') lastFen = null; renderAll(); };
    });
    panel.querySelector('.bfm-tg').onclick = toggle;
    panel.querySelector('.bfm-min').onclick = () => { S.min = !S.min; save(); renderPanel(); };
    panel.querySelector('.bfm-gear').onclick = () => panel.classList.toggle('bfm-showset');
    const list = panel.querySelector('.bfm-list');
    list.addEventListener('mouseover', (e) => { const r = e.target.closest('.bfm-mv'); const i = r ? +r.dataset.i : -1; if (i !== hoverIdx) { hoverIdx = i; drawArrows(); } });
    list.addEventListener('mouseleave', () => { hoverIdx = -1; drawArrows(); });
    // drag by the header
    const head = panel.querySelector('.bfm-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const mv = (ev) => { S.x = Math.max(0, Math.min(innerWidth - 60, ev.clientX - ox)); S.y = Math.max(0, Math.min(innerHeight - 30, ev.clientY - oy)); panel.style.left = S.x + 'px'; panel.style.top = S.y + 'px'; panel.style.right = 'auto'; };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); save(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    document.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'a' || e.key === 'A')) { toggle(); e.preventDefault(); } });
    renderPanel();
  }
  function toggle() { S.on = !S.on; save(); if (!S.on) stop(); renderAll(); }
  function message(icon, title, sub) {
    const q = (s) => panel.querySelector(s);
    q('.bfm-score').textContent = icon; q('.bfm-score').className = 'bfm-score';
    q('.bfm-barw').style.width = '50%';
    q('.bfm-verdict').textContent = title; q('.bfm-turn').textContent = sub || '';
    q('.bfm-list').innerHTML = ''; q('.bfm-foot').textContent = '';
  }
  function renderPanel() {
    if (!panel) return;
    const here = allowedHere(), b = boardEl();
    panel.classList.toggle('bfm-hidden', here === 'off');
    panel.classList.toggle('bfm-minimised', !!S.min);
    panel.querySelector('.bfm-tg').classList.toggle('on', S.on);
    if (here === 'ok' && !b) return message('…', 'Looking for the board…');
    if (!S.on) return message('Off', 'Arrows are off', 'Click the switch or press Alt+A');
    if (state === 'error') return message('!', 'Engine failed to load', 'Try reloading the page');
    if (state === 'over') return message('#', 'Game over', 'No moves left in this position');
    const fresh = linesFen === lastFen && lines[0];
    if (!fresh) return message('…', lastFen ? (loadingText || 'Thinking…') : 'Waiting for board…');
    const best = lines[0], turn = linesFen.split(' ')[1];
    const sc = panel.querySelector('.bfm-score');
    sc.textContent = fmt(best); sc.className = 'bfm-score' + (neg(best) ? ' neg' : '');
    panel.querySelector('.bfm-barw').style.width = barPct(best) + '%';
    panel.querySelector('.bfm-verdict').textContent = verdict(best);
    panel.querySelector('.bfm-turn').innerHTML = `<span class="bfm-pawn ${turn}"></span>${turn === 'w' ? 'White' : 'Black'} to move — top ${Math.min(S.moves, lines.filter(Boolean).length)} move${S.moves > 1 ? 's' : ''}:`;
    let h = '';
    for (let i = 0; i < S.moves; i++) {
      const M = lines[i];
      if (!M || !M.pv[0]) { h += `<div class="bfm-mv empty"><span class="bfm-num">${i + 1}</span><b>…</b></div>`; continue; }
      const [q, qc] = quality(i, best, M, turn);
      h += `<div class="bfm-mv${i === 0 ? ' top' : ''}" data-i="${i}"><span class="bfm-num">${i + 1}</span><b>${bestSan(M)}</b><span class="bfm-q ${qc}">${q}</span><span class="bfm-e${neg(M) ? ' neg' : ''}">${fmt(M)}</span></div>`;
    }
    panel.querySelector('.bfm-list').innerHTML = h;
    panel.querySelector('.bfm-foot').textContent = `${engineName || 'Stockfish 19'} · depth ${best.depth}${state === 'done' ? ' · done' : ' · thinking…'}`;
  }
  // ---------- eval bar next to the board ----------
  let bar = null;
  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'bfm-evalbar';
    bar.innerHTML = '<div class="bfm-eb-w"></div><div class="bfm-eb-mid"></div><span class="bfm-eb-l"></span>';
    document.documentElement.appendChild(bar);
  }
  function renderBar() {
    if (!bar) buildBar();
    const b = boardEl();
    const fresh = linesFen === lastFen && lines[0];
    const show = b && S.on && S.evalbar && allowedHere() === 'ok' && (fresh || state === 'over' || state === 'thinking');
    if (!show) { bar.style.display = 'none'; return; }
    const r = b.getBoundingClientRect();
    if (r.width < 50) { bar.style.display = 'none'; return; }
    const w = Math.max(14, Math.round(r.width * 0.035)), gap = 6;
    Object.assign(bar.style, {
      display: 'block', width: w + 'px', height: r.height + 'px', top: r.top + 'px',
      left: (S.evalbar === 2 ? r.right + gap : r.left - gap - w) + 'px'
    });
    const flip = isFlipped(b);
    bar.classList.toggle('flip', flip);
    let pct = 50, txt = '', whiteAhead = true;
    if (fresh) {
      const L = lines[0];
      pct = barPct(L);
      whiteAhead = isMate(L) ? L.mate > 0 : L.cp >= 0;
      txt = isMate(L) ? 'M' + Math.abs(L.mate) : Math.abs(L.cp / 100).toFixed(1);
    } else if (state === 'over') {
      try { const c = new Chess(lastFen); if (c.in_checkmate()) { whiteAhead = c.turn() === 'b'; pct = whiteAhead ? 100 : 0; txt = whiteAhead ? '1-0' : '0-1'; } else txt = '½'; } catch (e) {}
    }
    bar.querySelector('.bfm-eb-w').style.height = pct + '%';
    const l = bar.querySelector('.bfm-eb-l');
    l.textContent = txt;
    // number sits at the end of the side that is ahead (bottom = white unless flipped)
    const atBottom = whiteAhead !== flip;
    l.className = 'bfm-eb-l ' + (atBottom ? 'bot' : 'top') + (whiteAhead ? ' onw' : ' onb');
    l.style.fontSize = Math.max(9, Math.round(w * 0.42)) + 'px';
  }
  addEventListener('scroll', () => renderBar(), { passive: true, capture: true });
  addEventListener('resize', () => renderBar());

  function renderAll() { drawArrows(); renderPanel(); renderBar(); }

  // ---------- main loop ----------
  function tick() {
    const b = boardEl();
    const here = allowedHere();
    if (!b || !S.on || here !== 'ok' || document.visibilityState !== 'visible') {
      if (lastFen) stop();
      renderAll();
      return;
    }
    const fen = currentFen(b);
    if (!fen) { renderAll(); return; }
    const c = new Chess(fen);
    if (c.game_over()) { if (lastFen !== fen) { stop(); lastFen = fen; state = 'over'; } renderAll(); return; }
    if (fen !== lastFen) request(fen);
    else { drawArrows(); renderBar(); } // keep in sync with flips / board moving
  }
  setInterval(tick, 300);
})();