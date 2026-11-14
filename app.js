(() => {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────
  const audio = document.getElementById("audio");
  const playlistEl = document.getElementById("playlist");
  const trackTitle = document.getElementById("track-title");
  const trackArtist = document.getElementById("track-artist");
  const progressFill = document.getElementById("progress-fill");
  const progressBar = document.getElementById("progress-bar");
  const timeCurrent = document.getElementById("time-current");
  const timeTotal = document.getElementById("time-total");
  const btnPlay = document.getElementById("btn-play");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const volume = document.getElementById("volume");
  const streamUrlInput = document.getElementById("stream-url");
  const btnLoadStream = document.getElementById("btn-load-stream");
  const btnAddUrl = document.getElementById("btn-add-url");
  const onairBadge = document.getElementById("onair-badge");
  const coverArt = document.getElementById("cover-art");
  const vuL = document.getElementById("vu-l");
  const vuR = document.getElementById("vu-r");
  const clockEl = document.getElementById("clock");
  const mtaUrl = document.getElementById("mta-url");
  const mtaName = document.getElementById("mta-name");
  const mtaLua = document.getElementById("mta-lua");
  const btnCopyLua = document.getElementById("btn-copy-lua");

  let tracks = [
    {
      title: "Exemplo — cole sua URL de stream",
      artist: "Icecast / SHOUTcast",
      url: "",
    },
  ];
  let current = -1;
  let isPlaying = false;
  let vuTimer = null;

  // ── Clock ──────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("pt-BR", { hour12: false });
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ── Tabs ───────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  // ── Profiles ───────────────────────────────────────────────────────────
  document.querySelectorAll(".profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".profile-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // ── EQ sliders (visual only) ───────────────────────────────────────────
  const eqBands = ["60", "250", "1k", "4k", "12k"];
  const eqContainer = document.getElementById("eq-sliders");
  eqBands.forEach((label) => {
    const div = document.createElement("div");
    div.className = "eq-band";
    div.innerHTML = `
      <input type="range" min="-12" max="12" value="0" step="0.5" />
      <span class="eq-label">${label}</span>
    `;
    eqContainer.appendChild(div);
  });

  // ── Playlist UI ────────────────────────────────────────────────────────
  function renderPlaylist() {
    playlistEl.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      if (i === current) li.classList.add("active");
      li.innerHTML = `
        <span class="idx">${String(i + 1).padStart(2, "0")}</span>
        <div class="meta">
          <div class="name">${escapeHtml(t.title)}</div>
          <div class="sub">${escapeHtml(t.artist || "Stream")}</div>
        </div>
      `;
      li.addEventListener("click", () => playIndex(i));
      playlistEl.appendChild(li);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Player core ────────────────────────────────────────────────────────
  function formatTime(sec) {
    if (!isFinite(sec) || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function setPlayingUI(playing) {
    isPlaying = playing;
    iconPlay.classList.toggle("hidden", playing);
    iconPause.classList.toggle("hidden", !playing);
    coverArt.classList.toggle("playing", playing);
    onairBadge.textContent = playing ? "ON AIR" : "OFFLINE";
    onairBadge.classList.toggle("online", playing);
    onairBadge.classList.toggle("offline", !playing);
  }

  function playIndex(idx) {
    if (idx < 0 || idx >= tracks.length) return;
    const t = tracks[idx];
    if (!t.url) {
      trackTitle.textContent = t.title;
      trackArtist.textContent = "Cole uma URL válida e clique em CARREGAR";
      return;
    }
    current = idx;
    audio.src = t.url;
    audio.play().then(() => {
      setPlayingUI(true);
      startVu();
    }).catch((err) => {
      console.warn("Play error:", err);
      trackArtist.textContent = "Erro ao tocar — verifique CORS ou URL";
      setPlayingUI(false);
    });
    trackTitle.textContent = t.title;
    trackArtist.textContent = t.artist || "Stream ao vivo";
    renderPlaylist();
  }

  function togglePlay() {
    if (!audio.src) {
      // try load from input
      const url = streamUrlInput.value.trim();
      if (url) {
        addAndPlay(url);
        return;
      }
      return;
    }
    if (audio.paused) {
      audio.play().then(() => {
        setPlayingUI(true);
        startVu();
      }).catch(() => setPlayingUI(false));
    } else {
      audio.pause();
      setPlayingUI(false);
      stopVu();
    }
  }

  function addAndPlay(url) {
    let title = "Stream ao vivo";
    try {
      const u = new URL(url);
      title = u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch (_) {}
    const entry = { title, artist: "HTTP Stream", url };
    // replace empty placeholder or add
    if (tracks.length === 1 && !tracks[0].url) {
      tracks[0] = entry;
      playIndex(0);
    } else {
      tracks.push(entry);
      playIndex(tracks.length - 1);
    }
    renderPlaylist();
  }

  btnPlay.addEventListener("click", togglePlay);
  btnPrev.addEventListener("click", () => {
    if (tracks.length === 0) return;
    playIndex((current - 1 + tracks.length) % tracks.length);
  });
  btnNext.addEventListener("click", () => {
    if (tracks.length === 0) return;
    playIndex((current + 1) % tracks.length);
  });

  volume.addEventListener("input", () => {
    audio.volume = volume.value / 100;
  });
  audio.volume = volume.value / 100;

  btnLoadStream.addEventListener("click", () => {
    const url = streamUrlInput.value.trim();
    if (!url) return;
    addAndPlay(url);
  });

  streamUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnLoadStream.click();
  });

  btnAddUrl.addEventListener("click", () => {
    const url = prompt("Cole a URL do stream (http/https):");
    if (url && url.trim()) {
      streamUrlInput.value = url.trim();
      addAndPlay(url.trim());
    }
  });

  // Progress
  audio.addEventListener("timeupdate", () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progressFill.style.width = pct + "%";
    timeCurrent.textContent = formatTime(audio.currentTime);
    timeTotal.textContent = isFinite(audio.duration) ? formatTime(audio.duration) : "LIVE";
  });

  progressBar.addEventListener("click", (e) => {
    if (!isFinite(audio.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  audio.addEventListener("ended", () => {
    if (tracks.length > 1) {
      playIndex((current + 1) % tracks.length);
    } else {
      setPlayingUI(false);
      stopVu();
    }
  });

  audio.addEventListener("error", () => {
    trackArtist.textContent = "Falha no stream (CORS, offline ou formato)";
    setPlayingUI(false);
    stopVu();
  });

  // ── Fake VU meters (visual only) ───────────────────────────────────────
  function startVu() {
    stopVu();
    vuTimer = setInterval(() => {
      if (!isPlaying) return;
      const base = 40 + Math.random() * 45;
      const l = Math.min(100, base + (Math.random() - 0.5) * 20);
      const r = Math.min(100, base + (Math.random() - 0.5) * 20);
      vuL.style.width = l + "%";
      vuR.style.width = r + "%";
    }, 80);
  }

  function stopVu() {
    if (vuTimer) clearInterval(vuTimer);
    vuTimer = null;
    vuL.style.width = "0%";
    vuR.style.width = "0%";
  }

  // ── MTA script generator ───────────────────────────────────────────────
  function updateMtaLua() {
    const url = (mtaUrl.value || "https://seu-servidor:8000/live").trim();
    const name = (mtaName.value || "RadioMix").trim();
    mtaLua.textContent = `local STREAM_URL = "${url}"
local STATION = "${name}"

addEventHandler("onClientResourceStart", resourceRoot, function()
    local sound = playSound(STREAM_URL, true)
    if sound then
        setSoundVolume(sound, 0.7)
        outputChatBox("#FF8C00[RadioMix]#FFFFFF " .. STATION .. " no ar!", 255, 255, 255, true)
    end
end)`;
  }

  mtaUrl.addEventListener("input", updateMtaLua);
  mtaName.addEventListener("input", updateMtaLua);

  btnCopyLua.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mtaLua.textContent);
      btnCopyLua.textContent = "COPIADO!";
      setTimeout(() => (btnCopyLua.textContent = "COPIAR SCRIPT"), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = mtaLua.textContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      btnCopyLua.textContent = "COPIADO!";
      setTimeout(() => (btnCopyLua.textContent = "COPIAR SCRIPT"), 1500);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────
  renderPlaylist();
  updateMtaLua();

  // Optional: restore last URL from localStorage
  try {
    const saved = localStorage.getItem("radiomix_last_url");
    if (saved) streamUrlInput.value = saved;
  } catch (_) {}

  streamUrlInput.addEventListener("change", () => {
    try {
      localStorage.setItem("radiomix_last_url", streamUrlInput.value.trim());
    } catch (_) {}
  });
})();
