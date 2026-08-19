/**
 * #317 — Open-Meteo Weather config.
 *
 * Attribution (Open-Meteo Terms): credit “Weather data by Open-Meteo.com”
 * when displaying forecasts. Non-commercial MVP uses the free API — no API key.
 * Commercial / high-volume use may require Open-Meteo commercial plans later.
 *
 * Endpoints are constructed only by server code (never from Core/user URLs).
 */

export const OPEN_METEO_FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search'

export const WEATHER_ATTRIBUTION = 'Weather data: Open-Meteo'

export const FORECAST_DAYS = 7

export const CURRENT_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'is_day',
].join(',')

export const HOURLY_VARS = [
  'temperature_2m',
  'precipitation_probability',
  'precipitation',
  'rain',
  'weather_code',
  'wind_speed_10m',
].join(',')

export const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'sunrise',
  'sunset',
].join(',')
