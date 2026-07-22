import { useEffect, useState } from 'react'
import liff from '@line/liff'
import { supabase } from '../../lib/supabase'
import { baht } from '../../lib/format'
import { BrandMark } from '../../components/Brand.jsx'

// หน้าสมาชิกใน LINE — เปิดผ่าน LIFF URL (ตั้ง Endpoint = /liff)
export default function LiffMember() {
  const [state, setState] = useState('loading') // loading | register | ready | error
  const [idToken, setIdToken] = useState(null)
  const [me, setMe] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', claimCode: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsClaimCode, setNeedsClaimCode] = useState(false)

  async function callMemberApi(action, payload = {}) {
    const { data, error } = await supabase.functions.invoke('line-member', {
      body: { action, id_token: idToken, ...payload },
    })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }

  async function loadMe(token) {
    const { data, error } = await supabase.functions.invoke('line-member', {
      body: { action: 'me', id_token: token },
    })
    if (error || data?.error) throw new Error(data?.error || error?.message || 'โหลดข้อมูลไม่สำเร็จ')
    if (!data.data) return setState('register')
    setMe(data.data)
    setState('ready')
  }

  useEffect(() => {
    ;(async () => {
      try {
        const liffId = import.meta.env.VITE_LIFF_ID
        if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า VITE_LIFF_ID')
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) return liff.login()
        const token = liff.getIDToken()
        if (!token) throw new Error('LIFF app ต้องเปิด scope: openid')
        const profile = await liff.getProfile()
        setIdToken(token)
        setForm((f) => ({ ...f, name: profile.displayName }))
        await loadMe(token)
      } catch (e) {
        setErr(String(e.message || e))
        setState('error')
      }
    })()
  }, [])

  async function register() {
    if (!form.name || !form.phone || busy) return
    const phone = form.phone.replace(/\D/g, '')
    if (phone.length !== 10) {
      setErr('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก')
      return
    }
    setBusy(true); setErr('')
    try {
      const data = await callMemberApi('register', {
        name: form.name,
        phone,
        claim_code: form.claimCode || null,
      })
      const result = data.result
      if (!result?.ok) {
        if (result?.error === 'claim_code_required' || result?.error === 'invalid_claim_code') {
          setNeedsClaimCode(true)
          return setErr(result.error === 'claim_code_required'
            ? 'เบอร์นี้มีสมาชิกเดิม กรุณาขอโค้ด 6 หลักจากพนักงาน'
            : 'โค้ดไม่ถูกต้องหรือหมดอายุ')
        }
        const labels = {
          phone_already_linked: 'เบอร์นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้าน',
          invalid_phone: 'กรุณาตรวจสอบเบอร์โทร',
          invalid_name: 'กรุณากรอกชื่อ',
        }
        return setErr(labels[result?.error] || 'สมัครสมาชิกไม่สำเร็จ')
      }
      await loadMe(idToken)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRedeem(id) {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await callMemberApi('confirm_redemption', { redemption_id: id })
      await loadMe(idToken)
    } catch (e) {
      setErr('ยืนยันไม่สำเร็จ: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <Wrap><p className="text-sagegray">กำลังโหลด…</p></Wrap>
  if (state === 'error') return <Wrap><p className="text-rosedeep">{err || 'เกิดข้อผิดพลาด'}</p></Wrap>

  if (state === 'register') return (
    <Wrap>
      <Brand />
      <section className="w-full max-w-xl overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-lift backdrop-blur">
        <div className="relative overflow-hidden border-b border-mist bg-[linear-gradient(135deg,#fff8f7_0%,#f5e6e6_100%)] px-5 py-6 sm:px-7 sm:py-8">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-rose/10 blur-2xl" aria-hidden="true" />
          <div className="relative">
            <span className="badge-rose">สมัครผ่าน LINE</span>
            <p className="mt-3 font-display text-3xl font-semibold text-ink">สมัครสมาชิก</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-sagegray">สะสมครบทุก ฿1,500 รับ 1 NTime แลกบริการฟรี NTime จะสะสมอัตโนมัติทุกครั้งที่ชำระเงิน</p>
          </div>
        </div>
        <div className="p-5 sm:p-7">
          <label className="block text-sm font-semibold text-ink">
            ชื่อสำหรับติดต่อ
            <input className="input mt-2" placeholder="เช่น โน้ต" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="mt-5 block text-sm font-semibold text-ink">
            เบอร์โทรศัพท์
            <input className="input mt-2" placeholder="0801234567" inputMode="tel" value={form.phone}
              type="tel" autoComplete="tel-national" maxLength={10}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            <span className="mt-2 block text-xs font-normal text-sagegray">กรอกตัวเลข 10 หลัก เพื่อใช้ค้นหาสมาชิกที่หน้าร้าน</span>
          </label>
          {needsClaimCode && (
            <label className="mt-5 block rounded-2xl border border-rose/25 bg-blush/35 p-4 text-sm font-semibold text-ink">
              โค้ดยืนยันสมาชิกเดิม
              <span className="mt-1 block text-xs font-normal leading-5 text-sagegray">ขอโค้ด 6 หลักจากพนักงาน เพื่อผูกบัญชีเดิมกับ LINE นี้</span>
              <input className="input mt-3 text-center text-lg tracking-[0.25em]" placeholder="000000"
                inputMode="numeric" maxLength={6} value={form.claimCode}
                onChange={(e) => setForm({ ...form, claimCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </label>
          )}
          {err && <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{err}</p>}
          <button onClick={register} disabled={busy} className="btn-rose mt-6 w-full">
            {busy ? 'กำลังสมัคร…' : 'สมัครและเริ่มสะสม NTime'}
          </button>
        </div>
      </section>
    </Wrap>
  )

  const m = me.member
  const toNext = Math.max(0, Number(me.threshold) - Number(m.accumulated_baht))
  const pct = Math.min(100, (Number(m.accumulated_baht) / Number(me.threshold)) * 100)
  const hasPending = me.pending.length > 0
  const srcLabel = {
    order_paid: 'สะสมจากบิล', order_void: 'คืนแต้มจากบิลยกเลิก',
    redemption: 'ใช้ NTime', redemption_refund: 'คืน NTime จากบิลยกเลิก',
    manual_adjust: 'ปรับโดยร้าน',
  }

  return (
    <Wrap>
      <Brand />
      <div className={`grid w-full gap-5 lg:items-start ${hasPending ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]' : 'mx-auto max-w-3xl'}`}>
        <section className="relative isolate overflow-hidden rounded-[30px] border border-rose/20 bg-[linear-gradient(135deg,#c76c7e_0%,#ab5267_48%,#77394c_100%)] p-6 text-white shadow-lift sm:p-8">
          <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full border-[22px] border-white/10" aria-hidden="true" />
          <div className="absolute -bottom-24 -left-14 h-44 w-44 rounded-full bg-[#f8d9dd]/20 blur-2xl" aria-hidden="true" />
          <div className="absolute inset-3 rounded-[22px] border border-white/15" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/70">Nail Time & Spa</p>
                <p className="mt-1 text-sm font-medium text-white/80">Membership card</p>
              </div>
              <span className="rounded-full border border-white/20 bg-white/15 px-3 py-1 text-[11px] font-bold tracking-[0.12em] text-white backdrop-blur-sm">MEMBER</span>
            </div>

            <div className="mt-10 sm:mt-12">
              <p className="text-xs font-medium tracking-wide text-white/70">ชื่อสมาชิก</p>
              <p className="mt-1 font-display text-4xl font-semibold tracking-tight sm:text-5xl">{m.name}</p>
            </div>

            <div className="mt-9 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-white/70">NTime พร้อมใช้</p>
                <p className="mt-1 font-display text-5xl font-semibold leading-none tabular-nums sm:text-6xl">{m.points_balance}<span className="ml-2 text-xl font-medium text-white/75">NTime</span></p>
              </div>
              <p className="pb-1 text-right text-sm font-medium text-white/85">ยอดสะสม<br /><span className="font-display text-xl font-semibold tabular-nums text-white">฿{baht(m.accumulated_baht)}</span></p>
            </div>

            <div className="mt-8 border-t border-white/20 pt-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/80">
                <span>อีก ฿{baht(toNext)} รับเพิ่ม 1 NTime</span>
                <span>{Math.round(pct)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/20" aria-label={`สะสมแล้ว ${Math.round(pct)} เปอร์เซ็นต์`}>
                <div className="h-full rounded-full bg-white transition-[width] duration-300" style={{ width: pct + '%' }} />
              </div>
            </div>
          </div>
        </section>

        {hasPending && (
          <div className="grid gap-5">
            <section className="card border-rose/35 bg-[linear-gradient(135deg,#fff_0%,#fff6f7_100%)] p-5 sm:p-6">
              <span className="badge-rose">รอการยืนยัน</span>
              <p className="mt-3 font-display text-2xl font-semibold text-ink">ยืนยันใช้ NTime</p>
              <p className="mt-1 text-sm leading-6 text-sagegray">กรุณาตรวจสอบรายการก่อนยืนยัน ระบบจะหัก NTime หลังยืนยัน</p>
              {err && <p role="alert" className="mt-4 rounded-xl bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
              {me.pending.map((p) => (
                <div key={p.id} className="mt-4 rounded-2xl border border-mist bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-ink">{p.reward}</p>
                    <span className="badge-neutral shrink-0">{p.points_cost} NTime</span>
                  </div>
                  <button onClick={() => confirmRedeem(p.id)} disabled={busy} className="btn-rose mt-4 w-full">
                    {busy ? 'กำลังยืนยัน…' : 'ยืนยันใช้ NTime'}
                  </button>
                </div>
              ))}
            </section>
          </div>
        )}

        <section className={`card overflow-hidden ${hasPending ? 'lg:col-span-2' : ''}`}>
          <div className="flex items-center justify-between border-b border-mist px-5 py-5 sm:px-6">
            <div>
              <p className="section-title">ประวัติ NTime ล่าสุด</p>
              <p className="mt-1 text-sm text-sagegray">รายการสะสมและการใช้ NTime ของคุณ</p>
            </div>
            <span className="badge-neutral">{me.history.length} รายการ</span>
          </div>
          {me.history.length === 0 ? (
            <div className="px-5 py-10 text-center sm:px-6">
              <p className="font-medium text-ink">ยังไม่มีประวัติ NTime</p>
              <p className="mt-1 text-sm text-sagegray">NTime สะสมจะแสดงที่นี่หลังชำระเงินครั้งแรก</p>
            </div>
          ) : (
            <div className="divide-y divide-mist px-5 sm:px-6">
              {me.history.map((h, i) => (
                <div key={i} className="flex min-h-16 items-center justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{srcLabel[h.source] || h.source}</p>
                    {h.reward_name && (h.source === 'redemption' || h.source === 'redemption_refund') && (
                      <p className="mt-0.5 text-xs font-medium text-rosedeep">{h.reward_name}</p>
                    )}
                    <p className="mt-1 text-xs text-sagegray">{formatHistoryDate(h.at)}</p>
                  </div>
                  <span className={h.change > 0 ? 'shrink-0 font-semibold tabular-nums text-success' : 'shrink-0 font-semibold tabular-nums text-rosedeep'}>
                    {h.change > 0 ? '+' : ''}{h.change} NTime
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Wrap>
  )
}

function Brand() {
  return <div className="flex w-full justify-center py-1 sm:py-2"><BrandMark /></div>
}
function Wrap({ children }) {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_50%_-12%,_rgba(183,90,110,0.18),_transparent_38%),linear-gradient(180deg,#fbf9f8_0%,#f1eae7_100%)] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 sm:gap-6">{children}</div>
    </main>
  )
}

function formatHistoryDate(value) {
  if (!value) return 'รายการล่าสุด'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'รายการล่าสุด'
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
