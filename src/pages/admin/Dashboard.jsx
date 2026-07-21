import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht, bangkokDateStr, bangkokDayRange, bangkokTime, todayStr } from "../../lib/format"

export default function Dashboard() {
  const [orders, setOrders] = useState([])
  const [byTech, setByTech] = useState([])

  useEffect(() => {
    ;(async () => {
      const today = bangkokDateStr()
      const range = bangkokDayRange(today)
      const { data: o } = await supabase
        .from("orders")
        .select("id, order_no, total, paid_at, status, member_id, payments(confirmed_by_staff_id)")
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: false })
      setOrders(o || [])

      const { data: items } = await supabase
        .from("order_items")
        .select("price_snapshot, qty, technician_id, staff:technician_id(name), orders!inner(status, paid_at)")
        .eq("orders.status", "paid")
        .gte("orders.paid_at", range.start)
        .lt("orders.paid_at", range.end)
      const map = {}
      for (const it of items || []) {
        const k = it.staff?.name || "-"
        map[k] = (map[k] || 0) + it.price_snapshot * it.qty
      }
      setByTech(Object.entries(map))
    })()
  }, [])

  const paid = orders.filter((o) => o.status === "paid")
  const total = paid.reduce((s, o) => s + Number(o.total), 0)
  const members = paid.filter((o) => o.member_id).length

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Overview</p>
          <h1 className="page-title">ภาพรวมร้านวันนี้</h1>
          <p className="page-description">ยอดขายและการทำงานของทีม อัปเดตจากรายการที่ชำระแล้ว</p>
        </div>
        <span className="badge-neutral self-start sm:self-auto">{todayStr()}</span>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ยอดขายวันนี้" value={"฿" + baht(total)} />
        <Stat label="จำนวนบิล" value={paid.length} />
        <Stat label="บิลสมาชิก" value={members} />
        <Stat label="Walk-in" value={paid.length - members} />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-mist px-5 py-4">
            <div><p className="section-title">บิลวันนี้</p><p className="section-note">เฉพาะรายการที่ชำระสำเร็จ</p></div>
            <span className="badge-neutral">{paid.length} บิล</span>
          </div>
          <div className="px-5 py-2">
            {paid.length === 0 && <div className="empty-state my-3">ยังไม่มีบิลชำระแล้ววันนี้</div>}
            {paid.map((o) => (
              <div key={o.id} className="data-row grid-cols-[1fr_auto_auto] text-sm">
                <span className="font-semibold">{o.order_no}</span>
                <span className="text-sagegray">{bangkokTime(o.paid_at)}</span>
                <span className="min-w-24 text-right font-bold tabular-nums">฿{baht(o.total)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card overflow-hidden">
          <div className="border-b border-mist px-5 py-4">
            <p className="section-title">ยอดต่อช่าง</p>
            <p className="section-note">ยอดบริการที่ชำระแล้ววันนี้</p>
          </div>
          <div className="px-5 py-2">
            {byTech.length === 0 && <div className="empty-state my-3">ยังไม่มียอดบริการของช่าง</div>}
            {byTech.map(([name, amt]) => (
              <div key={name} className="data-row grid-cols-[1fr_auto] text-sm">
                <span className="font-semibold">ช่าง{name}</span><span className="font-bold tabular-nums">฿{baht(amt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card relative overflow-hidden p-4 sm:p-5">
      <span className="absolute right-4 top-4 h-2 w-2 rounded-full bg-rose/50" />
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sagegray">{label}</p>
      <p className="mt-3 font-display text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
    </div>
  )
}
