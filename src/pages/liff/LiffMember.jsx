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
            <p className="mt-2 max-w-md text-sm leading-6 text-sagegray">สะสมครบทุก ฿1,500 รับ 1 สิทธิ์แลกบริการฟรี สิทธิ์จะสะสมอัตโนมัติทุกครั้งที่ชำระเงิน</p>
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
            {busy ? 'กำลังสมัคร…' : 'สมัครและเริ่มสะสมสิทธิ์'}
          </button>
        </div>
      </section>
    </Wrap>
  )

  const m = me.member
  const toNext = Math.max(0, Number(me.threshold) - Number(m.accumulated_baht))
  const pct = Math.min(100, (Number(m.accumulated_baht) / Number(me.threshold)) * 100)
  const srcLabel = {
    order_paid: 'สะสมจากบิล', order_void: 'คืนแต้มจากบิลยกเลิก',
    redemption: 'ใช้สิทธิ์', redemption_refund: 'คืนสิทธิ์จากบิลยกเลิก',
    manual_adjust: 'ปรับโดยร้าน',
  }

  return (
    <Wrap>
      <Brand />
      <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:items-start">
        <section className="relative overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#38252c_0%,#22181c_56%,#804657_145%)] p-6 text-white shadow-lift sm:p-8">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-rose/30 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-16 left-1/3 h-36 w-36 rounded-full bg-white/5 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rosepale">Nail Time Member</p>
                <p className="mt-3 font-display text-3xl font-semibold leading-tight">คุณ {m.name}</p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-wide text-white/90">ACTIVE</span>
            </div>

            <div className="mt-8 grid grid-cols-[1fr_auto] items-end gap-4">
              <div>
                <p className="font-display text-7xl font-semibold leading-none tabular-nums text-white sm:text-8xl">{m.points_balance}</p>
                <p className="mt-3 text-sm font-medium text-white/70">สิทธิ์พร้อมใช้</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-right backdrop-blur-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">ยอดสะสม</p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums">฿{baht(m.accumulated_baht)}</p>
              </div>
            </div>

            <div className="mt-8 border-t border-white/10 pt-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-white/70">สะสมครบ ฿{baht(me.threshold)} รับเพิ่ม 1 สิทธิ์</span>
                <span className="shrink-0 font-semibold text-rosepale">อีก ฿{baht(toNext)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10" aria-label={`สะสมแล้ว ${Math.round(pct)} เปอร์เซ็นต์`}>
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#e7a3ad,#c56b7c)] transition-[width] duration-300" style={{ width: pct + '%' }} />
              </div>
              <p className="mt-3 text-xs leading-5 text-white/55">สิทธิ์จะเพิ่มให้อัตโนมัติหลังพนักงานยืนยันการชำระเงิน</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5">
          {me.pending.length > 0 ? (
            <section className="card border-rose/35 bg-[linear-gradient(135deg,#fff_0%,#fff6f7_100%)] p-5 sm:p-6">
              <span className="badge-rose">รอการยืนยัน</span>
              <p className="mt-3 font-display text-2xl font-semibold text-ink">ยืนยันใช้สิทธิ์</p>
              <p className="mt-1 text-sm leading-6 text-sagegray">กรุณาตรวจสอบรายการก่อนยืนยัน ระบบจะหักสิทธิ์หลังยืนยัน</p>
              {err && <p role="alert" className="mt-4 rounded-xl bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
              {me.pending.map((p) => (
                <div key={p.id} className="mt-4 rounded-2xl border border-mist bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-ink">{p.reward}</p>
                    <span className="badge-neutral shrink-0">{p.points_cost} สิทธิ์</span>
                  </div>
                  <button onClick={() => confirmRedeem(p.id)} disabled={busy} className="btn-rose mt-4 w-full">
                    {busy ? 'กำลังยืนยัน…' : 'ยืนยันใช้สิทธิ์'}
                  </button>
                </div>
              ))}
            </section>
          ) : (
            <section className="card overflow-hidden p-5 sm:p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose/10 text-rosedeep" aria-hidden="true">
                <CheckIcon />
              </div>
              <p className="mt-4 font-display text-2xl font-semibold text-ink">สิทธิ์ของคุณพร้อมใช้</p>
              <p className="mt-2 text-sm leading-6 text-sagegray">เมื่อเลือกแลกรางวัลที่หน้าร้าน ระบบจะส่งคำขอให้คุณยืนยันที่หน้านี้ก่อนเสมอ</p>
            </section>
          )}
          <section className="rounded-[24px] border border-rose/15 bg-rose/5 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-rosedeep">Member benefits</p>
            <p className="mt-2 font-display text-xl font-semibold text-ink">ทุกยอดชำระ คือสิทธิ์ของคุณ</p>
            <p className="mt-2 text-sm leading-6 text-sagegray">ใช้เบอร์เดิมทุกครั้งที่หน้าร้าน เพื่อรับสิทธิ์และติดตามยอดสะสมได้ครบถ้วน</p>
          </section>
        </div>

        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-mist px-5 py-5 sm:px-6">
            <div>
              <p className="section-title">ประวัติสิทธิ์ล่าสุด</p>
              <p className="mt-1 text-sm text-sagegray">รายการสะสมและการใช้สิทธิ์ของคุณ</p>
            </div>
            <span className="badge-neutral">{me.history.length} รายการ</span>
          </div>
          {me.history.length === 0 ? (
            <div className="px-5 py-10 text-center sm:px-6">
              <p className="font-medium text-ink">ยังไม่มีประวัติสิทธิ์</p>
              <p className="mt-1 text-sm text-sagegray">สิทธิ์สะสมจะแสดงที่นี่หลังชำระเงินครั้งแรก</p>
            </div>
          ) : (
            <div className="divide-y divide-mist px-5 sm:px-6">
              {me.history.map((h, i) => (
                <div key={i} className="flex min-h-16 items-center justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{srcLabel[h.source] || h.source}</p>
                    <p className="mt-1 text-xs text-sagegray">{formatHistoryDate(h.at)}</p>
                  </div>
                  <span className={h.change > 0 ? 'shrink-0 font-semibold tabular-nums text-success' : 'shrink-0 font-semibold tabular-nums text-rosedeep'}>
                    {h.change > 0 ? '+' : ''}{h.change} สิทธิ์
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

function CheckIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.2 4.2L19 6.8" /></svg>
}

function formatHistoryDate(value) {
  if (!value) return 'รายการล่าสุด'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'รายการล่าสุด'
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
