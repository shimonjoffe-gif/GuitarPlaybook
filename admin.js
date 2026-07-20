(() => {
  "use strict";

  let fileHandle = null;
  let catalog = { artists: [] };

  const els = {
    openFile: document.getElementById("openFile"),
    fileStatus: document.getElementById("fileStatus"),
    formPanel: document.getElementById("formPanel"),
    artist: document.getElementById("artist"),
    artistList: document.getElementById("artistList"),
    title: document.getElementById("title"),
    key: document.getElementById("key"),
    bpm: document.getElementById("bpm"),
    sourceUrl: document.getElementById("sourceUrl"),
    raw: document.getElementById("raw"),
    convert: document.getElementById("convert"),
    result: document.getElementById("result"),
    save: document.getElementById("save"),
    saveStatus: document.getElementById("saveStatus"),
    catalogList: document.getElementById("catalogList"),
  };

  // --- Chord parsing: two-line (chords-over-lyrics) -> inline [Chord]lyric ---

  const CHORD_TOKEN_RE =
    /^[A-H](#|b)?(maj|min|m)?\d{0,2}(sus2|sus4|sus|add\d?|dim|aug)?(\/[A-H](#|b)?\d{0,2})?$|^\d+[xxхр×]$/i;

  function isChordToken(tok) {
    return CHORD_TOKEN_RE.test(tok);
  }

  function isChordLine(line) {
    const t = line.trim();
    if (!t) return false;
    const tokens = t.split(/\s+/);
    return tokens.every(isChordToken);
  }

  function mergeChordLyric(chordLine, lyricLine) {
    const matches = [...chordLine.matchAll(/\S+/g)];
    let result = lyricLine;
    for (let m = matches.length - 1; m >= 0; m--) {
      const token = matches[m][0];
      const col = matches[m].index;
      const insertion = `[${token}]`;
      if (col > result.length) {
        result += " ".repeat(col - result.length);
      }
      result = result.slice(0, col) + insertion + result.slice(col);
    }
    return result;
  }

  function convertText(raw) {
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const next = i + 1 < lines.length ? lines[i + 1] : null;
      if (isChordLine(line) && next !== null && next.trim() !== "" && !isChordLine(next)) {
        out.push(mergeChordLyric(line, next));
        i += 2;
      } else if (isChordLine(line)) {
        out.push(
          line.trim().split(/\s+/).map((t) => `[${t}]`).join(" ")
        );
        i += 1;
      } else {
        out.push(line);
        i += 1;
      }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // --- File handling ---

  function slugify(str) {
    return str
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "");
  }

  function refreshArtistList() {
    els.artistList.innerHTML = catalog.artists
      .map((a) => `<option value="${a.name}">`)
      .join("");
  }

  function refreshCatalogView() {
    if (catalog.artists.length === 0) {
      els.catalogList.innerHTML = "<li>Каталог пуст</li>";
      return;
    }
    els.catalogList.innerHTML = catalog.artists
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map(
        (a) => `<li><b>${a.name}</b> — ${a.songs.map((s) => s.title).join(", ")}</li>`
      )
      .join("");
  }

  els.openFile.addEventListener("click", async () => {
    try {
      [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      catalog = text.trim() ? JSON.parse(text) : { artists: [] };
      if (!Array.isArray(catalog.artists)) catalog.artists = [];
      els.fileStatus.textContent = `Открыт: ${file.name}`;
      els.fileStatus.className = "status ok";
      els.formPanel.hidden = false;
      refreshArtistList();
      refreshCatalogView();
    } catch (e) {
      if (e.name !== "AbortError") {
        els.fileStatus.textContent = "Не удалось открыть файл: " + e.message;
        els.fileStatus.className = "status err";
      }
    }
  });

  els.convert.addEventListener("click", () => {
    els.result.value = convertText(els.raw.value);
  });

  async function writeCatalog() {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(catalog, null, 2));
    await writable.close();
  }

  els.save.addEventListener("click", async () => {
    const artistName = els.artist.value.trim();
    const title = els.title.value.trim();
    const body = els.result.value.trim();

    if (!fileHandle) {
      els.saveStatus.textContent = "Сначала откройте catalog.json";
      els.saveStatus.className = "status err";
      return;
    }
    if (!artistName || !title || !body) {
      els.saveStatus.textContent = "Заполните исполнителя, название и текст";
      els.saveStatus.className = "status err";
      return;
    }

    let artist = catalog.artists.find(
      (a) => a.name.toLowerCase() === artistName.toLowerCase()
    );
    if (!artist) {
      artist = { id: slugify(artistName) || `artist-${Date.now()}`, name: artistName, songs: [] };
      catalog.artists.push(artist);
    }

    const song = {
      id: slugify(title) || `song-${Date.now()}`,
      title,
      key: els.key.value.trim(),
      bpm: els.bpm.value ? Number(els.bpm.value) : undefined,
      sourceUrl: els.sourceUrl.value.trim(),
      body,
    };
    const existingIdx = artist.songs.findIndex((s) => s.id === song.id);
    if (existingIdx >= 0) artist.songs[existingIdx] = song;
    else artist.songs.push(song);

    try {
      await writeCatalog();
      els.saveStatus.textContent = `Сохранено: ${artistName} — ${title}`;
      els.saveStatus.className = "status ok";
      els.artist.value = "";
      els.title.value = "";
      els.key.value = "";
      els.bpm.value = "";
      els.sourceUrl.value = "";
      els.raw.value = "";
      els.result.value = "";
      refreshArtistList();
      refreshCatalogView();
    } catch (e) {
      els.saveStatus.textContent = "Ошибка сохранения: " + e.message;
      els.saveStatus.className = "status err";
    }
  });

  if (!window.showOpenFilePicker) {
    els.fileStatus.textContent =
      "Ваш браузер не поддерживает File System Access API — используйте Chrome или Edge на компьютере.";
    els.fileStatus.className = "status err";
    els.openFile.disabled = true;
  }
})();
