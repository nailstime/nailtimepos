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
      <div className="card w-full p-5 sm:p-6">
        <p className="page-eyebrow">Nail Time Member</p>
        <p className="mt-2 font-display text-2xl font-semibold">สมัครสมาชิก</p>
        <p className="mt-2 text-sm leading-6 text-sagegray">สะสมครบทุก 1,500 บาท รับ 1 สิทธิ์แลกบริการฟรี</p>
        <label className="mt-5 block text-sm font-semibold text-ink">
          ชื่อ
          <input className="input mt-2" placeholder="ชื่อที่ใช้ติดต่อ" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="mt-4 block text-sm font-semibold text-ink">
          เบอร์โทรศัพท์
          <input className="input mt-2" placeholder="0xx-xxx-xxxx" inputMode="tel" value={form.phone}
            type="tel" autoComplete="tel-national" maxLength={10}
            onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
        </label>
        {needsClaimCode && (
          <label className="mt-4 block text-sm font-semibold text-ink">
            โค้ดยืนยันสมาชิกเดิม
            <input className="input mt-2 text-center text-lg tracking-[0.25em]" placeholder="000000"
              inputMode="numeric" maxLength={6} value={form.claimCode}
              onChange={(e) => setForm({ ...form, claimCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
          </label>
        )}
        {err && <p role="alert" className="mt-4 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">{err}</p>}
        <button onClick={register} disabled={busy} className="btn-rose w-full mt-4">
          {busy ? 'กำลังสมัคร…' : 'สมัครสมาชิก'}
        </button>
      </div>
    </Wrap>
  )

  const m = me.member
  const toNext = Number(me.threshold) - Number(m.accumulated_baht)
  const pct = Math.min(100, (Number(m.accumulated_baht) / Number(me.threshold)) * 100)
  const srcLabel = {
    order_paid: 'สะสมจากบิล', order_void: 'คืนแต้มจากบิลยกเลิก',
    redemption: 'ใช้สิทธิ์', redemption_refund: 'คืนสิทธิ์จากบิลยกเลิก',
    manual_adjust: 'ปรับโดยร้าน',
  }

  return (
    <Wrap>
      <Brand />
      <div className="w-full overflow-hidden rounded-[24px] bg-ink p-6 text-white shadow-lift">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-white/60">สมาชิก</p>
            <p className="mt-1 font-display text-xl font-semibold">คุณ{m.name}</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70">ACTIVE</span>
        </div>
        <div className="mt-8 flex items-end justify-between">
          <div>
            <p className="font-display text-6xl font-semibold leading-none text-white">{m.points_balance}</p>
            <p className="mt-2 text-sm text-white/60">สิทธิ์ที่ใช้ได้</p>
          </div>
          <span className="brand-symbol brand-symbol-inverse" aria-hidden="true">N</span>
        </div>
        <div className="mt-7 text-left">
          <div className="mb-2 flex justify-between text-xs text-white/55">
            <span>สะสม ฿{baht(m.accumulated_baht)}</span>
            <span>อีก ฿{baht(toNext)} รับ 1 สิทธิ์</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-rose transition-all" style={{ width: pct + '%' }} />
          </div>
        </div>
      </div>

      {me.pending.length > 0 && (
        <div className="card w-full border-rose/40 p-5 shadow-md">
          <span className="badge-rose">ต้องยืนยัน</span>
          <p className="mt-3 font-display text-xl font-semibold">รอคุณยืนยันการใช้สิทธิ์</p>
          {err && <p className="text-rosedeep text-sm mt-1">{err}</p>}
          {me.pending.map((p) => (
            <div key={p.id} className="mt-3">
              <p className="text-sm">แลก <b>{p.reward}</b> (ใช้ {p.points_cost} สิทธิ์)</p>
              <button onClick={() => confirmRedeem(p.id)} disabled={busy}
                className="btn-rose w-full mt-2">ยืนยันใช้สิทธิ์</button>
            </div>
          ))}
        </div>
      )}

      <div className="card w-full p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="section-title">ประวัติล่าสุด</p>
          <span className="badge-neutral">{me.history.length} รายการ</span>
        </div>
        {me.history.length === 0 && <p className="text-sm text-sagegray">ยังไม่มีรายการ</p>}
        {me.history.map((h, i) => (
          <div key={i} className="flex min-h-12 items-center justify-between border-b border-mist py-2 text-sm last:border-0">
            <span>{srcLabel[h.source] || h.source}</span>
            <span className={h.change > 0 ? 'font-semibold text-success' : 'font-semibold text-rosedeep'}>
              {h.change > 0 ? '+' : ''}{h.change} สิทธิ์
            </span>
          </div>
        ))}
      </div>
    </Wrap>
  )
}

function Brand() {
  return <div className="flex w-full justify-center py-2"><BrandMark /></div>
}
function Wrap({ children }) {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,_rgba(169,79,97,0.12),_transparent_32%),linear-gradient(180deg,#f7f4f2_0%,#efe7e4_100%)] p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">{children}</div>
    </main>
  )
}
