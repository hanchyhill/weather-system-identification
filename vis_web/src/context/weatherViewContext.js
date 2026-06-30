import { inject } from 'vue'

export const WEATHER_VIEW_CONTEXT_KEY = Symbol('WeatherViewContext')

export function useWeatherViewContext() {
  const context = inject(WEATHER_VIEW_CONTEXT_KEY)
  if (!context) {
    throw new Error('Weather view context is not provided')
  }
  return context
}
