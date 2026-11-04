// Runs in the page's own JS world so it can read Chess.com's board object directly.
(function () {
  function read() {
    const el = document.querySelector('wc-chess-board, chess-board');
    let fen = null, over = false, flipped = null;
    if (el && el.game) {
      const g = el.game;
      try { if (typeof g.getFEN === 'function') fen = g.getFEN(); } catch (e) {}
      try { if (typeof g.isGameOver === 'function') over = !!g.isGameOver(); } catch (e) {}
      try { const o = g.getOptions && g.getOptions(); if (o && typeof o.flipped === 'boolean') flipped = o.flipped; } catch (e) {}
    }
    window.postMessage({ __bfm: 'pos', fen, over, flipped }, '*');
  }
  setInterval(read, 250);
  read();
})();
