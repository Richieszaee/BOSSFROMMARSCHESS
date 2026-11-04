// Relays messages between Chess.com tabs and the offscreen Stockfish engine.
let engine = null;          // port to offscreen document
let queued = null;          // last request waiting for the engine
const tabs = new Map();     // tabId -> port

async function ensureOffscreen() {
  try {
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (ctx.length) return;
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run the Stockfish chess engine in a Web Worker'
    });
  } catch (e) { /* already exists */ }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'engine') {
    engine = port;
    port.onMessage.addListener((m) => {
      const t = tabs.get(m.tabId);
      if (t) { try { t.postMessage(m); } catch (e) {} }
    });
    port.onDisconnect.addListener(() => { if (engine === port) engine = null; });
    if (queued) { port.postMessage(queued); queued = null; }
    return;
  }
  if (port.name === 'tab' && port.sender && port.sender.tab) {
    const id = port.sender.tab.id;
    tabs.set(id, port);
    port.onDisconnect.addListener(() => {
      if (tabs.get(id) === port) tabs.delete(id);
      if (engine) engine.postMessage({ type: 'stop', tabId: id });
    });
    port.onMessage.addListener(async (m) => {
      m.tabId = id;
      if (engine) { engine.postMessage(m); return; }
      queued = m;
      await ensureOffscreen();
    });
  }
});
