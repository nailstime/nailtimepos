import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { useAppDialog } from '../../components/AppDialog.jsx'
import SettingsBackLink from '../../components/SettingsBackLink.jsx'

const emptyBranch = { code: '', name: '', promptpay_id: '' }

export default function BranchCounters() {
  const { confirm } = useAppDialog()
  const [branches, setBranches] = useState([])
  const [branch, setBranch] = useState(null)
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [counters, setCounters] = useState([])
  const [form, setForm] = useState({ name: '', promptpay_id: '' })
  const [newBranch, setNewBranch] = useState(emptyBranch)
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

  async function load(branchId = selectedBranchId) {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_branch_counter_settings', {
      p_branch: branchId || null,
    })
    if (rpcError) setError(rpcError.message)
    else {
      const nextBranch = data?.branch || null
      setBranches(data?.branches || [])
      setBranch(nextBranch)
      setCounters(data?.counters || [])
      setSelectedBranchId(nextBranch?.id || '')
      setForm({ name: nextBranch?.name || '', promptpay_id: nextBranch?.promptpay_id || '' })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function selectBranch(event) {
    const branchId = event.target.value
    setSelectedBranchId(branchId)
    setSecret(null)
    setPairingSecret(null)
    setCounterCode('')
    setNotice('')
    await load(branchId)
  }

  async function createBranch(event) {
    event.preventDefault()
    const code = newBranch.code.trim().toUpperCase()
    const name = newBranch.name.trim()
    if (!code || !name || !newBranch.promptpay_id.trim()) {
      return setError('กรอกรหัส ชื่อสาขา และ PromptPay ให้ครบก่อน')
    }
    const approved = await confirm({
      title: `เพิ่มสาขา ${code}`,
      description: `สร้างสาขา “${name}” แล้วคุณจะเลือกสาขานี้เพื่อเพิ่ม Counter และตั้งค่า PromptPay ได้ทันที`,
      confirmLabel: 'เพิ่มสาขา',
      cancelLabel: 'ยกเลิก',
    })
    if (!approved) return
    setSaving(true); setError(''); setNotice('')
    const { data, error: rpcError } = await supabase.rpc('create_branch', {
      p_code: code,
      p_name: name,
      p_promptpay_id: newBranch.promptpay_id,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setNewBranch(emptyBranch)
    setSecret(null)
    setPairingSecret(null)
    setNotice(`เพิ่มสาขา ${data.code} แล้ว — เลือกสาขานี้เพื่อเริ่มเพิ่ม Counter`)
    await load(data.id)
  }

  async function saveBranch(event) {
    event.preventDefault()
    if (!branch?.id) return
    setSaving(true); setError(''); setNotice('')
    const { data, error: rpcError } = await supabase.rpc('save_branch_settings', {
      p_branch: branch.id,
      p_name: form.name,
      p_promptpay_id: form.promptpay_id,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setBranch(data)
    setBranches((items) => items.map((item) => item.id === data.id ? { ...item, ...data } : item))
    setForm({ name: data.name, promptpay_id: data.promptpay_id })
    setNotice(`บันทึกข้อมูลสาขา ${data.code} แล้ว`)
  }

  async function createCounter(event) {
    event.preventDefault()
    const code = counterCode.trim().toUpperCase()
    if (!branch?.id) return setError('กรุณาเลือกสาขาก่อนเพิ่ม Counter')
    if (!code) return setError('กรุณาระบุรหัส Counter')
    const approved = await confirm({
      title: `สร้าง Counter ${code}`,
      description: `สร้างในสาขา ${branch.code} · ${branch.name} สำหรับรับบิลและเชื่อมต่อจอลูกค้า`,
      confirmLabel: 'สร้าง Counter',
      cancelLabel: 'ยกเลิก',
    })
    if (!approved) return
    setSaving(true); setError(''); setNotice(''); setSecret(null); setPairingSecret(null)
    const { data, error: rpcError } = await supabase.rpc('create_branch_counter', {
      p_branch: branch.id,
      p_code: code,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCounterCode('')
    setSecret(data)
    setNotice(`สร้าง Counter ${data.code} ในสาขา ${branch.code} แล้ว — คัดลอกลิงก์จอด้านล่างก่อนปิดหน้านี้`)
    await load(branch.id)
  }

  async function rotateToken(counter) {
    const approved = await confirm({
      title: `สร้าง token ใหม่สำหรับ ${counter.code}`,
      description: `ลิงก์เดิมและจอที่จับคู่ไว้ของ Counter นี้จะใช้ไม่ได้ทันที ต้องตั้งค่าจอใหม่อีกครั้ง`,
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
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Branch & counter</p>
          <h1 className="page-title">สาขาและ Counter</h1>
          <p className="page-description">สร้างสาขา เลือกสาขาที่ต้องการจัดการ แล้วค่อยตั้งค่า PromptPay และ Counter ของสาขานั้น</p>
        </div>
      </div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      {notice && <p role="status" className="mb-5 rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm font-medium text-success">{notice}</p>}

      <section className="card mb-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <label className="block lg:min-w-[360px]">
            <span className="mb-1.5 block text-sm font-semibold text-ink">สาขาที่กำลังจัดการ</span>
            <select className="input" value={selectedBranchId} onChange={selectBranch} disabled={loading || saving} aria-label="เลือกสาขาที่จัดการ">
              {branches.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.counter_count} Counter)</option>)}
            </select>
          </label>
          {branch && <div className="flex items-center gap-2 text-sm text-sagegray"><span className="badge-neutral">{branch.code}</span><span>{branch.active ? 'เปิดใช้งานอยู่' : 'ปิดใช้งาน'}</span></div>}
        </div>
        <p className="mt-3 text-sm leading-6 text-sagegray">Counter และลิงก์จอลูกค้าด้านล่างจะแสดงเฉพาะสาขาที่เลือกเท่านั้น</p>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
        <form onSubmit={saveBranch} className="card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><p className="section-title">ข้อมูลสาขาที่เลือก</p><p className="section-note">รหัสสาขาถูกล็อกไว้เพื่อไม่ให้กระทบข้อมูลย้อนหลัง</p></div>
            <span className="badge-neutral">{branch?.code || '—'}</span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">ชื่อสาขา</span><input className="input" required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={loading || saving || !branch} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">PromptPay</span><input className="input" required inputMode="numeric" placeholder="เบอร์โทรหรือเลขบัตรประชาชน" value={form.promptpay_id} onChange={(event) => setForm({ ...form, promptpay_id: event.target.value })} disabled={loading || saving || !branch} /><span className="mt-1.5 block text-xs text-sagegray">กรอกได้ 10 หรือ 13 หลัก ระบบจะตัดขีดและช่องว่างให้</span></label>
          </div>
          <button disabled={loading || saving || !branch} className="btn-rose mt-5 w-full sm:w-auto">{saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลสาขา'}</button>
        </form>

        <form onSubmit={createBranch} className="card p-5 sm:p-6">
          <p className="section-title">เพิ่มสาขาใหม่</p>
          <p className="section-note">เมื่อสร้างแล้ว ระบบจะเลือกสาขาใหม่นี้ให้ทันที เพื่อเพิ่ม Counter ต่อได้</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">รหัสสาขา</span><input className="input uppercase" placeholder="เช่น BKK2" maxLength={20} value={newBranch.code} onChange={(event) => setNewBranch({ ...newBranch, code: event.target.value.toUpperCase() })} disabled={saving} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">ชื่อสาขา</span><input className="input" placeholder="เช่น เซ็นทรัลลาดพร้าว" maxLength={120} value={newBranch.name} onChange={(event) => setNewBranch({ ...newBranch, name: event.target.value })} disabled={saving} /></label>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">PromptPay สาขา</span><input className="input" inputMode="numeric" placeholder="เบอร์โทรหรือเลขบัตรประชาชน" value={newBranch.promptpay_id} onChange={(event) => setNewBranch({ ...newBranch, promptpay_id: event.target.value })} disabled={saving} /></label>
          </div>
          <button disabled={saving} className="btn-ghost mt-5 w-full">เพิ่มสาขา</button>
        </form>
      </div>

      <form onSubmit={createCounter} className="card mt-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="section-title">เพิ่ม Counter ในสาขา {branch?.code || '—'}</p><p className="section-note">Counter ใหม่จะได้ token สำหรับจอลูกค้า 1 ชุด และจะผูกกับสาขาที่เลือกไว้ด้านบน</p></div>
          <label className="block w-full lg:max-w-xl"><span className="mb-1.5 block text-sm font-semibold text-ink">รหัส Counter</span><div className="flex gap-2"><input className="input min-w-0 flex-1 uppercase" placeholder="เช่น C2" maxLength={20} value={counterCode} onChange={(event) => setCounterCode(event.target.value.toUpperCase())} disabled={loading || saving || !branch} /><button disabled={loading || saving || !branch} className="btn-rose shrink-0">เพิ่ม Counter</button></div></label>
        </div>
        <p className="mt-2 text-xs text-sagegray">ใช้ A–Z, 0–9, _ หรือ - ได้สูงสุด 20 ตัวอักษร และห้ามซ้ำภายในสาขาเดียวกัน</p>
      </form>

      {secret && <section className="card mt-5 border-rose/25 p-5 sm:p-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0 flex-1"><p className="section-title">ตั้งค่าจอลูกค้า · {branch?.code} / {secret.code}</p><p className="section-note">สแกน QR นี้จากเครื่องจอลูกค้า แล้วบันทึกหน้านั้นไว้เป็น Bookmark หรือเปิดเต็มหน้าจอ</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={copyDisplayUrl} className="btn-rose">คัดลอกลิงก์</button><span className="flex min-h-11 items-center text-xs text-sagegray">ลิงก์นี้จะแสดงหลังสร้างหรือหมุน token เท่านั้น</span></div><input className="input mt-4 font-mono text-xs" value={displayUrl} readOnly aria-label="ลิงก์จอลูกค้า" onFocus={(event) => event.target.select()} /></div><div className="shrink-0 self-center rounded-2xl border border-mist bg-white p-3 shadow-sm"><QRCodeSVG value={displayUrl} size={168} includeMargin aria-label={`QR code สำหรับจอลูกค้า Counter ${secret.code}`} /></div></div></section>}

      {pairingSecret && <section className="card mt-5 border-rose/25 p-5 sm:p-6">
        <p className="section-title">รหัสจับคู่จอลูกค้า · {branch?.code} / {pairingSecret.code}</p>
        <p className="section-note mt-1">เปิด PWA จอลูกค้า แล้วกรอก Counter และรหัสนี้ รหัสจะใช้ได้ครั้งเดียวภายใน 10 นาที</p>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <code className="rounded-2xl border border-rose/20 bg-rose/5 px-5 py-4 text-center font-mono text-3xl font-bold tracking-[0.22em] text-rosedeep">{pairingSecret.pairing_code}</code>
          <p className="max-w-sm text-sm leading-6 text-sagegray">หลังจับคู่สำเร็จ เครื่องจอนี้จะเปิดใช้ได้ต่อแม้ปิดและเปิด PWA ใหม่ โดยไม่ต้องสแกน QR ซ้ำ</p>
        </div>
      </section>}

      <section className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4 sm:px-6"><div><p className="section-title">Counter ในสาขา {branch?.code || '—'}</p><p className="section-note">หมุน token เมื่อเปลี่ยนเครื่องจอลูกค้า หรือสงสัยว่าลิงก์เดิมรั่ว</p></div><span className="badge-neutral">{counters.length}</span></div>
        <div className="px-5 py-2 sm:px-6">
          {counters.map((counter) => <div key={counter.id} className="data-row grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-semibold">{counter.code}</p><p className="mt-1 text-xs text-sagegray">{counter.has_open_order ? 'กำลังมีบิลเปิดอยู่' : 'พร้อมรับบิล'}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => createPairingCode(counter)} disabled={saving} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-rosedeep hover:bg-rose/10 disabled:cursor-not-allowed disabled:opacity-50">รหัสจับคู่จอ</button><button type="button" onClick={() => rotateToken(counter)} disabled={saving} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-rosedeep hover:bg-rose/10 disabled:cursor-not-allowed disabled:opacity-50">สร้าง token ใหม่</button></div></div>)}
          {!loading && counters.length === 0 && <div className="empty-state my-3">สาขานี้ยังไม่มี Counter — เพิ่ม Counter ด้านบนเพื่อเริ่มใช้งาน</div>}
        </div>
      </section>
    </div>
  )
}
