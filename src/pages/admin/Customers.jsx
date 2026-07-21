import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase.js"
import { baht, bangkokDate, dateOnlyThai } from "../../lib/format.js"

const PAGE_SIZE = 30

export default function Customers() {
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const requestId = useRef(0)

  async function load({ append = false, search = appliedQuery } = {}) {
    const id = ++requestId.current
    append ? setLoadingMore(true) : setLoading(true)
    setError("")
    const cursor = append ? rows.at(-1) : null
    const { data, error: rpcError } = await supabase.rpc("admin_search_customers", {
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

  useEffect(() => { load({ search: "" }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Search after a brief pause so typing a partial name or phone number is
    // immediate to the user without causing a request for every character.
    if (query === appliedQuery) return
    const timer = window.setTimeout(() => {
      setRows([])
      setAppliedQuery(query)
      load({ search: query })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, appliedQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  function clearSearch() {
    setQuery("")
    setAppliedQuery("")
    setRows([])
    load({ search: "" })
  }

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Customer CRM</p>
          <h1 className="page-title">ลูกค้า</h1>
          <p className="page-description">ดูยอดใช้จ่าย จำนวนบิล บริการที่ชอบ และข้อมูลวันเกิดแบบรายบุคคล</p>
        </div>
        {!loading && <span className="badge-neutral">แสดง {rows.length} คน</span>}
      </div>

      <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-sagegray">ค้นหาลูกค้า</span>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อหรือเบอร์โทรศัพท์" />
        </label>
        {appliedQuery && <button type="button" onClick={clearSearch} className="btn-ghost">ล้าง</button>}
      </div>

      <section className="card overflow-hidden" aria-live="polite">
        <div className="border-b border-mist px-5 py-4">
          <p className="section-title">รายชื่อลูกค้า</p>
          <p className="section-note">กดที่รายชื่อเพื่อดูประวัติทั้งหมด</p>
        </div>
        {loading ? <CustomerSkeleton /> : error ? (
          <div className="p-5"><div className="empty-state"><p className="font-semibold text-danger">โหลดข้อมูลลูกค้าไม่สำเร็จ</p><p className="mt-1">{error}</p><button onClick={() => load()} className="btn-ghost mt-4">ลองอีกครั้ง</button></div></div>
        ) : rows.length === 0 ? (
          <div className="p-5"><div className="empty-state"><p className="font-semibold text-ink">ยังไม่พบลูกค้า</p><p className="mt-1">ลูกค้าจะปรากฏที่นี่เมื่อผูกสมาชิกกับบิล หรือเมื่อมีข้อมูลสมาชิกในระบบ</p></div></div>
        ) : <>
          <div className="hidden grid-cols-[minmax(180px,1.3fr)_100px_130px_minmax(160px,1fr)_150px] gap-4 border-b border-mist bg-porcelain/60 px-5 py-3 text-xs font-semibold text-sagegray lg:grid">
            <span>ลูกค้า</span><span className="text-right">จำนวนบิล</span><span className="text-right">ยอดรวม</span><span>บริการที่ชอบ</span><span>มาล่าสุด</span>
          </div>
          {rows.map((customer) => (
            <Link key={customer.id} to={`/admin/customers/${customer.id}`} className="block cursor-pointer border-b border-mist px-5 py-4 transition last:border-b-0 hover:bg-porcelain/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose lg:grid lg:min-h-20 lg:grid-cols-[minmax(180px,1.3fr)_100px_130px_minmax(160px,1fr)_150px] lg:items-center lg:gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><p className="truncate font-semibold">{customer.name}</p>{customer.line_linked && <span className="badge-success">LINE</span>}</div>
                <p className="mt-1 text-xs text-sagegray">{customer.phone} · วันเกิด {dateOnlyThai(customer.birth_date)}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:contents">
                <div className="lg:text-right"><p className="text-xs text-sagegray lg:hidden">จำนวนบิล</p><p className="mt-1 font-semibold lg:mt-0">{customer.paid_bills}</p></div>
                <div className="text-right"><p className="text-xs text-sagegray lg:hidden">ยอดใช้จ่ายรวม</p><p className="mt-1 font-semibold lg:mt-0">฿{baht(customer.lifetime_spend)}</p></div>
              </div>
              <div className="mt-4 lg:mt-0"><p className="text-xs text-sagegray lg:hidden">บริการที่ใช้บ่อย</p><p className="mt-1 text-sm font-medium lg:mt-0">{customer.favorite_service || "ยังไม่มีข้อมูล"}{customer.favorite_service_count ? ` · ${customer.favorite_service_count} ครั้ง` : ""}</p></div>
              <div className="mt-3 text-sm text-sagegray lg:mt-0">{customer.last_visit ? bangkokDate(customer.last_visit) : "ยังไม่เคยชำระ"}</div>
            </Link>
          ))}
        </>}
      </section>

      {hasMore && !loading && <div className="mt-5 flex justify-center"><button onClick={() => load({ append: true })} disabled={loadingMore} className="btn-ghost min-w-36">{loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}</button></div>}
    </div>
  )
}

function CustomerSkeleton() {
  return <div className="divide-y divide-mist" aria-label="กำลังโหลดรายชื่อลูกค้า">{[1, 2, 3, 4].map((n) => <div key={n} className="grid min-h-20 animate-pulse grid-cols-[1fr_120px] items-center gap-4 px-5"><div className="h-4 rounded bg-blush/60" /><div className="h-4 rounded bg-blush/50" /></div>)}</div>
}
