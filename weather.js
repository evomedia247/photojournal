// Free weather data from Open-Meteo (no API key needed): https://open-meteo.com
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";

// WMO weather codes grouped into the conditions we care about.
const WEATHER_CODES = [
  { codes: [0], label: "Clear sky", icon: "☀️", tags: ["clear"] },
  { codes: [1], label: "Mostly clear", icon: "🌤️", tags: ["clear"] },
  { codes: [2], label: "Partly cloudy", icon: "⛅", tags: ["clear", "cloudy"] },
  { codes: [3], label: "Overcast", icon: "☁️", tags: ["cloudy"] },
  { codes: [45, 48], label: "Fog", icon: "🌫️", tags: ["fog", "cloudy"] },
  { codes: [51, 53, 55, 56, 57], label: "Drizzle", icon: "🌦️", tags: ["rain", "cloudy"] },
  { codes: [61, 63, 65, 66, 67], label: "Rain", icon: "🌧️", tags: ["rain", "cloudy"] },
  { codes: [80, 81, 82], label: "Rain showers", icon: "🌦️", tags: ["rain"] },
  { codes: [71, 73, 75, 77, 85, 86], label: "Snow", icon: "❄️", tags: ["snow", "cloudy"] },
  { codes: [95, 96, 99], label: "Thunderstorm", icon: "⛈️", tags: ["storm", "rain", "cloudy"] },
];

function weatherInfo(code) {
  return WEATHER_CODES.find((w) => w.codes.includes(code)) || { label: "Unknown", icon: "🌡️", tags: [] };
}

function seasonFor(date, latitude) {
  const northern = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
  const season = northern[date.getMonth()];
  if (latitude >= 0) return season;
  return { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" }[season];
}

// Tags describing the current conditions, used to decide which prompts make sense right now.
function weatherTags(weather, latitude, date = new Date()) {
  const tags = new Set(weatherInfo(weather.code).tags);
  tags.add(seasonFor(date, latitude));
  tags.add(weather.isDay ? "day" : "night");
  if (weather.wind >= 30) tags.add("wind");
  if (weather.temp >= 25) tags.add("hot");
  if (weather.temp <= 5) tags.add("cold");
  if (weather.temp <= 1) tags.add("frost");
  return tags;
}

async function fetchWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    timezone: "auto",
  });
  const res = await fetch(`${WEATHER_API}?${params}`);
  if (!res.ok) throw new Error(`Weather request failed: ${res.status}`);
  const { current } = await res.json();
  return {
    temp: current.temperature_2m,
    code: current.weather_code,
    wind: current.wind_speed_10m,
    isDay: current.is_day === 1,
    fetchedAt: Date.now(),
  };
}

async function geocodeCity(name) {
  const res = await fetch(`${GEOCODING_API}?${new URLSearchParams({ name, count: 1 })}`);
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`);
  const { results } = await res.json();
  if (!results || !results.length) return null;
  const { name: city, country, latitude, longitude } = results[0];
  return { name: country ? `${city}, ${country}` : city, latitude, longitude };
}

function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation is not available"));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ name: "Your location", latitude: coords.latitude, longitude: coords.longitude }),
      reject,
      { timeout: 10000 },
    );
  });
}
