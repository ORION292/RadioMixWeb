(() => {
  "use strict";

  const audio = document.getElementById("audio");
  try {
    audio.removeAttribute("crossorigin");
    audio.crossOrigin = null;
  } catch (_) {}

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
  const btnTestStream = document.getElementById("btn-test-stream");
  const onairBadge = document.getElementById("onair-badge");
  const coverArt = document.getElementById("cover-art");
  const vuL = document.getElementById("vu-l");
  const vuR = document.getElementById("vu-r");
  const clockEl = document.getElementById("clock");
  const mtaUrl = document.getElementById("mta-url");
  const mtaName = document.getElementById("mta-name");
  const mtaLua = document.getElementById("mta-lua");
  const btnCopyLua = document.getElementById("btn-copy-lua");

  const TEST_STREAM = "https://icecast.radiofrance.fr/fip-midfi.mp3";

  let tracks = [
    { title: "Nenhuma URL ainda", artist: "Cole o mount ou use o botao de teste", url: "" },
  ];
  let current = -1;
  let isPlaying = false;
  let vuTimer = null;
  let loadToken = 0;
  let activeUrl = "";

  function updateClock() {
    clockEl.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  }
  updateClock();
  setInterval(updateClock, 1000);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  document.querySelectorAll(".profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".profile-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  ["60", "250", "1k", "4k", "12k"].forEach((label) => {
    const div = document.createElement("div");
    div.className = "eq-band";
    div.innerHTML =
      '<input type="range" min="-12" max="12" value="0" step="0.5" />' +
      '<span class="eq-label">' + label + "</span>";
    document.getElementById("eq-sliders").appendChild(div);
  });

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderPlaylist() {
    playlistEl.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li");
      if (i === current) li.classList.add("active");
      li.innerHTML =
        '<span class="idx">' + String(i + 1).padStart(2, "0") +
        '</span><div class="meta"><div class="name">' + escapeHtml(t.title) +
        '</div><div class="sub">' + escapeHtml(t.artist || "Stream") + "</div></div>";
      li.addEventListener("click", () => {
        if (!t.url) {
          trackArtist.textContent = "Essa faixa nao tem URL. Use CARREGAR ou o teste FIP.";
          return;
        }
        playIndex(i);
      });
      playlistEl.appendChild(li);
    });
  }

  function normalizeStreamUrl(raw) {
    let url = (raw || "").trim();
    if (!url) return "";
    if (/^icy:\/\//i.test(url)) url = "http://" + url.slice(6);
    if (!/^https?:\/\//i.test(url) && /^[\w.-]+:\d+/.test(url)) url = "http://" + url;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      if (u.href === location.href) return "";
      return u.href;
    } catch (_) {
      return "";
    }
  }

  function friendlyError(err, url) {
    const name = (err && err.name) || "";
    const msg = (err && err.message) || String(err || "");
    if (name === "NotAllowedError") return "Toque bloqueado — clique de novo no Play";
    if (name === "NotSupportedError" || /no supported source/i.test(msg)) {
      if (url && url.indexOf("http://") === 0 && location.protocol === "https:") {
        return "HTTP bloqueado em pagina HTTPS — use https:// no mount";
      }
      return "Stream invalido/offline. Se o teste FIP tocar, o problema e a URL do seu mount";
    }
    return "Falha ao tocar — confira se o mount esta no ar";
  }

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

  function clearMediaElement() {
    try { audio.pause(); } catch (_) {}
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch (_) {}
    activeUrl = "";
  }

  function stopPlayback() {
    try { audio.pause(); } catch (_) {}
    setPlayingUI(false);
    stopVu();
  }

  function playIndex(idx) {
    if (idx < 0 || idx >= tracks.length) return;
    const t = tracks[idx];
    const url = normalizeStreamUrl(t.url);

    if (!url) {
      trackTitle.textContent = t.title || "Sem faixa";
      trackArtist.textContent = "Cole a URL e clique CARREGAR, ou use Testar FIP";
      stopPlayback();
      return;
    }

    if (url.indexOf("http://") === 0 && location.protocol === "https:") {
      trackTitle.textContent = t.title;
      trackArtist.textContent = "Mount HTTP em pagina HTTPS — browser bloqueia. Use HTTPS no Icecast.";
      stopPlayback();
      return;
    }

    current = idx;
    trackTitle.textContent = t.title;
    trackArtist.textContent = "Conectando…";
    renderPlaylist();

    const token = ++loadToken;
    clearMediaElement();

    audio.removeAttribute("crossorigin");
    try { audio.crossOrigin = null; } catch (_) {}

    activeUrl = url;
    audio.preload = "auto";
    audio.src = url;

    const onCanPlay = () => {
      if (token !== loadToken || !activeUrl) return;
      cleanup();
      const p = audio.play();
      if (!p || typeof p.then !== "function") {
        setPlayingUI(true);
        startVu();
        trackArtist.textContent = t.artist || "Stream ao vivo";
        return;
      }
      p.then(() => {
        if (token !== loadToken) return;
        setPlayingUI(true);
        startVu();
        trackArtist.textContent = t.artist || "Stream ao vivo";
      }).catch((err) => {
        if (token !== loadToken) return;
        trackArtist.textContent = friendlyError(err, url);
        setPlayingUI(false);
        stopVu();
      });
    };

    const onError = () => {
      if (token !== loadToken) return;
      cleanup();
      const mediaErr = audio.error;
      let hint = "Falha ao carregar o stream";
      if (mediaErr) {
        if (mediaErr.code === 4) hint = friendlyError({ name: "NotSupportedError", message: "no supported source" }, url);
        else if (mediaErr.code === 2) hint = "Servidor offline — confira host/porta e se o SOURCE esta no ar";
        else if (mediaErr.code === 3) hint = "Formato nao suportado — use MP3 no Icecast";
      }
      trackArtist.textContent = hint;
      setPlayingUI(false);
      stopVu();
    };

    function cleanup() {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("loadeddata", onCanPlay);
      audio.removeEventListener("error", onError);
    }

    audio.addEventListener("canplay", onCanPlay, { once: true });
    audio.addEventListener("loadeddata", onCanPlay, { once: true });
    audio.addEventListener("error", onError, { once: true });

    try { audio.load(); } catch (err) {
      trackArtist.textContent = friendlyError(err, url);
      setPlayingUI(false);
    }

    setTimeout(() => {
      if (token !== loadToken || !activeUrl) return;
      if (!audio.paused && !audio.error) return;
      if (audio.readyState >= 2) { onCanPlay(); return; }
      audio.play().then(() => {
        if (token !== loadToken) return;
        cleanup();
        setPlayingUI(true);
        startVu();
        trackArtist.textContent = t.artist || "Stream ao vivo";
      }).catch(() => {});
    }, 3000);
  }

  function togglePlay() {
    if (!activeUrl) {
      const inputUrl = normalizeStreamUrl(streamUrlInput.value);
      if (inputUrl) { addAndPlay(inputUrl); return; }
      trackArtist.textContent = "Nada para tocar. Cole a URL e CARREGAR, ou clique em Testar FIP";
      return;
    }
    if (audio.paused) {
      audio.play().then(() => {
        setPlayingUI(true);
        startVu();
      }).catch((err) => {
        trackArtist.textContent = friendlyError(err, activeUrl);
        setPlayingUI(false);
      });
    } else {
      stopPlayback();
    }
  }

  function addAndPlay(rawUrl) {
    const url = normalizeStreamUrl(rawUrl);
    if (!url) {
      trackArtist.textContent = "URL invalida — exemplo: https://servidor:8000/live";
      return;
    }
    let title = "Stream ao vivo";
    try {
      const u = new URL(url);
      title = u.hostname + (u.pathname && u.pathname !== "/" ? u.pathname : "");
    } catch (_) {}
    const entry = { title: title, artist: "HTTP Stream", url: url };
    if (tracks.length === 1 && !tracks[0].url) {
      tracks[0] = entry;
      playIndex(0);
    } else {
      const last = tracks[tracks.length - 1];
      if (last && last.url === url) playIndex(tracks.length - 1);
      else { tracks.push(entry); playIndex(tracks.length - 1); }
    }
    renderPlaylist();
    try { localStorage.setItem("radiomix_last_url", url); } catch (_) {}
  }

  btnPlay.addEventListener("click", togglePlay);
  btnPrev.addEventListener("click", () => { if (tracks.length) playIndex((current - 1 + tracks.length) % tracks.length); });
  btnNext.addEventListener("click", () => { if (tracks.length) playIndex((current + 1) % tracks.length); });
  volume.addEventListener("input", () => { audio.volume = volume.value / 100; });
  audio.volume = volume.value / 100;

  btnLoadStream.addEventListener("click", () => {
    const url = streamUrlInput.value.trim();
    if (!url) { trackArtist.textContent = "Cole a URL do stream primeiro"; return; }
    addAndPlay(url);
  });

  if (btnTestStream) {
    btnTestStream.addEventListener("click", () => {
      streamUrlInput.value = TEST_STREAM;
      addAndPlay(TEST_STREAM);
    });
  }

  streamUrlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") btnLoadStream.click(); });
  btnAddUrl.addEventListener("click", () => {
    const url = prompt("Cole a URL do stream (https://...):");
    if (url && url.trim()) { streamUrlInput.value = url.trim(); addAndPlay(url.trim()); }
  });

  audio.addEventListener("timeupdate", () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progressFill.style.width = (isFinite(pct) ? pct : 0) + "%";
    timeCurrent.textContent = formatTime(audio.currentTime);
    timeTotal.textContent = isFinite(audio.duration) ? formatTime(audio.duration) : "LIVE";
  });

  progressBar.addEventListener("click", (e) => {
    if (!isFinite(audio.duration)) return;
    const rect = progressBar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  audio.addEventListener("ended", () => {
    if (tracks.length > 1) playIndex((current + 1) % tracks.length);
    else {
      const t = tracks[current];
      if (t && t.url) setTimeout(() => playIndex(current), 1500);
      else { setPlayingUI(false); stopVu(); }
    }
  });

  audio.addEventListener("waiting", () => { if (isPlaying) trackArtist.textContent = "Buffering…"; });
  audio.addEventListener("playing", () => {
    if (isPlaying) {
      const t = tracks[current];
      trackArtist.textContent = (t && t.artist) || "Stream ao vivo";
    }
  });

  function startVu() {
    stopVu();
    vuTimer = setInterval(() => {
      if (!isPlaying) return;
      const base = 40 + Math.random() * 45;
      vuL.style.width = Math.min(100, base + (Math.random() - 0.5) * 20) + "%";
      vuR.style.width = Math.min(100, base + (Math.random() - 0.5) * 20) + "%";
    }, 80);
  }
  function stopVu() {
    if (vuTimer) clearInterval(vuTimer);
    vuTimer = null;
    vuL.style.width = "0%";
    vuR.style.width = "0%";
  }

  function updateMtaLua() {
    const url = (mtaUrl.value || "https://seu-servidor:8000/live").trim();
    const name = (mtaName.value || "RadioMix").trim();
    mtaLua.textContent =
      'local STREAM_URL = "' + url + '"\nlocal STATION = "' + name +
      '"\n\naddEventHandler("onClientResourceStart", resourceRoot, function()\n    local sound = playSound(STREAM_URL, true)\n    if sound then\n        setSoundVolume(sound, 0.7)\n        outputChatBox("#FF8C00[RadioMix]#FFFFFF " .. STATION .. " no ar!", 255, 255, 255, true)\n    end\nend)';
  }
  mtaUrl.addEventListener("input", updateMtaLua);
  mtaName.addEventListener("input", updateMtaLua);
  btnCopyLua.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mtaLua.textContent);
      btnCopyLua.textContent = "COPIADO!";
      setTimeout(() => (btnCopyLua.textContent = "COPIAR SCRIPT"), 1500);
    } catch (_) {
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

  renderPlaylist();
  updateMtaLua();
  try {
    const saved = localStorage.getItem("radiomix_last_url");
    if (saved) streamUrlInput.value = saved;
  } catch (_) {}
  streamUrlInput.addEventListener("change", () => {
    try { localStorage.setItem("radiomix_last_url", streamUrlInput.value.trim()); } catch (_) {}
  });
})();
