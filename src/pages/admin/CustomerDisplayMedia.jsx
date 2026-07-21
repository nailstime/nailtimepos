import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppDialog } from '../../components/AppDialog.jsx'
import SettingsBackLink from '../../components/SettingsBackLink.jsx'

const BUCKET = 'customer-display-media'
const MAX_FILE_SIZE = 50 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'])

function publicUrl(path) {
  if (!path) return ''
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || ''
}

function mediaLabel(type) {
  if (type === 'video') return 'วิดีโอ'
  if (type === 'image') return 'Artwork ที่อัปโหลด'
  return 'Artwork เริ่มต้นของร้าน'
}

function mediaTypeForFile(file) {
  return file?.type.startsWith('video/') ? 'video' : 'image'
}

function safeExtension(file) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension && /^[a-z0-9]{1,8}$/.test(extension)) return extension
  return mediaTypeForFile(file) === 'video' ? 'mp4' : 'jpg'
}

export default function CustomerDisplayMedia() {
  const { confirm } = useAppDialog()
  const inputRef = useRef(null)
  const [campaign, setCampaign] = useState(null)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_customer_display_media')
    if (rpcError) setError(rpcError.message)
    else setCampaign(data || { type: 'artwork', path: null, branch_code: '' })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function chooseFile(nextFile) {
    setError('')
    setNotice('')
    if (!nextFile) return setFile(null)
    if (!ACCEPTED_TYPES.has(nextFile.type)) {
      inputRef.current.value = ''
      return setError('รองรับเฉพาะ JPG, PNG, WebP, AVIF, MP4 และ WebM')
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      inputRef.current.value = ''
      return setError('ไฟล์ต้องมีขนาดไม่เกิน 50 MB')
    }
    setFile(nextFile)
  }

  async function upload() {
    if (!file || !campaign?.branch_code) return
    setSaving(true)
    setError('')
    setNotice('')
    const type = mediaTypeForFile(file)
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${campaign.branch_code}/${id}.${safeExtension(file)}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: '31536000', contentType: file.type, upsert: false })
    if (uploadError) {
      setSaving(false)
      return setError(uploadError.message)
    }

    const { data, error: rpcError } = await supabase.rpc('set_customer_display_media', {
      p_media_type: type,
      p_media_path: path,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCampaign(data)
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    setNotice('อัปเดตสื่อหน้าจอลูกค้าแล้ว จะแสดงเมื่อจออยู่สถานะรอคิดเงิน')
  }

  async function useDefaultArtwork() {
    if (campaign?.type === 'artwork') return
    const accepted = await confirm({
      title: 'เปลี่ยนกลับเป็น Artwork เริ่มต้น',
      description: 'สื่อที่อัปโหลดจะไม่แสดงบนจอลูกค้าแล้ว แต่ไฟล์เดิมจะยังเก็บไว้ในระบบ',
      confirmLabel: 'ใช้ Artwork เริ่มต้น',
      cancelLabel: 'ยกเลิก',
    })
    if (!accepted) return
    setSaving(true)
    setError('')
    setNotice('')
    const { data, error: rpcError } = await supabase.rpc('set_customer_display_media', {
      p_media_type: 'artwork',
      p_media_path: null,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCampaign(data)
    setNotice('กลับมาใช้ Artwork เริ่มต้นแล้ว')
  }

  const activeUrl = publicUrl(campaign?.path)
  const activeVideo = campaign?.type === 'video'

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">Customer display</p><h1 className="page-title">สื่อหน้าจอลูกค้า</h1><p className="page-description">อัปโหลด Artwork หรือวิดีโอที่จะแสดงบนจอลูกค้าระหว่างยังไม่มีบิล โดยไม่ต้องแก้โค้ดหรือ deploy ใหม่</p></div></div>

      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      {notice && <p role="status" className="mb-5 rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm font-medium text-success">{notice}</p>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist px-5 py-4 sm:px-6"><div><p className="section-title">ตัวอย่างที่กำลังแสดง</p><p className="section-note">จอลูกค้าจะโหลดสื่อนี้เมื่อไม่มีบิลค้างอยู่</p></div><span className={campaign?.type === 'artwork' ? 'badge-neutral' : 'badge-rose'}>{loading ? 'กำลังโหลด' : mediaLabel(campaign?.type)}</span></div>
          <div className="bg-porcelain p-4 sm:p-6"><div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-mist bg-[radial-gradient(circle_at_top_right,_rgba(169,79,97,0.18),_transparent_38%),linear-gradient(135deg,#fbf7f5_0%,#f0e1df_100%)]">
            {loading ? <div className="absolute inset-0 animate-pulse bg-white/55" /> : activeUrl ? (activeVideo ? <video className="h-full w-full object-cover" src={activeUrl} autoPlay muted loop playsInline controls aria-label="ตัวอย่างวิดีโอหน้าจอลูกค้า" /> : <img className="h-full w-full object-cover" src={activeUrl} alt="ตัวอย่าง Artwork หน้าจอลูกค้า" />) : <DefaultPreview />}
          </div></div>
        </section>

        <section className="card p-5 sm:p-6">
          <p className="section-title">อัปโหลดสื่อใหม่</p><p className="section-note">เลือกได้ 1 ไฟล์ต่อครั้ง แล้วระบบจะสลับไปใช้ไฟล์นั้นทันทีหลังอัปโหลดสำเร็จ</p>
          <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="customer-display-media">ไฟล์ Artwork หรือวิดีโอ</label>
          <input ref={inputRef} id="customer-display-media" type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" className="input mt-2 cursor-pointer py-2" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={saving} />
          <p className="mt-2 text-xs leading-5 text-sagegray">รองรับ JPG, PNG, WebP, AVIF, MP4 และ WebM ขนาดไม่เกิน 50 MB — วิดีโอจะเล่นแบบไม่มีเสียงและวนซ้ำ</p>
          {file && <div className="mt-4 rounded-xl border border-rose/15 bg-rose/5 px-3.5 py-3 text-sm"><p className="font-semibold text-ink">{file.name}</p><p className="mt-1 text-sagegray">{mediaLabel(mediaTypeForFile(file))} · {(file.size / 1024 / 1024).toFixed(1)} MB</p></div>}
          <button onClick={upload} disabled={!file || saving || loading} className="btn-rose mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'กำลังอัปโหลด…' : 'อัปโหลดและใช้กับจอลูกค้า'}</button>
        </section>
      </div>

      <section className="card mt-5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6"><div><p className="section-title">Artwork เริ่มต้น</p><p className="section-note">ใช้พื้นหลังและข้อความของ Nail Time & Spa ในระบบ เหมาะเมื่อยังไม่มีโปรโมชั่นให้แสดง</p></div><button onClick={useDefaultArtwork} disabled={saving || loading || campaign?.type === 'artwork'} className="btn-ghost mt-4 w-full sm:mt-0 sm:w-auto disabled:cursor-not-allowed disabled:opacity-50">ใช้ Artwork เริ่มต้น</button></section>
    </div>
  )
}

function DefaultPreview() {
  return <div className="absolute inset-0 flex flex-col justify-between p-5 text-ink sm:p-7"><div className="flex items-center justify-between"><span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-rosedeep">Nail Time & Spa</span><span className="text-xs font-semibold uppercase tracking-[0.14em] text-sagegray">Idle display</span></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-rosedeep">Nail Time Member</p><p className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">สวยในแบบคุณ<br />ทุกวัน</p><p className="mt-3 text-sm text-sagegray">สะสมยอดครบทุก ฿1,500 รับ 1 สิทธิ์</p></div><p className="text-xs font-semibold text-sagegray">Care in every detail</p></div>
}
