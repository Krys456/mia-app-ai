/**
 * #317 — Compact Weather card / location chips.
 */

import type { WeatherUiState } from '../../types'
import './WeatherUi.css'

type Props = {
  weatherUi: WeatherUiState
  onAction: (actionId: string) => void
}

export function WeatherUi({ weatherUi, onAction }: Props) {
  const actions = weatherUi.actions || []
  const card = weatherUi.card

  if (!actions.length && !card && !weatherUi.attribution) return null

  return (
    <div className="weather-ui" data-weather-kind={weatherUi.kind}>
      {weatherUi.kind === 'card' && card ? (
        <div className="weather-ui__card" aria-label="Meteo">
          <div className="weather-ui__place">{card.locationLabel}</div>
          <div className="weather-ui__main">
            <span className="weather-ui__emoji" aria-hidden="true">
              {card.emoji}
            </span>
            {typeof card.temperatureC === 'number' ? (
              <span className="weather-ui__temp">{card.temperatureC}°C</span>
            ) : null}
          </div>
          {card.description ? <div className="weather-ui__desc">{card.description}</div> : null}
          <div className="weather-ui__meta">
            {typeof card.apparentTemperatureC === 'number' ? (
              <span>Percepita {card.apparentTemperatureC}°</span>
            ) : null}
            {typeof card.temperatureMaxC === 'number' && typeof card.temperatureMinC === 'number' ? (
              <span>
                Max {card.temperatureMaxC}° · Min {card.temperatureMinC}°
              </span>
            ) : null}
            {typeof card.precipitationProbabilityMax === 'number' ? (
              <span>Pioggia {card.precipitationProbabilityMax}%</span>
            ) : null}
            {typeof card.windSpeedKmh === 'number' ? (
              <span>Vento {card.windSpeedKmh} km/h</span>
            ) : null}
          </div>
          <div className="weather-ui__attr">
            {card.attribution || weatherUi.attribution || 'Weather data: Open-Meteo'}
          </div>
        </div>
      ) : null}

      {weatherUi.kind === 'attribution' && weatherUi.attribution ? (
        <div className="weather-ui__attr weather-ui__attr--solo">{weatherUi.attribution}</div>
      ) : null}

      {actions.length ? (
        <div className="weather-ui__actions" role="group" aria-label="Azioni meteo">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="weather-ui__btn"
              onClick={() => onAction(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
