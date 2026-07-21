export const baht = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0 })
export const todayStr = () => new Date().toLocaleDateString("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" })
export const bangkokTime = (value) => value
  ? new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
  : "-"

export const bangkokDate = (value) => value
  ? new Date(value).toLocaleDateString("th-TH", {
      day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok",
    })
  : "-"

export const bangkokDateTime = (value) => value
  ? new Date(value).toLocaleString("th-TH", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
    })
  : "-"

export const dateOnlyThai = (value) => {
  if (!value) return "ยังไม่ได้ระบุ"
  const [year, month, day] = value.split("-").map(Number)
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric",
  }).format(new Date(year, month - 1, day))
}

export function bangkokDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function bangkokMonthStr(date = new Date()) {
  return bangkokDateStr(date).slice(0, 7)
}

export function bangkokDayRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+07:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}
