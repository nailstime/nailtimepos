import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { baht, bangkokDate, bangkokDateTime } from '../../lib/format.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppDialog } from '../../components/AppDialog.jsx'
import { StaffShell } from './StaffCustomers.jsx'

export default function StaffCustomerDetail() {
  const { memberId } = useParams()
  const { staff, logout } = useAuth()
  const { prompt: openPrompt, confirm: openConfirm } = useAppDialog()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingNote, setSavingNote] = useState(false)
  const [deletingNoteId, setDeletingNoteId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('staff_customer_detail', { p_member: memberId })
    if (rpcError) setError(rpcError.message)
    else setDetail(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addNote() {
    const note = await openPrompt({
      title: 'เพิ่มโน้ตลูกค้า',
      description: 'บันทึกเฉพาะสิ่งที่ช่วยให้ทีมดูแลลูกค้าได้ดีขึ้น เช่น สีที่ชอบหรือข้อควรระวัง',
      label: 'โน้ตบริการ',
      placeholder: 'เช่น ชอบลายสีแดง ไม่ชอบลายสีม่วง',
      helperText: 'ทุกคนในสาขาจะเห็นโน้ตนี้ · ไม่เกิน 500 ตัวอักษร',
      multiline: true,
      required: true,
      maxLength: 500,
      confirmLabel: 'บันทึกโน้ต',
    })
    if (note === null) return
    setSavingNote(true)
    setError('')
    setMessage('')
    const { data, error: rpcError } = await supabase.rpc('staff_add_customer_note', { p_member: memberId, p_note: note })
    if (rpcError) setError(rpcError.message)
    else {
      setDetail((current) => ({ ...current, notes: [data, ...(current?.notes || [])] }))
      setMessage('บันทึกโน้ตแล้ว')
    }
    setSavingNote(false)
  }

  async function deleteNote(note) {
    const confirmed = await openConfirm({
      title: 'ลบโน้ตนี้หรือไม่',
      description: 'เมื่อลบแล้วจะกู้คืนข้อความนี้ไม่ได้',
      tone: 'danger',
      cancelLabel: 'เก็บโน้ตไว้',
      confirmLabel: 'ลบโน้ต',
    })
    if (!confirmed) return
    setDeletingNoteId(note.id)
    setError('')
    setMessage('')
    const { error: rpcError } = await supabase.rpc('staff_delete_customer_note', { p_note: note.id })
    if (rpcError) setError(rpcError.message)
    else {
      setDetail((current) => ({ ...current, notes: (current?.notes || []).filter((item) => item.id !== note.id) }))
      setMessage('ลบโน้ตแล้ว')
    }
    setDeletingNoteId('')
  }

  if (loading) return <StaffShell staff={staff} logout={logout}><DetailSkeleton /></StaffShell>
  if (error && !detail) return <StaffShell staff={staff} logout={logout}><div className="w-full"><Link to="/pos/customers" className="btn-ghost mb-5">กลับไปรายชื่อลูกค้า</Link><div className="card p-5"><div className="empty-state"><p className="font-semibold text-danger">เปิดข้อมูลลูกค้าไม่ได้</p><p className="mt-1">{error}</p><button onClick={load} className="btn-ghost mt-4">ลองอีกครั้ง</button></div></div></div></StaffShell>

  const { member, stats, favorite_services: favorites, recent_visits: visits, notes } = detail
  const initial = member.name?.trim()?.charAt(0)?.toUpperCase() || 'N'

  return <StaffShell staff={staff} logout={logout}>
    <div className="page-heading">
      <div>
        <Link to="/pos/customers" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-sagegray transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"><ArrowLeftIcon /> ลูกค้าทั้งหมด</Link>
        <p className="page-eyebrow mt-2">Customer care</p>
        <h1 className="page-title">โปรไฟล์ลูกค้า</h1>
        <p className="page-description">ใช้เป็นข้อมูลช่วยบริการเท่านั้น ไม่มีรายละเอียดใบเสร็จหรือการพิมพ์ซ้ำ</p>
      </div>
    </div>

    {(message || error) && <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${error ? 'border-danger/20 bg-danger/5 text-danger' : 'border-success/20 bg-success/5 text-success'}`}>{error || message}</div>}

    <section className="card mb-5 p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blush text-xl font-bold text-rosedeep">{initial}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-display text-2xl font-semibold">{member.name}</h2>{member.line_linked ? <span className="badge-success">เชื่อม LINE แล้ว</span> : <span className="badge-neutral">ยังไม่ผูก LINE</span>}</div><p className="mt-1 text-sm text-sagegray">{member.phone} · สมาชิกตั้งแต่ {bangkokDate(member.joined_at)}</p></div></div><span className="badge-rose">คงเหลือ {member.points_balance} สิทธิ์</span></div></section>

    <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><Stat label="บิลที่ชำระแล้ว" value={`${stats.paid_bills} บิล`} /><Stat label="ยอดใช้จ่ายทั้งหมด" value={`฿${baht(stats.lifetime_spend)}`} /><Stat label="มาครั้งล่าสุด" value={stats.last_visit ? bangkokDate(stats.last_visit) : 'ยังไม่มี'} /></section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
      <div className="space-y-5">
        <section className="card overflow-hidden"><div className="border-b border-mist px-5 py-4"><p className="section-title">บริการที่ใช้บ่อย</p><p className="section-note">จัดอันดับจากบริการในบิลที่ชำระแล้ว</p></div>{favorites.length === 0 ? <Empty text="ยังไม่มีประวัติบริการเพียงพอสำหรับจัดอันดับ" /> : favorites.map((service, index) => <div key={service.name} className="grid min-h-16 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-mist px-5 py-3 last:border-b-0"><span className="grid h-8 w-8 place-items-center rounded-full bg-porcelain text-sm font-bold text-rosedeep">{index + 1}</span><div><p className="font-semibold">{service.name}</p><p className="mt-0.5 text-xs text-sagegray">ล่าสุด {bangkokDate(service.last_used_at)}</p></div><div className="text-right"><p className="font-semibold">{service.usage_count} ครั้ง</p><p className="mt-0.5 text-xs text-sagegray">฿{baht(service.total_spend)}</p></div></div>)}</section>
        <section className="card overflow-hidden"><div className="border-b border-mist px-5 py-4"><p className="section-title">ประวัติการมาใช้บริการ</p><p className="section-note">สรุปรายการล่าสุด ไม่มีเลขบิลหรือการพิมพ์ใบเสร็จ</p></div>{visits.length === 0 ? <Empty text="ลูกค้ารายนี้ยังไม่มีบิลที่ชำระแล้ว" /> : visits.map((visit, index) => <div key={`${visit.paid_at}-${index}`} className="grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-mist px-5 py-3.5 last:border-b-0"><div className="min-w-0"><p className="truncate font-semibold">{visit.items || 'ไม่มีรายละเอียดรายการ'}</p><p className="mt-1 text-xs text-sagegray">{bangkokDateTime(visit.paid_at)}</p></div><span className="font-semibold tabular-nums">฿{baht(visit.total)}</span></div>)}</section>
      </div>

      <aside className="card h-fit overflow-hidden xl:sticky xl:top-8"><div className="flex items-start justify-between gap-4 border-b border-mist px-5 py-4"><div><p className="section-title">โน้ตบริการ</p><p className="section-note">ข้อมูลที่ช่วยให้ดูแลลูกค้าได้ตรงใจ</p></div><button onClick={addNote} disabled={savingNote} className="btn-rose shrink-0 disabled:opacity-40">{savingNote ? 'กำลังบันทึก…' : 'เพิ่มโน้ต'}</button></div>{notes.length === 0 ? <Empty text="ยังไม่มีโน้ตสำหรับลูกค้ารายนี้" /> : <div className="divide-y divide-mist">{notes.map((note) => <article key={note.id} className="px-5 py-4"><div className="flex items-start justify-between gap-3"><p className="whitespace-pre-wrap text-sm leading-6 text-ink">{note.note}</p>{note.can_delete && <button onClick={() => deleteNote(note)} disabled={deletingNoteId === note.id} className="min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-danger transition hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-40">{deletingNoteId === note.id ? 'กำลังลบ…' : 'ลบ'}</button>}</div><p className="mt-2 text-xs text-sagegray">โดย {note.created_by} · {bangkokDateTime(note.created_at)}</p></article>)}</div>}</aside>
    </div>
  </StaffShell>
}

function Stat({ label, value }) { return <div className="card min-h-28 p-4 sm:p-5"><p className="text-xs font-semibold text-sagegray">{label}</p><p className="mt-3 text-xl font-bold sm:text-2xl">{value}</p></div> }
function Empty({ text }) { return <div className="p-5"><div className="empty-state">{text}</div></div> }
function ArrowLeftIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg> }
function DetailSkeleton() { return <div className="animate-pulse"><div className="mb-5 h-10 w-52 rounded bg-blush/60" /><div className="card mb-5 h-32 bg-white" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{[1, 2, 3].map((number) => <div key={number} className="card h-28 bg-white" />)}</div></div> }
