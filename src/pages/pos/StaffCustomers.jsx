import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { baht, bangkokDate } from '../../lib/format.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { BrandMark } from '../../components/Brand.jsx'

const PAGE_SIZE = 30

export default function StaffCustomers() {
  const { staff, logout } = useAuth()
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  async function load({ append = false, search = appliedQuery } = {}) {
    const id = ++requestId.current
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    const cursor = append ? rows.at(-1) : null
    const { data, error: rpcError } = await supabase.rpc('staff_search_customers', {
      p_query: search.trim() || null,
      p_limit: PAGE_SIZE,
      p_cursor_joined_at: cursor?.joined_at || null,
      p_cursor_id: cursor?.id || null,
    })
    if (id !== requestId.current) return
    const items = data?.items || []
    if (rpcError) setError(rpcError.message)
    else {
      setRows((current) => append ? [...current, ...items] : items)
      setHasMore(items.length === PAGE_SIZE)
    }
    setLoading(false)
    setLoadingMore(false)
  }

  useEffect(() => { load({ search: '' }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Keep partial-name and partial-phone search responsive without a request
    // per keystroke. Invalidating the current request also avoids stale rows.
    if (query === appliedQuery) return
    const timer = window.setTimeout(() => {
      setRows([])
      setAppliedQuery(query)
      load({ search: query })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, appliedQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearSearch() {
    setQuery('')
    setAppliedQuery('')
    setRows([])
    load({ search: '' })
  }

  return (
    <StaffShell staff={staff} logout={logout}>
      <div className="page-heading">
        <div>
          <Link to="/pos" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-sagegray transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"><ArrowLeftIcon /> กลับหน้าขาย</Link>
          <p className="page-eyebrow mt-2">Customer care</p>
          <h1 className="page-title">ข้อมูลลูกค้า</h1>
          <p className="page-description">ดูสิ่งที่ลูกค้าชอบใช้และโน้ตการบริการ เพื่อดูแลครั้งถัดไปให้ตรงใจ</p>
        </div>
        {!loading && <span className="badge-neutral">แสดง {rows.length} คน</span>}
      </div>

      <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-sagegray">ค้นหาลูกค้า</span>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ชื่อหรือเบอร์โทรศัพท์" autoComplete="off" />
        </label>
        {appliedQuery && <button type="button" onClick={clearSearch} className="btn-ghost">ล้าง</button>}
      </div>

      <section className="card overflow-hidden" aria-live="polite">
        <div className="border-b border-mist px-5 py-4">
          <p className="section-title">รายชื่อลูกค้า</p>
          <p className="section-note">เปิดเพื่อดูโน้ตและประวัติบริการแบบสรุป — ไม่มีใบเสร็จหรือปุ่มพิมพ์ซ้ำ</p>
        </div>
        {loading ? <Skeleton /> : error ? (
          <div className="p-5"><div className="empty-state"><p className="font-semibold text-danger">โหลดข้อมูลลูกค้าไม่สำเร็จ</p><p className="mt-1">{error}</p><button onClick={() => load()} className="btn-ghost mt-4">ลองอีกครั้ง</button></div></div>
        ) : rows.length === 0 ? (
          <div className="p-5"><div className="empty-state"><p className="font-semibold text-ink">ยังไม่พบลูกค้า</p><p className="mt-1">ลองค้นหาด้วยชื่อหรือเบอร์โทรศัพท์</p></div></div>
        ) : <>
          <div className="hidden grid-cols-[minmax(180px,1.2fr)_100px_130px_minmax(160px,1fr)_145px] gap-4 border-b border-mist bg-porcelain/60 px-5 py-3 text-xs font-semibold text-sagegray lg:grid">
            <span>ลูกค้า</span><span className="text-right">จำนวนบิล</span><span className="text-right">ยอดรวม</span><span>บริการที่ใช้บ่อย</span><span>มาล่าสุด</span>
          </div>
          {rows.map((customer) => (
            <Link key={customer.id} to={`/pos/customers/${customer.id}`} className="block min-h-20 cursor-pointer border-b border-mist px-5 py-4 transition last:border-b-0 hover:bg-porcelain/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose lg:grid lg:grid-cols-[minmax(180px,1.2fr)_100px_130px_minmax(160px,1fr)_145px] lg:items-center lg:gap-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{customer.name}</p>{customer.line_linked ? <span className="badge-success">LINE</span> : <span className="badge-neutral">ยังไม่ผูก LINE</span>}</div><p className="mt-1 text-xs text-sagegray">{customer.phone}</p></div>
              <div className="mt-4 lg:mt-0 lg:text-right"><p className="text-xs text-sagegray lg:hidden">จำนวนบิล</p><p className="mt-1 font-semibold lg:mt-0">{customer.paid_bills}</p></div>
              <div className="mt-3 text-right lg:mt-0"><p className="text-xs text-sagegray lg:hidden">ยอดใช้จ่ายรวม</p><p className="mt-1 font-semibold lg:mt-0">฿{baht(customer.lifetime_spend)}</p></div>
              <div className="mt-4 lg:mt-0"><p className="text-xs text-sagegray lg:hidden">บริการที่ใช้บ่อย</p><p className="mt-1 text-sm font-medium lg:mt-0">{customer.favorite_service || 'ยังไม่มีข้อมูล'}{customer.favorite_service_count ? ` · ${customer.favorite_service_count} ครั้ง` : ''}</p></div>
              <div className="mt-3 text-sm text-sagegray lg:mt-0">{customer.last_visit ? bangkokDate(customer.last_visit) : 'ยังไม่เคยชำระ'}</div>
            </Link>
          ))}
        </>}
      </section>

      {hasMore && !loading && <div className="mt-5 flex justify-center"><button onClick={() => load({ append: true })} disabled={loadingMore} className="btn-ghost min-w-36">{loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}</button></div>}
    </StaffShell>
  )
}

export function StaffShell({ staff, logout, children }) {
  return <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_rgba(169,79,97,0.07),_transparent_32%),#f7f4f2]">
    <header className="sticky top-0 z-20 border-b border-mist bg-white/90 backdrop-blur-xl"><div className="page-shell flex min-h-16 items-center justify-between px-4 sm:px-6 lg:px-8"><BrandMark compact /><div className="flex items-center gap-1 rounded-xl border border-mist bg-porcelain px-1.5 py-1 text-sm"><span className="hidden px-2 font-semibold text-ink sm:block">{staff.name}</span><button onClick={logout} className="min-h-9 rounded-lg px-3 font-medium text-sagegray transition hover:bg-white hover:text-danger">ออก</button></div></div></header>
    <main className="page-shell px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
  </div>
}

function ArrowLeftIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}

function Skeleton() {
  return <div className="divide-y divide-mist" aria-label="กำลังโหลดรายชื่อลูกค้า">{[1, 2, 3, 4].map((number) => <div key={number} className="grid min-h-20 animate-pulse grid-cols-[1fr_120px] items-center gap-4 px-5"><div className="h-4 rounded bg-blush/60" /><div className="h-4 rounded bg-blush/50" /></div>)}</div>
}
