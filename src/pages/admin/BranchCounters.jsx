import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { useAppDialog } from '../../components/AppDialog.jsx'
import SettingsBackLink from '../../components/SettingsBackLink.jsx'

export default function BranchCounters() {
  const { confirm } = useAppDialog()
  const [branch, setBranch] = useState(null)
  const [counters, setCounters] = useState([])
  const [form, setForm] = useState({ name: '', promptpay_id: '' })
  const [counterCode, setCounterCode] = useState('')
  const [secret, setSecret] = useState(null)
  const [pairingSecret, setPairingSecret] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const displayUrl = useMemo(() => secret
    ? `${window.location.origin}/display?counter=${encodeURIComponent(secret.code)}#token=${secret.display_token}`
    : '', [secret])

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_branch_counter_settings')
    if (rpcError) setError(rpcError.message)
    else {
      setBranch(data?.branch || null)
      setCounters(data?.counters || [])
      setForm({ name: data?.branch?.name || '', promptpay_id: data?.branch?.promptpay_id || '' })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveBranch(event) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    const { data, error: rpcError } = await supabase.rpc('save_branch_settings', {
      p_name: form.name,
      p_promptpay_id: form.promptpay_id,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setBranch(data)
    setForm({ name: data.name, promptpay_id: data.promptpay_id })
    setNotice('บันทึกข้อมูลสาขาแล้ว')
  }

  async function createCounter(event) {
    event.preventDefault()
    const code = counterCode.trim().toUpperCase()
    if (!code) return setError('กรุณาระบุรหัส Counter')
    const approved = await confirm({
      title: 'สร้าง Counter ใหม่',
      description: `สร้าง Counter ${code} สำหรับรับบิลและเชื่อมต่อจอลูกค้า`,
      confirmLabel: 'สร้าง Counter',
      cancelLabel: 'ยกเลิก',
    })
    if (!approved) return
    setSaving(true); setError(''); setNotice(''); setSecret(null); setPairingSecret(null)
    const { data, error: rpcError } = await supabase.rpc('create_branch_counter', { p_code: code })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCounterCode('')
    setSecret(data)
    setNotice(`สร้าง Counter ${data.code} แล้ว — คัดลอกลิงก์จอด้านล่างก่อนปิดหน้านี้`)
    load()
  }

  async function rotateToken(counter) {
    const approved = await confirm({
      title: `สร้าง token ใหม่สำหรับ ${counter.code}`,
      description: 'ลิงก์เดิมของจอลูกค้าจะใช้ไม่ได้ทันที ต้องนำลิงก์ใหม่ไปเปิดบนเครื่องจอลูกค้า',
      confirmLabel: 'สร้าง token ใหม่',
      cancelLabel: 'ยกเลิก',
      tone: 'danger',
    })
    if (!approved) return
    setSaving(true); setError(''); setNotice(''); setSecret(null); setPairingSecret(null)
    const { data, error: rpcError } = await supabase.rpc('rotate_counter_display_token', { p_counter: counter.id })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setSecret(data)
    setNotice(`สร้าง token ใหม่สำหรับ ${data.code} แล้ว`)
  }

  async function createPairingCode(counter) {
    const approved = await confirm({
      title: `สร้างรหัสจับคู่จอ ${counter.code}`,
      description: 'รหัสใช้ได้หนึ่งครั้งและหมดอายุใน 10 นาที รหัสเดิมที่ยังไม่ได้ใช้จะถูกยกเลิก',
      confirmLabel: 'สร้างรหัสจับคู่',
      cancelLabel: 'ยกเลิก',
    })
    if (!approved) return
    setSaving(true); setError(''); setNotice(''); setPairingSecret(null)
    const { data, error: rpcError } = await supabase.rpc('create_customer_display_pairing_code', { p_counter: counter.id })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setPairingSecret(data)
    setNotice(`สร้างรหัสจับคู่จอ ${data.code} แล้ว — กรอกบน PWA จอลูกค้าภายใน 10 นาที`)
  }

  async function copyDisplayUrl() {
    try {
      await navigator.clipboard.writeText(displayUrl)
      setNotice('คัดลอกลิงก์จอลูกค้าแล้ว')
    } catch {
      setError('คัดลอกอัตโนมัติไม่สำเร็จ กรุณาคัดลอกจากช่องลิงก์ด้านล่าง')
    }
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">Branch & counter</p><h1 className="page-title">สาขาและ Counter</h1><p className="page-description">ตั้งค่าข้อมูลสาขา PromptPay และ Counter สำหรับเปิดบิลหรือเชื่อมต่อจอลูกค้า</p></div></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      {notice && <p role="status" className="mb-5 rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm font-medium text-success">{notice}</p>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
        <form onSubmit={saveBranch} className="card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="section-title">ข้อมูลสาขา</p><p className="section-note">รหัสสาขาถูกล็อกไว้เพื่อไม่ให้กระทบข้อมูลย้อนหลัง</p></div><span className="badge-neutral">{branch?.code || '—'}</span></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">ชื่อสาขา</span><input className="input" required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={loading || saving} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">PromptPay</span><input className="input" required inputMode="numeric" placeholder="เบอร์โทรหรือเลขบัตรประชาชน" value={form.promptpay_id} onChange={(event) => setForm({ ...form, promptpay_id: event.target.value })} disabled={loading || saving} /><span className="mt-1.5 block text-xs text-sagegray">กรอกได้ 10 หรือ 13 หลัก ระบบจะตัดขีดและช่องว่างให้</span></label>
          </div>
          <button disabled={loading || saving} className="btn-rose mt-5 w-full sm:w-auto">{saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลสาขา'}</button>
        </form>

        <form onSubmit={createCounter} className="card p-5 sm:p-6">
          <p className="section-title">เพิ่ม Counter</p><p className="section-note">Counter ใหม่จะได้ token สำหรับจอลูกค้า 1 ชุด</p>
          <label className="mt-5 block"><span className="mb-1.5 block text-sm font-semibold text-ink">รหัส Counter</span><div className="flex gap-2"><input className="input min-w-0 flex-1 uppercase" placeholder="เช่น C2" maxLength={20} value={counterCode} onChange={(event) => setCounterCode(event.target.value.toUpperCase())} disabled={loading || saving} /><button disabled={loading || saving} className="btn-rose shrink-0">เพิ่ม</button></div><span className="mt-1.5 block text-xs text-sagegray">ใช้ A–Z, 0–9, _ หรือ - ได้สูงสุด 20 ตัวอักษร</span></label>
        </form>
      </div>

      {secret && <section className="card mt-5 border-rose/25 p-5 sm:p-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0 flex-1"><p className="section-title">ตั้งค่าจอลูกค้า · {secret.code}</p><p className="section-note">สแกน QR นี้จากเครื่องจอลูกค้า แล้วบันทึกหน้านั้นไว้เป็น Bookmark หรือเปิดเต็มหน้าจอ</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={copyDisplayUrl} className="btn-rose">คัดลอกลิงก์</button><span className="flex min-h-11 items-center text-xs text-sagegray">ลิงก์นี้จะแสดงหลังสร้างหรือหมุน token เท่านั้น</span></div><input className="input mt-4 font-mono text-xs" value={displayUrl} readOnly aria-label="ลิงก์จอลูกค้า" onFocus={(event) => event.target.select()} /></div><div className="shrink-0 self-center rounded-2xl border border-mist bg-white p-3 shadow-sm"><QRCodeSVG value={displayUrl} size={168} includeMargin aria-label={`QR code สำหรับจอลูกค้า Counter ${secret.code}`} /></div></div></section>}

      {pairingSecret && <section className="card mt-5 border-rose/25 p-5 sm:p-6">
        <p className="section-title">รหัสจับคู่จอลูกค้า · {pairingSecret.code}</p>
        <p className="section-note mt-1">เปิด PWA จอลูกค้า แล้วกรอก Counter และรหัสนี้ รหัสจะใช้ได้ครั้งเดียวภายใน 10 นาที</p>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <code className="rounded-2xl border border-rose/20 bg-rose/5 px-5 py-4 text-center font-mono text-3xl font-bold tracking-[0.22em] text-rosedeep">{pairingSecret.pairing_code}</code>
          <p className="max-w-sm text-sm leading-6 text-sagegray">หลังจับคู่สำเร็จ เครื่องจอนี้จะเปิดใช้งานได้ต่อแม้ปิดและเปิด PWA ใหม่ โดยไม่ต้องสแกน QR ซ้ำ</p>
        </div>
      </section>}

      <section className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4 sm:px-6"><div><p className="section-title">Counter ในสาขานี้</p><p className="section-note">หมุน token เมื่อเปลี่ยนเครื่องจอลูกค้า หรือสงสัยว่าลิงก์เดิมรั่ว</p></div><span className="badge-neutral">{counters.length}</span></div>
        <div className="px-5 py-2 sm:px-6">
          {counters.map((counter) => <div key={counter.id} className="data-row grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-semibold">{counter.code}</p><p className="mt-1 text-xs text-sagegray">{counter.has_open_order ? 'กำลังมีบิลเปิดอยู่' : 'พร้อมรับบิล'}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => createPairingCode(counter)} disabled={saving} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-rosedeep hover:bg-rose/10 disabled:cursor-not-allowed disabled:opacity-50">รหัสจับคู่จอ</button><button type="button" onClick={() => rotateToken(counter)} disabled={saving} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-rosedeep hover:bg-rose/10 disabled:cursor-not-allowed disabled:opacity-50">สร้าง token ใหม่</button></div></div>)}
          {!loading && counters.length === 0 && <div className="empty-state my-3">ยังไม่มี Counter — เพิ่ม Counter ด้านบนเพื่อเริ่มใช้งาน</div>}
        </div>
      </section>
    </div>
  )
}
