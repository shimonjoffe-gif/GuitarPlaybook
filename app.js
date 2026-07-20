(() => {
  "use strict";

  const app = document.getElementById("app");
  let catalog = { artists: [] };

  const CHORD_RE = /\[([^\]]+)\]/g;

  function renderChordLine(text) {
    return text.replace(CHORD_RE, (_, chord) => `<span class="chord">${escapeHtml(chord)}</span>`);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderSongBody(body) {
    return body
      .split("\n")
      .map((line) => renderChordLine(escapeHtml(line)))
      .join("\n");
  }

  function findArtist(id) {
    return catalog.artists.find((a) => a.id === id);
  }
  function findSong(artistId, songId) {
    const artist = findArtist(artistId);
    if (!artist) return null;
    const song = artist.songs.find((s) => s.id === songId);
    return song ? { artist, song } : null;
  }

  function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    const parts = hash.split("/").filter(Boolean);
    if (parts.length === 0) return renderArtistList();
    if (parts.length === 1) return renderSongList(decodeURIComponent(parts[0]));
    if (parts.length === 2) return renderSong(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
    renderArtistList();
  }

  function setPage({ title, backHref, bodyHtml }) {
    document.body.querySelectorAll(".controls").forEach((c) => c.remove());
    app.innerHTML = `
      <header class="topbar">
        ${backHref ? `<button class="back" data-nav="${backHref}">‹</button>` : ""}
        <h1>${escapeHtml(title)}</h1>
      </header>
      <main>${bodyHtml}</main>
    `;
    app.querySelectorAll("[data-nav]").forEach((el) => {
      el.addEventListener("click", () => { location.hash = el.getAttribute("data-nav"); });
    });
  }

  function renderArtistList() {
    if (catalog.artists.length === 0) {
      setPage({
        title: "Guitar Playbook",
        bodyHtml: `<div class="empty-state">Каталог пока пуст.<br>Песни добавляются с компьютера.</div>`
      });
      return;
    }
    const items = catalog.artists
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((a) => `
        <li><a data-nav="/${encodeURIComponent(a.id)}">
          <span>${escapeHtml(a.name)}</span>
          <span class="meta">${a.songs.length} <span class="chevron">›</span></span>
        </a></li>
      `).join("");
    setPage({ title: "Исполнители", bodyHtml: `<ul class="list">${items}</ul>` });
  }

  function renderSongList(artistId) {
    const artist = findArtist(artistId);
    if (!artist) return renderArtistList();
    const items = artist.songs
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title, "ru"))
      .map((s) => `
        <li><a data-nav="/${encodeURIComponent(artistId)}/${encodeURIComponent(s.id)}">
          <span>${escapeHtml(s.title)}</span>
          <span class="meta">${s.key || ""} <span class="chevron">›</span></span>
        </a></li>
      `).join("");
    setPage({ title: artist.name, backHref: "/", bodyHtml: `<ul class="list">${items}</ul>` });
  }

  function renderSong(artistId, songId) {
    const found = findSong(artistId, songId);
    if (!found) return renderArtistList();
    const { artist, song } = found;
    setPage({
      title: song.title,
      backHref: `/${encodeURIComponent(artistId)}`,
      bodyHtml: `
        <div class="song-meta-bar">
          ${song.key ? `<span>Тональность: ${escapeHtml(song.key)}</span>` : ""}
          ${song.bpm ? `<span>BPM: ${escapeHtml(String(song.bpm))}</span>` : ""}
        </div>
        <div class="song-body" id="song-body">${renderSongBody(song.body)}</div>
        <div style="height:1px"></div>
      `
    });
    setupScroller(song);
  }

  // --- Auto-scroll engine ---
  const SPEED_MIN = 30;
  const SPEED_MAX = 60;

  function setupScroller(song) {
    const main = document.querySelector("main");
    const clamp = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(v)));
    let speed = clamp(Number(localStorage.getItem(`speed:${song.id}`)) || pxPerSecFromBpm(song.bpm) || 40);
    let playing = false;
    let rafId = null;
    let lastTs = null;
    let tapTimes = [];

    const controls = document.createElement("div");
    controls.className = "controls";
    controls.innerHTML = `
      <div class="row">
        <button id="tap" title="Тап-темп">Темп</button>
        <button id="playpause" class="primary wide">Старт</button>
        <button id="top" title="В начало">⤒</button>
      </div>
      <div class="row">
        <span style="color:var(--text-dim);font-size:0.8rem;">медленно</span>
        <input id="speedRange" type="range" min="${SPEED_MIN}" max="${SPEED_MAX}" step="1" value="${speed}">
        <span style="color:var(--text-dim);font-size:0.8rem;">быстро</span>
        <span class="speed-label" id="speedLabel">${speed} px/с</span>
      </div>
      <div class="hint-swipe">Во время воспроизведения: свайп вверх/вниз по тексту — скорость</div>
    `;
    document.body.appendChild(controls);

    const speedRange = controls.querySelector("#speedRange");
    const speedLabel = controls.querySelector("#speedLabel");
    const playBtn = controls.querySelector("#playpause");

    function setSpeed(v) {
      speed = clamp(v);
      speedRange.value = String(speed);
      speedLabel.textContent = `${speed} px/с`;
      localStorage.setItem(`speed:${song.id}`, String(speed));
    }

    // iOS WebKit can keep momentum-scrolling a finger-scrolled list; that inertia then
    // fights our programmatic scrollTop updates. Briefly toggling overflow cancels it.
    function killMomentumScroll() {
      main.style.overflowY = "hidden";
      void main.offsetHeight;
      main.style.overflowY = "auto";
    }

    function step(ts) {
      if (!playing) return;
      if (lastTs != null) {
        const dt = (ts - lastTs) / 1000;
        main.scrollTop += speed * dt;
        if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) {
          pause();
          return;
        }
      }
      lastTs = ts;
      rafId = requestAnimationFrame(step);
    }

    function play() {
      killMomentumScroll();
      playing = true;
      lastTs = null;
      playBtn.textContent = "Пауза";
      rafId = requestAnimationFrame(step);
    }
    function pause() {
      playing = false;
      playBtn.textContent = "Старт";
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    playBtn.addEventListener("click", () => (playing ? pause() : play()));
    controls.querySelector("#top").addEventListener("click", () => {
      main.scrollTop = 0;
    });
    speedRange.addEventListener("input", () => setSpeed(Number(speedRange.value)));

    controls.querySelector("#tap").addEventListener("click", () => {
      const now = performance.now();
      tapTimes.push(now);
      tapTimes = tapTimes.filter((t) => now - t < 4000);
      if (tapTimes.length >= 2) {
        const intervals = [];
        for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
        const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avgMs);
        setSpeed(pxPerSecFromBpm(bpm));
        speedLabel.textContent = `${speed} px/с (~${bpm} BPM)`;
      }
    });

    // Swipe up/down on the lyrics while playing adjusts speed instead of scrolling manually.
    let dragStartY = null;
    let dragStartSpeed = speed;
    main.addEventListener(
      "touchstart",
      (e) => {
        if (!playing) return;
        dragStartY = e.touches[0].clientY;
        dragStartSpeed = speed;
      },
      { passive: true }
    );
    main.addEventListener(
      "touchmove",
      (e) => {
        if (!playing || dragStartY == null) return;
        e.preventDefault();
        const dy = dragStartY - e.touches[0].clientY;
        setSpeed(dragStartSpeed + dy * 0.15);
      },
      { passive: false }
    );
    main.addEventListener(
      "touchend",
      () => {
        dragStartY = null;
      },
      { passive: true }
    );
  }

  function pxPerSecFromBpm(bpm) {
    if (!bpm) return null;
    // Maps a ~60-140 bpm range onto the 30-60 px/s scroll range; fine-tune with the slider/swipe.
    return Math.round((bpm / 60) * 27);
  }

  window.addEventListener("hashchange", route);

  async function loadCatalog() {
    try {
      const res = await fetch("data/catalog.json", { cache: "no-cache" });
      catalog = await res.json();
    } catch (e) {
      catalog = { artists: [] };
    }
    route();
  }

  if ("serviceWorker" in navigator) {
    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshedOnce) return;
      refreshedOnce = true;
      location.reload();
    });
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  }

  loadCatalog();
})();
