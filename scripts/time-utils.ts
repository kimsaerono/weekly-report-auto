export interface TimeRange {
  start: number
  end: number
  startStr: string
  endStr: string
}

export function getWeekRange(options?: { weekStart?: number; includeWeekend?: boolean }): TimeRange {
  const weekStart = options?.weekStart ?? 1
  const includeWeekend = options?.includeWeekend ?? true
  const now = new Date()
  const currentDay = now.getDay()
  const daysToMonday = currentDay === 0 ? 6 : currentDay - weekStart
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysToMonday)
  monday.setHours(0, 0, 0, 0)
  const end = new Date(monday)
  if (includeWeekend) {
    end.setDate(monday.getDate() + 6)
  } else {
    end.setDate(monday.getDate() + 4)
  }
  end.setHours(23, 59, 59, 999)
  return {
    start: monday.getTime(),
    end: end.getTime(),
    startStr: formatDate(monday),
    endStr: formatDate(end),
  }
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return date.toISOString().replace(/\.\d{3}Z$/, `${sign}${hours}:${minutes}`)
}

export function isThisWeek(date: Date): boolean {
  const range = getWeekRange()
  const time = date.getTime()
  return time >= range.start && time <= range.end
}