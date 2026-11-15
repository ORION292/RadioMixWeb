(() => {
  "use strict";

  const audio = document.getElementById("audio");
  try { audio.removeAttribute("crossorigin"); audio.crossOrigin = null; } catch (_) {}

  const $ = (id) => document.getElementById(id);
  const playlistEl = $("playlist");
  const trackTitle = $("track-title");
  const trackArtist = $("track-artist");
  const progressFill = $("progress-fill");
  const progressBar = $("progress-bar");
  const timeCurrent = $("time-current");
  const timeTotal = $("time-total");
  const btnPlay = $("btn-play");
  const iconPlay = $("icon-play");
  const iconPause = $("icon-pause");
  const volume = $("volume");
  const streamUrlInput = $("stream-url");
  const btnLoadStream = $("btn-load-stream");
  const btnAddUrl = $("btn-add-url");
  const btnTestStream = $("btn-test-stream");
  const onairBadge = $("onair-badge");
  const coverArt = $("cover-art");
  const vuL = $("vu-l");
  const vuR = $("vu-r");
  const clockEl = $("clock");
  const mtaUrl = $("mta-url");
  const mtaName = $("mta-name");
  const mtaLua = $("mta-lua");
  const btnCopyLua = $("btn-copy-lua");

  const TEST_STREAM = "https://icecast.radiofrance.fr/fip-midfi.mp3";
  const EQ31_FREQS = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000];
  const EQ10_FREQS = [31.5,63,125,250,500,1000,2000,4000,8000,16000];
  const BAXTER_FREQS = [60,250,1000,4000,12000];

  const dsp = {
    baxterOn: true, bootOn: false, densityOn: false, ferricOn: false, verbOn: false,
    agcOn: false, limiterOn: true, geq31On: false, geq10On: false,
    eqBaxter: [0,0,0,0,0], bootBass: 0, bootAir: 0, compression: 35, saturation: 15,
    reverb: 12, agcTarget: -18, agcMaxGain: 12, limiterCeiling: -1,
    eq31: EQ31_FREQS.map(() => 0), eq10: EQ10_FREQS.map(() => 0), profile: "MTA",
  };

  let tracks = [{ title: "Nenhuma URL ainda", artist: "Cole o mount ou use o botao de teste", url: "" }];
  let current = -1, isPlaying = false, vuTimer = null, loadToken = 0, activeUrl = "";
  let audioCtx = null, mediaSource = null, graphBuilt = false;
  let baxterFilters = [], geq31Filters = [], geq10Filters = [];
  let bootLow = null, bootHigh = null, compressor = null, waveshaper = null;
  let verbGain = null, dryGain = null, limiter = null, masterGain = null, analyser = null;

  function ensureAudioGraph() {
    if (graphBuilt) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaSource = audioCtx.createMediaElementSource(audio);
    baxterFilters = BAXTER_FREQS.map((f) => { const fil = audioCtx.createBiquadFilter(); fil.type = "peaking"; fil.frequency.value = f; fil.Q.value = 0.85; fil.gain.value = 0; return fil; });
    geq31Filters = EQ31_FREQS.map((f) => { const fil = audioCtx.createBiquadFilter(); fil.type = "peaking"; fil.frequency.value = Math.min(f, audioCtx.sampleRate * 0.44); fil.Q.value = 4.318; fil.gain.value = 0; return fil; });
    geq10Filters = EQ10_FREQS.map((f) => { const fil = audioCtx.createBiquadFilter(); fil.type = "peaking"; fil.frequency.value = Math.min(f, audioCtx.sampleRate * 0.44); fil.Q.value = 1.4; fil.gain.value = 0; return fil; });
    bootLow = audioCtx.createBiquadFilter(); bootLow.type = "lowshelf"; bootLow.frequency.value = 120;
    bootHigh = audioCtx.createBiquadFilter(); bootHigh.type = "highshelf"; bootHigh.frequency.value = 8000;
    compressor = audioCtx.createDynamicsCompressor();
    waveshaper = audioCtx.createWaveShaper(); waveshaper.curve = makeSaturationCurve(0); waveshaper.oversample = "2x";
    const delay1 = audioCtx.createDelay(1.0); const delay2 = audioCtx.createDelay(1.0);
    delay1.delayTime.value = 0.029; delay2.delayTime.value = 0.037;
    const fb1 = audioCtx.createGain(); const fb2 = audioCtx.createGain(); fb1.gain.value = 0.35; fb2.gain.value = 0.3;
    verbGain = audioCtx.createGain(); verbGain.gain.value = 0; dryGain = audioCtx.createGain(); dryGain.gain.value = 1;
    delay1.connect(fb1); fb1.connect(delay1); delay2.connect(fb2); fb2.connect(delay2);
    limiter = audioCtx.createDynamicsCompressor(); masterGain = audioCtx.createGain();
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 256;
    let node = mediaSource;
    baxterFilters.forEach((f) => { node.connect(f); node = f; });
    geq31Filters.forEach((f) => { node.connect(f); node = f; });
    geq10Filters.forEach((f) => { node.connect(f); node = f; });
    node.connect(bootLow); bootLow.connect(bootHigh); node = bootHigh;
    node.connect(compressor); compressor.connect(waveshaper);
    waveshaper.connect(dryGain); waveshaper.connect(delay1); waveshaper.connect(delay2);
    delay1.connect(verbGain); delay2.connect(verbGain);
    const merge = audioCtx.createGain(); dryGain.connect(merge); verbGain.connect(merge);
    merge.connect(limiter); limiter.connect(masterGain); masterGain.connect(analyser); analyser.connect(audioCtx.destination);
    graphBuilt = true; applyDspToGraph();
  }

  function makeSaturationCurve(amount) {
    const n = 44100; const curve = new Float32Array(n); const a = Math.max(0.0001, amount / 100);
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + a) * x) / (1 + a * Math.abs(x)); }
    return curve;
  }

  function applyDspToGraph() {
    if (!graphBuilt) return;
    baxterFilters.forEach((f, i) => { f.gain.value = dsp.baxterOn ? dsp.eqBaxter[i] : 0; });
    geq31Filters.forEach((f, i) => { f.gain.value = dsp.geq31On ? dsp.eq31[i] : 0; });
    geq10Filters.forEach((f, i) => { f.gain.value = dsp.geq10On ? dsp.eq10[i] : 0; });
    bootLow.gain.value = dsp.bootOn ? dsp.bootBass : 0; bootHigh.gain.value = dsp.bootOn ? dsp.bootAir : 0;
    if (dsp.densityOn) { const c = dsp.compression; compressor.threshold.value = -10 - c * 0.3; compressor.ratio.value = 2 + c / 25; compressor.knee.value = 20 - c * 0.1; }
    else { compressor.threshold.value = 0; compressor.ratio.value = 1; }
    waveshaper.curve = makeSaturationCurve(dsp.ferricOn ? dsp.saturation : 0);
    const rev = dsp.verbOn ? dsp.reverb / 100 : 0; verbGain.gain.value = rev * 0.6; dryGain.gain.value = 1 - rev * 0.25;
    if (dsp.limiterOn) { limiter.threshold.value = dsp.limiterCeiling; limiter.ratio.value = 20; }
    else { limiter.threshold.value = 0; limiter.ratio.value = 1; }
    if (dsp.agcOn) { const g = Math.min(dsp.agcMaxGain, Math.max(0, (-18 - dsp.agcTarget) * 0.3)); masterGain.gain.value = Math.pow(10, g / 20); }
    else masterGain.gain.value = 1;
  }

  function applyProfile(name) {
    dsp.profile = name;
    document.querySelectorAll(".profile-btn").forEach((b) => b.classList.toggle("active", b.dataset.profile === name));
    if (name === "FM") {
      dsp.baxterOn = true; dsp.bootOn = true; dsp.densityOn = true; dsp.ferricOn = false; dsp.verbOn = false; dsp.agcOn = true; dsp.limiterOn = true; dsp.geq31On = false; dsp.geq10On = true;
      dsp.eqBaxter = [1, 0.5, 0, 0.5, 1]; dsp.bootBass = 1.5; dsp.bootAir = 1; dsp.compression = 40; dsp.agcTarget = -16; dsp.limiterCeiling = -1;
    } else if (name === "MTA") {
      dsp.baxterOn = true; dsp.bootOn = false; dsp.densityOn = true; dsp.ferricOn = true; dsp.verbOn = false; dsp.agcOn = true; dsp.limiterOn = true; dsp.geq31On = false; dsp.geq10On = false;
      dsp.eqBaxter = [0,0,0,0,0]; dsp.compression = 30; dsp.saturation = 12; dsp.agcTarget = -18; dsp.limiterCeiling = -1;
    } else {
      dsp.baxterOn = true; dsp.bootOn = false; dsp.densityOn = false; dsp.ferricOn = false; dsp.verbOn = false; dsp.agcOn = false; dsp.limiterOn = true; dsp.geq31On = false; dsp.geq10On = false;
      dsp.eqBaxter = [0,0,0,0,0]; dsp.limiterCeiling = -1;
    }
    rebuildPluginUI(); syncToggles(); applyDspToGraph();
  }

  function rebuildPluginUI() {
    const root = $("plugins-root"); root.innerHTML = "";
    function card(id, title, sub, on, bodyHtml) {
      const div = document.createElement("div");
      div.className = "plugin-card" + (on ? " on" : "");
      div.innerHTML = '<div class="plugin-head"><div><div class="plugin-title">' + title + '</div><div class="plugin-sub">' + sub + '</div></div><div class="toggle' + (on ? " on" : "") + '" data-tog="' + id + '"></div></div>' + bodyHtml;
      root.appendChild(div);
    }
    function slider(key, label, min, max, step, val, unit) {
      return '<div class="slider-row"><span>' + label + '</span><input type="range" data-key="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" /><span class="slider-val" data-val="' + key + '">' + val + (unit || "") + "</span></div>";
    }
    let baxterSliders = "";
    ["60Hz","250Hz","1kHz","4kHz","12kHz"].forEach((lab, i) => { baxterSliders += slider("baxter" + i, lab, -12, 12, 0.5, dsp.eqBaxter[i], " dB"); });
    card("baxter", "BaxterEQ", "5 bandas parametricas", dsp.baxterOn, baxterSliders);
    card("boot", "BootEQ", "Low / High shelves", dsp.bootOn, slider("bootBass", "Bass", -12, 12, 0.5, dsp.bootBass, " dB") + slider("bootAir", "Air", -12, 12, 0.5, dsp.bootAir, " dB"));
    card("density", "Density", "Compressor", dsp.densityOn, slider("compression", "Amount", 0, 100, 1, dsp.compression, "%"));
    card("ferric", "Ferric", "Soft saturation", dsp.ferricOn, slider("saturation", "Drive", 0, 100, 1, dsp.saturation, "%"));
    card("verb", "epicVerb", "Ambience", dsp.verbOn, slider("reverb", "Mix", 0, 100, 1, dsp.reverb, "%"));
    card("agc", "AGC", "Auto gain", dsp.agcOn, slider("agcTarget", "Target", -30, -6, 1, dsp.agcTarget, " dB") + slider("agcMaxGain", "Max gain", 0, 24, 1, dsp.agcMaxGain, " dB"));
    card("limiter", "Limiter", "Peak ceiling", dsp.limiterOn, slider("limiterCeiling", "Ceiling", -12, 0, 0.5, dsp.limiterCeiling, " dB"));
    root.querySelectorAll(".toggle[data-tog]").forEach((el) => {
      el.addEventListener("click", () => {
        const map = { baxter: "baxterOn", boot: "bootOn", density: "densityOn", ferric: "ferricOn", verb: "verbOn", agc: "agcOn", limiter: "limiterOn" };
        const k = map[el.dataset.tog]; if (!k) return; dsp[k] = !dsp[k]; el.classList.toggle("on", dsp[k]); el.closest(".plugin-card").classList.toggle("on", dsp[k]); applyDspToGraph();
      });
    });
    root.querySelectorAll("input[type=range][data-key]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const key = inp.dataset.key; const v = parseFloat(inp.value);
        const valEl = root.querySelector('[data-val="' + key + '"]');
        if (key.indexOf("baxter") === 0) { dsp.eqBaxter[parseInt(key.replace("baxter", ""), 10)] = v; if (valEl) valEl.textContent = v + " dB"; }
        else { dsp[key] = v; let unit = (key === "compression" || key === "saturation" || key === "reverb") ? "%" : " dB"; if (valEl) valEl.textContent = v + unit; }
        applyDspToGraph();
      });
    });
  }

  function syncToggles() { const g31 = $("tog-geq31"); const g10 = $("tog-geq10"); if (g31) g31.classList.toggle("on", dsp.geq31On); if (g10) g10.classList.toggle("on", dsp.geq10On); }

  function buildEqBands(containerId, freqs, values, onChange) {
    const el = $(containerId); el.innerHTML = "";
    freqs.forEach((f, i) => {
      const band = document.createElement("div"); band.className = "band";
      const lab = f >= 1000 ? (f / 1000) + "k" : String(f);
      band.innerHTML = '<input type="range" min="-12" max="12" step="0.5" value="' + values[i] + '" data-i="' + i + '" /><span class="blabel">' + lab + "</span>";
      el.appendChild(band);
    });
    el.querySelectorAll("input").forEach((inp) => { inp.addEventListener("input", () => onChange(parseInt(inp.dataset.i, 10), parseFloat(inp.value))); });
  }

  rebuildPluginUI();
  buildEqBands("eq31", EQ31_FREQS, dsp.eq31, (i, v) => { dsp.eq31[i] = v; applyDspToGraph(); });
  buildEqBands("eq10", EQ10_FREQS, dsp.eq10, (i, v) => { dsp.eq10[i] = v; applyDspToGraph(); });
  syncToggles();
  $("tog-geq31").addEventListener("click", () => { dsp.geq31On = !dsp.geq31On; syncToggles(); applyDspToGraph(); });
  $("tog-geq10").addEventListener("click", () => { dsp.geq10On = !dsp.geq10On; syncToggles(); applyDspToGraph(); });
  document.querySelectorAll(".profile-btn").forEach((btn) => btn.addEventListener("click", () => applyProfile(btn.dataset.profile)));
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active"); $("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  function updateClock() { clockEl.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false }); }
  updateClock(); setInterval(updateClock, 1000);

  function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function renderPlaylist() {
    playlistEl.innerHTML = "";
    tracks.forEach((t, i) => {
      const li = document.createElement("li"); if (i === current) li.classList.add("active");
      li.innerHTML = '<span class="idx">' + String(i + 1).padStart(2, "0") + '</span><div class="meta"><div class="name">' + escapeHtml(t.title) + '</div><div class="sub">' + escapeHtml(t.artist || "Stream") + "</div></div>";
      li.addEventListener("click", () => { if (!t.url) { trackArtist.textContent = "Sem URL — use CARREGAR ou Testar FIP"; return; } playIndex(i); });
      playlistEl.appendChild(li);
    });
  }

  function normalizeStreamUrl(raw) {
    let url = (raw || "").trim(); if (!url) return "";
    if (/^icy:\/\//i.test(url)) url = "http://" + url.slice(6);
    if (!/^https?:\/\//i.test(url) && /^[\w.-]+:\d+/.test(url)) url = "http://" + url;
    try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") return ""; if (u.href === location.href) return ""; return u.href; } catch (_) { return ""; }
  }
  function friendlyError(err, url) {
    const name = (err && err.name) || ""; const msg = (err && err.message) || String(err || "");
    if (name === "NotAllowedError") return "Toque bloqueado — clique de novo no Play";
    if (name === "NotSupportedError" || /no supported source/i.test(msg)) {
      if (url && url.indexOf("http://") === 0 && location.protocol === "https:") return "HTTP bloqueado em pagina HTTPS — use https:// no mount";
      return "Stream invalido/offline. Se FIP tocar, o problema e a URL do seu mount";
    }
    return "Falha ao tocar — confira se o mount esta no ar";
  }
  function formatTime(sec) { if (!isFinite(sec) || isNaN(sec)) return "0:00"; const m = Math.floor(sec / 60); const s = Math.floor(sec % 60); return m + ":" + String(s).padStart(2, "0"); }
  function setPlayingUI(playing) {
    isPlaying = playing; iconPlay.classList.toggle("hidden", playing); iconPause.classList.toggle("hidden", !playing);
    coverArt.classList.toggle("playing", playing); onairBadge.textContent = playing ? "ON AIR" : "OFFLINE";
    onairBadge.classList.toggle("online", playing); onairBadge.classList.toggle("offline", !playing);
  }
  function clearMediaElement() { try { audio.pause(); } catch (_) {} try { audio.removeAttribute("src"); audio.load(); } catch (_) {} activeUrl = ""; }
  function stopPlayback() { try { audio.pause(); } catch (_) {} setPlayingUI(false); stopVu(); }

  function playIndex(idx) {
    if (idx < 0 || idx >= tracks.length) return;
    const t = tracks[idx]; const url = normalizeStreamUrl(t.url);
    if (!url) { trackTitle.textContent = t.title || "Sem faixa"; trackArtist.textContent = "Cole a URL e CARREGAR, ou Testar FIP"; stopPlayback(); return; }
    if (url.indexOf("http://") === 0 && location.protocol === "https:") { trackTitle.textContent = t.title; trackArtist.textContent = "Mount HTTP em pagina HTTPS — use HTTPS no Icecast"; stopPlayback(); return; }
    current = idx; trackTitle.textContent = t.title; trackArtist.textContent = "Conectando…"; renderPlaylist();
    const token = ++loadToken; clearMediaElement();
    try { ensureAudioGraph(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (_) {}
    activeUrl = url; audio.preload = "auto"; audio.src = url;
    const onCanPlay = () => {
      if (token !== loadToken || !activeUrl) return; cleanup();
      audio.play().then(() => { if (token !== loadToken) return; setPlayingUI(true); startVu(); trackArtist.textContent = t.artist || "Stream ao vivo"; })
        .catch((err) => { if (token !== loadToken) return; trackArtist.textContent = friendlyError(err, url); setPlayingUI(false); stopVu(); });
    };
    const onError = () => {
      if (token !== loadToken) return; cleanup();
      const mediaErr = audio.error; let hint = "Falha ao carregar o stream";
      if (mediaErr) { if (mediaErr.code === 4) hint = friendlyError({ name: "NotSupportedError", message: "no supported source" }, url); else if (mediaErr.code === 2) hint = "Servidor offline — confira host/porta e SOURCE"; else if (mediaErr.code === 3) hint = "Formato nao suportado — use MP3"; }
      trackArtist.textContent = hint; setPlayingUI(false); stopVu();
    };
    function cleanup() { audio.removeEventListener("canplay", onCanPlay); audio.removeEventListener("loadeddata", onCanPlay); audio.removeEventListener("error", onError); }
    audio.addEventListener("canplay", onCanPlay, { once: true }); audio.addEventListener("loadeddata", onCanPlay, { once: true }); audio.addEventListener("error", onError, { once: true });
    try { audio.load(); } catch (err) { trackArtist.textContent = friendlyError(err, url); setPlayingUI(false); }
    setTimeout(() => {
      if (token !== loadToken || !activeUrl) return; if (!audio.paused && !audio.error) return;
      if (audio.readyState >= 2) { onCanPlay(); return; }
      audio.play().then(() => { if (token !== loadToken) return; cleanup(); setPlayingUI(true); startVu(); trackArtist.textContent = t.artist || "Stream ao vivo"; }).catch(() => {});
    }, 3000);
  }

  function togglePlay() {
    if (!activeUrl) { const inputUrl = normalizeStreamUrl(streamUrlInput.value); if (inputUrl) { addAndPlay(inputUrl); return; } trackArtist.textContent = "Nada para tocar. CARREGAR URL ou Testar FIP"; return; }
    if (audio.paused) {
      try { ensureAudioGraph(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch (_) {}
      audio.play().then(() => { setPlayingUI(true); startVu(); }).catch((err) => { trackArtist.textContent = friendlyError(err, activeUrl); setPlayingUI(false); });
    } else stopPlayback();
  }

  function addAndPlay(rawUrl) {
    const url = normalizeStreamUrl(rawUrl);
    if (!url) { trackArtist.textContent = "URL invalida — https://servidor:8000/live"; return; }
    let title = "Stream ao vivo"; try { const u = new URL(url); title = u.hostname + (u.pathname && u.pathname !== "/" ? u.pathname : ""); } catch (_) {}
    const entry = { title: title, artist: "HTTP Stream", url: url };
    if (tracks.length === 1 && !tracks[0].url) { tracks[0] = entry; playIndex(0); }
    else { const last = tracks[tracks.length - 1]; if (last && last.url === url) playIndex(tracks.length - 1); else { tracks.push(entry); playIndex(tracks.length - 1); } }
    renderPlaylist(); try { localStorage.setItem("radiomix_last_url", url); } catch (_) {}
  }

  btnPlay.addEventListener("click", togglePlay);
  $("btn-prev").addEventListener("click", () => { if (tracks.length) playIndex((current - 1 + tracks.length) % tracks.length); });
  $("btn-next").addEventListener("click", () => { if (tracks.length) playIndex((current + 1) % tracks.length); });
  volume.addEventListener("input", () => { audio.volume = volume.value / 100; }); audio.volume = volume.value / 100;
  btnLoadStream.addEventListener("click", () => { const url = streamUrlInput.value.trim(); if (!url) { trackArtist.textContent = "Cole a URL primeiro"; return; } addAndPlay(url); });
  if (btnTestStream) btnTestStream.addEventListener("click", () => { streamUrlInput.value = TEST_STREAM; addAndPlay(TEST_STREAM); });
  streamUrlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") btnLoadStream.click(); });
  btnAddUrl.addEventListener("click", () => { const url = prompt("URL do stream (https://...):"); if (url && url.trim()) { streamUrlInput.value = url.trim(); addAndPlay(url.trim()); } });
  audio.addEventListener("timeupdate", () => { const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0; progressFill.style.width = (isFinite(pct) ? pct : 0) + "%"; timeCurrent.textContent = formatTime(audio.currentTime); timeTotal.textContent = isFinite(audio.duration) ? formatTime(audio.duration) : "LIVE"; });
  progressBar.addEventListener("click", (e) => { if (!isFinite(audio.duration)) return; const rect = progressBar.getBoundingClientRect(); audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration; });
  audio.addEventListener("ended", () => { if (tracks.length > 1) playIndex((current + 1) % tracks.length); else { const t = tracks[current]; if (t && t.url) setTimeout(() => playIndex(current), 1500); else { setPlayingUI(false); stopVu(); } } });
  audio.addEventListener("waiting", () => { if (isPlaying) trackArtist.textContent = "Buffering…"; });
  audio.addEventListener("playing", () => { if (isPlaying) trackArtist.textContent = (tracks[current] && tracks[current].artist) || "Stream ao vivo"; });

  function startVu() {
    stopVu();
    vuTimer = setInterval(() => {
      if (!isPlaying) return;
      if (analyser) { const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i]; const avg = sum / data.length / 255 * 100; vuL.style.width = Math.min(100, avg * 1.2 + Math.random() * 5) + "%"; vuR.style.width = Math.min(100, avg * 1.15 + Math.random() * 8) + "%"; }
      else { const base = 40 + Math.random() * 45; vuL.style.width = Math.min(100, base) + "%"; vuR.style.width = Math.min(100, base + (Math.random() - 0.5) * 20) + "%"; }
    }, 80);
  }
  function stopVu() { if (vuTimer) clearInterval(vuTimer); vuTimer = null; vuL.style.width = "0%"; vuR.style.width = "0%"; }

  function updateMtaLua() {
    const url = (mtaUrl.value || "https://seu-servidor:8000/live").trim(); const name = (mtaName.value || "RadioMix").trim();
    mtaLua.textContent = 'local STREAM_URL = "' + url + '"\nlocal STATION = "' + name + '"\n\naddEventHandler("onClientResourceStart", resourceRoot, function()\n    local sound = playSound(STREAM_URL, true)\n    if sound then\n        setSoundVolume(sound, 0.7)\n        outputChatBox("#FF8C00[RadioMix]#FFFFFF " .. STATION .. " no ar!", 255, 255, 255, true)\n    end\nend)';
  }
  mtaUrl.addEventListener("input", updateMtaLua); mtaName.addEventListener("input", updateMtaLua);
  btnCopyLua.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(mtaLua.textContent); btnCopyLua.textContent = "COPIADO!"; setTimeout(() => (btnCopyLua.textContent = "COPIAR SCRIPT"), 1500); }
    catch (_) { const ta = document.createElement("textarea"); ta.value = mtaLua.textContent; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); btnCopyLua.textContent = "COPIADO!"; setTimeout(() => (btnCopyLua.textContent = "COPIAR SCRIPT"), 1500); }
  });

  renderPlaylist(); updateMtaLua();
  try { const saved = localStorage.getItem("radiomix_last_url"); if (saved) streamUrlInput.value = saved; } catch (_) {}
})();
