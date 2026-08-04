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
  if (type === 'slideshow') return 'Slideshow'
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

function fileSize(size) {
  if (!Number.isFinite(Number(size)) || Number(size) <= 0) return ''
  return `${(Number(size) / 1024 / 1024).toFixed(1)} MB`
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
  const [slideshowPaths, setSlideshowPaths] = useState([])
  const [slideshowInterval, setSlideshowInterval] = useState(5000)

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_customer_display_media')
    if (rpcError) setError(rpcError.message)
    else {
      setCampaign(data || { type: 'artwork', path: null, branch_code: '' })
      setSlideshowPaths(Array.isArray(data?.slideshow_paths) ? data.slideshow_paths : [])
      setSlideshowInterval(data?.slideshow_interval || 5000)
    }
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
    await load()
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

  async function useLibraryMedia(media) {
    if (!media?.path || media.path === campaign?.path) return
    setSaving(true)
    setError('')
    setNotice('')
    const { data, error: rpcError } = await supabase.rpc('set_customer_display_media', {
      p_media_type: media.type,
      p_media_path: media.path,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCampaign({ ...data, library: campaign?.library || [] })
    setNotice(`เปลี่ยนจอลูกค้าเป็น ${media.name} แล้ว`)
  }

  async function deleteLibraryMedia(media) {
    if (!media?.path) return
    const isActive = media.path === campaign?.path
    const accepted = await confirm({
      title: 'ลบสื่อจากคลัง',
      description: isActive
        ? `"${media.name}" กำลังแสดงอยู่บนจอลูกค้า เมื่อลบแล้วจะสลับกลับไปใช้ Artwork เริ่มต้นทันที`
        : `ลบ "${media.name}" ออกจากคลังอย่างถาวรหรือไม่? ไฟล์นี้จะไม่สามารถกู้คืนได้`,
      confirmLabel: 'ลบไฟล์',
      cancelLabel: 'เก็บไว้',
      tone: 'danger',
    })
    if (!accepted) return
    setSaving(true)
    setError('')
    setNotice('')

    if (isActive) {
      const { error: switchError } = await supabase.rpc('set_customer_display_media', {
        p_media_type: 'artwork',
        p_media_path: null,
      })
      if (switchError) {
        setSaving(false)
        return setError(switchError.message)
      }
    }

    const { data: removed, error: removeError } = await supabase.storage.from(BUCKET).remove([media.path])
    setSaving(false)
    if (removeError) return setError(removeError.message)
    if (!removed?.length) return setError('ลบไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง')
    setCampaign((current) => ({
      ...current,
      type: isActive ? 'artwork' : current.type,
      path: isActive ? null : current.path,
      library: (current?.library || []).filter((item) => item.path !== media.path),
    }))
    setSlideshowPaths((prev) => prev.filter((p) => p !== media.path))
    setNotice(isActive ? `ลบ ${media.name} แล้ว — สลับกลับ Artwork เริ่มต้น` : `ลบ ${media.name} ออกจากคลังแล้ว`)
  }

  function toggleSlideshowPath(path) {
    setSlideshowPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  function moveSlideshowItem(index, dir) {
    setSlideshowPaths((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function activateSlideshow() {
    if (!slideshowPaths.length) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: rpcError } = await supabase.rpc('set_slideshow_media', {
      p_paths: slideshowPaths,
      p_interval_ms: slideshowInterval,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.message)
    setCampaign((current) => ({
      ...current,
      type: 'slideshow',
      path: null,
      slideshow_paths: slideshowPaths,
      slideshow_interval: slideshowInterval,
    }))
    setNotice(`เปิดใช้ Slideshow แล้ว — ${slideshowPaths.length} ภาพ สลับทุก ${slideshowInterval / 1000} วินาที`)
  }

  const activeUrl = publicUrl(campaign?.path)
  const activeVideo = campaign?.type === 'video'
  const isSlideshowActive = campaign?.type === 'slideshow'
  const slideshowPreviewUrl = isSlideshowActive && slideshowPaths.length > 0 ? publicUrl(slideshowPaths[0]) : ''

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
            {loading ? (
              <div className="absolute inset-0 animate-pulse bg-white/55" />
            ) : slideshowPreviewUrl ? (
              <>
                <img className="h-full w-full object-cover" src={slideshowPreviewUrl} alt="Slideshow preview" />
                <span className="absolute left-3 top-3 badge-rose">Slideshow · {slideshowPaths.length} ภาพ</span>
              </>
            ) : activeUrl ? (
              activeVideo
                ? <video className="h-full w-full object-cover" src={activeUrl} autoPlay muted loop playsInline controls aria-label="ตัวอย่างวิดีโอหน้าจอลูกค้า" />
                : <img className="h-full w-full object-cover" src={activeUrl} alt="ตัวอย่าง Artwork หน้าจอลูกค้า" />
            ) : (
              <DefaultPreview />
            )}
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

      <section className="card mt-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist px-5 py-4 sm:px-6">
          <div><p className="section-title">คลังสื่อ</p><p className="section-note">เลือกไฟล์เดิมเพื่อแสดงใหม่ได้ทันที — กดดาว ☆ บนภาพเพื่อเพิ่มใน Slideshow</p></div>
          <span className="badge-neutral">{campaign?.library?.length || 0} ไฟล์</span>
        </div>
        {!loading && !(campaign?.library?.length) ? (
          <div className="px-5 py-10 text-center text-sm text-sagegray sm:px-6">ยังไม่มีไฟล์ในคลัง — อัปโหลดภาพหรือวิดีโอไฟล์แรกได้จากด้านบน</div>
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {(campaign?.library || []).map((media) => {
              const active = media.path === campaign?.path
              const inSlideshow = slideshowPaths.includes(media.path)
              const url = publicUrl(media.path)
              return (
                <article key={media.path} className={(active ? 'border-rose ring-2 ring-rose/15' : inSlideshow ? 'border-rose/40' : 'border-mist') + ' overflow-hidden rounded-2xl border bg-white'}>
                  <div className="relative aspect-video bg-ink">
                    {media.type === 'video'
                      ? <video className="h-full w-full object-cover" src={url} muted preload="metadata" aria-label={`วิดีโอ ${media.name}`} />
                      : <img className="h-full w-full object-cover" src={url} alt={`Artwork ${media.name}`} />
                    }
                    {active && <span className="absolute left-3 top-3 badge-rose">กำลังแสดง</span>}
                    {inSlideshow && !active && <span className="absolute left-3 top-3 badge-rose">★ Slide</span>}
                    <span className="absolute right-3 top-3 rounded-full bg-ink/65 px-2.5 py-1 text-xs font-semibold text-white">{media.type === 'video' ? 'วิดีโอ' : 'ภาพ'}</span>
                  </div>
                  <div className="p-3.5">
                    <p className="truncate font-semibold text-ink" title={media.name}>{media.name}</p>
                    <p className="mt-1 text-xs text-sagegray">{fileSize(media.size) || 'ไม่ทราบขนาด'}{media.created_at ? ` · ${new Date(media.created_at).toLocaleDateString('th-TH')}` : ''}</p>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => useLibraryMedia(media)} disabled={saving || active} className="btn-ghost min-h-9 flex-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">{active ? 'กำลังใช้งาน' : 'ใช้ไฟล์นี้'}</button>
                      {media.type === 'image' && (
                        <button
                          onClick={() => toggleSlideshowPath(media.path)}
                          disabled={saving}
                          title={inSlideshow ? 'นำออกจาก Slideshow' : 'เพิ่มใน Slideshow'}
                          className={`min-h-9 w-10 rounded-xl border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${inSlideshow ? 'border-rose/25 bg-rose/10 text-rosedeep' : 'btn-ghost'}`}
                        >
                          {inSlideshow ? '★' : '☆'}
                        </button>
                      )}
                      <button onClick={() => deleteLibraryMedia(media)} disabled={saving} className="btn-danger min-h-9 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50">ลบ</button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="card mt-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist px-5 py-4 sm:px-6">
          <div><p className="section-title">Slideshow</p><p className="section-note">แสดงภาพหลายภาพสลับกันอัตโนมัติ — กดดาว ☆ บนภาพในคลังด้านบนเพื่อเพิ่ม</p></div>
          {isSlideshowActive && <span className="badge-rose">กำลังแสดง</span>}
        </div>
        <div className="p-4 sm:p-6">
          {slideshowPaths.length === 0 ? (
            <p className="py-4 text-center text-sm text-sagegray">ยังไม่ได้เลือกภาพ — กดดาว ☆ บนภาพแต่ละใบในคลังสื่อด้านบน</p>
          ) : (
            <div className="mb-4 space-y-2">
              {slideshowPaths.map((path, index) => {
                const item = (campaign?.library || []).find((m) => m.path === path)
                return (
                  <div key={path} className="flex items-center gap-3 rounded-xl border border-mist bg-white p-2.5">
                    <img src={publicUrl(path)} className="h-12 w-20 flex-shrink-0 rounded-lg object-cover bg-ink" alt="" />
                    <p className="flex-1 truncate text-sm font-semibold text-ink" title={item?.name}>{item?.name || path.split('/').pop()}</p>
                    <span className="shrink-0 text-xs tabular-nums text-sagegray">#{index + 1}</span>
                    <div className="flex shrink-0 gap-1">
                      <button disabled={saving || index === 0} onClick={() => moveSlideshowItem(index, -1)} className="btn-ghost min-h-8 w-8 px-0 disabled:opacity-30">↑</button>
                      <button disabled={saving || index === slideshowPaths.length - 1} onClick={() => moveSlideshowItem(index, 1)} className="btn-ghost min-h-8 w-8 px-0 disabled:opacity-30">↓</button>
                      <button disabled={saving} onClick={() => toggleSlideshowPath(path)} className="btn-danger min-h-8 px-2.5 text-xs">นำออก</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              สลับทุก
              <select value={slideshowInterval} onChange={(e) => setSlideshowInterval(Number(e.target.value))} disabled={saving} className="input w-auto py-1.5 text-sm font-normal">
                <option value={3000}>3 วินาที</option>
                <option value={5000}>5 วินาที</option>
                <option value={8000}>8 วินาที</option>
                <option value={10000}>10 วินาที</option>
                <option value={15000}>15 วินาที</option>
                <option value={30000}>30 วินาที</option>
              </select>
            </label>
            <button
              onClick={activateSlideshow}
              disabled={saving || loading || slideshowPaths.length === 0}
              className="btn-rose disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'กำลังบันทึก…' : isSlideshowActive ? 'อัปเดต Slideshow' : 'เปิดใช้ Slideshow'}
            </button>
          </div>
        </div>
      </section>

      <section className="card mt-5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6"><div><p className="section-title">Artwork เริ่มต้น</p><p className="section-note">ใช้พื้นหลังและข้อความของ Nail Time & Spa ในระบบ เหมาะเมื่อยังไม่มีสื่อให้แสดง</p></div><button onClick={useDefaultArtwork} disabled={saving || loading || campaign?.type === 'artwork'} className="btn-ghost mt-4 w-full sm:mt-0 sm:w-auto disabled:cursor-not-allowed disabled:opacity-50">ใช้ Artwork เริ่มต้น</button></section>
    </div>
  )
}

function DefaultPreview() {
  return <div className="absolute inset-0 flex flex-col justify-between p-5 text-ink sm:p-7"><div className="flex items-center justify-between"><span className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-rosedeep">Nail Time & Spa</span><span className="text-xs font-semibold uppercase tracking-[0.14em] text-sagegray">Idle display</span></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-rosedeep">Nail Time Member</p><p className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">สวยในแบบคุณ<br />ทุกวัน</p><p className="mt-3 text-sm text-sagegray">สะสมยอดครบทุก ฿1,500 รับ 1 NTime</p></div><p className="text-xs font-semibold text-sagegray">Care in every detail</p></div>
}
