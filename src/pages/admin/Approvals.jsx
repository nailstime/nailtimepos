import { useEffect, useState, useCallback } from "react"
import { supabase } from "../../lib/supabase"
import { baht } from "../../lib/format"

export default function Approvals() {
  const [reqs, setReqs] = useState([])
  const [err, setErr] = useState("")

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("approval_requests")
      .select("*, orders(order_no, total, subtotal), staff:requested_by(name)")
      .order("created_at", { ascending: false }).limit(30)
    setReqs(data || [])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel("approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load])

  async function decide(id, approve) {
    setErr("")
    const { error } = await supabase.rpc("decide_approval", {
      p_request: id, p_approve: approve,
    })
    if (error) setErr(error.message)
    load()
  }

  const pending = reqs.filter((r) => r.status === "pending")
  const decided = reqs.filter((r) => r.status !== "pending")
  const typeLabel = { discount: "ส่วนลด", void: "ยกเลิกบิล" }

  return (
    <div className="w-full">
      <div className="page-heading"><div><p className="page-eyebrow">Approval queue</p><h1 className="page-title">คำขออนุมัติ</h1><p className="page-description">ตรวจสอบส่วนลดและการยกเลิกบิลก่อนอนุมัติ</p></div><span className={pending.length ? "badge-rose" : "badge-neutral"}>{pending.length} รายการรอ</span></div>
      {err && <p role="alert" className="mb-4 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">{err}</p>}
      <section className="card mb-5 overflow-hidden">
        <div className="border-b border-mist px-5 py-4"><p className="section-title">รออนุมัติ</p><p className="section-note">ตรวจเหตุผลและยอดบิลก่อนตัดสินใจ</p></div>
        {pending.length === 0 && <div className="empty-state m-5">ไม่มีคำขอค้าง</div>}
        <div className="grid gap-4 p-5 md:grid-cols-2 2xl:grid-cols-3">
        {pending.map((r) => (
          <article key={r.id} className="soft-panel flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold">
                {typeLabel[r.type]} · บิล {r.orders?.order_no}
                {r.type === "discount" && <> · ฿{baht(r.amount)}</>}
              </p>
              <span className="badge-neutral shrink-0">{r.staff?.name}</span>
            </div>
            <p className="mt-3 flex-1 text-sm leading-6 text-sagegray">เหตุผล: {r.reason}<br />ยอดบิล ฿{baht(r.orders?.total)}</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => decide(r.id, true)} className="btn-rose text-sm flex-1">อนุมัติ</button>
              <button onClick={() => decide(r.id, false)} className="btn-danger text-sm flex-1">ปฏิเสธ</button>
            </div>
          </article>
        ))}
        </div>
      </section>
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">ประวัติการตัดสินใจ</p><p className="section-note">รายการล่าสุดไม่เกิน 30 คำขอ</p></div><span className="badge-neutral">{decided.length}</span></div>
        <div className="px-5 py-2">
        {decided.map((r) => (
          <div key={r.id} className="data-row grid-cols-[minmax(0,1fr)_auto] text-sm">
            <span className="font-semibold">{typeLabel[r.type]} · {r.orders?.order_no}{r.type === "discount" ? ` · ฿${baht(r.amount)}` : ""}</span>
            <span className={r.status === "approved" ? "badge-success" : "badge-neutral"}>
              {r.status === "approved" ? "อนุมัติ" : "ปฏิเสธ"}
            </span>
          </div>
        ))}
        {decided.length === 0 && <div className="empty-state my-3">ยังไม่มีประวัติ</div>}
        </div>
      </section>
    </div>
  )
}
