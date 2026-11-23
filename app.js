const STORAGE_KEY = "photo-prompt-state-v3";

const els = {
  date: document.getElementById("date"),
  type: document.getElementById("type"),
  prompt: document.getElementById("prompt"),
  source: document.getElementById("source"),
  tipsTitle: document.getElementById("tips-title"),
  tips: document.getElementById("tips"),
  note: document.getElementById("note"),
  count: document.getElementById("count"),
  weather: document.getElementById("weather"),
  location: document.getElementById("location"),
  locationForm: document.getElementById("location-form"),
  locationMessage: document.getElementById("location-message"),
  city: document.getElementById("city"),
  device: document.getElementById("device"),
  locationControls: [...document.querySelectorAll("#location-form input, #location-form button")],
  reroll: document.getElementById("reroll"),
  today: document.getElementById("today"),
  copy: document.getElementById("copy"),
  filters: [...document.querySelectorAll(".filters input")],
};

function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Small deterministic hash + PRNG so the same date gives the same daily prompt.
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadState() {
  const fresh = { date: todayKey(), disabled: [], seen: [], location: null, weather: null, daily: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return { ...fresh, ...saved, date: todayKey() };
  } catch {}
  return fresh;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

const state = loadState();
const MAX_SEEN = 1000;
let current = null;
let viewingDaily = true;

const promptKey = (p) => `${p.type}|${p.text}`;

function remember(prompt) {
  const key = promptKey(prompt);
  if (state.seen.includes(key)) return;
  state.seen.push(key);
  if (state.seen.length > MAX_SEEN) state.seen.shift();
  saveState();
}

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);
const unique = (list) => [...new Set(list)];

const WORD_LIST = unique(WORDS);
const CONCEPT_LIST = unique(CONCEPTS);
const ALL_THEMES = unique([...WORDS, ...CONCEPTS]);

// Conditions right now (e.g. "rain", "cold", "autumn"); empty until a location is set.
let conditions = new Set();
let THEMES = [];

// Themes that depend on weather are only included while the conditions make them possible.
function refreshThemes() {
  THEMES = ALL_THEMES.filter(
    (t) => !RARE_THEMES.includes(t) || (RARE_THEME_WHEN[t] || []).some((tag) => conditions.has(tag)),
  );
}

const weatherPool = () => WEATHER.filter(([, , tags]) => tags.every((tag) => conditions.has(tag)));

// Season names are only offered in season, which needs a location to know the hemisphere.
const SEASONS = ["spring", "summer", "autumn", "winter"];
const conceptPool = () => CONCEPT_LIST.filter((t) => !SEASONS.includes(t) || conditions.has(t));

function updateConditions() {
  const { location, weather } = state;
  conditions = location && weather ? weatherTags(weather, location.latitude) : new Set();
  refreshThemes();
}

const COLOUR_PAIRS = PAIR_COLOURS.flatMap((a, i) => PAIR_COLOURS.slice(i + 1).map((b) => [a, b]));

// Builds a generator from a list of [text, source] entries.
const fromPairs = (list, format = (text) => text) => ({
  count: list.length,
  at: (i) => ({ text: format(list[i][0]), source: list[i][1] }),
});

// Each generator maps an index to a prompt: a string, or { text, source }.
const GENERATORS = {
  Idiom: fromPairs(IDIOMS, (text) => `“${text}”`),
  Mood: {
    count: MOODS.length,
    at: (i) => capitalise(MOODS[i]),
  },
  Style: {
    count: STYLES.length,
    at: (i) => ({ text: STYLES[i][0], source: STYLES[i][1], tips: STYLES[i][2] }),
  },
  Technique: fromPairs(TECHNIQUES),
  Colours: {
    count: COLOUR_PAIRS.length,
    at(i) {
      const [a, b] = COLOUR_PAIRS[i];
      return { text: capitalise(`${a} and ${b}`), source: "look for both colours in the same frame" };
    },
  },
  Location: {
    count: LOCATIONS.length,
    at: (i) => ({ text: capitalise(LOCATIONS[i]), source: "location: take 5 photos here" }),
  },
  Weather: {
    get count() {
      return weatherPool().length;
    },
    at: (i) => {
      const [text, source] = weatherPool()[i];
      return { text, source };
    },
  },
  Series: {
    get count() {
      return SERIES.length + THEMES.length * SERIES_TEMPLATES.length;
    },
    at(i) {
      if (i < SERIES.length) return { text: SERIES[i][0], source: SERIES[i][1] };
      const j = i - SERIES.length;
      const [title, detail] = SERIES_TEMPLATES[Math.floor(j / THEMES.length)];
      const theme = THEMES[j % THEMES.length];
      return { text: title.replace("{t}", theme), source: detail.replace("{t}", theme) };
    },
  },
  Poetry: {
    count: POETRY.length + SONG_TITLES.length,
    at(i) {
      if (i < POETRY.length) return { text: `“${POETRY[i][0]}”`, source: POETRY[i][1] };
      const [title, artist] = SONG_TITLES[i - POETRY.length];
      return { text: `Song: “${title}”`, source: artist };
    },
  },
  Word: {
    count: WORD_LIST.length,
    at: (i) => capitalise(WORD_LIST[i]),
  },
  Concept: {
    get count() {
      return conceptPool().length;
    },
    at: (i) => capitalise(conceptPool()[i]),
  },
  Challenge: {
    get count() {
      return PLAIN_CHALLENGES.length + THEMES.length * CHALLENGE_TEMPLATES.length;
    },
    at(i) {
      if (i < PLAIN_CHALLENGES.length) return PLAIN_CHALLENGES[i];
      const j = i - PLAIN_CHALLENGES.length;
      return CHALLENGE_TEMPLATES[Math.floor(j / THEMES.length)].replace("{t}", THEMES[j % THEMES.length]);
    },
  },
};

function enabledTypes() {
  return els.filters.filter((f) => f.checked).map((f) => f.value);
}

function totalPrompts() {
  return enabledTypes().reduce((sum, t) => sum + GENERATORS[t].count, 0);
}

function pick(rand) {
  const types = enabledTypes();
  const type = types[Math.floor(rand() * types.length)];
  const { count, at } = GENERATORS[type];
  const item = at(Math.floor(rand() * count));
  return typeof item === "string" ? { type, text: item } : { type, ...item };
}

const DAILY_VERSION = 2; // bump when the prompt pools change, so a stored daily prompt is re-picked

// The daily prompt is fixed once chosen, so it doesn't change as the weather does.
function dailyPrompt() {
  const signature = `${DAILY_VERSION}:${enabledTypes().join()}`;
  const { daily } = state;
  if (daily && daily.date === state.date && daily.signature === signature) return daily.prompt;
  const prompt = pick(mulberry32(hashString(state.date)));
  state.daily = { date: state.date, signature, prompt };
  saveState();
  return prompt;
}

// Rerolls skip anything shown recently, so small categories don't keep repeating.
function randomPrompt() {
  const seen = new Set(state.seen);
  let next;
  for (let attempt = 0; attempt < 200; attempt++) {
    next = pick(Math.random);
    if (!seen.has(promptKey(next))) break;
  }
  return next;
}

function render() {
  els.date.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  els.type.textContent = current.type;
  els.type.dataset.type = current.type;
  els.prompt.textContent = current.text;
  els.source.textContent = current.source ? `— ${current.source}` : "";
  els.tipsTitle.hidden = !current.tips;
  els.tips.replaceChildren(
    ...(current.tips || []).map((tip) => Object.assign(document.createElement("li"), { textContent: tip })),
  );
  els.note.textContent = viewingDaily
    ? "Today's prompt"
    : "Rerolled: press “Today's prompt” to go back";
  els.today.hidden = viewingDaily;
  els.count.textContent = `${totalPrompts().toLocaleString()} possible prompts`;
}

function showDaily() {
  viewingDaily = true;
  current = dailyPrompt();
  remember(current);
  render();
}

els.reroll.addEventListener("click", () => {
  viewingDaily = false;
  current = randomPrompt();
  remember(current);
  render();
});

els.today.addEventListener("click", showDaily);

els.copy.addEventListener("click", async () => {
  try {
    const source = current.source ? ` (${current.source})` : "";
    const tips = current.tips ? `\n${current.tips.map((t) => `- ${t}`).join("\n")}` : "";
    await navigator.clipboard.writeText(`${current.type}: ${current.text}${source}${tips}`);
    els.copy.textContent = "Copied!";
  } catch {
    els.copy.textContent = "Copy failed";
  }
  setTimeout(() => (els.copy.textContent = "Copy"), 1200);
});

els.filters.forEach((box) => {
  box.checked = !state.disabled.includes(box.value);
  box.addEventListener("change", () => {
    if (!els.filters.some((f) => f.checked)) box.checked = true;
    state.disabled = els.filters.filter((f) => !f.checked).map((f) => f.value);
    saveState();
    showDaily();
  });
});

function renderWeather() {
  const { location, weather } = state;
  if (!location || !weather) {
    els.weather.textContent = "Set a location for prompts that match the weather";
    els.location.textContent = "📍 Set location";
    return;
  }
  const info = weatherInfo(weather.code);
  const season = seasonFor(new Date(), location.latitude);
  els.weather.textContent = `${info.icon} ${info.label}, ${Math.round(weather.temp)}°C · ${location.name} · ${capitalise(season)}`;
  els.location.textContent = "📍 Change location";
}

const WEATHER_MAX_AGE_MS = 30 * 60 * 1000;

// Fetches fresh weather unless a recent reading is cached. Failures just leave weather prompts off.
async function refreshWeather() {
  const { location, weather } = state;
  if (!location) return;
  if (weather && Date.now() - weather.fetchedAt < WEATHER_MAX_AGE_MS) return;
  try {
    state.weather = await fetchWeather(location.latitude, location.longitude);
    saveState();
  } catch {}
}

// Sets the location from a lookup (city search or device), then refreshes weather and prompts.
async function applyLocation(lookup) {
  els.locationControls.forEach((el) => (el.disabled = true));
  els.locationMessage.textContent = "Looking up weather…";
  try {
    const found = await lookup();
    if (!found) {
      els.locationMessage.textContent = "Couldn't find that place. Try a nearby city.";
      return;
    }
    state.location = found;
    state.weather = null;
    state.daily = null;
    await refreshWeather();
    els.locationMessage.textContent = state.weather ? "" : "Location saved, but the weather couldn't be loaded right now.";
    if (state.weather) els.locationForm.hidden = true;
    updateConditions();
    renderWeather();
    showDaily();
  } catch {
    els.locationMessage.textContent = "Couldn't get your location. Check your connection or enter a city.";
  } finally {
    els.locationControls.forEach((el) => (el.disabled = false));
  }
}

els.location.addEventListener("click", () => {
  els.locationForm.hidden = !els.locationForm.hidden;
  if (!els.locationForm.hidden) els.city.focus();
});

els.locationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const city = els.city.value.trim();
  if (city) applyLocation(() => geocodeCity(city));
});

els.device.addEventListener("click", () => applyLocation(deviceLocation));

async function init() {
  // Wait briefly for weather so the first daily prompt can use it.
  await Promise.race([refreshWeather(), new Promise((resolve) => setTimeout(resolve, 2500))]);
  updateConditions();
  renderWeather();
  showDaily();
}

init();
