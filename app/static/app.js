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
  loadMonitors();
  loadSettings();
  renderZoneCards();
});

// ----------------------------------------------------
// Navigation
// ----------------------------------------------------
function switchTab(tabName) {
  document.querySelectorAll("section[id^='tab-']").forEach(sec => sec.classList.add("hidden"));
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.classList.remove("text-white", "bg-slate-800", "shadow-sm");
    btn.classList.add("text-slate-400");
  });

  const targetSection = document.getElementById(`tab-${tabName}`);
  const targetBtn = document.getElementById(`tab-${tabName}-btn`);

  if (targetSection) targetSection.classList.remove("hidden");
  if (targetBtn) {
    targetBtn.classList.add("text-white", "bg-slate-800", "shadow-sm");
    targetBtn.classList.remove("text-slate-400");
  }

  if (tabName === "monitors") {
    loadMonitors();
  }
}

// ----------------------------------------------------
// Cinematic Audio Synthesizer (Web Audio API)
// ----------------------------------------------------
function playCinemaSound(type = 'success') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    if (type === 'activate') {
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
  toast.className = "cinema-toast flex items-start justify-between gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-xl relative overflow-hidden ";

  let icon = "fa-solid fa-clapperboard text-sky-400";
  let borderClass = "border-sky-500/30 bg-slate-950/90 text-slate-200";
  let barColor = "bg-sky-400";

  if (type === "success") {
    icon = "fa-solid fa-circle-check text-emerald-400";
    borderClass = "border-emerald-500/30 bg-slate-950/90 text-slate-200";
    barColor = "bg-emerald-400";
  } else if (type === "error") {
    icon = "fa-solid fa-triangle-exclamation text-rose-400";
    borderClass = "border-rose-500/30 bg-slate-950/90 text-slate-200";
    barColor = "bg-rose-400";
  } else if (type === "warning") {
    icon = "fa-solid fa-bell text-amber-400";
    borderClass = "border-amber-500/30 bg-slate-950/90 text-slate-200";
    barColor = "bg-amber-400";
  }

  toast.className += borderClass;

  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <i class="${icon} text-lg mt-0.5 shrink-0"></i>
      <div class="text-xs font-medium leading-relaxed">${message}</div>
    </div>
    <button onclick="this.closest('.cinema-toast').remove()" class="text-slate-400 hover:text-white transition shrink-0">
      <i class="fa-solid fa-xmark text-sm"></i>
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
// Cinematic Monitor Activation Animation & Modal
// ----------------------------------------------------
let lastCreatedMonitorId = null;

function showActivationModal(data) {
  const modal = document.getElementById("cinema-activation-modal");
  if (!modal) return;

  document.getElementById("act-modal-movie").textContent = data.movie_title || "Movie";
  document.getElementById("act-modal-venue").innerHTML = `<i class="fa-solid fa-location-dot text-rose-400 mr-1"></i> ${data.venue_name || "Cinema"}`;
  
  const d = data.target_date || "";
  const displayDate = d.length === 8 ? `${d.substring(6,8)}/${d.substring(4,6)}/${d.substring(0,4)}` : d;
  document.getElementById("act-modal-date").textContent = displayDate;
  document.getElementById("act-modal-format").textContent = data.format_name || "Any Format";
  document.getElementById("act-modal-rule").textContent = data.rule_summary || "Preferred seats";
  document.getElementById("act-modal-id").textContent = data.id || "NEW";

  lastCreatedMonitorId = data.id;

  modal.classList.remove("hidden");
  spawnConfetti();
}

function closeActivationModalAndGo() {
  const modal = document.getElementById("cinema-activation-modal");
  if (modal) modal.classList.add("hidden");
  switchTab("monitors");
  loadMonitors();

  setTimeout(() => {
    if (lastCreatedMonitorId) {
      const card = document.getElementById(`monitor-card-${lastCreatedMonitorId}`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("ring-2", "ring-rose-500", "neon-glow-rose");
        setTimeout(() => {
          card.classList.remove("ring-2", "ring-rose-500", "neon-glow-rose");
        }, 4000);
      }
    }
  }, 300);
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
            <p class="text-slate-300 mt-0.5">Showing <strong>predicted formats & screens</strong> synthesized from this cinema's active schedule. You can select your target experience (e.g. <em>Telugu • DOLBY CINEMA 3D</em>) and set seat conditions now!</p>
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
      <div class="col-span-2 p-5 bg-slate-900/70 rounded-xl border border-slate-800 space-y-3">
        <p class="text-xs text-amber-300 font-semibold flex items-center gap-1.5">
          <i class="fa-solid fa-clock"></i> Auto-Watch Future Unopened Date
        </p>
        <p class="text-xs text-slate-400">Select which format you want SeatWatch to monitor as soon as BMS opens bookings:</p>
        <div class="flex flex-wrap gap-2 pt-1" id="unopened-format-chips">
          <button type="button" class="format-chip active px-3 py-1.5 rounded-lg border border-rose-500 bg-rose-500/10 text-xs text-rose-300 font-medium transition" onclick="selectUnopenedFormat('Telugu • DOLBY CINEMA 3D', this)">Telugu • DOLBY CINEMA 3D</button>
          <button type="button" class="format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition" onclick="selectUnopenedFormat('Hindi • DOLBY CINEMA 3D', this)">Hindi • DOLBY CINEMA 3D</button>
          <button type="button" class="format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition" onclick="selectUnopenedFormat('Telugu • 3D', this)">Telugu • 3D</button>
          <button type="button" class="format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition" onclick="selectUnopenedFormat('Hindi • 3D', this)">Hindi • 3D</button>
          <button type="button" class="format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition" onclick="selectUnopenedFormat('Hindi • 2D', this)">Hindi • 2D</button>
          <button type="button" class="format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition" onclick="selectUnopenedFormat('Any Format', this)">Any Format</button>
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
    card.className = `format-card p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between ${
      fIdx === 0 ? "border-rose-500 bg-rose-500/10 shadow-md shadow-rose-500/10" : "border-slate-800 bg-slate-900/80 hover:border-slate-700"
    }`;

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
          class="show-pill show-all-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition bg-rose-600 text-white border-rose-500 shadow-sm shadow-rose-600/30"
          onclick="onShowtimeAllPillClicked(event, ${fIdx})">
          <i class="fa-solid fa-sparkles text-[10px]"></i> All Shows (${f.shows.length})
        </button>
      ` : "";

      let tagFiltersHtml = "";
      if (tagsInShows.length > 0) {
        tagFiltersHtml = tagsInShows.map(tag => {
          const matchingCount = f.shows.filter(s => (s.attributes || "").toLowerCase() === tag.toLowerCase()).length;
          return `
            <button type="button"
              id="tag-pill-${fIdx}-${tag}"
              class="tag-filter-pill px-2.5 py-1 rounded-lg text-[10px] font-bold border transition bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 flex items-center gap-1 shadow-sm"
              onclick="onTagFilterClicked(event, ${fIdx}, '${tag}')">
              <i class="fa-solid fa-star text-[9px] text-amber-400"></i> ⭐ ${tag} Shows (${matchingCount})
            </button>
          `;
        }).join(" ");
      }

      const showTimesHtml = f.shows.map((s, sIdx) => {
        const hasTag = Boolean(s.attributes);
        const tagBadge = hasTag ? `
          <span class="ml-1 px-1 py-0.2 rounded text-[9px] bg-amber-400/20 text-amber-300 font-extrabold border border-amber-400/30">
            ${s.attributes}
          </span>
        ` : "";
        return `
          <button type="button"
            id="show-pill-${fIdx}-${sIdx}"
            title="${s.screen || ''}${s.attributes ? ' • ' + s.attributes : ''}"
            class="show-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition ${
              !isMultiShow && fIdx === 0 && sIdx === 0
                ? "bg-rose-600 text-white border-rose-500 font-bold shadow-sm shadow-rose-600/30"
                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
            }"
            onclick="onShowtimePillClicked(event, ${fIdx}, ${sIdx})">
            ${s.show_time}${tagBadge}
          </button>
        `;
      }).join(" ");

      bottomActionHtml = `
        <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-slate-400">Select showtime to monitor & view layout:</span>
            ${tagFiltersHtml ? `<div class="flex items-center gap-1">${tagFiltersHtml}</div>` : ''}
          </div>
          <div class="flex flex-wrap gap-1.5">
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
          <div class="pt-1.5 flex items-center gap-1.5 flex-wrap">
            <span class="text-[10px] text-slate-400 font-medium">Target Screen Tag:</span>
            <button type="button" class="unopened-tag-pill active px-2 py-0.5 rounded-md text-[10px] font-bold border bg-rose-600 text-white border-rose-500" onclick="onUnopenedScreenFilterClicked(event, ${fIdx}, 'ALL', this)">All Screens</button>
            ${predictedTags.map(t => `
              <button type="button" class="unopened-tag-pill px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-800 text-amber-300 border-amber-500/30 hover:border-amber-400 flex items-center gap-1" onclick="onUnopenedScreenFilterClicked(event, ${fIdx}, '${t}', this)">
                <i class="fa-solid fa-star text-[8px] text-amber-400"></i> ${t} Screens Only
              </button>
            `).join("")}
          </div>
        `;
      }

      bottomActionHtml = `
        <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-amber-400 font-medium flex items-center gap-1">
              <i class="fa-solid fa-clock"></i> Unopened Future Date
            </span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30">
              Auto-Alert Ready
            </span>
          </div>
          ${unopenedTagsHtml}
          <button type="button" class="w-full py-1.5 px-3 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
            <i class="fa-solid fa-bell"></i> Target this format for opening alert
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between gap-2 mb-1.5">
          <span class="text-xs font-bold text-white flex items-center gap-1.5">
            <i class="fa-solid fa-film text-rose-400"></i>
            ${f.format_name}
          </span>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700">
            ${f.screen}
          </span>
        </div>
        <div class="text-[11px] text-slate-400 mb-2">
          ${f.attributes ? `<span class="text-amber-400 mr-1.5 font-medium">${f.attributes}</span>` : ''}
          <span class="text-slate-500">${f.event_code ? `Event: ${f.event_code}` : ''}</span>
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
    document.querySelectorAll(".format-card").forEach(c => {
      c.className = "format-card p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between border-slate-800 bg-slate-900/80 hover:border-slate-700";
    });
    if (cardElement) {
      cardElement.className = "format-card p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between border-rose-500 bg-rose-500/10 shadow-md shadow-rose-500/10";
    }

    // Reset show pills
    cardElement.querySelectorAll(".show-pill").forEach(p => {
      p.className = "show-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700";
    });
    cardElement.querySelectorAll(".tag-filter-pill").forEach(p => {
      p.classList.remove("bg-amber-500", "text-slate-950", "border-amber-400", "font-extrabold");
      p.classList.add("bg-amber-500/15", "text-amber-300", "border-amber-500/40");
    });

    const activePill = cardElement.querySelector(`#tag-pill-${fIdx}-${tag}`);
    if (activePill) {
      activePill.classList.remove("bg-amber-500/15", "text-amber-300");
      activePill.classList.add("bg-amber-500", "text-slate-950", "border-amber-400", "font-extrabold");
    }

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
    b.className = "unopened-tag-pill px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-800 text-amber-300 border-amber-500/30 hover:border-amber-400 flex items-center gap-1";
  });
  btn.className = "unopened-tag-pill active px-2 py-0.5 rounded-md text-[10px] font-bold border bg-amber-500 text-slate-950 border-amber-400 font-extrabold flex items-center gap-1";

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
    c.className = "format-card p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between border-slate-800 bg-slate-900/80 hover:border-slate-700";
  });
  if (cardElement) {
    cardElement.className = "format-card p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between border-rose-500 bg-rose-500/10 shadow-md shadow-rose-500/10";
  }

  document.querySelectorAll(".show-pill").forEach(p => {
    p.className = "show-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700";
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
      if (allPill) {
        allPill.className = "show-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition bg-rose-600 text-white border-rose-500 shadow-sm shadow-rose-600/30";
      }

      if (directLink) {
        directLink.classList.add("hidden");
      }

      if (seatMapSection) seatMapSection.classList.remove("hidden");
      // Load first show as interactive preview layout
      loadLiveSeatMap(formatObj.shows[0].session_id, formatObj.shows[0].screen);
    } else {
      const validIndex = Math.min(showIdx, formatObj.shows.length - 1);
      const chosenShow = formatObj.shows[validIndex];
      document.getElementById("selected-session-id").value = chosenShow.session_id || "";
      document.getElementById("selected-showtime-str").value = chosenShow.show_time || "";

      const activePill = cardElement?.querySelector(`#show-pill-${formatIndex}-${validIndex}`);
      if (activePill) {
        activePill.className = "show-pill px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition bg-rose-600 text-white border-rose-500 font-bold shadow-sm shadow-rose-600/30";
      }

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
    if (directLink) {
      directLink.classList.add("hidden");
    }
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
      c.className = "format-chip px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-300 font-medium hover:border-slate-600 transition";
    });
    btnElement.className = "format-chip active px-3 py-1.5 rounded-lg border border-rose-500 bg-rose-500/10 text-xs text-rose-300 font-medium transition";
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
    card.className = `p-4 rounded-xl border transition space-y-3 ${
      isActive
        ? "border-rose-500/70 bg-rose-500/10 shadow-md shadow-rose-500/10"
        : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
    }`;

    card.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800/60">
        <div class="flex items-center gap-2">
          <span class="w-5 h-5 rounded-full ${isActive ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400'} text-xs flex items-center justify-center font-bold font-mono">
            ${idx + 1}
          </span>
          <input type="text" value="${z.title}"
            onchange="updateZoneField(${idx}, 'title', this.value)"
            class="bg-transparent border-0 font-semibold text-xs text-slate-200 focus:ring-0 focus:outline-none p-0 w-52 sm:w-64">
        </div>

        <div class="flex items-center gap-2">
          <button type="button" onclick="setActiveZone(${idx})"
            class="px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 ${
              isActive
                ? "bg-rose-500 text-white font-bold shadow-sm shadow-rose-500/30"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            }">
            <i class="fa-solid fa-crosshairs text-[10px]"></i>
            ${isActive ? "Active Selection" : "Select to Edit"}
          </button>

          ${
            currentZones.length > 1
              ? `<button type="button" onclick="removeZone(${idx})" class="w-6 h-6 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 flex items-center justify-center transition text-xs" title="Delete this selection">
                  <i class="fa-solid fa-trash-can text-[10px]"></i>
                </button>`
              : ""
          }
        </div>
      </div>

      <!-- Quick Row & Seat Preset Chips -->
      <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span class="text-slate-400 text-[10px] mr-1">Quick Presets:</span>
        <button type="button" onclick="applyZonePreset(${idx}, 'B', 'I', 12, 25, 4, true, 'Middle Rows B-I (12-25)')"
          class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-rose-300 font-mono text-[10px] border border-slate-700/60 transition">
          Middle Rows (B-I, 12-25)
        </button>
        <button type="button" onclick="applyZonePreset(${idx}, 'J', 'J', 1, 20, 2, true, 'Row J Director (1-20)')"
          class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-mono text-[10px] border border-slate-700/60 transition">
          Row J (Director Choice)
        </button>
        <button type="button" onclick="applyZonePreset(${idx}, 'C', 'G', 10, 26, 4, true, 'Prime Center Rows (C-G)')"
          class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 font-mono text-[10px] border border-slate-700/60 transition">
          Prime Center (C-G)
        </button>
      </div>

      <!-- Zone Coordinates & Requirements -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
        <!-- Target Rows Range -->
        <div>
          <label class="text-[11px] text-slate-400 block mb-1">Target Rows Range</label>
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-slate-400">From</span>
            <input type="text" value="${z.row_start}" maxlength="2"
              onchange="updateZoneField(${idx}, 'row_start', this.value.toUpperCase())"
              class="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-center font-mono font-bold text-slate-200 uppercase">
            <span class="text-xs text-slate-500">to</span>
            <input type="text" value="${z.row_end}" maxlength="2"
              onchange="updateZoneField(${idx}, 'row_end', this.value.toUpperCase())"
              class="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-center font-mono font-bold text-slate-200 uppercase">
          </div>
        </div>

        <!-- Seat Number Range -->
        <div>
          <label class="text-[11px] text-slate-400 block mb-1">Seat Number Range</label>
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-slate-400">Seats</span>
            <input type="number" value="${z.seat_min}" min="1" max="999"
              onchange="updateZoneField(${idx}, 'seat_min', parseInt(this.value, 10))"
              class="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-center font-mono font-bold text-slate-200">
            <span class="text-xs text-slate-500">to</span>
            <input type="number" value="${z.seat_max}" min="1" max="999"
              onchange="updateZoneField(${idx}, 'seat_max', parseInt(this.value, 10))"
              class="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-center font-mono font-bold text-slate-200">
          </div>
        </div>

        <!-- Quantity & Consecutive Checkbox -->
        <div>
          <label class="text-[11px] text-slate-400 block mb-1">Seats Required</label>
          <div class="flex items-center gap-3">
            <input type="number" value="${z.quantity}" min="1" max="10"
              onchange="updateZoneField(${idx}, 'quantity', parseInt(this.value, 10))"
              class="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-center font-mono font-bold text-slate-200">

            <label class="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-300">
              <input type="checkbox" ${z.consecutive ? 'checked' : ''}
                onchange="updateZoneField(${idx}, 'consecutive', this.checked)"
                class="accent-rose-500 w-4 h-4 rounded">
              <span class="font-medium text-rose-300">Consecutive adjacent seats</span>
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

  const userChatId = document.getElementById("monitor-telegram-chat-id")?.value.trim() || document.getElementById("tg-chat-input")?.value.trim();
  if (userChatId) {
    rulePayload.telegram_chat_id = userChatId;
  }

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
      playCinemaSound('activate');
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

  try {
    const res = await fetch("/api/monitors");
    const monitors = await res.json();

    if (monitors.length === 0) {
      container.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");
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
  card.className = "monitor-card cinema-card rounded-2xl p-5 space-y-4 shadow-xl flex flex-col justify-between relative overflow-hidden transition-all";

  let badgeColor = "bg-slate-800 text-slate-300 border-slate-700";
  let statusIcon = "fa-solid fa-clock";

  if (m.status === "ACTIVE") {
    badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    statusIcon = "fa-solid fa-circle-dot fa-fade";
  } else if (m.status === "TRIGGERED") {
    badgeColor = "bg-rose-500/10 text-rose-400 border-rose-500/30";
    statusIcon = "fa-solid fa-bell";
  } else if (m.status === "PAUSED") {
    badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/30";
    statusIcon = "fa-solid fa-pause";
  }

  const d = m.target_date;
  const displayDate = d.length === 8 ? `${d.substring(6,8)}/${d.substring(4,6)}/${d.substring(0,4)}` : d;

  let ruleSummary = m.rule_type;
  if (m.rule_type === "RANGE") {
    ruleSummary = `Row ${m.rule_payload.row}: Seats ${m.rule_payload.start}-${m.rule_payload.end}`;
  } else if (m.rule_type === "EXACT") {
    ruleSummary = `Seats: ${(m.rule_payload.seats || []).join(", ")}`;
  } else if (m.rule_type === "CONSECUTIVE") {
    ruleSummary = `${m.rule_payload.count} Consecutive Seats`;
  } else if (m.rule_type === "BOOKING_OPEN") {
    ruleSummary = "Booking Open Alert";
  }

  card.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h3 class="text-base font-bold text-white leading-tight">${m.movie_title}</h3>
          <p class="text-xs text-slate-400 mt-0.5"><i class="fa-solid fa-location-dot mr-1 text-slate-500"></i>${m.venue_name}</p>
        </div>
        <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold border flex items-center gap-1.5 ${badgeColor}">
          <i class="${statusIcon}"></i> ${m.status}
        </span>
      </div>

      <div class="bg-slate-900/80 rounded-xl p-3 border border-slate-800/80 text-xs space-y-1.5">
        <div class="flex justify-between text-slate-400">
          <span>Target Date:</span>
          <span class="text-slate-200 font-medium">${displayDate}</span>
        </div>
        <div class="flex justify-between text-slate-400">
          <span>Format & Screen:</span>
          <span class="text-slate-200 font-medium">
            ${m.format_filter || "Any Format"}
            ${m.rule_payload?.screen_filter && m.rule_payload.screen_filter !== 'ALL' ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">⭐ ${m.rule_payload.screen_filter}</span>` : ''}
          </span>
        </div>
        <div class="flex justify-between text-slate-400">
          <span>Rule:</span>
          <span class="text-rose-400 font-semibold">${ruleSummary}</span>
        </div>
        ${m.rule_payload?.telegram_chat_id ? `
        <div class="flex justify-between text-slate-400">
          <span>Telegram Alert:</span>
          <span class="text-sky-300 font-medium font-mono text-[11px] flex items-center gap-1">
            <i class="fa-brands fa-telegram text-sky-400"></i> ${m.rule_payload.telegram_chat_id}
          </span>
        </div>` : ''}
      </div>

      <div class="text-[11px] text-slate-400 border-l-2 border-slate-700 pl-2.5 py-0.5">
        <span class="text-slate-500 font-medium">Status:</span> ${m.last_status_message || "Scheduled"}
      </div>
    </div>

    <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
      <div class="flex items-center gap-1.5">
        <button onclick="triggerCheckNow(${m.id})" title="Force check BookMyShow now" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition">
          <i class="fa-solid fa-bolt text-amber-400"></i>
        </button>
        ${
          m.status === "ACTIVE"
            ? `<button onclick="pauseMonitor(${m.id})" title="Pause monitoring" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition">
                 <i class="fa-solid fa-pause text-slate-400"></i>
               </button>`
            : `<button onclick="resumeMonitor(${m.id})" title="Resume monitoring" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition">
                 <i class="fa-solid fa-play text-emerald-400"></i>
               </button>`
        }
        <button onclick="viewLogs(${m.id})" title="View check history" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition">
          <i class="fa-solid fa-clock-rotate-left text-sky-400"></i>
        </button>
        ${
          m.booking_url
            ? `<a href="${m.booking_url}" target="_blank" title="Open BookMyShow direct booking page" class="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition">
                 <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> BMS
               </a>`
            : ''
        }
      </div>

      <button onclick="deleteMonitor(${m.id})" title="Delete monitor" class="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `;

  return card;
}

async function triggerCheckNow(id) {
  showAlert(`Checking BookMyShow now for Monitor #${id}...`, "info");
  try {
    const res = await fetch(`/api/monitors/${id}/check_now`, { method: "POST" });
    const data = await res.json();
    showAlert(`Check completed: ${data.explanation || data.message || "Done"}`, data.status === "TRIGGERED" ? "success" : "info");
    loadMonitors();
  } catch (err) {
    showAlert("Check failed: " + err.message, "error");
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
    title: "Decommission Seat Watcher?",
    message: `Are you sure you want to delete Monitor #${id}? Continuous BookMyShow radar surveillance for this show will be stopped immediately.`,
    confirmText: "Delete Watcher",
    confirmIcon: "fa-solid fa-trash-can",
    onConfirm: async () => {
      await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      showAlert(`Monitor #${id} removed from surveillance radar.`, "info");
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
  content.innerHTML = "<div class='text-slate-400'>Loading history...</div>";
  modal.classList.remove("hidden");

  try {
    const res = await fetch(`/api/monitors/${id}/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      content.innerHTML = "<div class='text-slate-500'>No check logs recorded yet.</div>";
      return;
    }

    content.innerHTML = logs.map(l => `
      <div class="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
        <div class="flex justify-between text-[11px] text-slate-500 mb-1">
          <span>${l.timestamp}</span>
          <span class="font-bold ${l.status === 'TRIGGERED' ? 'text-rose-400' : 'text-slate-400'}">${l.status}</span>
        </div>
        <div class="text-slate-200">${l.message}</div>
        ${l.seats_found ? `<div class="mt-1 text-emerald-400">Seats: ${l.seats_found}</div>` : ''}
      </div>
    `).join("");
  } catch (err) {
    content.innerHTML = `<div class='text-rose-400'>Failed to load logs: ${err.message}</div>`;
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
    if (chatInput) {
      chatInput.value = data.telegram_chat_id || "";
    }

    const connectedView = document.getElementById("tg-connected-view");
    const unconnectedView = document.getElementById("tg-unconnected-view");

    if (data.telegram_chat_id) {
      // Connected State
      if (pairPollInterval) {
        clearInterval(pairPollInterval);
        pairPollInterval = null;
      }
      if (connectedView) connectedView.classList.remove("hidden");
      if (unconnectedView) unconnectedView.classList.add("hidden");

      const nameElem = document.getElementById("tg-display-name");
      const chatElem = document.getElementById("tg-display-chat-id");
      if (nameElem) nameElem.textContent = data.telegram_user_name || "You";
      if (chatElem) chatElem.textContent = data.telegram_chat_id;

      // Auto-fill monitor creation chat ID if currently empty
      const monInput = document.getElementById("monitor-telegram-chat-id");
      if (monInput && !monInput.value) {
        monInput.value = data.telegram_chat_id;
      }
    } else {
      // Unconnected / Pairing State
      if (connectedView) connectedView.classList.add("hidden");
      if (unconnectedView) unconnectedView.classList.remove("hidden");
      start1ClickPairing();
    }
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
            showAlert(`🎉 Connected! Welcome, ${statusData.first_name || "Friend"}! Telegram is linked.`, "success");
            loadSettings();
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
    message: "Are you sure you want to disconnect your Telegram account from SeatWatch? You will no longer receive instant alerts until paired again.",
    confirmText: "Disconnect Account",
    confirmIcon: "fa-solid fa-link-slash",
    onConfirm: async () => {
      try {
        await fetch("/api/telegram/disconnect", { method: "POST" });
        showAlert("Telegram account unlinked. 1-Click pairing is ready.", "info");
        loadSettings();
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
      showAlert("Telegram Chat ID saved successfully! You are ready to receive alerts.", "success");
      const monInput = document.getElementById("monitor-telegram-chat-id");
      if (monInput && !monInput.value) {
        monInput.value = chatId;
      }
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
