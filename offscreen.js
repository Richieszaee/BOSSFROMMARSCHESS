// Runs Stockfish 19 in a Web Worker and streams results back through the background worker.
const ENGINES = {
  lite: { file: 'stockfish-19-lite-single.js', name: 'Stockfish 19 Lite', threaded: false, hash: 64 }
};
let port = null;
let sf = null, ready = false, loadedKey = null, engTimer = 0, engineName = '';
let searching = false, stopping = false, pending = null, cur = null, appliedMpv = 0;

function connect() {
  port = chrome.runtime.connect({ name: 'engine' });
  port.onMessage.addListener(onRequest);
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 300); });
}
function send(m) { if (port) { try { port.postMessage(m); } catch (e) {} } }
function note(text) { if (pending || cur) send({ type: 'status', tabId: (pending || cur).tabId, fen: (pending || cur).fen, text }); }

function load(key) {
  clearTimeout(engTimer);
  try { sf && sf.terminate(); } catch (e) {}
  sf = null; ready = false; searching = false; stopping = false; appliedMpv = 0;
  loadedKey = key;
  const E = ENGINES[key];
  note('Loading ' + E.name + '…');
  try {
    sf = new Worker(E.file);
    sf.onerror = (e) => { e.preventDefault(); fail(key); };
    sf.onmessage = (e) => onLine(String(e.data));
    sf.postMessage('uci');
  } catch (e) { fail(key); return; }
  engTimer = setTimeout(() => { if (!ready && loadedKey === key) fail(key); }, 15000);
}
function fail(key) {
  if (ready || loadedKey !== key) return;
  const t = pending || cur;
  send({ type: 'error', tabId: t && t.tabId, msg: 'Engine failed to load' });
}

function onLine(l) {
  if (l === 'uciok') {
    const E = ENGINES[loadedKey];
    if (E.threaded) {
      const th = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
      sf.postMessage('setoption name Threads value ' + th);
    }
    sf.postMessage('setoption name Hash value ' + E.hash);
    sf.postMessage('isready');
    return;
  }
  if (l === 'readyok') {
    if (!ready) { ready = true; clearTimeout(engTimer); engineName = ENGINES[loadedKey].name; kick(); }
    return;
  }
  if (l.startsWith('bestmove')) {
    const wasStop = stopping;
    searching = false; stopping = false;
    if (!wasStop && cur) send({ type: 'done', tabId: cur.tabId, fen: cur.fen });
    kick();
    return;
  }
  if (l.startsWith('info') && l.includes(' pv ') && !stopping && cur) parseInfo(l);
}

function parseInfo(l) {
  const t = l.split(' ');
  let depth = 0, mpv = 1, cp = null, mate = null, pv = [], nps = 0, bound = false;
  for (let i = 0; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') depth = +t[++i];
    else if (k === 'multipv') mpv = +t[++i];
    else if (k === 'nps') nps = +t[++i];
    else if (k === 'score') { const ty = t[++i], v = +t[++i]; if (ty === 'cp') cp = v; else mate = v; }
    else if (k === 'lowerbound' || k === 'upperbound') bound = true;
    else if (k === 'pv') { pv = t.slice(i + 1); break; }
  }
  if (bound) return;
  if (cur.fen.split(' ')[1] === 'b') { if (cp !== null) cp = -cp; if (mate !== null) mate = -mate; }
  send({ type: 'info', tabId: cur.tabId, fen: cur.fen, engine: engineName, depth, mpv, cp, mate, pv, nps });
}

function kick() {
  if (!ready || searching || !pending) return;
  cur = pending; pending = null;
  if (appliedMpv !== cur.multipv) { sf.postMessage('setoption name MultiPV value ' + cur.multipv); appliedMpv = cur.multipv; }
  sf.postMessage('position fen ' + cur.fen);
  sf.postMessage(cur.depth >= 99 ? 'go infinite' : 'go depth ' + cur.depth);
  searching = true;
  send({ type: 'started', tabId: cur.tabId, fen: cur.fen, engine: engineName });
}

function onRequest(m) {
  if (m.type === 'go') {
    pending = { tabId: m.tabId, fen: m.fen, multipv: m.multipv || 1, depth: m.depth || 20 };
    const target = 'lite';
    if (loadedKey !== target) { load(target); return; }
    if (!ready) { note('Loading ' + ENGINES[loadedKey].name + '…'); return; }
    if (searching) { stopping = true; sf.postMessage('stop'); } else kick();
  } else if (m.type === 'stop') {
    if (pending && pending.tabId === m.tabId) pending = null;
    if (searching && cur && cur.tabId === m.tabId) { stopping = true; sf.postMessage('stop'); }
  }
}

connect();
