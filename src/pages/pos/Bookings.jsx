import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { BrandMark } from '../../components/Brand.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppDialog } from '../../components/AppDialog.jsx'

// ─── helpers ────────────────────────────────────────────────────────────────

function bangkokDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}
function toDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
}
function displayDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}
function displayMonth(value) {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}
function displayTime(value) {
  return String(value || '').slice(0, 5) || '-'
}
function timeToMinutes(value) {
  const [h, m] = String(value || '0:0').split(':')
  return Number(h) * 60 + Number(m || 0)
}
function statusLabel(status) {
  return ({ pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' })[status] || status
}
function statusClass(status) {
  if (status === 'pending') return 'badge-rose'
  if (status === 'confirmed') return 'badge-success'
  return 'badge-neutral'
}

// ─── month calendar helpers ──────────────────────────────────────────────────
function monthGrid(monthValue) {
  const [year, month] = monthValue.slice(0, 7).split('-').map(Number)
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7
  return Array.from({ length: totalCells }, (_, index) => {
    const day = index - offset + 1
    if (day < 1 || day > daysInMonth) return null
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
}
function shiftMonth(value, delta) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── week helpers ────────────────────────────────────────────────────────────
function getMonday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return toDateStr(d)
}
function getWeekDates(mondayStr) {
  const base = new Date(`${mondayStr}T00:00:00`)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    return toDateStr(d)
  })
}
function shiftWeek(mondayStr, delta) {
  const d = new Date(`${mondayStr}T00:00:00`)
  d.setDate(d.getDate() + delta * 7)
  return toDateStr(d)
}
function formatWeekRange(dates) {
  const first = new Date(`${dates[0]}T00:00:00`)
  const last = new Date(`${dates[6]}T00:00:00`)
  const lastLabel = new Intl.DateTimeFormat('th-TH', { month: 'short', year: 'numeric' }).format(last)
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()}–${last.getDate()} ${lastLabel}`
  }
  const firstLabel = new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(first)
  return `${first.getDate()} ${firstLabel} – ${last.getDate()} ${lastLabel}`
}

// ─── constants ───────────────────────────────────────────────────────────────
const OPEN_MIN  = 10 * 60   // 10:00
const CLOSE_MIN = 20 * 60   // 20:00
const SLOT_MIN  = 30
const SLOT_W    = 44        // px per 30-min slot (fits iPad landscape)
const DAY_COL   = 60        // px day-label column
const ROW_H     = 80        // px per day row
const TOTAL_SLOTS = (CLOSE_MIN - OPEN_MIN) / SLOT_MIN  // 20

const DAY_LABELS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']
const DAY_FULL   = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์']

// ─── WeekView ────────────────────────────────────────────────────────────────
const TOTAL_MIN = CLOSE_MIN - OPEN_MIN  // 600 min

function pct(min) {
  return `${((min - OPEN_MIN) / TOTAL_MIN) * 100}%`
}

function WeekView({ weekDates, weekBookings, today, selectedId, onSelect, onCellClick, loading }) {
  const timeSlots = useMemo(() =>
    Array.from({ length: TOTAL_SLOTS }, (_, i) => {
      const min = OPEN_MIN + i * SLOT_MIN
      return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
    }), [])

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <div className="w-full" style={{ minWidth: DAY_COL + TOTAL_SLOTS * 32 }}>
          <div className="flex border-b border-mist">
            <div style={{ width: DAY_COL }} className="shrink-0 border-r border-mist py-3" />
            <div className="flex flex-1">
              {timeSlots.map(t => (
                <div key={t} className="flex-1 border-l border-mist/50 py-3 text-center">
                  <div className="mx-auto h-3 w-6 animate-pulse rounded bg-porcelain" />
                </div>
              ))}
            </div>
          </div>
          {weekDates.map(d => (
            <div key={d} className="flex border-b border-mist" style={{ height: ROW_H }}>
              <div style={{ width: DAY_COL }} className="shrink-0 animate-pulse border-r border-mist bg-porcelain/40" />
              <div className="flex-1 animate-pulse bg-porcelain/20" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="w-full" style={{ minWidth: DAY_COL + TOTAL_SLOTS * 32 }}>
        {/* time header — slots use flex-1 so they fill the full row */}
        <div className="flex border-b-2 border-mist">
          <div style={{ width: DAY_COL }} className="shrink-0 border-r border-mist" />
          <div className="flex flex-1">
            {timeSlots.map((t, i) => (
              <div key={t}
                className={`flex-1 py-1.5 text-center leading-none ${i % 2 === 0
                  ? 'border-l border-mist text-[10px] font-semibold text-sagegray'
                  : 'border-l border-dashed border-mist/50 text-[9px] text-sagegray/40'}`}>
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* day rows */}
        {weekDates.map((date, dayIdx) => {
          const bookings = weekBookings[date] || []
          const isToday = date === today

          return (
            <div key={date} className={`flex border-b border-mist ${isToday ? 'bg-rose/[0.03]' : ''}`} style={{ minHeight: ROW_H }}>
              {/* day label */}
              <div style={{ width: DAY_COL }} className={`shrink-0 flex flex-col items-center justify-center border-r py-2 ${isToday ? 'border-rose/20' : 'border-mist'}`}>
                <span className="text-[11px] font-medium text-sagegray">{DAY_LABELS[dayIdx]}</span>
                <span className={`mt-0.5 flex size-8 items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-rose text-white' : 'text-ink'}`}>
                  {Number(date.slice(-2))}
                </span>
              </div>

              {/* time grid — flex-1 fills full remaining width */}
              <div className="relative flex-1 cursor-cell" style={{ minHeight: ROW_H }}
                onClick={() => onCellClick?.(date)}>
                {/* grid lines match header slots via flex-1 */}
                <div className="pointer-events-none absolute inset-0 flex">
                  {timeSlots.map((_, i) => (
                    <div key={i} className={`flex-1 border-l ${i % 2 === 0 ? 'border-mist' : 'border-dashed border-mist/40'}`} />
                  ))}
                </div>

                {/* now line */}
                {isToday && (() => {
                  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
                  if (nowMin < OPEN_MIN || nowMin > CLOSE_MIN) return null
                  return (
                    <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-rose/50"
                      style={{ left: pct(nowMin) }} />
                  )
                })()}

                {/* bookings — positioned by % so they scale with grid width */}
                {bookings.map(b => {
                  const startMin = timeToMinutes(b.start_time)
                  const endMin   = timeToMinutes(b.end_time)
                  const isPending   = b.status === 'pending'
                  const isConfirmed = b.status === 'confirmed'
                  const isSelected  = selectedId === b.id

                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : b.id) }}
                      className={`absolute rounded-lg border px-1.5 py-1 text-left text-xs shadow-sm transition
                        ${isPending   ? 'border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-400'
                          : isConfirmed ? 'border-green-300 bg-green-100 text-green-900 hover:border-green-400'
                          : 'border-mist bg-porcelain text-sagegray'}
                        ${isSelected  ? 'z-20 ring-2 ring-rose/50 ring-offset-1' : 'z-10'}`}
                      style={{
                        left: `calc(${pct(startMin)} + 2px)`,
                        width: `calc(${pct(endMin)} - ${pct(startMin)} - 4px)`,
                        minWidth: 44,
                        top: 4, bottom: 4, overflow: 'hidden',
                      }}
                    >
                      <p className="truncate font-bold leading-tight">{displayTime(b.start_time)}</p>
                      <p className="truncate leading-tight">{b.guest_name || 'ลูกค้า'}</p>
                      <p className="truncate text-[10px] opacity-70">{b.service?.name}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── BookingPanel ─────────────────────────────────────────────────────────────
function BookingPanel({ booking, busyId, onChangeStatus, onOpenBill, onClose }) {
  if (!booking) return null
  const isPending   = booking.status === 'pending'
  const isConfirmed = booking.status === 'confirmed'
  const isActive    = isPending || isConfirmed

  return (
    <div className={`mt-3 rounded-2xl border p-4 shadow-sm
      ${isPending ? 'border-amber-200 bg-amber-50' : isConfirmed ? 'border-green-200 bg-green-50' : 'border-mist bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-ink">{displayTime(booking.start_time)}–{displayTime(booking.end_time)} น.</p>
            <span className={statusClass(booking.status)}>{statusLabel(booking.status)}</span>
            <span className="text-xs text-sagegray">{booking.booking_no}</span>
          </div>
          <p className="mt-1 text-base font-semibold text-ink">{booking.guest_name || 'ลูกค้าทั่วไป'}</p>
          <p className="text-sm text-sagegray">{booking.service?.name}</p>
          {booking.guest_phone && <p className="text-sm text-sagegray">{booking.guest_phone}</p>}
          {booking.note && <p className="mt-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-sagegray">{booking.note}</p>}
          {booking.order_id && <p className="mt-1.5 text-xs font-medium text-sagegray">บิล {booking.order_no} · {booking.order_status}</p>}
        </div>
        <button type="button" onClick={onClose} className="mt-0.5 shrink-0 text-sagegray hover:text-ink">✕</button>
      </div>
      {isActive && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isPending && (
            <button type="button" onClick={() => onChangeStatus(booking, 'confirmed')} disabled={busyId === booking.id} className="btn-ghost text-sm">ยืนยัน</button>
          )}
          {!booking.order_id && (
            <button type="button" onClick={() => onOpenBill(booking.id, booking.member_id)} className="btn-rose text-sm">เปิดบิล</button>
          )}
          <button type="button" onClick={() => onChangeStatus(booking, 'cancelled')} disabled={busyId === booking.id} className="btn-danger text-sm">ยกเลิก</button>
        </div>
      )}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────
export default function PosBookings() {
  const { staff, logout } = useAuth()
  const { confirm } = useAppDialog()
  const navigate = useNavigate()
  const today = bangkokDate()

  // view
  const [viewMode, setViewMode]   = useState('week')    // 'week' | 'month'
  const [showCreate, setShowCreate] = useState(false)

  // week state
  const [weekStart,    setWeekStart]    = useState(() => getMonday(today))
  const [weekBookings, setWeekBookings] = useState({})
  const [weekLoading,  setWeekLoading]  = useState(true)
  const [selectedId,   setSelectedId]   = useState(null)

  // month / day state
  const [date,           setDate]          = useState(today)
  const [calendarMonth,  setCalendarMonth] = useState(`${today.slice(0, 7)}-01`)
  const [calendarDays,   setCalendarDays]  = useState([])
  const [calendarLoading,setCalendarLoading] = useState(true)
  const [query,          setQuery]         = useState('')
  const [bookings,       setBookings]      = useState([])
  const [loading,        setLoading]       = useState(true)

  // create form state
  const [services,      setServices]      = useState([])
  const [slots,         setSlots]         = useState([])
  const [serviceIds,    setServiceIds]    = useState([])
  const [slotId,        setSlotId]        = useState('')
  const [guestName,     setGuestName]     = useState('')
  const [guestPhone,    setGuestPhone]    = useState('')
  const [note,          setNote]          = useState('')
  const [status,        setStatus]        = useState('confirmed')
  const [memberId,      setMemberId]      = useState('')
  const [memberSearch,  setMemberSearch]  = useState('')
  const [memberResults, setMemberResults] = useState([])
  const [memberLoading, setMemberLoading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [busyId,    setBusyId]    = useState('')
  const [error,     setError]     = useState('')

  const createSectionRef = useRef(null)
  const panelRef         = useRef(null)

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])

  const selectedBooking = useMemo(() => {
    if (!selectedId) return null
    for (const d of weekDates) {
      const found = (weekBookings[d] || []).find(b => b.id === selectedId)
      if (found) return found
    }
    return null
  }, [selectedId, weekDates, weekBookings])

  const totalDuration  = useMemo(() =>
    services.filter(s => serviceIds.includes(s.id)).reduce((sum, s) => sum + (s.duration || 0), 0),
    [services, serviceIds])
  const calendarByDate = useMemo(() => new Map(calendarDays.map(item => [item.date, item])), [calendarDays])
  const days            = useMemo(() => monthGrid(calendarMonth), [calendarMonth])

  // ── loaders ──────────────────────────────────────────────────────────────
  const loadWeekBookings = useCallback(async () => {
    setWeekLoading(true)
    setSelectedId(null)
    const results = await Promise.all(
      weekDates.map(d => supabase.rpc('pos_list_bookings', { p_date: d }))
    )
    const map = {}
    weekDates.forEach((d, i) => { map[d] = results[i].data || [] })
    setWeekBookings(map)
    setWeekLoading(false)
  }, [weekDates])

  const loadBookings = useCallback(async () => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc('pos_list_bookings', { p_date: date, p_query: query || null })
    if (rpcError) setError(rpcError.message)
    else { setBookings(data || []); setError('') }
    setLoading(false)
  }, [date, query])

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true)
    const { data, error: rpcError } = await supabase.rpc('pos_booking_calendar', { p_month: calendarMonth })
    if (rpcError) setError(rpcError.message)
    else setCalendarDays(data || [])
    setCalendarLoading(false)
  }, [calendarMonth])

  useEffect(() => {
    supabase.rpc('pos_booking_services').then(({ data }) => setServices(data || []))
  }, [])

  useEffect(() => {
    if (viewMode === 'week') loadWeekBookings()
  }, [viewMode, loadWeekBookings])

  useEffect(() => {
    if (viewMode === 'month') loadCalendar()
  }, [viewMode, loadCalendar])

  useEffect(() => {
    if (viewMode === 'month') {
      const t = window.setTimeout(loadBookings, query ? 180 : 0)
      return () => window.clearTimeout(t)
    }
  }, [viewMode, loadBookings, query])

  useEffect(() => {
    setSlotId('')
    if (serviceIds.length === 0 || totalDuration === 0) return setSlots([])
    let alive = true
    supabase.rpc('pos_booking_slots_for_duration', { p_date: date, p_minutes: totalDuration }).then(({ data }) => {
      if (alive) setSlots(data || [])
    })
    return () => { alive = false }
  }, [date, serviceIds, totalDuration])

  useEffect(() => {
    if (!memberSearch.trim()) { setMemberResults([]); return }
    const t = window.setTimeout(async () => {
      setMemberLoading(true)
      const { data } = await supabase.rpc('staff_search_customers', { p_query: memberSearch, p_limit: 5 })
      setMemberResults(data || [])
      setMemberLoading(false)
    }, 200)
    return () => { window.clearTimeout(t); setMemberLoading(false) }
  }, [memberSearch])

  useEffect(() => {
    if (selectedBooking) {
      window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    }
  }, [selectedBooking])

  // ── actions ──────────────────────────────────────────────────────────────
  function resetCreateForm() {
    setServiceIds([]); setSlotId(''); setGuestName(''); setGuestPhone(''); setNote('')
    setMemberId(''); setMemberSearch(''); setMemberResults([])
  }

  function handleCellClick(dateStr) {
    setDate(dateStr)
    setCalendarMonth(`${dateStr.slice(0, 7)}-01`)
    setQuery('')
    setShowCreate(true)
    window.requestAnimationFrame(() => createSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function selectCalendarDay(nextDate) {
    setDate(nextDate)
    setCalendarMonth(`${nextDate.slice(0, 7)}-01`)
    setQuery('')
  }

  async function changeStatus(booking, nextStatus) {
    const verb = nextStatus === 'cancelled' ? 'ยกเลิกการจอง' : nextStatus === 'confirmed' ? 'ยืนยันการจอง' : 'ปิดงาน'
    const ok = await confirm({
      title: verb,
      description: `ยืนยันเปลี่ยนสถานะ ${booking.booking_no} ของ ${booking.guest_name || 'ลูกค้า'} หรือไม่`,
      cancelLabel: 'กลับ',
      confirmLabel: verb,
      tone: nextStatus === 'cancelled' ? 'danger' : 'default',
    })
    if (!ok) return
    setBusyId(booking.id); setError('')
    const { error: rpcError } = await supabase.rpc('pos_set_booking_status', { p_booking: booking.id, p_status: nextStatus })
    setBusyId('')
    if (rpcError) return setError(rpcError.message)
    setSelectedId(null)
    if (viewMode === 'week') loadWeekBookings()
    else await Promise.all([loadBookings(), loadCalendar()])
  }

  async function createBooking(event) {
    event.preventDefault()
    if (serviceIds.length === 0 || !slotId || !guestName.trim() || saving) return
    setSaving(true); setError('')
    const { error: rpcError } = await supabase.rpc('pos_create_multi_booking', {
      p_services: serviceIds, p_slot: slotId,
      p_guest_name: guestName.trim(), p_guest_phone: guestPhone, p_note: note, p_status: status,
      p_member: memberId || null,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    resetCreateForm()
    setShowCreate(false)
    if (viewMode === 'week') loadWeekBookings()
    else await Promise.all([loadBookings(), loadCalendar()])
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_rgba(169,79,97,0.07),_transparent_32%),#f7f4f2]">
      <header className="sticky top-0 z-20 border-b border-mist bg-white/90 backdrop-blur-xl">
        <div className="page-shell flex min-h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/pos')} className="btn-ghost">กลับหน้าขาย</button>
            {staff.role === 'owner' && <button type="button" onClick={() => navigate('/admin')} className="btn-ghost hidden sm:inline-flex">หลังร้าน</button>}
            <div className="flex items-center gap-1 rounded-xl border border-mist bg-porcelain px-1.5 py-1 text-sm">
              <span className="hidden px-2 font-semibold text-ink sm:block">{staff.name}</span>
              <button type="button" onClick={logout} className="min-h-9 rounded-lg px-3 font-medium text-sagegray transition hover:bg-white hover:text-danger">ออก</button>
            </div>
          </div>
        </div>
      </header>

      <main className="page-shell px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        {/* heading row */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="page-title">ตารางนัดหมาย</h1>
            <p className="page-description">ดูคิวจากเว็บไซต์และเพิ่มการจองที่หน้าร้านในตารางเดียวกัน</p>
          </div>
          <div className="flex items-center gap-2">
            {/* view toggle */}
            <div className="inline-flex rounded-xl border border-mist bg-porcelain p-1">
              <button type="button" onClick={() => setViewMode('week')} aria-pressed={viewMode === 'week'}
                className={`min-h-9 rounded-lg px-3 text-sm font-semibold transition ${viewMode === 'week' ? 'bg-white text-ink shadow-sm' : 'text-sagegray hover:text-ink'}`}>
                สัปดาห์
              </button>
              <button type="button" onClick={() => setViewMode('month')} aria-pressed={viewMode === 'month'}
                className={`min-h-9 rounded-lg px-3 text-sm font-semibold transition ${viewMode === 'month' ? 'bg-white text-ink shadow-sm' : 'text-sagegray hover:text-ink'}`}>
                เดือน
              </button>
            </div>
            <button type="button" onClick={() => { if (showCreate) resetCreateForm(); setShowCreate(v => !v) }} className="btn-rose">
              {showCreate ? 'ปิด' : '+ เพิ่มการจอง'}
            </button>
          </div>
        </div>

        {error && <p role="alert" className="mb-4 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}

        {/* ── create form ── */}
        {showCreate && (
          <section ref={createSectionRef} className="card mb-5 overflow-hidden">
            <div className="border-b border-mist px-5 py-4">
              <h2 className="section-title">เพิ่มการจอง</h2>
              <p className="section-note">บันทึกเข้าตารางเดียวกับเว็บไซต์ทันที</p>
            </div>
            <form onSubmit={createBooking} className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="block text-sm font-semibold">วันที่นัดหมาย
                <input className="input mt-1.5" type="date" value={date} onChange={e => selectCalendarDay(e.target.value)} required />
              </label>
              <label className="block text-sm font-semibold">สถานะเริ่มต้น
                <select className="input mt-1.5" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="confirmed">ยืนยันแล้ว</option>
                  <option value="pending">รอยืนยัน</option>
                </select>
              </label>

              {/* member search */}
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">ค้นหาสมาชิก <span className="font-normal text-sagegray">(ไม่บังคับ)</span></p>
                {memberId ? (
                  <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-rose/30 bg-rose/5 px-3 py-2.5">
                    <span className="font-semibold text-rose text-sm">{guestName}</span>
                    {guestPhone && <span className="text-xs text-sagegray">{guestPhone}</span>}
                    <button type="button" className="ml-auto text-xs text-sagegray hover:text-danger"
                      onClick={() => { setMemberId(''); setMemberSearch('') }}>✕ ยกเลิก</button>
                  </div>
                ) : (
                  <div className="relative mt-1.5">
                    <input className="input w-full" type="search" value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      placeholder="พิมพ์ชื่อ หรือ เบอร์สมาชิก" />
                    {memberLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-sagegray">…</span>}
                    {memberResults.length > 0 && (
                      <div className="absolute z-30 mt-1 w-full rounded-xl border border-mist bg-white shadow-lift overflow-hidden">
                        {memberResults.map(m => (
                          <button key={m.id} type="button"
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-porcelain"
                            onClick={() => { setMemberId(m.id); setGuestName(m.name); setGuestPhone(m.phone || ''); setMemberSearch(''); setMemberResults([]) }}>
                            <span className="font-semibold text-ink">{m.name}</span>
                            <span className="text-sagegray">{m.phone}</span>
                            {m.points_balance > 0 && <span className="ml-auto text-xs text-gold">{m.points_balance} แต้ม</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* multi-service chips */}
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">บริการ <span className="font-normal text-sagegray">เลือกได้หลายรายการ</span></p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {services.map(s => {
                    const sel = serviceIds.includes(s.id)
                    return (
                      <button key={s.id} type="button"
                        onClick={() => setServiceIds(ids => sel ? ids.filter(id => id !== s.id) : [...ids, s.id])}
                        className={`rounded-xl border px-3 py-1.5 text-sm transition
                          ${sel ? 'border-rose bg-rose text-white' : 'border-mist bg-white text-ink hover:border-rose/40'}`}>
                        {s.name}<span className={`ml-1 text-xs ${sel ? 'opacity-75' : 'text-sagegray'}`}>{s.duration} น.</span>
                      </button>
                    )
                  })}
                </div>
                {totalDuration > 0 && <p className="mt-1.5 text-xs text-sagegray">รวม <span className="font-semibold text-ink">{totalDuration} นาที</span></p>}
              </div>

              <label className="block text-sm font-semibold sm:col-span-2">เวลา
                <select className="input mt-1.5" value={slotId} onChange={e => setSlotId(e.target.value)} disabled={serviceIds.length === 0} required>
                  <option value="">{serviceIds.length > 0 ? (slots.length ? 'เลือกเวลาว่าง' : 'ไม่มีเวลาว่าง') : 'เลือกบริการก่อน'}</option>
                  {slots.map(s => <option key={s.id} value={s.id}>{displayTime(s.start_time)}–{displayTime(s.end_time)} น.</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">ชื่อลูกค้า
                <input className="input mt-1.5" value={guestName} onChange={e => setGuestName(e.target.value)} maxLength={160} required placeholder="ชื่อสำหรับติดต่อ" />
              </label>
              <label className="block text-sm font-semibold">เบอร์โทรศัพท์ <span className="font-normal text-sagegray">(ไม่บังคับ)</span>
                <input className="input mt-1.5" type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value.replace(/[^0-9-]/g, '').slice(0, 15))} placeholder="0xx-xxx-xxxx" />
              </label>
              <label className="block text-sm font-semibold sm:col-span-2">หมายเหตุ <span className="font-normal text-sagegray">(ไม่บังคับ)</span>
                <textarea className="input mt-1.5 min-h-24 resize-y" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="เช่น สีที่ชอบ หรือข้อมูลเพิ่มเติม" />
              </label>
              <div className="flex gap-3 sm:col-span-2">
                <button type="button" onClick={() => { resetCreateForm(); setShowCreate(false) }} className="btn-ghost flex-1">ยกเลิก</button>
                <button disabled={saving || serviceIds.length === 0 || !slotId || !guestName.trim()} className="btn-rose flex-1 disabled:opacity-40">
                  {saving ? 'กำลังบันทึก…' : 'บันทึกการจอง'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* ── week view ── */}
        {viewMode === 'week' && (
          <section className="card overflow-hidden">
            {/* week nav */}
            <div className="flex items-center gap-2 border-b border-mist px-5 py-3">
              <button type="button" className="btn-ghost min-w-10 px-2.5" onClick={() => setWeekStart(w => shiftWeek(w, -1))}>‹</button>
              <p className="min-w-48 text-center font-semibold text-ink">{formatWeekRange(weekDates)}</p>
              <button type="button" className="btn-ghost min-w-10 px-2.5" onClick={() => setWeekStart(w => shiftWeek(w, 1))}>›</button>
              {weekStart !== getMonday(today) && (
                <button type="button" className="btn-ghost px-3 text-xs text-rose" onClick={() => setWeekStart(getMonday(today))}>สัปดาห์นี้</button>
              )}
              <span className="ml-auto flex gap-3 text-xs text-sagegray">
                <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-amber-200 border border-amber-300" />รอยืนยัน</span>
                <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm bg-green-200 border border-green-300" />ยืนยันแล้ว</span>
              </span>
            </div>

            <WeekView
              weekDates={weekDates}
              weekBookings={weekBookings}
              today={today}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCellClick={handleCellClick}
              loading={weekLoading}
            />

            {selectedBooking && (
              <div ref={panelRef} className="border-t border-mist px-5 py-4">
                <BookingPanel
                  booking={selectedBooking}
                  busyId={busyId}
                  onChangeStatus={changeStatus}
                  onOpenBill={(id, mid) => navigate(`/pos?booking=${id}${mid ? `&member=${mid}` : ''}`)}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </section>
        )}

        {/* ── month view ── */}
        {viewMode === 'month' && (
          <div className="space-y-5">
            <section className="card overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="section-title">ปฏิทินนัดหมาย</h2>
                  <p className="section-note">เลือกวันที่เพื่อดูคิวและจัดการการจองของวันนั้น</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-ghost min-w-11 px-3" onClick={() => setCalendarMonth(m => shiftMonth(m, -1))}>‹</button>
                  <p className="min-w-40 text-center font-semibold text-ink">{displayMonth(calendarMonth)}</p>
                  <button type="button" className="btn-ghost min-w-11 px-3" onClick={() => setCalendarMonth(m => shiftMonth(m, 1))}>›</button>
                  {calendarMonth.slice(0, 7) !== today.slice(0, 7) && (
                    <button type="button" className="btn-ghost px-3 text-xs text-rose" onClick={() => selectCalendarDay(today)}>วันนี้</button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto p-3 sm:p-5">
                <div className="min-w-[660px]">
                  <div className="grid grid-cols-7 gap-2 pb-2 text-center text-xs font-semibold text-sagegray">
                    {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map(n => <span key={n} className="py-2">{n}</span>)}
                  </div>
                  {calendarLoading ? (
                    <div className="grid grid-cols-7 gap-1.5">
                      {Array.from({ length: 35 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-porcelain" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-7 gap-1.5">
                      {days.map((day, index) => {
                        if (!day) return <div key={`blank-${index}`} className="min-h-20 rounded-xl bg-porcelain/40" />
                        const summary   = calendarByDate.get(day)
                        const selected  = date === day
                        const isToday   = today === day
                        const hasPending  = summary?.pending > 0
                        const hasBookings = summary?.total > 0
                        return (
                          <button key={day} type="button" onClick={() => selectCalendarDay(day)}
                            className={`min-h-20 rounded-xl border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm
                              ${selected    ? 'border-rose bg-rose/10 ring-1 ring-rose/20 hover:border-rose'
                                : isToday  ? 'border-rose/40 bg-white hover:border-rose/60'
                                : hasPending  ? 'border-amber-200 bg-amber-50/60 hover:border-amber-300'
                                : hasBookings ? 'border-green-200 bg-green-50/60 hover:border-green-300'
                                : 'border-mist bg-white hover:border-rose/30'}`}>
                            <span className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold
                              ${selected ? 'bg-rose text-white' : isToday ? 'bg-rose/10 text-rose' : 'text-ink'}`}>
                              {Number(day.slice(-2))}
                            </span>
                            {summary ? (
                              <span className="mt-1.5 block space-y-0.5">
                                <span className="block text-xs font-semibold text-ink">{summary.total} คิว</span>
                                {hasPending   && <span className="block text-xs text-amber-600">รอ {summary.pending}</span>}
                                {summary.confirmed > 0 && <span className="block text-xs text-green-600">ยืนยัน {summary.confirmed}</span>}
                              </span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* day schedule (month view) */}
            <section className="card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="section-title">ตารางเวลา {displayDate(date)}</h2>
                  <p className="section-note">คลิกการจองเพื่อจัดการ</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className="input min-w-52" type="date" value={date} onChange={e => selectCalendarDay(e.target.value)} />
                  <input className="input min-w-52" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาชื่อ เบอร์ หรือเลขจอง" />
                </div>
              </div>
              {loading ? (
                <div className="space-y-px p-5">
                  {[80,120,60].map((h,i) => <div key={i} style={{ height: h }} className="w-full animate-pulse rounded-xl bg-porcelain" />)}
                </div>
              ) : (
                <DayTimeline
                  bookings={bookings}
                  busyId={busyId}
                  onChangeStatus={changeStatus}
                  onOpenBill={(id, mid) => navigate(`/pos?booking=${id}${mid ? `&member=${mid}` : ''}`)}
                />
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── DayTimeline (used in month view) ────────────────────────────────────────
function DayTimeline({ bookings, busyId, onChangeStatus, onOpenBill }) {
  const [expandedId, setExpandedId] = useState(null)
  const totalHeight = ((CLOSE_MIN - OPEN_MIN) / 60) * 80
  const hours = Array.from({ length: 11 }, (_, i) => 10 + i)

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[420px] px-3 pb-6 pt-3" style={{ height: totalHeight + 48 }}>
        {hours.map(h => {
          const top = ((h * 60 - OPEN_MIN) / 60) * 80
          return (
            <div key={h} className="pointer-events-none absolute inset-x-3 flex items-start gap-2" style={{ top }}>
              <span className="w-12 shrink-0 text-right text-xs text-sagegray" style={{ marginTop: -8 }}>{h}:00</span>
              <div className="flex-1 border-t border-mist" />
            </div>
          )
        })}
        {hours.slice(0, -1).map(h => {
          const top = ((h * 60 + 30 - OPEN_MIN) / 60) * 80
          return (
            <div key={`${h}h30`} className="pointer-events-none absolute inset-x-3 flex items-start gap-2" style={{ top }}>
              <span className="w-12 shrink-0" />
              <div className="flex-1 border-t border-dashed border-mist/60" />
            </div>
          )
        })}
        {(() => {
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
          if (nowMin < OPEN_MIN || nowMin > CLOSE_MIN) return null
          const top = ((nowMin - OPEN_MIN) / 60) * 80
          return (
            <div className="pointer-events-none absolute inset-x-3 flex items-center gap-2" style={{ top, zIndex: 10 }}>
              <span className="w-12 shrink-0" />
              <div className="size-2 -translate-y-px rounded-full bg-rose" />
              <div className="flex-1 border-t-2 border-rose/60" />
            </div>
          )
        })()}
        {bookings.map(booking => {
          const startMin  = timeToMinutes(booking.start_time)
          const endMin    = timeToMinutes(booking.end_time)
          const top       = ((startMin - OPEN_MIN) / 60) * 80
          const height    = Math.max(((endMin - startMin) / 60) * 80, 36)
          const isExpanded = expandedId === booking.id
          const isPending  = booking.status === 'pending'
          const isConfirmed = booking.status === 'confirmed'
          const isActive   = isPending || isConfirmed

          return (
            <div key={booking.id} className="absolute"
              style={{ top: top + 2, left: 60, right: 12, height: isExpanded ? 'auto' : height - 4, minHeight: height - 4, zIndex: isExpanded ? 20 : 1 }}>
              <button type="button" onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left shadow-sm transition
                  ${isPending ? 'border-amber-200 bg-amber-50 hover:border-amber-300'
                    : isConfirmed ? 'border-green-200 bg-green-50 hover:border-green-300'
                    : 'border-mist bg-porcelain hover:border-mist'}`}
                style={{ minHeight: height - 4 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-xs font-bold ${isPending ? 'text-amber-700' : isConfirmed ? 'text-green-700' : 'text-sagegray'}`}>
                      {displayTime(booking.start_time)}–{displayTime(booking.end_time)}
                      <span className={`ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold
                        ${isPending ? 'bg-amber-200 text-amber-800' : isConfirmed ? 'bg-green-200 text-green-800' : 'bg-mist text-sagegray'}`}>
                        {statusLabel(booking.status)}
                      </span>
                    </p>
                    {height >= 52 && <p className="mt-0.5 truncate text-sm font-semibold text-ink">{booking.guest_name || 'ลูกค้าทั่วไป'}</p>}
                    {height >= 72 && <p className="truncate text-xs text-sagegray">{booking.service?.name}</p>}
                  </div>
                  <span className="mt-0.5 shrink-0 text-sagegray">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>
              {isExpanded && (
                <div className={`mt-1 rounded-xl border p-3 shadow-lg
                  ${isPending ? 'border-amber-200 bg-white' : isConfirmed ? 'border-green-200 bg-white' : 'border-mist bg-white'}`}>
                  <p className="font-semibold text-ink">{booking.guest_name || 'ลูกค้าทั่วไป'}</p>
                  <p className="text-sm text-sagegray">{booking.service?.name}</p>
                  {booking.guest_phone && <p className="text-sm text-sagegray">{booking.guest_phone}</p>}
                  {booking.note && <p className="mt-1 rounded-lg bg-porcelain px-2.5 py-1.5 text-xs text-sagegray">{booking.note}</p>}
                  {booking.order_id && <p className="mt-2 text-xs font-medium text-sagegray">บิล {booking.order_no} · {booking.order_status}</p>}
                  {isActive && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {isPending && <button type="button" onClick={() => { onChangeStatus(booking, 'confirmed'); setExpandedId(null) }} disabled={busyId === booking.id} className="btn-ghost text-sm">ยืนยัน</button>}
                      {!booking.order_id && <button type="button" onClick={() => onOpenBill(booking.id)} className="btn-rose text-sm">เปิดบิล</button>}
                      <button type="button" onClick={() => { onChangeStatus(booking, 'cancelled'); setExpandedId(null) }} disabled={busyId === booking.id} className="btn-danger text-sm">ยกเลิก</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {bookings.length === 0 && (
          <div className="absolute inset-x-16 top-1/3 text-center text-sm text-sagegray">ไม่มีรายการจองในวันที่เลือก</div>
        )}
      </div>
    </div>
  )
}
