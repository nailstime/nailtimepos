import { useEffect, useState } from 'react'
import liff from '@line/liff'
import { supabase } from '../../lib/supabase'
import { BrandMark } from '../../components/Brand.jsx'

function datesFromToday(days = 21) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

function thaiDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
}

function time(value) { return String(value || '').slice(0, 5) }

function serviceSummary(items) {
  return items.map((item) => item.name).join(' + ')
}

export default function LiffBooking() {
  const [state, setState] = useState('loading')
  const [token, setToken] = useState('')
  const [profile, setProfile] = useState(null)
  const [services, setServices] = useState([])
  const [selectedServices, setSelectedServices] = useState([])
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState(null)
  const [booking, setBooking] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dates = datesFromToday()
  const serviceIds = selectedServices.map((item) => item.id)
  const totalDuration = selectedServices.reduce((sum, item) => sum + Number(item.duration || 0), 0)

  async function api(action, payload = {}) {
    const { data, error: invokeError } = await supabase.functions.invoke('booking-liff', {
      body: { action, id_token: token, ...payload },
    })
    if (invokeError || data?.error) {
      let message = data?.error
      if (!message && invokeError?.context?.clone) {
        try { message = (await invokeError.context.clone().json())?.error } catch { /* no JSON body */ }
      }
      throw new Error(message || invokeError?.message || 'ไม่สามารถเชื่อมต่อระบบจองได้')
    }
    return data?.data
  }

  useEffect(() => {
    ;(async () => {
      try {
        const liffId = import.meta.env.VITE_BOOKING_LIFF_ID
        if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า Booking LIFF')
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) { liff.login(); return }
        const idToken = liff.getIDToken()
        if (!idToken) throw new Error('ไม่พบ LINE ID token')
        const lineProfile = await liff.getProfile()
        setToken(idToken)
        setProfile(lineProfile)
        const { data, error: invokeError } = await supabase.functions.invoke('booking-liff', {
          body: { action: 'services', id_token: idToken },
        })
        if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || 'ไม่สามารถโหลดบริการได้')
        setServices(data?.data || [])
        setState('service')
      } catch (err) {
        setError(String(err?.message || err))
        setState('error')
      }
    })()
  }, [])

  function toggleService(item) {
    setSelectedServices((current) => current.some((selected) => selected.id === item.id)
      ? current.filter((selected) => selected.id !== item.id)
      : [...current, item])
  }

  async function selectDate(nextDate) {
    if (!serviceIds.length || busy) return
    setDate(nextDate); setSlot(null); setBusy(true); setError('')
    try {
      setSlots(await api('slots', { date: nextDate, service_ids: serviceIds }))
      setState('slot')
    } catch (err) { setError(String(err.message || err)) } finally { setBusy(false) }
  }

  async function confirmBooking() {
    if (!serviceIds.length || !slot || busy) return
    setBusy(true); setError('')
    try {
      const result = await api('book', {
        service_ids: serviceIds,
        slot_id: slot.id,
        date,
        guest_name: profile?.displayName || '',
      })
      setBooking(result)
      setState('done')
    } catch (err) { setError(String(err.message || err)) } finally { setBusy(false) }
  }

  if (state === 'loading') return <Wrap><p className="text-sagegray">กำลังเชื่อมต่อ LINE...</p></Wrap>
  if (state === 'error') return <Wrap><section className="card max-w-md p-6 text-center"><p className="font-semibold text-danger">{error}</p><p className="mt-2 text-sm text-sagegray">กรุณาเปิดจาก LINE อีกครั้ง หรือติดต่อร้านหากปัญหายังไม่หาย</p></section></Wrap>
  if (state === 'done') return <Wrap><section className="card max-w-md p-7 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/10 text-xl text-success">✓</div><p className="mt-4 text-sm font-bold uppercase tracking-[0.18em] text-rosedeep">Booking confirmed</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink">จองคิวสำเร็จ</h1><p className="mt-3 text-lg font-bold text-rosedeep">{booking?.booking_no}</p><div className="mt-5 rounded-2xl bg-porcelain p-4 text-left text-sm text-sagegray"><p className="font-semibold text-ink">{serviceSummary(selectedServices)}</p><p className="mt-1">{thaiDate(booking?.slot_date)} · {time(booking?.start_time)}–{time(booking?.end_time)} น.</p></div>{liff.isInClient() && <button className="btn-rose mt-6 w-full" onClick={() => liff.closeWindow()}>ปิดหน้าต่าง</button>}</section></Wrap>

  return <Wrap><div className="w-full max-w-xl"><div className="mb-6 flex items-center gap-3"><BrandMark /><div><p className="font-display text-xl font-semibold text-ink">Nail Time &amp; Spa</p><p className="text-sm text-sagegray">จองคิวออนไลน์</p></div></div><section className="card p-5 sm:p-7"><div className="mb-6 flex gap-2 text-xs font-semibold"><span className="badge-rose">1 บริการ</span><span className={`badge ${state === 'date' || state === 'slot' ? 'badge-rose' : ''}`}>2 วันและเวลา</span><span className={`badge ${state === 'confirm' ? 'badge-rose' : ''}`}>3 ยืนยัน</span></div>{state === 'service' && <><h1 className="font-display text-3xl font-semibold text-ink">เลือกบริการ</h1><p className="mt-2 text-sm text-sagegray">เลือกได้มากกว่า 1 รายการ ระบบจะรวมเวลาที่ต้องใช้ให้</p><div className="mt-5 grid gap-3">{services.map((item) => { const selected = selectedServices.some((value) => value.id === item.id); return <button key={item.id} className={`rounded-2xl border p-4 text-left transition ${selected ? 'border-rose bg-blush/45 shadow-sm' : 'border-mist hover:border-rose hover:bg-blush/30'}`} onClick={() => toggleService(item)}><div className="flex justify-between gap-4"><span className="font-semibold text-ink">{item.name}</span><span className={`grid h-6 w-6 place-items-center rounded-full border text-xs ${selected ? 'border-rose bg-rose text-white' : 'border-mist text-transparent'}`}>✓</span></div><div className="mt-1 flex justify-between gap-3 text-sm text-sagegray"><span>ประมาณ {item.duration} นาที</span>{item.price != null && <span className="font-semibold text-rosedeep">฿{Number(item.price).toLocaleString()}</span>}</div></button> })}</div><div className="mt-5 flex items-center justify-between rounded-2xl bg-porcelain p-4"><div><p className="font-semibold text-ink">เลือกแล้ว {selectedServices.length} รายการ</p><p className="mt-1 text-sm text-sagegray">ใช้เวลารวมประมาณ {totalDuration} นาที</p></div><button className="btn-rose" disabled={!selectedServices.length} onClick={() => setState('date')}>เลือกวัน</button></div></>}{state === 'date' && <><button className="text-sm font-semibold text-rosedeep" onClick={() => setState('service')}>← เปลี่ยนบริการ</button><h1 className="mt-4 font-display text-3xl font-semibold text-ink">เลือกวัน</h1><p className="mt-1 text-sm text-sagegray">{serviceSummary(selectedServices)} · {totalDuration} นาที</p><div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">{dates.map((item) => <button key={item} className="rounded-2xl border border-mist p-3 text-center transition hover:border-rose hover:bg-blush/30" disabled={busy} onClick={() => selectDate(item)}><p className="text-sm font-semibold text-ink">{thaiDate(item)}</p></button>)}</div></>}{state === 'slot' && <><button className="text-sm font-semibold text-rosedeep" onClick={() => setState('date')}>← เปลี่ยนวัน</button><h1 className="mt-4 font-display text-3xl font-semibold text-ink">เลือกเวลา</h1><p className="mt-1 text-sm text-sagegray">{thaiDate(date)} · {totalDuration} นาที</p>{error && <p className="mt-4 rounded-xl bg-danger/5 p-3 text-sm text-danger">{error}</p>}<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{slots.map((item) => <button key={item.id} className="rounded-2xl border border-mist p-4 text-left transition hover:border-rose hover:bg-blush/30" onClick={() => { setSlot(item); setState('confirm') }}><p className="font-semibold text-ink">{time(item.start_time)}–{time(item.end_time)}</p><p className="mt-1 text-xs text-sagegray">ว่าง {item.available} คิว</p></button>)}</div>{!slots.length && !busy && <p className="mt-6 rounded-xl bg-porcelain p-4 text-center text-sagegray">ไม่มีเวลาว่างที่ยาวพอสำหรับบริการที่เลือก</p>}</>}{state === 'confirm' && <><button className="text-sm font-semibold text-rosedeep" onClick={() => setState('slot')}>← เปลี่ยนเวลา</button><h1 className="mt-4 font-display text-3xl font-semibold text-ink">ยืนยันการจอง</h1><div className="mt-5 rounded-2xl bg-porcelain p-4 text-sm text-sagegray"><p className="font-semibold text-ink">{serviceSummary(selectedServices)}</p><p className="mt-2">{thaiDate(date)} · {time(slot?.start_time)}–{time(slot?.end_time)} น.</p><p className="mt-2">ผู้จอง: {profile?.displayName}</p></div>{error && <p className="mt-4 rounded-xl bg-danger/5 p-3 text-sm text-danger">{error}</p>}<button className="btn-rose mt-6 w-full" disabled={busy} onClick={confirmBooking}>{busy ? 'กำลังบันทึก...' : 'ยืนยันการจอง'}</button></>}</section></div></Wrap>
}

function Wrap({ children }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f9e6e5_0%,#faf7f5_42%,#f5efec_100%)] px-5 py-8 sm:px-8 sm:py-12"><div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">{children}</div></main> }
