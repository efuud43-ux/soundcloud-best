/**
 * «Новый дизайн» в духе pear-desktop.
 *
 * Центр нового дизайна — полноэкранный экран «Now Playing» с раскладкой как в
 * pear: СЛЕВА обложка трека, название/исполнитель, прогресс и кнопки управления
 * (prev / play-pause / next), СПРАВА — крупный синхронизированный текст с
 * подсветкой активной строки, плавным авто-скроллом и перемоткой по клику.
 *
 * Кнопки управления проксируют клики на нативные контролы SoundCloud, поэтому
 * реально управляют воспроизведением. Текст берётся из main
 * (window.soundcloudAPI.getLyrics → тот же LyricsService, lrclib + YouTube).
 *
 * Дополнительно — Material-You-ish рестайл, заскоупленный под body.sc-pear-design,
 * так что классический вид возвращается снятием класса. В панель плеера
 * добавляются кнопки «Lyrics» (открыть экран) и «Design» (переключатель).
 */
export const pearDesignScript = `
(() => {
  if (window.__scPearDesignActive) return;
  window.__scPearDesignActive = true;

  function injectStyles() {
    if (document.getElementById('sc-pear-style')) return;
    const style = document.createElement('style');
    style.id = 'sc-pear-style';
    style.textContent = \`
      .sc-pear-btn {
        margin-left: 6px; height: 26px; padding: 0 12px; border-radius: 14px;
        border: 1px solid #ff5500; background: transparent; color: #ff5500;
        font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s ease;
      }
      .sc-pear-btn:hover, .sc-pear-btn.active { background: #ff5500; color: #fff; }

      /* ===== Now Playing screen ===== */
      .sc-np {
        position: fixed; inset: 0; z-index: 2147483000; display: none;
        color: #fff; overflow: hidden;
        font-family: 'Inter','Satoshi','Segoe UI',-apple-system,Roboto,sans-serif;
        background: rgba(8,8,11,0.9);
        -webkit-backdrop-filter: blur(50px) saturate(150%);
        backdrop-filter: blur(50px) saturate(150%);
      }
      .sc-np.open { display: flex; animation: sc-np-fade .3s ease; }
      @keyframes sc-np-fade { from { opacity: 0 } to { opacity: 1 } }
      .sc-np.open .sc-np-left { animation: sc-left-in .55s cubic-bezier(.22,.61,.36,1) both; }
      .sc-np.open .sc-np-art { animation: sc-art-in .6s cubic-bezier(.22,.61,.36,1) both; }
      @keyframes sc-left-in { from { opacity: 0; transform: translateY(26px); } }
      @keyframes sc-art-in { from { opacity: 0; transform: scale(.88); } }
      .sc-np-bg {
        position: absolute; inset: -12%; z-index: -1; background-size: cover;
        background-position: center; filter: blur(80px) brightness(.4) saturate(1.5);
        transform: scale(1.3); opacity: .75; transition: background-image .6s ease;
      }
      .sc-np-close {
        position: absolute; top: 22px; left: 26px; width: 42px; height: 42px;
        border-radius: 50%; border: none; background: rgba(255,255,255,.12);
        color: #fff; font-size: 20px; cursor: pointer; z-index: 2; transition: background .2s ease;
      }
      .sc-np-close:hover { background: rgba(255,255,255,.24); }

      /* left pane: artwork + meta + controls */
      .sc-np-left {
        flex: 0 0 42%; max-width: 42%; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 26px; padding: 60px 48px;
      }
      .sc-np-art {
        width: min(360px, 30vw); aspect-ratio: 1; border-radius: 22px; background-size: cover;
        background-position: center; box-shadow: 0 24px 70px rgba(0,0,0,.6); background-color: #1a1a1f;
      }
      .sc-np-meta { text-align: center; max-width: 100%; }
      .sc-np-title { font-size: clamp(1.5rem, 2vw, 2.1rem); font-weight: 800; letter-spacing: -.02em; }
      .sc-np-artist { font-size: 1rem; opacity: .65; margin-top: 6px; }
      .sc-np-progress { width: 100%; max-width: 440px; }
      .sc-np-bar {
        height: 6px; border-radius: 999px; background: rgba(255,255,255,.18);
        position: relative; cursor: pointer; transition: height .15s ease;
      }
      .sc-np-bar:hover, .sc-np-bar.dragging { height: 9px; }
      .sc-np-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #ff5500; border-radius: 999px; }
      .sc-np-handle {
        position: absolute; top: 50%; left: 0; width: 15px; height: 15px; border-radius: 50%;
        background: #fff; transform: translate(-50%, -50%); opacity: 0; pointer-events: none;
        box-shadow: 0 2px 8px rgba(0,0,0,.5); transition: opacity .15s ease;
      }
      .sc-np-bar:hover .sc-np-handle, .sc-np-bar.dragging .sc-np-handle { opacity: 1; }
      .sc-np-times { display: flex; justify-content: space-between; font-size: 12px; opacity: .6; margin-top: 10px; }
      .sc-np-controls { display: flex; align-items: center; gap: 28px; }
      .sc-np-ctl {
        width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
        background: transparent; color: rgba(255,255,255,.85); display: flex;
        align-items: center; justify-content: center; transition: color .2s ease, transform .1s ease, background .2s ease;
      }
      .sc-np-ctl:hover { color: #fff; }
      .sc-np-ctl:active { transform: scale(.9); }
      .sc-np-ctl.play {
        width: 66px; height: 66px; background: #fff; color: #111;
        box-shadow: 0 10px 28px rgba(0,0,0,.45);
      }
      .sc-np-ctl.play:hover { transform: scale(1.05); color: #111; }
      .sc-np-source {
        display: flex; gap: 4px; background: rgba(255,255,255,.08); border-radius: 999px;
        padding: 4px; margin-top: 4px;
      }
      .sc-np-source button {
        border: none; background: transparent; color: rgba(255,255,255,.6); font-size: 12px;
        font-weight: 700; padding: 6px 14px; border-radius: 999px; cursor: pointer; transition: all .2s ease;
      }
      .sc-np-source button.active { background: #ff5500; color: #fff; }
      .sc-np-source button:hover:not(.active) { color: #fff; }
      .sc-np-offset {
        display: flex; align-items: center; gap: 6px; margin-top: 4px;
        background: rgba(255,255,255,.08); border-radius: 999px; padding: 4px 6px;
        font-size: 12px; color: rgba(255,255,255,.8);
      }
      .sc-np-offset .label { padding: 0 8px; opacity: .65; font-weight: 600; }
      .sc-np-offset .val { min-width: 64px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
      .sc-np-offset button {
        width: 26px; height: 26px; border: none; border-radius: 50%; cursor: pointer;
        background: transparent; color: rgba(255,255,255,.85); font-size: 14px; font-weight: 800;
        transition: background .2s ease;
      }
      .sc-np-offset button:hover { background: rgba(255,255,255,.16); }

      /* right pane: lyrics */
      .sc-np-right {
        flex: 1; min-width: 0; overflow-y: auto; padding: 24vh 6vw 30vh 2vw; scrollbar-width: none;
        -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 14%, #000 86%, transparent 100%);
        mask-image: linear-gradient(180deg, transparent 0, #000 14%, #000 86%, transparent 100%);
      }
      .sc-np-right::-webkit-scrollbar { display: none; }
      .sc-lyric-line {
        font-size: clamp(1.6rem, 2.3vw, 2.5rem); font-weight: 800; line-height: 1.3;
        letter-spacing: -.01em; margin: 14px 0; opacity: .3; cursor: pointer; color: #fff;
        transform-origin: left center; filter: blur(.4px);
        transition: opacity .35s ease, transform .35s ease, text-shadow .35s ease, filter .35s ease;
      }
      .sc-lyric-line:hover { opacity: .6; }
      .sc-lyric-line.passed { opacity: .22; }
      .sc-lyric-line.current {
        opacity: 1; transform: scale(1.04); filter: none;
        text-shadow: 0 0 28px rgba(255,255,255,.32); animation: sc-lyric-pop .4s ease;
      }
      @keyframes sc-lyric-pop { 0% { transform: scale(1) } 60% { transform: scale(1.07) } 100% { transform: scale(1.04) } }
      @keyframes sc-line-rise { from { opacity: 0; transform: translateY(24px); filter: blur(3px); } }
      .sc-np-right.sc-enter .sc-lyric-line {
        animation: sc-line-rise .55s cubic-bezier(.22,.61,.36,1) backwards;
        animation-delay: calc(var(--i, 0) * .035s);
      }
      .sc-lyrics-empty { margin-top: 26vh; opacity: .55; font-size: 1.3rem; font-weight: 600; }

      @media (max-width: 820px) {
        .sc-np { flex-direction: column; }
        .sc-np-left { flex: none; max-width: 100%; padding: 70px 24px 16px; gap: 16px; }
        .sc-np-art { width: 180px; }
        .sc-np-right { padding: 4vh 24px 30vh; -webkit-mask-image: none; mask-image: none; }
      }

      /* ===== Material-You-ish global restyle ===== */
      body.sc-pear-design { background: #0c0c10 !important; }
      body.sc-pear-design .header, body.sc-pear-design .header__bg {
        background: rgba(14,14,18,.88) !important;
        -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); border: none !important;
      }
      body.sc-pear-design .playControls, body.sc-pear-design .playControls__bg {
        background: rgba(16,16,20,.9) !important;
        -webkit-backdrop-filter: blur(26px) saturate(140%); backdrop-filter: blur(26px) saturate(140%);
        border-top: 1px solid rgba(255,255,255,.06) !important;
      }
      body.sc-pear-design .image, body.sc-pear-design .sound__coverArt,
      body.sc-pear-design .fullHero__artwork, body.sc-pear-design .image__full,
      body.sc-pear-design .playableTile__artwork { border-radius: 16px !important; overflow: hidden; }
      body.sc-pear-design .image__lightOutline { box-shadow: 0 8px 26px rgba(0,0,0,.45) !important; }
      body.sc-pear-design button:not(.sc-np-close):not(.sc-np-ctl),
      body.sc-pear-design .sc-button, body.sc-pear-design .sc-button-cta,
      body.sc-pear-design .badge { border-radius: 999px !important; }
      body.sc-pear-design .l-container, body.sc-pear-design .l-main,
      body.sc-pear-design .l-fixed { background: transparent !important; }
      body.sc-pear-design ::-webkit-scrollbar { width: 10px; }
      body.sc-pear-design ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 999px; }
    \`;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------- helpers ----------
  function txt(sel) { const e = document.querySelector(sel); return e && e.textContent ? e.textContent.trim() : ''; }

  function currentTrack() {
    const link = document.querySelector('.playbackSoundBadge__titleLink');
    const title = link ? (link.getAttribute('title') || link.textContent || '').trim() : '';
    const artist = txt('.playbackSoundBadge__lightLink') || txt('.soundTitle__username');
    let art = '';
    const a = document.querySelector('.playbackSoundBadge__avatar .image__lightOutline span');
    if (a && a.style && a.style.backgroundImage) art = a.style.backgroundImage.replace(/^url\\(['"]?|['"]?\\)$/g, '');
    return { title: title, artist: artist, art: art };
  }

  function parseTime(t) {
    if (!t) return 0;
    const p = t.split(':').map(Number);
    if (p.length === 3) return (p[0]*3600 + p[1]*60 + p[2]) * 1000;
    if (p.length === 2) return (p[0]*60 + p[1]) * 1000;
    return 0;
  }
  function fmt(ms) {
    if (!ms || ms < 0) ms = 0;
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }
  function media() {
    const list = document.querySelectorAll('audio,video');
    for (let i = 0; i < list.length; i++) { const m = list[i]; if (m && !isNaN(m.duration) && m.duration > 0) return m; }
    return null;
  }
  function positionMs() {
    const m = media();
    if (m && m.currentTime > 0) return m.currentTime * 1000;
    return parseTime(txt('.playbackTimeline__timePassed span:last-child'));
  }
  function durationMs() {
    const m = media();
    if (m) return m.duration * 1000;
    return parseTime(txt('.playbackTimeline__duration span:last-child'));
  }
  function seek(ms) { const m = media(); if (m) { try { m.currentTime = ms / 1000; } catch (e) {} } }
  function nativeClick(sels) {
    for (let i = 0; i < sels.length; i++) { const el = document.querySelector(sels[i]); if (el) { el.click(); return true; } }
    return false;
  }
  function isPlaying() { const e = document.querySelector('.playControls__play'); return !!(e && e.classList.contains('playing')); }

  // ---------- overlay ----------
  let view, bg, artEl, titleEl, artistEl, linesEl, fillEl, handleEl, curTimeEl, durTimeEl, playBtn, barEl, srcWrap;
  let lines = [], synced = false, activeIdx = -1, loadedKey = '', triedKey = '', open = false, pending = false, dragging = false;
  let source = 'auto';
  try { source = localStorage.getItem('scLyricsSource') || 'auto'; } catch (e) {}

  // Положительный офсет = строка зажигается раньше таймкода (учитывает 200мс
  // тика, fade-анимации и небольшую задержку медиа-часов SoundCloud).
  let offsetMs = 300;
  try { const v = parseInt(localStorage.getItem('scLyricsOffset') || '', 10); if (!isNaN(v)) offsetMs = v; } catch (e) {}

  const ICONS = {
    prev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2.2v12H6zM18 6L9.2 12 18 18z"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M6 5h4.2v14H6zm7.8 0H18v14h-4.2z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M15.8 6H18v12h-2.2zM6 6l8.8 6L6 18z"/></svg>'
  };

  function buildOverlay() {
    if (view) return;
    view = document.createElement('div'); view.className = 'sc-np';
    bg = document.createElement('div'); bg.className = 'sc-np-bg';

    const close = document.createElement('button'); close.className = 'sc-np-close';
    close.textContent = '\\u2715'; close.addEventListener('click', toggleView);

    const left = document.createElement('div'); left.className = 'sc-np-left';
    artEl = document.createElement('div'); artEl.className = 'sc-np-art';
    const meta = document.createElement('div'); meta.className = 'sc-np-meta';
    titleEl = document.createElement('div'); titleEl.className = 'sc-np-title';
    artistEl = document.createElement('div'); artistEl.className = 'sc-np-artist';
    meta.appendChild(titleEl); meta.appendChild(artistEl);

    const prog = document.createElement('div'); prog.className = 'sc-np-progress';
    barEl = document.createElement('div'); barEl.className = 'sc-np-bar';
    fillEl = document.createElement('div'); fillEl.className = 'sc-np-fill';
    handleEl = document.createElement('div'); handleEl.className = 'sc-np-handle';
    barEl.appendChild(fillEl); barEl.appendChild(handleEl);
    const fracAt = (clientX) => {
      const r = barEl.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    };
    const applyFrac = (f) => { fillEl.style.width = (f * 100) + '%'; handleEl.style.left = (f * 100) + '%'; };
    barEl.addEventListener('pointerdown', (e) => { dragging = true; barEl.classList.add('dragging'); applyFrac(fracAt(e.clientX)); e.preventDefault(); });
    document.addEventListener('pointermove', (e) => { if (dragging) applyFrac(fracAt(e.clientX)); });
    document.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false; barEl.classList.remove('dragging');
      const d = durationMs(); if (d) seek(fracAt(e.clientX) * d);
    });
    const times = document.createElement('div'); times.className = 'sc-np-times';
    curTimeEl = document.createElement('span'); curTimeEl.textContent = '0:00';
    durTimeEl = document.createElement('span'); durTimeEl.textContent = '0:00';
    times.appendChild(curTimeEl); times.appendChild(durTimeEl);
    prog.appendChild(barEl); prog.appendChild(times);

    const controls = document.createElement('div'); controls.className = 'sc-np-controls';
    const prevBtn = document.createElement('button'); prevBtn.className = 'sc-np-ctl'; prevBtn.innerHTML = ICONS.prev;
    prevBtn.addEventListener('click', () => nativeClick(['.playControls__prev', '.skipControl__previous']));
    playBtn = document.createElement('button'); playBtn.className = 'sc-np-ctl play'; playBtn.innerHTML = ICONS.play;
    playBtn.addEventListener('click', () => nativeClick(['.playControls__play']));
    const nextBtn = document.createElement('button'); nextBtn.className = 'sc-np-ctl'; nextBtn.innerHTML = ICONS.next;
    nextBtn.addEventListener('click', () => nativeClick(['.playControls__next', '.skipControl__next']));
    controls.appendChild(prevBtn); controls.appendChild(playBtn); controls.appendChild(nextBtn);

    srcWrap = document.createElement('div'); srcWrap.className = 'sc-np-source';
    [['auto', 'Auto'], ['lrclib', 'LRCLIB'], ['youtube', 'YouTube']].forEach((o) => {
      const b = document.createElement('button'); b.dataset.s = o[0]; b.textContent = o[1];
      if (o[0] === source) b.classList.add('active');
      b.addEventListener('click', () => setSource(o[0]));
      srcWrap.appendChild(b);
    });

    const offWrap = document.createElement('div'); offWrap.className = 'sc-np-offset';
    const offLabel = document.createElement('span'); offLabel.className = 'label'; offLabel.textContent = 'Sync';
    const offMinus = document.createElement('button'); offMinus.textContent = '\\u2212'; offMinus.title = 'Lyrics earlier';
    const offVal = document.createElement('span'); offVal.className = 'val';
    const offPlus = document.createElement('button'); offPlus.textContent = '+'; offPlus.title = 'Lyrics later';
    const renderOff = () => { offVal.textContent = (offsetMs >= 0 ? '+' : '') + offsetMs + ' ms'; };
    const setOffset = (v) => {
      offsetMs = Math.max(-3000, Math.min(3000, v));
      try { localStorage.setItem('scLyricsOffset', String(offsetMs)); } catch (e) {}
      renderOff();
      activeIdx = -1; // форс-ресинк
    };
    offMinus.addEventListener('click', () => setOffset(offsetMs - 100));
    offPlus.addEventListener('click', () => setOffset(offsetMs + 100));
    offVal.addEventListener('click', () => setOffset(300)); // клик по значению — сброс к дефолту
    offVal.title = 'Click to reset';
    renderOff();
    offWrap.appendChild(offLabel); offWrap.appendChild(offMinus); offWrap.appendChild(offVal); offWrap.appendChild(offPlus);

    left.appendChild(artEl); left.appendChild(meta); left.appendChild(prog); left.appendChild(controls); left.appendChild(srcWrap); left.appendChild(offWrap);

    linesEl = document.createElement('div'); linesEl.className = 'sc-np-right';

    view.appendChild(bg); view.appendChild(close); view.appendChild(left); view.appendChild(linesEl);
    document.body.appendChild(view);
  }

  function renderLines() {
    linesEl.innerHTML = ''; activeIdx = -1;
    if (!lines.length) {
      const e = document.createElement('div'); e.className = 'sc-lyrics-empty';
      e.textContent = pending ? 'Searching lyrics\\u2026' : 'No lyrics found for this track';
      linesEl.appendChild(e); return;
    }
    lines.forEach((l, i) => {
      const d = document.createElement('div'); d.className = 'sc-lyric-line';
      d.style.setProperty('--i', String(Math.min(i, 22)));
      d.textContent = l.text || '\\u266a';
      if (synced) d.addEventListener('click', () => seek(l.timeMs));
      linesEl.appendChild(d);
    });
    // перезапуск каскадной анимации появления строк
    linesEl.classList.remove('sc-enter');
    void linesEl.offsetWidth;
    linesEl.classList.add('sc-enter');
  }

  function setActive(idx) {
    const kids = linesEl.children;
    if (activeIdx >= 0 && kids[activeIdx]) kids[activeIdx].classList.remove('current');
    for (let i = 0; i < kids.length; i++) kids[i].classList && kids[i].classList.toggle('passed', i < idx);
    activeIdx = idx;
    const el = kids[idx];
    if (el) {
      el.classList.add('current');
      linesEl.scrollTo({ top: el.offsetTop - linesEl.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
    }
  }

  async function loadLyrics(track) {
    const key = (track.artist + '|' + track.title + '|' + source).toLowerCase();
    const changed = key !== loadedKey;
    if (changed) {
      loadedKey = key;
      titleEl.textContent = track.title || 'Unknown';
      artistEl.textContent = track.artist || '';
      const big = track.art ? track.art.replace(/t\\d+x\\d+/, 't500x500') : '';
      bg.style.backgroundImage = big ? 'url("' + big + '")' : 'none';
      artEl.style.backgroundImage = big ? 'url("' + big + '")' : 'none';
      lines = []; synced = false; pending = true; renderLines();
    } else if (lines.length) {
      return; // текст для этого трека/источника уже загружен
    } else if (source !== 'auto' && triedKey === key) {
      return; // явный источник уже ответил пусто — не спамим
    }
    if (!track.title || !window.soundcloudAPI || !window.soundcloudAPI.getLyrics) { pending = false; renderLines(); return; }
    try {
      const res = await window.soundcloudAPI.getLyrics(track.artist, track.title, source);
      if (key !== loadedKey) return;
      if (source !== 'auto') triedKey = key;
      if (res && res.lines && res.lines.length) {
        lines = res.lines; synced = !!res.synced; pending = false; renderLines();
      } else {
        pending = source === 'auto' ? !!(res && res.pending) : false; renderLines();
      }
    } catch (e) {}
  }

  function setSource(s) {
    if (source === s) return;
    source = s;
    try { localStorage.setItem('scLyricsSource', s); } catch (e) {}
    if (srcWrap) for (let i = 0; i < srcWrap.children.length; i++) srcWrap.children[i].classList.toggle('active', srcWrap.children[i].dataset.s === s);
    loadedKey = ''; lines = []; synced = false; pending = true; renderLines();
    loadLyrics(currentTrack());
  }

  function tick() {
    if (!open) return;
    playBtn.innerHTML = isPlaying() ? ICONS.pause : ICONS.play;
    const pos = positionMs(), dur = durationMs();
    if (dur > 0) durTimeEl.textContent = fmt(dur);
    curTimeEl.textContent = fmt(pos);
    if (!dragging && dur > 0) {
      const f = Math.min(100, (pos / dur) * 100);
      fillEl.style.width = f + '%'; handleEl.style.left = f + '%';
    }
    if (synced && lines.length) {
      const adj = pos + offsetMs;
      let idx = -1;
      for (let i = lines.length - 1; i >= 0; i--) { if (adj >= lines[i].timeMs) { idx = i; break; } }
      if (idx !== activeIdx) setActive(idx);
    }
  }

  function toggleView() {
    buildOverlay();
    open = !open;
    view.classList.toggle('open', open);
    const btn = document.getElementById('sc-lyrics-btn');
    if (btn) btn.classList.toggle('active', open);
    if (open) { loadLyrics(currentTrack()); activeIdx = -1; }
  }

  // ---------- design toggle ----------
  function applyDesign(on) {
    document.body.classList.toggle('sc-pear-design', !!on);
    const btn = document.getElementById('sc-design-btn');
    if (btn) btn.classList.toggle('active', !!on);
  }
  async function toggleDesign() {
    const on = !document.body.classList.contains('sc-pear-design');
    applyDesign(on);
    if (window.soundcloudAPI && window.soundcloudAPI.setDesign) { try { await window.soundcloudAPI.setDesign(on); } catch (e) {} }
  }

  // ---------- buttons ----------
  function ensureButtons() {
    const controls = document.querySelector('.playControls__elements') ||
                     document.querySelector('.playControls__inner') ||
                     document.querySelector('.playControls');
    if (!controls) return;
    if (!document.getElementById('sc-lyrics-btn')) {
      const b = document.createElement('button');
      b.id = 'sc-lyrics-btn'; b.className = 'sc-pear-btn'; b.type = 'button';
      b.textContent = 'Lyrics'; b.title = 'Now playing + synced lyrics';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleView(); });
      controls.appendChild(b);
    }
    if (!document.getElementById('sc-design-btn')) {
      const d = document.createElement('button');
      d.id = 'sc-design-btn'; d.className = 'sc-pear-btn'; d.type = 'button';
      d.textContent = 'Design'; d.title = 'Toggle classic / new design';
      d.classList.toggle('active', document.body.classList.contains('sc-pear-design'));
      d.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleDesign(); });
      controls.appendChild(d);
    }
  }

  function init() {
    injectStyles();
    buildOverlay();
    ensureButtons();
    if (window.soundcloudAPI && window.soundcloudAPI.getDesign) {
      window.soundcloudAPI.getDesign().then(applyDesign).catch(() => {});
    }
    setInterval(ensureButtons, 1500);
    setInterval(() => { if (open) loadLyrics(currentTrack()); }, 1000);
    setInterval(tick, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
`;
