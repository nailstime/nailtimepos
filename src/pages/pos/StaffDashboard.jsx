import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { BrandMark } from '../../components/Brand.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppDialog } from '../../components/AppDialog.jsx'

function time(value) {
  return String(value || '').slice(0, 5) || '-'
}

function thaiDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${value}T00:00:00`))
}

function QueueCard({ booking, kind, busy, onConfirm, onOpenBill }) {
  const isPending = kind === 'pending'
  const phone = String(booking.guest_phone || '').replace(/\D/g, '')
  return (
    <article className={`rounded-2xl border p-4 ${isPending ? 'border-rose/20 bg-rose/5' : 'border-success/25 bg-success/5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-lg font-semibold text-ink">{time(booking.start_time)}–{time(booking.end_time)} น.</p>
            <span className={isPending ? 'badge-rose' : 'badge-success'}>{isPending ? 'รอยืนยัน' : 'เริ่มภายใน 1 ชั่วโมง'}</span>
          </div>
          <p className="mt-2 font-semibold text-ink">{booking.guest_name || 'ลูกค้าทั่วไป'}</p>
          <p className="mt-0.5 text-sm text-sagegray">{booking.service_name || 'บริการ'}</p>
          <p className="mt-1 text-xs font-mono text-sagegray">{booking.booking_no}</p>
          {booking.note && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-sagegray">{booking.note}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {booking.guest_phone && <a href={`tel:${phone}`} className="btn-ghost min-h-10 text-sm">โทร {booking.guest_phone}</a>}
          {isPending && <button type="button" className="btn-ghost min-h-10 text-sm" disabled={busy} onClick={() => onConfirm(booking)}>ยืนยัน</button>}
          <button type="button" className="btn-rose min-h-10 text-sm" onClick={() => onOpenBill(booking)}>เปิดบิล</button>
        </div>
      </div>
    </article>
  )
}

export default function StaffDashboard() {
  const { staff, logout } = useAuth()
  const { confirm } = useAppDialog()
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState({ pending: [], upcoming: [], generated_at: null })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('pos_staff_booking_dashboard')
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setDashboard(data || { pending: [], upcoming: [], generated_at: null })
    setError('')
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  async function confirmBooking(booking) {
    const approved = await confirm({
      title: 'ยืนยันการจอง',
      description: `ยืนยันคิว ${booking.booking_no} ของ ${booking.guest_name || 'ลูกค้า'} หรือไม่`,
      confirmLabel: 'ยืนยันคิว',
    })
    if (!approved) return
    setBusyId(booking.id)
    const { error: rpcError } = await supabase.rpc('pos_set_booking_status', { p_booking: booking.id, p_status: 'confirmed' })
    setBusyId('')
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    load()
  }

  function openBill(booking) {
    navigate(`/pos?booking=${booking.id}`)
  }

  const pending = dashboard.pending || []
  const upcoming = dashboard.upcoming || []

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_rgba(169,79,97,0.07),_transparent_32%),#f7f4f2]">
      <header className="sticky top-0 z-20 border-b border-mist bg-white/90 backdrop-blur-xl">
        <div className="page-shell flex min-h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost min-h-10 text-sm" onClick={() => navigate('/pos/bookings')}>ตารางนัดหมาย</button>
            <button type="button" className="btn-ghost min-h-10 text-sm" onClick={() => navigate('/pos')}>หน้าขาย</button>
            <div className="flex items-center gap-1 rounded-xl border border-mist bg-porcelain px-1.5 py-1 text-sm">
              <span className="hidden px-2 font-semibold text-ink sm:block">{staff.name}</span>
              <button onClick={logout} className="min-h-9 rounded-lg px-3 font-medium text-sagegray transition hover:bg-white hover:text-danger">ออก</button>
            </div>
          </div>
        </div>
      </header>
      <main className="page-shell px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="page-heading">
          <div>
            <p className="page-eyebrow">Staff dashboard</p>
            <h1 className="page-title">คิวที่ต้องจัดการ</h1>
            <p className="page-description">ติดตามคิวรอยืนยันและคิวที่เริ่มภายใน 1 ชั่วโมง</p>
          </div>
          <button type="button" className="btn-ghost" onClick={load}>รีเฟรช</button>
        </div>

        {error && <p role="alert" className="mb-5 rounded-xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-mist px-5 py-4">
              <div><h2 className="font-display text-xl font-semibold text-ink">รอยืนยันนัด</h2><p className="mt-1 text-sm text-sagegray">คิวจากออนไลน์ที่ควรตรวจสอบก่อน</p></div>
              <span className={pending.length ? 'badge-rose' : 'badge-neutral'}>{pending.length} คิว</span>
            </div>
            <div className="space-y-3 p-4">
              {loading ? <div className="h-28 animate-pulse rounded-xl bg-porcelain" /> : pending.length ? pending.map((booking) => <QueueCard key={booking.id} booking={booking} kind="pending" busy={busyId === booking.id} onConfirm={confirmBooking} onOpenBill={openBill} />) : <div className="empty-state">ไม่มีคิวรอยืนยัน</div>}
            </div>
          </section>
          <section className="card overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-mist px-5 py-4">
              <div><h2 className="font-display text-xl font-semibold text-ink">คิวใกล้ถึง</h2><p className="mt-1 text-sm text-sagegray">เริ่มภายใน 1 ชั่วโมง และยังไม่ได้เปิดบิล</p></div>
              <span className={upcoming.length ? 'badge-success' : 'badge-neutral'}>{upcoming.length} คิว</span>
            </div>
            <div className="space-y-3 p-4">
              {loading ? <div className="h-28 animate-pulse rounded-xl bg-porcelain" /> : upcoming.length ? upcoming.map((booking) => <QueueCard key={booking.id} booking={booking} kind="upcoming" busy={false} onConfirm={confirmBooking} onOpenBill={openBill} />) : <div className="empty-state">ไม่มีคิวที่เริ่มภายใน 1 ชั่วโมง</div>}
            </div>
          </section>
        </div>
        {dashboard.generated_at && <p className="mt-4 text-right text-xs text-sagegray">อัปเดตอัตโนมัติทุก 1 นาที · ล่าสุด {thaiDate(String(dashboard.generated_at).slice(0, 10))} {time(String(dashboard.generated_at).slice(11))} น.</p>}
      </main>
    </div>
  )
}
