/**
 * SeatWatch Frontend Application Controller
 * Cinema-First and Format-Rich discovery engine for BookMyShow.
 */

let selectedCityCode = "HYD";
let selectedCitySlug = "hyderabad";
let selectedVenueCode = "ALUC";
let selectedVenueName = "ALLU Cinemas: Kokapet";
let selectedVenueSlug = "allu-cinemas-kokapet";
let cachedCinemas = [];
let cachedCinemaShowtimes = null;
let selectedMovieObj = null;
let selectedFormatObj = null;
let currentRuleType = "ZONES";
let currentZones = [
  {
    id: 1,
    title: "Selection 1: Middle Rows",
    row_start: "B",
    row_end: "I",
    seat_min: 12,
    seat_max: 25,
    quantity: 4,
    consecutive: true,
  }
];
let activeZoneIndex = 0;
let zonesMatchLogic = "ANY";
let cachedCurrentLayout = null;

document.addEventListener("DOMContentLoaded", () => {
  initDatePresets();
  loadRegions();
  updateTelegramNavBadge();
  loadMonitors();
  loadSettings();
  renderZoneCards();
});

// ----------------------------------------------------
// Telegram Account Identity & Persistence (localStorage)
// ----------------------------------------------------
function getStoredTelegramUser() {
  try {
    const raw = localStorage.getItem("seatwatch_telegram_user");
    if (raw) {
      const u = JSON.parse(raw);
      if (u && u.chat_id) return u;
    }
  } catch (e) {}
  return null;
}

function setStoredTelegramUser(user) {
  if (user && user.chat_id) {
    localStorage.setItem("seatwatch_telegram_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("seatwatch_telegram_user");
  }
  updateTelegramNavBadge();
}

function clearStoredTelegramUser() {
  localStorage.removeItem("seatwatch_telegram_user");
  updateTelegramNavBadge();
}

function updateTelegramNavBadge() {
  const user = getStoredTelegramUser();
  const label = document.getElementById("nav-tg-label");
  const dot = document.getElementById("nav-tg-dot");
  const reelCard = document.getElementById("reel-telegram-card");
  const reelTitle = document.getElementById("reel-tg-status-title");
  const reelDesc = document.getElementById("reel-tg-status-desc");

  if (user && user.chat_id) {
    if (label) label.textContent = user.first_name ? `Telegram (${user.first_name})` : "Telegram Linked";
    if (dot) {
      dot.style.background = "var(--neon-emerald)";
      dot.style.boxShadow = "0 0 8px var(--neon-emerald)";
      dot.title = `Connected as ${user.first_name || 'User'} (ID: ${user.chat_id})`;
    }
    if (reelCard) {
      reelCard.style.borderColor = "rgba(0, 240, 152, 0.4)";
      reelCard.style.background = "rgba(0, 240, 152, 0.05)";
    }
    if (reelTitle) {
      reelTitle.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--neon-emerald);margin-right:6px"></i> Telegram: Connected (${user.chat_id})`;
    }
    if (reelDesc) {
      reelDesc.innerHTML = `Instant seat alerts will be pushed to <strong>${user.first_name || 'your Telegram'}</strong> (<a href="javascript:switchTab('settings')" style="color:var(--neon-cyan);text-decoration:underline">change</a>)`;
    }
  } else {
    if (label) label.textContent = "Connect Telegram";
    if (dot) {
      dot.style.background = "var(--gold-bright)";
      dot.style.boxShadow = "0 0 8px var(--gold-bright)";
      dot.title = "Telegram not connected";
    }
    if (reelCard) {
      reelCard.style.borderColor = "rgba(229, 43, 80, 0.4)";
      reelCard.style.background = "rgba(229, 43, 80, 0.05)";
    }
    if (reelTitle) {
      reelTitle.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--velvet-bright);margin-right:6px"></i> Telegram Not Connected`;
    }
    if (reelDesc) {
      reelDesc.innerHTML = `<a href="javascript:switchTab('settings')" style="color:var(--gold-bright);text-decoration:underline;font-weight:700">Click here to connect Telegram in 1-Click</a> before activating.`;
    }
  }
}

function openCreateWatcher() {
  const user = getStoredTelegramUser();
  if (!user || !user.chat_id) {
    showCinematicConfirm({
      title: "Telegram Connection Required",
      message: "SeatWatch sends real-time ticket alerts straight to your Telegram the moment seats open. Please connect your Telegram account first to start tracking.",
      confirmText: "Connect Telegram (1-Click)",
      confirmIcon: "fa-brands fa-telegram",
      onConfirm: () => {
        switchTab("settings");
      }
    });
    return;
  }
  switchTab("create");
}

// ----------------------------------------------------
// Navigation
// ----------------------------------------------------
function switchTab(tabName) {
  if (tabName === "create") {
    const user = getStoredTelegramUser();
    if (!user || !user.chat_id) {
      showCinematicConfirm({
        title: "Telegram Connection Required",
        message: "SeatWatch sends real-time ticket alerts straight to your Telegram the moment seats open. Please connect your Telegram account first to start tracking.",
        confirmText: "Connect Telegram (1-Click)",
        confirmIcon: "fa-brands fa-telegram",
        onConfirm: () => {
          switchTab("settings");
        }
      });
      return;
    }
  }

  document.querySelectorAll("section[id^='tab-']").forEach(sec => sec.classList.add("hidden"));
  document.querySelectorAll(".nav-tab").forEach(btn => btn.classList.remove("active"));

  const targetSection = document.getElementById(`tab-${tabName}`);
  const targetBtn = document.getElementById(`tab-${tabName}-btn`);

  if (targetSection) targetSection.classList.remove("hidden");
  if (targetBtn) targetBtn.classList.add("active");

  if (tabName === "monitors") {
    loadMonitors();
  }
}

// ----------------------------------------------------
// Cinematic Audio Synthesizer (Web Audio API) & Controls
// ----------------------------------------------------
let cinemaAudioEnabled = localStorage.getItem("cinemaAudioEnabled") !== "false";

function toggleCinemaAudio() {
  cinemaAudioEnabled = !cinemaAudioEnabled;
  localStorage.setItem("cinemaAudioEnabled", cinemaAudioEnabled);
  const icon = document.getElementById("sound-toggle-icon");
  const btn = document.getElementById("sound-toggle-btn");
  if (icon) {
    icon.className = cinemaAudioEnabled ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark";
  }
  if (btn) {
    btn.classList.toggle("active", cinemaAudioEnabled);
  }
  showAlert(cinemaAudioEnabled ? "🔊 Cinema Sound FX: Enabled" : "🔇 Cinema Sound FX: Muted", "info");
}

function refreshDashboard(btn) {
  if (btn) {
    const icon = btn.querySelector("i");
    if (icon) {
      icon.classList.add("fa-spin");
      setTimeout(() => icon.classList.remove("fa-spin"), 700);
    }
  }
  loadMonitors();
  showAlert("Alerts refreshed.", "info");
}

function playCinemaSound(type = 'success') {
  if (!cinemaAudioEnabled && type !== 'clap') return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    if (type === 'clap') {
      // Authentic wooden film clapperboard slap
      // 1. Sharp wooden slap transient (bandpass filtered white noise burst)
      const bufferSize = ctx.sampleRate * 0.08;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.setValueAtTime(2.5, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.55, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      whiteNoise.start(now);

      // 2. Resonant wooden body thump
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.09);
      oscGain.gain.setValueAtTime(0.65, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'activate') {
      // 3-tone rising fanfare
      const freqs = [440, 554.37, 659.25, 880];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0.12, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.35);
      });
    } else if (type === 'success') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.25);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {
    // AudioContext blocked
  }
}

// ----------------------------------------------------
// Cinematic Floating Toast System (Replaces browser alerts)
// ----------------------------------------------------
function showAlert(message, type = "info") {
  let container = document.getElementById("cinema-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "cinema-toast-container";
    document.body.appendChild(container);
  }

  playCinemaSound(type);

  const toast = document.createElement("div");
  toast.className = "cinema-toast";

  let icon = "fa-solid fa-clapperboard";
  let iconColor = "color:var(--neon-cyan)";

  if (type === "success") {
    icon = "fa-solid fa-circle-check";
    iconColor = "color:var(--neon-emerald)";
    toast.style.borderLeftColor = "var(--neon-emerald)";
  } else if (type === "error") {
    icon = "fa-solid fa-triangle-exclamation";
    iconColor = "color:var(--velvet-bright)";
    toast.style.borderLeftColor = "var(--velvet-bright)";
  } else if (type === "warning") {
    icon = "fa-solid fa-bell";
    iconColor = "color:var(--gold-bright)";
    toast.style.borderLeftColor = "var(--gold-bright)";
  }

  toast.innerHTML = `
    <i class="${icon}" style="${iconColor};font-size:18px;margin-top:2px;flex-shrink:0"></i>
    <div style="flex:1;font-weight:500;line-height:1.5">${message}</div>
    <button onclick="this.closest('.cinema-toast').remove()" style="background:none;border:none;color:var(--text-ash);cursor:pointer;padding:0 4px;font-size:14px">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

function hideAlert() {
  const container = document.getElementById("cinema-toast-container");
  if (container) container.innerHTML = "";
}

// ----------------------------------------------------
// Cinematic Confirmation Modal (Replaces browser confirm())
// ----------------------------------------------------
let pendingConfirmCallback = null;

function showCinematicConfirm({ title, message, confirmText = "Confirm", confirmIcon = "fa-solid fa-check", onConfirm, icon = "fa-solid fa-clapperboard" }) {
  const modal = document.getElementById("cinema-confirm-modal");
  if (!modal) {
    if (confirm(message)) onConfirm && onConfirm();
    return;
  }

  document.getElementById("confirm-modal-title").textContent = title;
  document.getElementById("confirm-modal-desc").textContent = message;
  document.getElementById("confirm-modal-icon").className = icon;

  const actionBtn = document.getElementById("confirm-modal-action-btn");
  actionBtn.innerHTML = `<i class="${confirmIcon}"></i> <span>${confirmText}</span>`;

  pendingConfirmCallback = onConfirm;

  modal.classList.remove("hidden");
  document.getElementById("confirm-modal-cancel-btn").onclick = () => {
    modal.classList.add("hidden");
    pendingConfirmCallback = null;
  };
  actionBtn.onclick = () => {
    modal.classList.add("hidden");
    if (pendingConfirmCallback) {
      pendingConfirmCallback();
      pendingConfirmCallback = null;
    }
  };
}

// ----------------------------------------------------
// Authentic Hollywood Film Clapperboard Activation
// ----------------------------------------------------
let lastCreatedMonitorId = null;
let clapperTimeout = null;

function showActivationModal(data) {
  const modal = document.getElementById("cinema-activation-modal");
  if (!modal) return;

  const movieEl = document.getElementById("act-modal-movie");
  const venueEl = document.getElementById("act-modal-venue");
  const dateEl = document.getElementById("act-modal-date");
  const formatEl = document.getElementById("act-modal-format");
  const ruleEl = document.getElementById("act-modal-rule");
  const idEl = document.getElementById("act-modal-id");

  if (movieEl) movieEl.textContent = data.movie_title || "Feature Film";
  if (venueEl) venueEl.innerHTML = `<i class="fa-solid fa-location-dot" style="color:var(--velvet-bright);margin-right:4px"></i> ${data.venue_name || "Cinema"}`;

  const d = data.target_date || "";
  const displayDate = d.length === 8 ? `${d.substring(6,8)}/${d.substring(4,6)}/${d.substring(0,4)}` : d;
  if (dateEl) dateEl.textContent = displayDate;
  if (formatEl) formatEl.textContent = data.format_name || "Any Format";
  if (ruleEl) ruleEl.textContent = data.rule_summary || "Preferred Seats";
  if (idEl) idEl.textContent = `#00${data.id || "1"}`;

  lastCreatedMonitorId = data.id;

  const clapperArm = document.getElementById("clapper-arm");
  const clapperBoard = document.getElementById("film-clapperboard");
  const stamp = document.getElementById("clapper-action-stamp");

  if (clapperArm) clapperArm.classList.remove("clapping");
  if (clapperBoard) clapperBoard.classList.remove("impact");
  if (stamp) stamp.classList.remove("stamped");
  modal.classList.remove("fade-out");

  modal.classList.remove("hidden");

  // Step 1: Open arm initially, then snap down hard with a loud wooden CLAP!
  setTimeout(() => {
    if (clapperArm) clapperArm.classList.add("clapping");

    // Exact moment of impact (280ms into snap)
    setTimeout(() => {
      playCinemaSound('clap');
      if (clapperBoard) clapperBoard.classList.add("impact");
      if (stamp) stamp.classList.add("stamped");
      spawnConfetti();
    }, 280);
  }, 220);

  // Auto transition to Active Radar stage after 2.8s
  if (clapperTimeout) clearTimeout(clapperTimeout);
  clapperTimeout = setTimeout(() => {
    closeActivationModalAndGo();
  }, 2800);
}

function closeActivationModalAndGo() {
  if (clapperTimeout) clearTimeout(clapperTimeout);
  const modal = document.getElementById("cinema-activation-modal");
  if (modal) {
    modal.classList.add("fade-out");
    setTimeout(() => {
      modal.classList.add("hidden");
      modal.classList.remove("fade-out");
    }, 300);
  }

  switchTab("monitors");
  loadMonitors();

  setTimeout(() => {
    if (lastCreatedMonitorId) {
      const card = document.getElementById(`monitor-card-${lastCreatedMonitorId}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("card-newly-activated");
        setTimeout(() => {
          card.classList.remove("card-newly-activated");
        }, 3200);
      }
    }
  }, 350);
}

function spawnConfetti() {
  const container = document.getElementById("activation-modal-box");
  if (!container) return;

  const colors = ["#f43f5e", "#06b6d4", "#fbbf24", "#10b981", "#a855f7"];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("div");
    p.className = "confetti-particle";
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.backgroundColor = color;
    p.style.left = "50%";
    p.style.top = "20%";

    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 150;
    const tx = Math.cos(angle) * dist + "px";
    const ty = Math.sin(angle) * dist + "px";

    p.style.setProperty("--tx", tx);
    p.style.setProperty("--ty", ty);

    container.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}

// ----------------------------------------------------
// Step 1: Regions & City Selection
// ----------------------------------------------------
async function loadRegions() {
  const loader = document.getElementById("city-loader");
  loader.classList.remove("hidden");
  try {
    const res = await fetch("/api/regions");
    const data = await res.json();

    const pillsContainer = document.getElementById("popular-cities-pills");
    pillsContainer.innerHTML = "";

    (data.popular || []).forEach(city => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `popular-city-btn py-2 px-3 rounded-xl border text-xs font-medium transition ${
        city.code === selectedCityCode ? "active" : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
      }`;
      btn.textContent = city.name;
      btn.onclick = () => onCitySelected(city.code, city.slug, city.name);
      pillsContainer.appendChild(btn);
    });

    const allSelect = document.getElementById("all-cities-select");
    (data.all || []).forEach(city => {
      const opt = document.createElement("option");
      opt.value = `${city.code}|${city.slug}`;
      opt.textContent = city.name;
      allSelect.appendChild(opt);
    });

    // Load cinemas for default Hyderabad
    onCitySelected("HYD", "hyderabad", "Hyderabad");
  } catch (err) {
    showAlert("Failed to load regions: " + err.message, "error");
  } finally {
    loader.classList.add("hidden");
  }
}

function onCitySelected(code, slug, name) {
  if (code.includes("|")) {
    const parts = code.split("|");
    selectedCityCode = parts[0];
    selectedCitySlug = parts[1];
  } else {
    selectedCityCode = code;
    selectedCitySlug = slug;
  }

  document.querySelectorAll(".popular-city-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent === name || btn.textContent.toLowerCase() === selectedCitySlug);
  });

  loadCinemas(selectedCitySlug);
}

// ----------------------------------------------------
// Step 2 & 3: Cinema Selection & Date
// ----------------------------------------------------
async function loadCinemas(citySlug) {
  const loader = document.getElementById("cinemas-loader");
  const theatreSelect = document.getElementById("theatre-select");

  loader.classList.remove("hidden");
  theatreSelect.innerHTML = `<option value="">-- Loading cinemas in ${citySlug}... --</option>`;

  try {
    const res = await fetch(`/api/cinemas?city_slug=${citySlug}`);
    const data = await res.json();
    cachedCinemas = data.cinemas || [];

    theatreSelect.innerHTML = `<option value="">-- Select Theatre / Cinema (${cachedCinemas.length} found) --</option>`;

    let defaultIndex = 0;
    cachedCinemas.forEach((c, idx) => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.name} (${c.code})`;
      if (c.code === "ALUC" || c.name.toLowerCase().includes("allu") || c.name.toLowerCase().includes("kokapet")) {
        opt.selected = true;
        defaultIndex = idx;
      }
      theatreSelect.appendChild(opt);
    });

    if (cachedCinemas.length > 0) {
      const chosen = cachedCinemas[defaultIndex];
      selectedVenueCode = chosen.code;
      selectedVenueName = chosen.name;
      selectedVenueSlug = chosen.slug;
    }

    onCinemaOrDateChanged();
  } catch (err) {
    showAlert("Failed to load cinemas: " + err.message, "error");
    theatreSelect.innerHTML = `<option value="">Error loading cinemas</option>`;
  } finally {
    loader.classList.add("hidden");
  }
}

function initDatePresets() {
  const target = new Date();
  // Default to upcoming Sunday
  const day = target.getDay();
  const diff = (7 - day + 7) % 7 || 7;
  target.setDate(target.getDate() + diff);

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  document.getElementById("target-date-input").value = `${yyyy}-${mm}-${dd}`;
}

function setPresetDate(preset) {
  const target = new Date();
  if (typeof preset === "number") {
    target.setDate(target.getDate() + preset);
  } else if (preset === "next_sat") {
    const day = target.getDay();
    const diff = (6 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + diff);
  } else if (preset === "next_sun") {
    const day = target.getDay();
    const diff = (7 - day + 7) % 7 || 7;
    target.setDate(target.getDate() + diff);
  }

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  document.getElementById("target-date-input").value = `${yyyy}-${mm}-${dd}`;
  onCinemaOrDateChanged();
}

async function onCinemaOrDateChanged() {
  const theatreSelect = document.getElementById("theatre-select");
  const customVenue = document.getElementById("custom-theatre-code").value.trim().toUpperCase();

  let vCode = customVenue || theatreSelect.value || selectedVenueCode;
  if (!vCode) return;

  const foundCinema = cachedCinemas.find(c => c.code === vCode);
  if (foundCinema) {
    selectedVenueCode = foundCinema.code;
    selectedVenueName = foundCinema.name;
    selectedVenueSlug = foundCinema.slug;
  } else {
    selectedVenueCode = vCode;
    selectedVenueName = `Cinema [${vCode}]`;
    selectedVenueSlug = `cinema-${vCode.toLowerCase()}`;
  }

  const dateVal = document.getElementById("target-date-input").value;
  if (!dateVal) return;
  const dateCode = dateVal.replace(/-/g, ""); // YYYYMMDD

  const loader = document.getElementById("movies-loader");
  const movieSelect = document.getElementById("movie-select");
  const noticeBox = document.getElementById("unopened-notice");

  loader.classList.remove("hidden");
  movieSelect.innerHTML = `<option value="">-- Checking schedule for ${selectedVenueName}... --</option>`;
  noticeBox.classList.add("hidden");

  try {
    const url = `/api/cinema_showtimes?city_slug=${selectedCitySlug}&venue_code=${selectedVenueCode}&date_code=${dateCode}&venue_slug=${selectedVenueSlug}`;
    const res = await fetch(url);
    const data = await res.json();
    cachedCinemaShowtimes = data;

    const movies = data.movies || [];
    const isPredicted = data.is_predicted || !data.is_open;

    if (isPredicted) {
      noticeBox.classList.remove("hidden");
      noticeBox.innerHTML = `
        <div class="flex items-start gap-2">
          <i class="fa-solid fa-wand-magic-sparkles text-amber-400 mt-0.5"></i>
          <div>
            <strong class="text-amber-300">Bookings have not opened yet for this cinema on this date.</strong>
            <p class="text-slate-300 mt-0.5">Showing <strong>predicted formats & screens</strong> based on this theatre's regular schedule. You can select your preferred format and set seat alerts now!</p>
          </div>
        </div>
      `;
    } else {
      noticeBox.classList.add("hidden");
    }

    if (movies.length === 0) {
      // Fallback: load city movies so user can still watch an unopened future date!
      const cityMoviesRes = await fetch(`/api/movies?city_slug=${selectedCitySlug}`);
      const cityMoviesData = await cityMoviesRes.json();
      const cityMovies = cityMoviesData.movies || [];

      movieSelect.innerHTML = `<option value="">-- Select Movie to Auto-Watch when Bookings Open --</option>`;
      cityMovies.forEach(m => {
        const opt = document.createElement("option");
        opt.value = JSON.stringify({
          title: m.title,
          formats: [
            {
              format_name: "Telugu • DOLBY CINEMA 3D",
              event_code: m.event_code,
              screen: "SCREEN 1",
              attributes: "DOLBY CINEMA",
              shows: []
            },
            {
              format_name: "Telugu • 3D",
              event_code: m.event_code,
              screen: "SCREEN 2",
              attributes: "LASER 4K ATMOS",
              shows: []
            },
            {
              format_name: "Any Format",
              event_code: m.event_code,
              screen: "SCREEN",
              attributes: "Any format",
              shows: []
            }
          ]
        });
        opt.textContent = `${m.title} (Auto-Watch Mode)`;
        movieSelect.appendChild(opt);
      });

      onMovieSelected();
      return;
    }

    movieSelect.innerHTML = `<option value="">-- Select Movie (${movies.length} movies available) --</option>`;
    let defaultIdx = 0;
    movies.forEach((m, idx) => {
      const opt = document.createElement("option");
      opt.value = JSON.stringify(m);
      const suffix = isPredicted ? "predicted formats" : "formats available";
      opt.textContent = `${m.title} (${m.formats.length} ${suffix})`;
      if (m.title.toLowerCase().includes("ramayana")) {
        opt.selected = true;
        defaultIdx = idx;
      }
      movieSelect.appendChild(opt);
    });

    onMovieSelected();
  } catch (err) {
    showAlert("Error fetching cinema showtimes: " + err.message, "error");
    movieSelect.innerHTML = `<option value="">Error checking showtimes</option>`;
  } finally {
    loader.classList.add("hidden");
  }
}

// ----------------------------------------------------
// Step 4 & 5: Movie & All Formats Selection
// ----------------------------------------------------
function onMovieSelected() {
  const movieSelect = document.getElementById("movie-select");
  if (!movieSelect.value) {
    selectedMovieObj = null;
    renderFormats([]);
    return;
  }

  selectedMovieObj = JSON.parse(movieSelect.value);
  renderFormats(selectedMovieObj.formats || []);
}

function renderFormats(formats) {
  const container = document.getElementById("formats-cards-container");
  container.innerHTML = "";
  const seatMapSection = document.getElementById("seat-map-section");

  if (formats.length === 0) {
    container.innerHTML = `
      <div class="unopened-format-box">
        <p class="unopened-format-title">
          <i class="fa-solid fa-clock"></i> AUTO-WATCH FUTURE UNOPENED DATE
        </p>
        <p class="unopened-format-subtitle">Select which format you want SeatWatch to monitor as soon as BMS opens bookings:</p>
        <div class="unopened-format-chips" id="unopened-format-chips">
          <button type="button" class="format-chip active" onclick="selectUnopenedFormat('Telugu • DOLBY CINEMA 3D', this)">Telugu • DOLBY CINEMA 3D</button>
          <button type="button" class="format-chip" onclick="selectUnopenedFormat('Hindi • DOLBY CINEMA 3D', this)">Hindi • DOLBY CINEMA 3D</button>
          <button type="button" class="format-chip" onclick="selectUnopenedFormat('Telugu • 3D', this)">Telugu • 3D</button>
          <button type="button" class="format-chip" onclick="selectUnopenedFormat('Hindi • 3D', this)">Hindi • 3D</button>
          <button type="button" class="format-chip" onclick="selectUnopenedFormat('Hindi • 2D', this)">Hindi • 2D</button>
          <button type="button" class="format-chip" onclick="selectUnopenedFormat('Any Format', this)">Any Format</button>
        </div>
      </div>
    `;
    selectUnopenedFormat("Telugu • DOLBY CINEMA 3D");
    if (seatMapSection) seatMapSection.classList.add("hidden");
    return;
  }

  formats.forEach((f, fIdx) => {
    const card = document.createElement("div");
    card.id = `format-card-${fIdx}`;
    card.className = `format-card ${fIdx === 0 ? "selected" : ""}`;

    const hasShows = f.shows && f.shows.length > 0;
    const isMultiShow = f.shows && f.shows.length > 1;
    let bottomActionHtml = "";

    if (hasShows) {
      // Discover tags (e.g. PXL, ATMOS, PLAYHOUSE) from shows
      const tagsInShows = [];
      f.shows.forEach(s => {
        if (s.attributes && !tagsInShows.includes(s.attributes)) {
          tagsInShows.push(s.attributes);
        }
      });

      const allShowsBtn = isMultiShow ? `
        <button type="button"
          id="show-pill-${fIdx}-all"
          class="show-pill show-all-pill"
          onclick="onShowtimeAllPillClicked(event, ${fIdx})">
          <i class="fa-solid fa-sparkles"></i> All Shows (${f.shows.length})
        </button>
      ` : "";

      let tagFiltersHtml = "";
      if (tagsInShows.length > 0) {
        tagFiltersHtml = tagsInShows.map(tag => {
          const matchingCount = f.shows.filter(s => (s.attributes || "").toLowerCase() === tag.toLowerCase()).length;
          return `
            <button type="button"
              id="tag-pill-${fIdx}-${tag}"
              class="tag-filter-pill"
              onclick="onTagFilterClicked(event, ${fIdx}, '${tag}')">
              <i class="fa-solid fa-star"></i> ${tag} (${matchingCount})
            </button>
          `;
        }).join(" ");
      }

      const showTimesHtml = f.shows.map((s, sIdx) => {
        const hasTag = Boolean(s.attributes);
        const tagBadge = hasTag ? `
          <span class="show-attr-badge">
            ${s.attributes}
          </span>
        ` : "";
        return `
          <button type="button"
            id="show-pill-${fIdx}-${sIdx}"
            title="${s.screen || ''}${s.attributes ? ' • ' + s.attributes : ''}"
            class="show-pill ${!isMultiShow && fIdx === 0 && sIdx === 0 ? "active" : ""}"
            onclick="onShowtimePillClicked(event, ${fIdx}, ${sIdx})">
            ${s.show_time}${tagBadge}
          </button>
        `;
      }).join(" ");

      bottomActionHtml = `
        <div class="format-card-bottom">
          <div class="format-shows-header">
            <span class="format-shows-label">Select showtime to monitor & view layout:</span>
            ${tagFiltersHtml ? `<div class="tag-filters-container">${tagFiltersHtml}</div>` : ''}
          </div>
          <div class="show-pills-wrap">
            ${allShowsBtn}
            ${showTimesHtml}
          </div>
        </div>
      `;
    } else {
      const predictedTags = (f.tags && f.tags.length > 0) ? f.tags : (f.attributes && f.attributes !== 'Standard' && f.attributes !== 'Alert when any format opens' ? [f.attributes] : []);
      let unopenedTagsHtml = "";
      if (predictedTags.length > 0) {
        unopenedTagsHtml = `
          <div class="unopened-tags-row">
            <span class="unopened-tags-label">Target Screen Tag:</span>
            <button type="button" class="unopened-tag-pill active" onclick="onUnopenedScreenFilterClicked(event, ${fIdx}, 'ALL', this)">
              <i class="fa-solid fa-expand"></i> All Screens
            </button>
            ${predictedTags.map(t => `
              <button type="button" class="unopened-tag-pill" onclick="onUnopenedScreenFilterClicked(event, ${fIdx}, '${t}', this)">
                <i class="fa-solid fa-star"></i> ${t} Screens Only
              </button>
            `).join("")}
          </div>
        `;
      }

      bottomActionHtml = `
        <div class="format-card-bottom">
          <div class="unopened-status-row">
            <span class="unopened-future-badge">
              <i class="fa-solid fa-clock"></i> Unopened Future Date
            </span>
            <span class="unopened-ready-badge">
              <span class="dot"></span> Auto-Alert Ready
            </span>
          </div>
          ${unopenedTagsHtml}
          <button type="button" class="unopened-target-btn" onclick="event.stopPropagation(); selectFormat(selectedMovieObj.formats[${fIdx}], document.getElementById('format-card-${fIdx}'), 0, false); if (window.playCinemaSound) playCinemaSound('click');">
            <i class="fa-solid fa-bell"></i> Target this format for opening alert
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="format-card-header">
        <div class="format-card-title-row">
          <span class="format-name-title">
            <i class="fa-solid fa-film"></i>
            ${f.format_name}
          </span>
          <span class="format-screen-badge">
            ${f.screen || 'ANY SCREEN'}
          </span>
        </div>
        <div class="format-card-meta">
          ${f.attributes ? `<span class="format-attr-tag">${f.attributes}</span>` : ''}
          <span class="format-event-code">${f.event_code ? `Event: ${f.event_code}` : ''}</span>
        </div>
      </div>
      ${bottomActionHtml}
    `;

    card.onclick = (e) => {
      selectFormat(f, card, 0, f.shows && f.shows.length > 1);
    };
    container.appendChild(card);

    if (fIdx === 0) {
      selectFormat(f, card, 0, f.shows && f.shows.length > 1);
    }
  });
}

function onShowtimeAllPillClicked(event, fIdx) {
  event.stopPropagation();
  const formatObj = selectedMovieObj.formats[fIdx];
  const cardElement = document.getElementById(`format-card-${fIdx}`);
  document.getElementById("selected-screen-filter").value = "ALL";
  selectFormat(formatObj, cardElement, 0, true);
}

function onTagFilterClicked(event, fIdx, tag) {
  event.stopPropagation();
  const formatObj = selectedMovieObj.formats[fIdx];
  const cardElement = document.getElementById(`format-card-${fIdx}`);

  document.getElementById("selected-screen-filter").value = tag;

  const matchingShows = formatObj.shows.filter(s =>
    (s.attributes || "").toLowerCase() === tag.toLowerCase() ||
    (s.screen || "").toLowerCase().includes(tag.toLowerCase())
  );

  if (matchingShows.length > 0) {
    document.getElementById("selected-session-id").value = "ALL";
    document.getElementById("selected-showtime-str").value = `All ${tag} Shows (${matchingShows.length})`;

    // Reset format card highlights
    document.querySelectorAll(".format-card").forEach(c => c.classList.remove("selected", "active"));
    if (cardElement) cardElement.classList.add("selected", "active");

    // Reset show pills
    cardElement.querySelectorAll(".show-pill").forEach(p => p.classList.remove("active"));
    cardElement.querySelectorAll(".tag-filter-pill").forEach(p => p.classList.remove("active"));

    const activePill = cardElement.querySelector(`#tag-pill-${fIdx}-${tag}`);
    if (activePill) activePill.classList.add("active");

    const directLink = document.getElementById("bms-direct-seat-link");
    if (directLink) directLink.classList.add("hidden");

    const seatMapSection = document.getElementById("seat-map-section");
    if (seatMapSection) seatMapSection.classList.remove("hidden");

    loadLiveSeatMap(matchingShows[0].session_id, matchingShows[0].screen);
    showAlert(`🎯 Screen filter set to "${tag}"! Monitoring all ${matchingShows.length} ${tag} shows.`, "success");
  }
}

function onUnopenedScreenFilterClicked(event, fIdx, tag, btn) {
  event.stopPropagation();
  document.getElementById("selected-screen-filter").value = tag;
  const parent = btn.parentElement;
  parent.querySelectorAll(".unopened-tag-pill").forEach(b => {
    b.classList.remove("active");
  });
  btn.classList.add("active");

  const formatObj = selectedMovieObj.formats[fIdx];
  const screenParam = tag === "ALL" ? (formatObj.screen || "") : tag;
  loadLiveSeatMap("", screenParam);
  showAlert(tag === "ALL" ? "Monitoring all screens when bookings open!" : `Targeting ${tag} screens only when bookings open!`, "success");
}

function onShowtimePillClicked(event, fIdx, sIdx) {
  event.stopPropagation();
  const formatObj = selectedMovieObj.formats[fIdx];
  const cardElement = document.getElementById(`format-card-${fIdx}`);
  const show = formatObj.shows[sIdx];
  document.getElementById("selected-screen-filter").value = show.attributes || show.screen || "ALL";
  selectFormat(formatObj, cardElement, sIdx, false);
}

function selectFormat(formatObj, cardElement, showIdx = 0, isAll = false) {
  selectedFormatObj = formatObj;

  document.querySelectorAll(".format-card").forEach(c => {
    c.classList.remove("selected", "active");
  });
  if (cardElement) {
    cardElement.classList.add("selected", "active");
  }

  document.querySelectorAll(".show-pill").forEach(p => {
    p.classList.remove("active");
  });

  document.getElementById("selected-event-code").value = formatObj.event_code || "";
  document.getElementById("selected-format-name").value = formatObj.format_name || "";

  const seatMapSection = document.getElementById("seat-map-section");
  const directLink = document.getElementById("bms-direct-seat-link");
  const formatIndex = selectedMovieObj.formats.indexOf(formatObj);

  if (formatObj.shows && formatObj.shows.length > 0) {
    if (isAll) {
      document.getElementById("selected-session-id").value = "ALL";
      document.getElementById("selected-showtime-str").value = `All Shows (${formatObj.shows.length})`;

      const allPill = cardElement?.querySelector(`#show-pill-${formatIndex}-all`);
      if (allPill) allPill.classList.add("active");

      if (directLink) directLink.classList.add("hidden");
      if (seatMapSection) seatMapSection.classList.remove("hidden");
      loadLiveSeatMap(formatObj.shows[0].session_id, formatObj.shows[0].screen);
    } else {
      const validIndex = Math.min(showIdx, formatObj.shows.length - 1);
      const chosenShow = formatObj.shows[validIndex];
      document.getElementById("selected-session-id").value = chosenShow.session_id || "";
      document.getElementById("selected-showtime-str").value = chosenShow.show_time || "";

      const activePill = cardElement?.querySelector(`#show-pill-${formatIndex}-${validIndex}`);
      if (activePill) activePill.classList.add("active");

      if (directLink) {
        directLink.classList.remove("hidden");
        directLink.href = chosenShow.booking_url || `https://in.bookmyshow.com/booktickets/${selectedVenueCode}/${chosenShow.session_id}`;
      }

      if (seatMapSection) seatMapSection.classList.remove("hidden");
      loadLiveSeatMap(chosenShow.session_id, chosenShow.screen);
    }
  } else {
    // Unopened future date or format without sessions: show verified reference layout!
    document.getElementById("selected-session-id").value = "";
    document.getElementById("selected-showtime-str").value = "";
    if (directLink) directLink.classList.add("hidden");
    if (seatMapSection) seatMapSection.classList.remove("hidden");
    loadLiveSeatMap("", formatObj.screen || "");
  }
}

function selectUnopenedFormat(fmtName, btnElement) {
  document.getElementById("selected-format-name").value = fmtName;
  document.getElementById("selected-session-id").value = "";
  document.getElementById("selected-showtime-str").value = "";
  document.getElementById("selected-screen-filter").value = "ALL";
  if (btnElement) {
    document.querySelectorAll(".format-chip").forEach(c => {
      c.classList.remove("active");
    });
    btnElement.classList.add("active");
  }
  const seatMapSection = document.getElementById("seat-map-section");
  if (seatMapSection) seatMapSection.classList.remove("hidden");
  loadLiveSeatMap();
}

function updateBmsLayoutButton(sessionIdOverride = null, screenOverride = null) {
  const cardSection = document.getElementById("bms-layout-action-section");
  const btn = document.getElementById("look-at-layout-bms-btn");
  const titleEl = document.getElementById("bms-layout-card-title");
  const descEl = document.getElementById("bms-layout-card-desc");
  const badgeEl = document.getElementById("bms-layout-screen-badge");

  if (!btn) return;
  if (cardSection) cardSection.classList.remove("hidden");

  let sessionId = sessionIdOverride;
  if (sessionId === null) {
    const rawVal = document.getElementById("selected-session-id")?.value;
    if (rawVal && rawVal !== "ALL") {
      sessionId = rawVal;
    }
  }

  const dateVal = document.getElementById("target-date-input")?.value || "";
  const dateCode = dateVal.replace(/-/g, "");
  const formatName = document.getElementById("selected-format-name")?.value || "";
  const showtimeStr = document.getElementById("selected-showtime-str")?.value || "";
  const screenName = screenOverride || selectedFormatObj?.screen || "";

  let bmsUrl = "";

  if (sessionId && sessionId !== "ALL") {
    bmsUrl = `https://in.bookmyshow.com/booktickets/${selectedVenueCode}/${sessionId}`;
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-chair text-rose-400 mr-1.5"></i> Live BMS Seat Layout (${showtimeStr || 'Selected Show'})`;
    }
    if (badgeEl) {
      badgeEl.textContent = screenName ? `Auditorium: ${screenName}` : `Session ID: ${sessionId}`;
    }
    if (descEl) {
      descEl.textContent = `Click below to inspect the live BookMyShow seat layout for this show in a new tab. Check your preferred rows and seats, then enter your monitoring rules below.`;
    }
  } else {
    // Cinema buytickets page (shows all active screens & layouts)
    const venueSlug = selectedVenueSlug || `cinema-${selectedVenueCode.toLowerCase()}`;
    bmsUrl = `https://in.bookmyshow.com/cinemas/${selectedCitySlug}/${venueSlug}/buytickets/${selectedVenueCode}/${dateCode}`;
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-film text-amber-400 mr-1.5"></i> BMS Cinema Schedule & Layouts`;
    }
    if (badgeEl) {
      badgeEl.textContent = `${selectedVenueName} (${selectedVenueCode})`;
    }
    if (descEl) {
      descEl.textContent = `Open BookMyShow for this cinema to check screen layouts from active shows, then configure your row and seat ranges below.`;
    }
  }

  btn.href = bmsUrl;
}

window.loadLiveSeatMap = updateBmsLayoutButton;

// ----------------------------------------------------
// Smart Seat Zones Management & Highlighting
// ----------------------------------------------------
function renderZoneCards() {
  const container = document.getElementById("zones-list-container");
  if (!container) return;
  container.innerHTML = "";

  const activeLabel = document.getElementById("active-zone-label");
  if (activeLabel && currentZones[activeZoneIndex]) {
    activeLabel.textContent = currentZones[activeZoneIndex].title;
  }

  currentZones.forEach((z, idx) => {
    const isActive = idx === activeZoneIndex;
    const card = document.createElement("div");
    card.className = `zone-ticket-card ${isActive ? "active" : ""}`;

    card.innerHTML = `
      <!-- Zone Card Header -->
      <div class="zone-header">
        <div class="zone-header-left">
          <span class="zone-num-badge ${isActive ? 'active' : ''}">${idx + 1}</span>
          <input type="text" value="${z.title}"
            onchange="updateZoneField(${idx}, 'title', this.value)"
            class="zone-title-input" placeholder="Zone name (e.g. Selection 1)">
        </div>

        <div class="zone-header-right">
          <button type="button" onclick="setActiveZone(${idx})"
            class="btn-zone-select ${isActive ? 'active' : ''}">
            <i class="fa-solid fa-crosshairs"></i>
            <span>${isActive ? "Active Selection" : "Select to Edit"}</span>
          </button>

          ${
            currentZones.length > 1
              ? `<button type="button" onclick="removeZone(${idx})" class="btn-zone-delete" title="Delete this selection">
                  <i class="fa-solid fa-trash-can"></i>
                </button>`
              : ""
          }
        </div>
      </div>

      <!-- Quick Row & Seat Preset Chips -->
      <div class="zone-presets-row">
        <span class="preset-label"><i class="fa-solid fa-wand-magic-sparkles"></i> Quick Presets:</span>
        <button type="button" onclick="applyZonePreset(${idx}, 'B', 'I', 12, 25, 4, true, 'Middle Rows (B-I, 12-25)')"
          class="preset-chip gold">
          Middle Rows (B–I, 12–25)
        </button>
        <button type="button" onclick="applyZonePreset(${idx}, 'J', 'J', 10, 22, 4, true, 'Row J Director Choice')"
          class="preset-chip sky">
          Row J (Director Choice)
        </button>
        <button type="button" onclick="applyZonePreset(${idx}, 'C', 'G', 10, 26, 4, true, 'Prime Center Rows (C-G)')"
          class="preset-chip emerald">
          Prime Center (C–G)
        </button>
      </div>

      <!-- Zone Coordinates Grid -->
      <div class="zone-coords-grid">
        <!-- Target Rows Range -->
        <div class="coord-box">
          <span class="coord-label">Target Rows Range</span>
          <div class="coord-inputs-wrap">
            <span class="coord-subtext">From</span>
            <input type="text" value="${z.row_start}" maxlength="2"
              onchange="updateZoneField(${idx}, 'row_start', this.value.toUpperCase())"
              class="coord-input row-input">
            <span class="coord-subtext">to</span>
            <input type="text" value="${z.row_end}" maxlength="2"
              onchange="updateZoneField(${idx}, 'row_end', this.value.toUpperCase())"
              class="coord-input row-input">
          </div>
        </div>

        <!-- Seat Number Range -->
        <div class="coord-box">
          <span class="coord-label">Seat Number Range</span>
          <div class="coord-inputs-wrap">
            <span class="coord-subtext">Seats</span>
            <input type="number" value="${z.seat_min}" min="1" max="999"
              onchange="updateZoneField(${idx}, 'seat_min', parseInt(this.value, 10))"
              class="coord-input seat-input">
            <span class="coord-subtext">to</span>
            <input type="number" value="${z.seat_max}" min="1" max="999"
              onchange="updateZoneField(${idx}, 'seat_max', parseInt(this.value, 10))"
              class="coord-input seat-input">
          </div>
        </div>

        <!-- Seats Required & Consecutive -->
        <div class="coord-box">
          <span class="coord-label">Seats Required</span>
          <div class="coord-inputs-wrap">
            <input type="number" value="${z.quantity}" min="1" max="10"
              onchange="updateZoneField(${idx}, 'quantity', parseInt(this.value, 10))"
              class="coord-input seat-input" style="width:52px">

            <label class="consecutive-toggle">
              <input type="checkbox" ${z.consecutive ? 'checked' : ''}
                onchange="updateZoneField(${idx}, 'consecutive', this.checked)">
              <span>Consecutive seats</span>
            </label>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function addNewZone() {
  const newNum = currentZones.length + 1;
  currentZones.push({
    id: Date.now(),
    title: `Selection ${newNum}: Alternative Row J`,
    row_start: "J",
    row_end: "J",
    seat_min: 1,
    seat_max: 20,
    quantity: 2,
    consecutive: true,
  });
  activeZoneIndex = currentZones.length - 1;
  renderZoneCards();
  highlightMonitoredZones();
  showAlert(`Added Selection #${newNum}! Configure your target row and seat range below.`, "success");
}

function removeZone(idx) {
  if (currentZones.length <= 1) return;
  currentZones.splice(idx, 1);
  if (activeZoneIndex >= currentZones.length) {
    activeZoneIndex = currentZones.length - 1;
  }
  renderZoneCards();
  highlightMonitoredZones();
}

function setActiveZone(idx) {
  activeZoneIndex = idx;
  renderZoneCards();
  highlightMonitoredZones();
}

function updateZoneField(idx, field, value) {
  if (!currentZones[idx]) return;
  currentZones[idx][field] = value;
  highlightMonitoredZones();
}

function updateZonesMatchLogic(value) {
  zonesMatchLogic = value;
}

function applyZonePreset(idx, rStart, rEnd, sMin, sMax, qty, consec, title) {
  if (!currentZones[idx]) return;
  currentZones[idx].row_start = rStart;
  currentZones[idx].row_end = rEnd;
  currentZones[idx].seat_min = sMin;
  currentZones[idx].seat_max = sMax;
  currentZones[idx].quantity = qty;
  currentZones[idx].consecutive = consec;
  currentZones[idx].title = `Selection ${idx + 1}: ${title}`;
  renderZoneCards();
  highlightMonitoredZones();
  showAlert(`Applied preset '${title}' to Selection #${idx + 1}!`, "info");
}

function highlightMonitoredZones() {
  // Official BookMyShow layout is inspected directly via the BMS button
}

function initMarqueeDragSelection() {
  // Deprecated in favor of direct BMS layout view
}

function onSeatClicked() {
  // Deprecated in favor of direct BMS layout view
}

// ----------------------------------------------------
// Step 6: Seat Rules Tabs
// ----------------------------------------------------
function setRuleType(type) {
  currentRuleType = type;

  ["ZONES", "EXACT", "BOOKING_OPEN"].forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const panel = document.getElementById(`rule-panel-${t}`);
    const isTarget = (t === type);

    if (btn) {
      btn.classList.toggle("active", isTarget);
      if (isTarget) {
        btn.classList.add("border-rose-500/40", "bg-rose-500/10", "text-white");
        btn.classList.remove("border-slate-800", "bg-slate-900", "text-slate-300");
      } else {
        btn.classList.remove("border-rose-500/40", "bg-rose-500/10", "text-white");
        btn.classList.add("border-slate-800", "bg-slate-900", "text-slate-300");
      }
    }

    if (panel) {
      panel.classList.toggle("hidden", !isTarget);
    }
  });

  if (type === "ZONES") {
    renderZoneCards();
    highlightMonitoredZones();
  }
}

// ----------------------------------------------------
// Create Monitor Submission
// ----------------------------------------------------
async function createMonitorHandler() {
  if (!selectedMovieObj) {
    showAlert("Please select a movie first.", "error");
    return;
  }

  const dateVal = document.getElementById("target-date-input").value;
  if (!dateVal) {
    showAlert("Please select a target booking date.", "error");
    return;
  }
  const targetDate = dateVal.replace(/-/g, "");

  const eventCode = document.getElementById("selected-event-code").value;
  const sessionId = document.getElementById("selected-session-id").value;
  const formatName = document.getElementById("selected-format-name").value;
  const showtimeStr = document.getElementById("selected-showtime-str").value;
  const intervalMinutes = parseFloat(document.getElementById("interval-select").value || 2.0);

  let rulePayload = {};

  if (currentRuleType === "ZONES") {
    rulePayload = {
      match_logic: zonesMatchLogic,
      zones: currentZones.map(z => ({
        title: z.title,
        row_start: z.row_start,
        row_end: z.row_end,
        rows: [z.row_start, z.row_end],
        seat_min: parseInt(z.seat_min, 10) || 1,
        seat_max: parseInt(z.seat_max, 10) || 999,
        quantity: parseInt(z.quantity, 10) || 1,
        consecutive: Boolean(z.consecutive)
      }))
    };
  } else if (currentRuleType === "EXACT") {
    const rawSeats = document.getElementById("exact-seats").value;
    const seats = rawSeats.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const matchMode = document.querySelector("input[name='exact-mode']:checked")?.value || "ALL";
    rulePayload = { seats, match_mode: matchMode };
  } else if (currentRuleType === "BOOKING_OPEN") {
    rulePayload = {};
  }

  const screenFilter = document.getElementById("selected-screen-filter")?.value || "ALL";
  rulePayload.screen_filter = screenFilter;

  const user = getStoredTelegramUser();
  const userChatId = user?.chat_id || document.getElementById("monitor-telegram-chat-id")?.value.trim() || document.getElementById("tg-chat-input")?.value.trim();
  if (!userChatId) {
    showAlert("Please connect your Telegram bot first so you can receive seat alerts.", "error");
    switchTab("settings");
    return;
  }
  rulePayload.telegram_chat_id = userChatId;

  const screenTagStr = (screenFilter && screenFilter !== 'ALL') ? ` • [${screenFilter}]` : '';
  const formatTag = formatName ? ` (${formatName}${screenTagStr}${showtimeStr ? ' • ' + showtimeStr : ''})` : '';
  const payload = {
    title: `${selectedMovieObj.title}${formatTag} - ${selectedVenueName}`,
    city_code: selectedCityCode,
    city_slug: selectedCitySlug,
    movie_title: selectedMovieObj.title,
    movie_slug: selectedMovieObj.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    event_code: eventCode || "ET_DYNAMIC",
    venue_name: selectedVenueName,
    venue_code: selectedVenueCode,
    target_date: targetDate,
    format_filter: formatName,
    session_id: sessionId,
    rule_type: currentRuleType,
    rule_payload: rulePayload,
    interval_minutes: intervalMinutes,
    booking_url: sessionId ? `https://in.bookmyshow.com/booktickets/${selectedVenueCode}/${sessionId}` : ""
  };

  try {
    const res = await fetch("/api/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      
      let ruleDesc = "Preferred seats";
      if (currentRuleType === "MULTI_SELECTION") {
        ruleDesc = rulePayload.selections?.length ? `${rulePayload.selections.length} Selection Block(s)` : "Multi-Row Range";
      } else if (currentRuleType === "ROW_SEAT_COUNT") {
        ruleDesc = `Row ${rulePayload.row}: ${rulePayload.min_seats} seats`;
      } else if (currentRuleType === "SPECIFIC_SEATS") {
        ruleDesc = `Seats: ${(rulePayload.seats || []).join(", ")}`;
      } else if (currentRuleType === "BOOKING_OPEN") {
        ruleDesc = "Booking Opening Alert";
      }

      showActivationModal({
        id: result.monitor_id,
        movie_title: selectedMovieObj.title,
        venue_name: selectedVenueName,
        target_date: targetDate,
        format_name: formatName || "Any Format",
        rule_summary: ruleDesc
      });
    } else {
      showAlert("Error creating monitor: " + result.message, "error");
    }
  } catch (err) {
    showAlert("Failed to create monitor: " + err.message, "error");
  }
}

// ----------------------------------------------------
// Active Monitors Dashboard
// ----------------------------------------------------
async function loadMonitors() {
  const container = document.getElementById("monitors-list");
  const emptyState = document.getElementById("monitors-empty");
  const unlinkedState = document.getElementById("monitors-unlinked");

  const user = getStoredTelegramUser();
  if (!user || !user.chat_id) {
    container.innerHTML = "";
    if (emptyState) emptyState.classList.add("hidden");
    if (unlinkedState) unlinkedState.classList.remove("hidden");
    return;
  }

  if (unlinkedState) unlinkedState.classList.add("hidden");

  try {
    const res = await fetch(`/api/monitors?telegram_chat_id=${encodeURIComponent(user.chat_id)}`);
    const monitors = await res.json();

    if (!Array.isArray(monitors) || monitors.length === 0) {
      container.innerHTML = "";
      if (emptyState) emptyState.classList.remove("hidden");
      return;
    }

    if (emptyState) emptyState.classList.add("hidden");
    container.innerHTML = "";

    monitors.forEach(m => {
      const card = createMonitorCard(m);
      container.appendChild(card);
    });
  } catch (err) {
    showAlert("Failed to load monitors: " + err.message, "error");
  }
}

function createMonitorCard(m) {
  const card = document.createElement("div");
  card.id = `monitor-card-${m.id}`;
  card.className = "ticket-card monitor-card";

  let statusClass = "active";
  let statusIcon = "fa-solid fa-satellite-dish";
  let statusText = "ACTIVE";

  if (m.status === "ACTIVE") {
    statusClass = "active";
    statusIcon = "fa-solid fa-satellite-dish";
    statusText = "ACTIVE";
  } else if (m.status === "TRIGGERED") {
    statusClass = "triggered";
    statusIcon = "fa-solid fa-bell";
    statusText = "TICKETS FOUND!";
  } else if (m.status === "PAUSED") {
    statusClass = "paused";
    statusIcon = "fa-solid fa-pause";
    statusText = "PAUSED";
  }

  const d = m.target_date || "";
  const displayDate = d.length === 8 ? `${d.substring(6,8)}/${d.substring(4,6)}/${d.substring(0,4)}` : d;

  let ruleSummary = m.rule_type;
  if (m.rule_type === "RANGE") {
    ruleSummary = `Row ${m.rule_payload?.row}: Seats ${m.rule_payload?.start}-${m.rule_payload?.end}`;
  } else if (m.rule_type === "EXACT") {
    ruleSummary = `Seats: ${(m.rule_payload?.seats || []).join(", ")}`;
  } else if (m.rule_type === "CONSECUTIVE") {
    ruleSummary = `${m.rule_payload?.count} Consecutive Seats`;
  } else if (m.rule_type === "BOOKING_OPEN") {
    ruleSummary = "Booking Open Alert";
  } else if (m.rule_type === "ZONES") {
    const count = m.rule_payload?.zones?.length || 1;
    ruleSummary = `${count} Seat Zone${count > 1 ? 's' : ''} Monitored`;
  }

  const screenBadge = (m.rule_payload?.screen_filter && m.rule_payload.screen_filter !== 'ALL')
    ? `<span style="margin-left:6px;padding:2px 6px;border-radius:4px;background:rgba(212,175,55,0.2);color:var(--gold-bright);border:1px solid rgba(212,175,55,0.4);font-size:10px;font-family:'Courier Prime',monospace">⭐ ${m.rule_payload.screen_filter}</span>`
    : '';

  card.innerHTML = `
    <!-- Ticket Notches -->
    <div class="ticket-notch-left"></div>
    <div class="ticket-notch-right"></div>

    <!-- Main Ticket Body -->
    <div>
      <div class="ticket-header">
        <div>
          <div class="ticket-admit-badge">
            <i class="fa-solid fa-film"></i> TICKET ALERT
          </div>
          <h3 class="ticket-movie-title">${m.movie_title}</h3>
          <p class="ticket-venue">
            <i class="fa-solid fa-location-dot"></i> ${m.venue_name}
          </p>
        </div>
        <div class="ticket-status-stamp ${statusClass}">
          <i class="${statusIcon}"></i> <span>${statusText}</span>
        </div>
      </div>

      <!-- Specs Box -->
      <div class="ticket-specs-box">
        <div class="spec-cell">
          <span class="spec-label">SHOW DATE</span>
          <span class="spec-val mono">${displayDate}</span>
        </div>
        <div class="spec-cell">
          <span class="spec-label">FORMAT &amp; SCREEN</span>
          <span class="spec-val gold mono">${m.format_filter || "Any Format"}${screenBadge}</span>
        </div>
        <div class="spec-cell full-width">
          <span class="spec-label">SEATS MONITORED</span>
          <span class="spec-val crimson">${ruleSummary}</span>
        </div>
        ${m.rule_payload?.telegram_chat_id ? `
        <div class="spec-cell full-width">
          <span class="spec-label">TELEGRAM ALERT</span>
          <span class="spec-val mono" style="color:var(--neon-cyan);display:flex;align-items:center;gap:6px">
            <i class="fa-brands fa-telegram"></i> ID: ${m.rule_payload.telegram_chat_id}
          </span>
        </div>` : ''}
      </div>

      <!-- Radar Status Report Banner -->
      <div class="ticket-radar-banner">
        <div class="radar-banner-header">
          <i class="fa-solid fa-satellite-dish"></i> LATEST STATUS
        </div>
        <div class="radar-banner-text">${m.last_status_message || "Alert active — checking BookMyShow now..."}</div>
      </div>
    </div>

    <!-- Perforated Tear Line -->
    <div class="ticket-perforation-line"></div>

    <!-- Bottom Tear-Off Stub with Barcode & Controls -->
    <div class="ticket-stub-bar">
      <div class="ticket-barcode-wrap">
        <span class="ticket-barcode-lines">||| | |||| | ||| ||</span>
        <span>#00${m.id}</span>
      </div>

      <div class="ticket-btn-group">
        <button onclick="triggerCheckNow(${m.id})" title="Force check BookMyShow now" class="btn-ticket-icon" style="color:var(--gold-bright)">
          <i class="fa-solid fa-bolt"></i>
        </button>
        ${
          m.status === "ACTIVE"
            ? `<button onclick="pauseMonitor(${m.id})" title="Pause monitoring" class="btn-ticket-icon">
                 <i class="fa-solid fa-pause"></i>
               </button>`
            : `<button onclick="resumeMonitor(${m.id})" title="Resume monitoring" class="btn-ticket-icon" style="color:var(--neon-emerald)">
                 <i class="fa-solid fa-play"></i>
               </button>`
        }
        <button onclick="viewLogs(${m.id})" title="Projection booth logs" class="btn-ticket-icon" style="color:var(--neon-cyan)">
          <i class="fa-solid fa-clock-rotate-left"></i>
        </button>
        ${
          m.booking_url
            ? `<a href="${m.booking_url}" target="_blank" title="Open BookMyShow direct booking page" class="btn-ticket-icon" style="color:var(--velvet-bright)">
                 <i class="fa-solid fa-arrow-up-right-from-square"></i>
               </a>`
            : ''
        }
        <button onclick="deleteMonitor(${m.id})" title="Delete watcher pass" class="btn-ticket-icon danger">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>
  `;

  return card;
}

async function triggerCheckNow(id) {
  const card = document.getElementById(`monitor-card-${id}`);
  const btn = event?.currentTarget || card?.querySelector("button[onclick^='triggerCheckNow']");
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = `<i class="fa-solid fa-bolt fa-spin" style="color:var(--gold-pure)"></i>`;
    btn.disabled = true;
  }
  const pingVal = card?.querySelector(".spec-cell.full-width:last-child .spec-val");
  if (pingVal) {
    pingVal.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin" style="color:var(--gold-bright);margin-right:4px"></i>Checking BookMyShow now...`;
  }
  showAlert(`Checking BookMyShow now for Monitor #${id}...`, "info");
  try {
    const res = await fetch(`/api/monitors/${id}/check_now`, { method: "POST" });
    const data = await res.json();
    showAlert(`Check completed: ${data.explanation || data.message || "Done"}`, data.status === "TRIGGERED" ? "success" : "info");
    await loadMonitors();
  } catch (err) {
    showAlert("Check failed: " + err.message, "error");
  } finally {
    if (btn) {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }
  }
}

async function pauseMonitor(id) {
  await fetch(`/api/monitors/${id}/pause`, { method: "POST" });
  loadMonitors();
}

async function resumeMonitor(id) {
  await fetch(`/api/monitors/${id}/resume`, { method: "POST" });
  loadMonitors();
}

function deleteMonitor(id) {
  showCinematicConfirm({
    title: "Delete This Alert?",
    message: `Are you sure you want to delete this alert? We will stop checking BookMyShow for this show.`,
    confirmText: "Delete Watcher",
    confirmIcon: "fa-solid fa-trash-can",
    onConfirm: async () => {
      await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      showAlert(`Alert deleted successfully.`, "info");
      loadMonitors();
    }
  });
}

// ----------------------------------------------------
// Logs Modal & Telegram Settings
// ----------------------------------------------------
async function viewLogs(id) {
  const modal = document.getElementById("logs-modal");
  const content = document.getElementById("logs-content");
  content.innerHTML = "<div style='color:var(--text-ash);padding:14px 0'><i class='fa-solid fa-circle-notch fa-spin'></i> Retrieving projection booth records…</div>";
  modal.classList.remove("hidden");

  try {
    const res = await fetch(`/api/monitors/${id}/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      content.innerHTML = "<div style='color:var(--text-ash);padding:14px 0'>No check logs recorded yet.</div>";
      return;
    }

    content.innerHTML = logs.map(l => {
      const isTriggered = l.status === 'TRIGGERED';
      const statusColor = isTriggered ? 'color:var(--velvet-bright)' : 'color:var(--neon-emerald)';
      return `
        <div class="log-entry">
          <div class="flex justify-between items-center" style="font-size:10px;color:var(--text-ash);margin-bottom:4px">
            <span style="font-family:'Courier Prime',monospace">${l.timestamp}</span>
            <span style="font-weight:700;${statusColor};font-family:'Cinzel',serif">${l.status}</span>
          </div>
          <div style="color:var(--text-parchment);font-size:12px">${l.message}</div>
          ${l.seats_found ? `<div style="margin-top:4px;color:var(--neon-emerald);font-weight:700">Unlocked Seats: ${l.seats_found}</div>` : ''}
        </div>
      `;
    }).join("");
  } catch (err) {
    content.innerHTML = `<div style="color:var(--velvet-bright)">Failed to load projection logs: ${err.message}</div>`;
  }
}

function closeLogsModal() {
  document.getElementById("logs-modal").classList.add("hidden");
}

let currentPairCode = null;
let pairPollInterval = null;

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const tokenInput = document.getElementById("tg-token-input");
    if (tokenInput) {
      tokenInput.value = data.telegram_bot_token || "";
    }
    const chatInput = document.getElementById("tg-chat-input");

    const connectedView = document.getElementById("tg-connected-view");
    const unconnectedView = document.getElementById("tg-unconnected-view");

    // Check localStorage first
    let user = getStoredTelegramUser();
    if (!user && data.telegram_chat_id) {
      // Backfill from server settings if present (e.g. single user or initial dev)
      user = {
        chat_id: data.telegram_chat_id,
        first_name: data.telegram_user_name || "You",
        username: ""
      };
      setStoredTelegramUser(user);
    }

    if (user && user.chat_id) {
      // Connected State
      if (pairPollInterval) {
        clearInterval(pairPollInterval);
        pairPollInterval = null;
      }
      if (connectedView) connectedView.classList.remove("hidden");
      if (unconnectedView) unconnectedView.classList.add("hidden");

      const nameElem = document.getElementById("tg-display-name");
      const chatElem = document.getElementById("tg-display-chat-id");
      if (nameElem) nameElem.textContent = user.first_name || "You";
      if (chatElem) chatElem.textContent = user.chat_id;

      if (chatInput) chatInput.value = user.chat_id;

      // Auto-fill monitor creation chat ID
      const monInput = document.getElementById("monitor-telegram-chat-id");
      if (monInput) {
        monInput.value = user.chat_id;
      }
    } else {
      // Unconnected / Pairing State
      if (connectedView) connectedView.classList.add("hidden");
      if (unconnectedView) unconnectedView.classList.remove("hidden");
      if (chatInput) chatInput.value = "";
      start1ClickPairing();
    }
    updateTelegramNavBadge();
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

async function start1ClickPairing() {
  if (pairPollInterval) {
    clearInterval(pairPollInterval);
    pairPollInterval = null;
  }

  try {
    const res = await fetch("/api/telegram/pair_code");
    const data = await res.json();
    if (data.success && data.code) {
      currentPairCode = data.code;
      const btn = document.getElementById("tg-1click-btn");
      if (btn) {
        btn.href = data.deep_link;
      }
      const qrImg = document.getElementById("tg-qr-img");
      if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.deep_link)}`;
      }

      // Start polling for pairing confirmation every 2 seconds
      pairPollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/telegram/pair_status?code=${currentPairCode}`);
          const statusData = await statusRes.json();
          if (statusData.status === "PAIRED" && statusData.chat_id) {
            clearInterval(pairPollInterval);
            pairPollInterval = null;
            setStoredTelegramUser({
              chat_id: statusData.chat_id,
              first_name: statusData.first_name || "Friend",
              username: statusData.username || ""
            });
            showAlert(`🎉 Connected! Welcome, ${statusData.first_name || "Friend"}! Telegram is linked.`, "success");
            loadSettings();
            loadMonitors();
          }
        } catch (e) {
          // ignore transient poll error
        }
      }, 2000);
    }
  } catch (err) {
    console.error("Failed to generate pairing code:", err);
  }
}

function disconnectTelegram() {
  showCinematicConfirm({
    title: "Disconnect Telegram Account?",
    message: "Are you sure you want to disconnect your Telegram account from this device? You will no longer receive alerts or see your watchers on this device until you pair again.",
    confirmText: "Disconnect Account",
    confirmIcon: "fa-solid fa-link-slash",
    onConfirm: async () => {
      try {
        clearStoredTelegramUser();
        await fetch("/api/telegram/disconnect", { method: "POST" });
        showAlert("Telegram account unlinked from this device.", "info");
        loadSettings();
        loadMonitors();
      } catch (err) {
        showAlert("Failed to disconnect: " + err.message, "error");
      }
    }
  });
}

async function saveSettings() {
  const token = document.getElementById("tg-token-input")?.value.trim() || "";
  const chatId = document.getElementById("tg-chat-input")?.value.trim() || "";

  if (!chatId) {
    showAlert("Please enter your numeric Telegram Chat ID (from @userinfobot).", "error");
    return;
  }

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_bot_token: token,
        telegram_chat_id: chatId
      })
    });
    const result = await res.json();
    if (result.success) {
      setStoredTelegramUser({
        chat_id: chatId,
        first_name: "You",
        username: ""
      });
      showAlert("Telegram Chat ID saved successfully! You are ready to receive alerts.", "success");
      loadSettings();
      loadMonitors();
    }
  } catch (err) {
    showAlert("Failed to save settings: " + err.message, "error");
  }
}

async function testTelegramAlert() {
  const token = document.getElementById("tg-token-input")?.value.trim() || "";
  const chatId = document.getElementById("tg-chat-input")?.value.trim() || "";

  if (!chatId) {
    showAlert("Please enter your Telegram Chat ID first to send a test alert.", "error");
    return;
  }

  showAlert("Sending test alert to Telegram via @seatwatch_alert_bot...", "info");
  try {
    const res = await fetch("/api/test_telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token || null, chat_id: chatId })
    });
    const result = await res.json();
    if (result.success) {
      showAlert("🎉 Success! Check @seatwatch_alert_bot on your Telegram app. Don't forget to set a custom alert sound!", "success");
    } else {
      showAlert("Telegram Test Failed: " + result.message, "error");
    }
  } catch (err) {
    showAlert("Network error testing Telegram: " + err.message, "error");
  }
}

// Automatic background surveillance refresh: updates active monitors every 15s if viewing Monitors tab
setInterval(() => {
  const monitorsTab = document.getElementById("tab-monitors");
  if (monitorsTab && monitorsTab.classList.contains("active")) {
    loadMonitors();
  }
}, 15000);

