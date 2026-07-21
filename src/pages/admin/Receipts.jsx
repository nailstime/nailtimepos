import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase.js"
import { baht, bangkokDateTime, bangkokDateStr } from "../../lib/format.js"
import { OrderStatusBadge } from "../../components/OrderStatusBadge.jsx"

const PAGE_SIZE = 30

export default function Receipts() {
  const [filters, setFilters] = useState({ query: "", status: "", from: "", to: bangkokDateStr() })
  const [applied, setApplied] = useState(filters)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const requestId = useRef(0)

  async function load({ append = false } = {}) {
    const id = ++requestId.current
    append ? setLoadingMore(true) : setLoading(true)
    setError("")
    const cursor = append ? rows.at(-1) : null
    const { data, error: rpcError } = await supabase.rpc("admin_search_receipts", {
      p_query: applied.query.trim() || null,
      p_status: applied.status || null,
      p_date_from: applied.from || null,
      p_date_to: applied.to || null,
      p_limit: PAGE_SIZE,
      p_cursor_at: cursor?.activity_at || null,
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

  useEffect(() => { load() }, [applied]) // eslint-disable-line react-hooks/exhaustive-deps

  function submit(event) {
    event.preventDefault()
    setRows([])
    setApplied({ ...filters })
  }

  function clearFilters() {
    const next = { query: "", status: "", from: "", to: "" }
    setFilters(next)
    setRows([])
    setApplied(next)
  }

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Sales history</p>
          <h1 className="page-title">ประวัติบิล</h1>
          <p className="page-description">ค้นหา เปิดดู และพิมพ์รายละเอียดบิลย้อนหลังของสาขานี้</p>
        </div>
        {!loading && <span className="badge-neutral">แสดง {rows.length} บิล</span>}
      </div>

      <form onSubmit={submit} className="card mb-5 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_auto]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">เลขบิล ชื่อ หรือเบอร์โทร</span>
            <input className="input" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} placeholder="เช่น 260721-004 หรือ 080…" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">สถานะ</span>
            <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">ทุกสถานะ</option>
              <option value="paid">ชำระแล้ว</option>
              <option value="awaiting_payment">รอชำระ</option>
              <option value="draft">แบบร่าง</option>
              <option value="void">ยกเลิก</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">ตั้งแต่วันที่</span>
            <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">ถึงวันที่</span>
            <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
          <button type="submit" className="btn-rose self-end">ค้นหา</button>
        </div>
        {(applied.query || applied.status || applied.from || applied.to) && (
          <button type="button" onClick={clearFilters} className="mt-3 min-h-10 text-sm font-semibold text-sagegray hover:text-ink">ล้างตัวกรอง</button>
        )}
      </form>

      <section className="card overflow-hidden" aria-live="polite">
        <div className="border-b border-mist px-5 py-4">
          <p className="section-title">รายการบิล</p>
          <p className="section-note">เรียงจากรายการล่าสุด</p>
        </div>

        {loading ? <LoadingRows /> : error ? (
          <div className="p-5">
            <div className="empty-state">
              <p className="font-semibold text-danger">โหลดประวัติบิลไม่สำเร็จ</p>
              <p className="mt-1">{error}</p>
              <button onClick={() => load()} className="btn-ghost mt-4">ลองอีกครั้ง</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5"><div className="empty-state">ไม่พบบิลตามเงื่อนไขที่เลือก</div></div>
        ) : (
          <div>
            <div className="receipt-list-grid hidden gap-4 border-b border-mist bg-porcelain/60 px-5 py-3 text-xs font-semibold text-sagegray lg:grid">
              <span>เลขบิล</span><span>วันที่</span><span>ลูกค้า</span><span className="text-center">สถานะ</span><span className="text-right">ยอดสุทธิ</span>
            </div>
            {rows.map((row) => (
              <Link key={row.id} to={`/admin/receipts/${row.id}`} className="receipt-list-grid grid min-h-20 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-mist px-5 py-4 transition last:border-b-0 hover:bg-porcelain/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose lg:items-center lg:gap-4">
                <div>
                  <p className="font-semibold tabular-nums">{row.order_no}</p>
                  <p className="mt-1 text-xs text-sagegray lg:hidden">{bangkokDateTime(row.activity_at)}</p>
                </div>
                <span className="hidden text-sm text-sagegray lg:block">{bangkokDateTime(row.activity_at)}</span>
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{row.member_name || "ลูกค้าทั่วไป"}</p>
                  <p className="mt-0.5 truncate text-xs text-sagegray">{row.member_phone || `${row.item_count} รายการ`}</p>
                </div>
                <div className="justify-self-start lg:justify-self-center"><OrderStatusBadge status={row.status} /></div>
                <p className="text-right font-semibold tabular-nums">฿{baht(row.total)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {hasMore && !loading && (
        <div className="mt-5 flex justify-center">
          <button onClick={() => load({ append: true })} disabled={loadingMore} className="btn-ghost min-w-36">
            {loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}
          </button>
        </div>
      )}
    </div>
  )
}

function LoadingRows() {
  return <div className="divide-y divide-mist" aria-label="กำลังโหลดประวัติบิล">
    {[1, 2, 3, 4].map((n) => <div key={n} className="grid min-h-20 animate-pulse grid-cols-[1fr_100px] items-center gap-4 px-5"><div className="h-4 rounded bg-blush/60" /><div className="h-7 rounded-full bg-blush/50" /></div>)}
  </div>
}
