// ...existing code...
const audio = new Audio('My Chemical Romance - The World Is Ugly.mp3');
audio.loop = false;
audio.preload = 'auto';
audio.volume = 0.1;

const vinyldiskrotate = document.getElementById('vinyldisk');

const SONG_DURATION = 294; // fallback total length (seconds)
const START_OFFSET = 46;   // fallback start (seconds)

let lyricsTrack = null;
let viewport = null;
let rafId = null;
let cues = []; // { start: seconds, text: string }

let currentY = 0;
let initialY = 0;

function toSecondsFromTimestamp(ts) {
  const t = ts.replace(',', '.').trim();
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(t) || 0;
}

function parseSRT(text) {
  const blocks = text.split(/\r?\n\r?\n/).map(b => b.trim()).filter(Boolean);
  const parsed = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let tsLineIndex = 0;
    if (/^\d+$/.test(lines[0]) && lines.length > 1) tsLineIndex = 1;
    const tsLine = lines[tsLineIndex];
    const m = tsLine.match(/(\d{1,2}:\d{2}:\d{2}(?:[,.]\d+)?|\d{1,2}:\d{2}(?:[,.]\d+)?)[ \t]*-->[ \t]*(\d{1,2}:\d{2}:\d{2}(?:[,.]\d+)?|\d{1,2}:\d{2}(?:[,.]\d+)?)/);
    if (!m) continue;
    const start = toSecondsFromTimestamp(m[1]);
    const textLines = lines.slice(tsLineIndex + 1);
    const cueText = textLines.join('\n');
    parsed.push({ start, text: cueText });
  }
  parsed.sort((a, b) => a.start - b.start);
  return parsed;
}

async function tryLoadSRT() {
  try {
    const resp = await fetch('lyrics.srt', { cache: 'no-store' });
    if (!resp.ok) return null;
    const txt = await resp.text();
    const parsed = parseSRT(txt);
    if (parsed.length) return parsed;
  } catch (e) { /* ignore */ }
  return null;
}

function fallbackDistributeFromText(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const duration = Math.max(1, SONG_DURATION - START_OFFSET);
  const per = duration / Math.max(1, lines.length);
  return lines.map((ln, i) => ({ start: START_OFFSET + i * per, text: ln }));
}

function buildDOMFromCues(cuesArr) {
  lyricsTrack.innerHTML = '';
  cuesArr.forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.start = String(c.start);
    div.dataset.index = String(idx);
    div.textContent = c.text;
    Object.assign(div.style, {
      padding: '6px 0',
      opacity: '0.28',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
      whiteSpace: 'pre-wrap',
      fontWeight: '400',
      fontSize: 'clamp(16px, 3.5vw, 32px)',
      pointerEvents: 'none'
    });
    lyricsTrack.appendChild(div);
  });
}

function findActiveIndex(t) {
  for (let i = cues.length - 1; i >= 0; --i) {
    if (t >= cues[i].start) return i;
  }
  return -1;
}

function updatePosition() {
  if (!lyricsTrack) return;
  const t = audio.currentTime || 0;

  if (cues.length) {
    const active = findActiveIndex(t);
    const lines = lyricsTrack.children;

    for (let i = 0; i < lines.length; i++) {
      lines[i].style.opacity = i === active ? '1' : '0.25';
      lines[i].style.fontWeight = i === active ? '700' : '400';
      lines[i].style.transform = i === active ? 'scale(1.02)' : 'scale(1)';
    }

    // top offset where the active line should appear (e.g. 6% from top)
    const topOffset = Math.max(8, Math.round(viewport.clientHeight * 0.08));

    let targetYpx;
    if (active >= 0 && lines[active]) {
      const lineRect = lines[active].getBoundingClientRect();
      const trackRect = lyricsTrack.getBoundingClientRect();
      // distance from top of track to top of active line
      const lineTopFromTrack = (lineRect.top - trackRect.top);
      // desired scroll so that active line's top is at topOffset
      const desiredScroll = lineTopFromTrack - topOffset;
      // transform uses negative desiredScroll to move track up
      targetYpx = -desiredScroll;
    } else {
      // still before first cue: keep whole lyrics hidden above viewport
      targetYpx = initialY;
    }

    // smooth movement: lerp currentY -> targetY
    const speed = 0.06; // smaller = slower movement
    currentY += (targetYpx - currentY) * speed;

    lyricsTrack.style.transform = `translateX(-50%) translateY(${currentY}px)`;
    return;
  }

  // fallback continuous scroll if no cues
  const tOffset = Math.max(0, t - START_OFFSET);
  const total = Math.max(1, SONG_DURATION - START_OFFSET);
  const progress = Math.min(1, Math.max(0, tOffset / total));
  const startY = -100;
  const distance = 220;
  const yPercent = startY + distance * progress;
  lyricsTrack.style.transform = `translateX(-50%) translateY(${yPercent}%)`;
}

function rafLoop() {
  updatePosition();
  if (!audio.paused && !audio.ended) {
    rafId = requestAnimationFrame(rafLoop);
  } else {
    rafId = null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  lyricsTrack = document.querySelector('.lyrics-track');
  if (!lyricsTrack) return;

  // setup viewport wrapper
  viewport = document.createElement('div');
  viewport.className = 'lyrics-viewport';
  Object.assign(viewport.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'flex-start', // align start so top offset is meaningful
    justifyContent: 'center',
    pointerEvents: 'none'
  });
  const parent = lyricsTrack.parentElement;
  parent.replaceChild(viewport, lyricsTrack);
  viewport.appendChild(lyricsTrack);

  // disable CSS animation and ensure absolute positioning
  lyricsTrack.style.animation = 'none';
  lyricsTrack.style.left = '50%';
  lyricsTrack.style.top = '0';
  lyricsTrack.style.transform = 'translateX(-50%) translateY(0px)';
  lyricsTrack.style.willChange = 'transform';
  lyricsTrack.style.position = 'absolute';
  lyricsTrack.style.width = '100%';
  lyricsTrack.style.maxWidth = '1100px';
  lyricsTrack.style.textAlign = 'center';
  lyricsTrack.style.color = '#fff';
  lyricsTrack.style.pointerEvents = 'none';

  // try load SRT cues
  const external = await tryLoadSRT();
  if (external && external.length) {
    cues = external;
    buildDOMFromCues(cues);
  } else {
    // fallback to distributing existing text
    const raw = lyricsTrack.textContent || '';
    cues = fallbackDistributeFromText(raw);
    buildDOMFromCues(cues);
  }

  // compute initialY after DOM layout so lyrics are hidden above viewport
  await new Promise(requestAnimationFrame);
  const trackHeight = lyricsTrack.getBoundingClientRect().height;
  const vpHeight = viewport.clientHeight || window.innerHeight;
  // place lyrics fully above visible area
  initialY = -(trackHeight + vpHeight * 0.2);
  currentY = initialY;
  lyricsTrack.style.transform = `translateX(-50%) translateY(${currentY}px)`;

  function showPlayButton() {
    if (document.getElementById('audio-play-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'audio-play-btn';
    btn.textContent = 'Play';
    Object.assign(btn.style, { position: 'fixed', left: '37.6%', bottom: '20px', zIndex: 9999, padding: '12px 7px', borderRadius: '100%', height: '90.25px', width: '90.25px', opacity: '0'});
    btn.addEventListener('click', () => {
      vinyldiskrotate.style.animation = 'glowrotate 3s linear infinite';
      audio.play().catch(()=>{});
      btn.remove();
    });
    document.body.appendChild(btn);
  }

  audio.play().then(() => {
    if (!rafId) rafLoop();
  }).catch(() => {
    showPlayButton();
  });

  audio.addEventListener('play', () => { if (!rafId) rafLoop(); });
  audio.addEventListener('pause', () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } });
  audio.addEventListener('seeked', () => { /* immediate reposition on seek */ currentY = currentY; updatePosition(); });
  audio.addEventListener('timeupdate', updatePosition);
});
// ...existing code...