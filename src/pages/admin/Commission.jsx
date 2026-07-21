import { useEffect, useState, useCallback } from "react"
import { supabase } from "../../lib/supabase"
import { baht, bangkokMonthStr } from "../../lib/format"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

const thisMonth = () => bangkokMonthStr()
const nextMonth = () => {
  const [year, month] = bangkokMonthStr().split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function Commission() {
  const [month, setMonth] = useState(thisMonth())
  const [report, setReport] = useState(null)
  const [branchId, setBranchId] = useState(null)
  const [nextMode, setNextMode] = useState("per_service")
  const [tiers, setTiers] = useState([{ min_amount: "0", max_amount: "", pct: "3" }])
  const [msg, setMsg] = useState("")

  const load = useCallback(async (m) => {
    const { data: br } = await supabase.from("branches").select("id").limit(1).single()
    setBranchId(br.id)
    const { data } = await supabase.rpc("commission_report", { p_month: m })
    setReport(data)
    const { data: cs } = await supabase.from("commission_settings")
      .select("mode").eq("branch_id", br.id).eq("effective_month", nextMonth()).maybeSingle()
    if (cs) setNextMode(cs.mode)
  }, [])
  useEffect(() => { load(month) }, [month, load])

  async function saveNextMonth() {
    setMsg("")
    const em = nextMonth()
    const payload = tiers.filter((t) => t.pct !== "").map((t) => ({
      min_amount: Number(t.min_amount || 0),
      max_amount: t.max_amount === "" ? null : Number(t.max_amount),
      pct: Number(t.pct),
    }))
    const { error } = await supabase.rpc("save_commission_configuration", {
      p_effective_month: em,
      p_mode: nextMode,
      p_tiers: nextMode === "tiered_monthly" ? payload : [],
    })
    if (error) return setMsg(error.message)
    setMsg(`บันทึกแล้ว — มีผลเดือน ${em} (เดือนปัจจุบันไม่เปลี่ยน)`)
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">Commission</p><h1 className="page-title">ค่าคอมมิชชัน</h1><p className="page-description">ดูรายงานรายเดือนและตั้งกติกาสำหรับรอบเดือนถัดไป</p></div></div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="section-title">รายงานค่าคอม</p><p className="section-note">เลือกเดือนที่ต้องการตรวจสอบ</p></div>
          <input aria-label="เดือนรายงาน" type="month" className="input sm:w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="p-5">
        {report && (
          <>
            <p className="mb-3 rounded-xl bg-porcelain px-3 py-2 text-sm text-sagegray">
              โหมดเดือนนี้: {report.mode === "per_service" ? "คิดต่อบริการ (Mode A)" : "Tier ยอดรวมรายเดือน (Mode B)"}
            </p>
            {(report.rows || []).length === 0 && <div className="empty-state">ยังไม่มีข้อมูล</div>}
            {(report.rows || []).map((r) => (
              <div key={r.technician} className="data-row grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto]">
                <span className="font-semibold">ช่าง{r.technician}</span>
                <span className="text-sagegray text-sm">
                  ยอด ฿{baht(r.total_sales)}{r.tier_pct != null ? ` · tier ${r.tier_pct}%` : ""}
                </span>
                <span className="text-right font-bold tabular-nums">฿{baht(r.commission)}</span>
              </div>
            ))}
          </>
        )}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <p className="section-title">ตั้งค่าเดือนถัดไป</p>
        <p className="section-note">รอบ {nextMonth()} · การเปลี่ยนแปลงไม่มีผลกับเดือนปัจจุบัน</p>
        <div className="soft-panel mt-5 grid grid-cols-1 gap-2 p-1.5 sm:grid-cols-2">
          <button onClick={() => setNextMode("per_service")}
            className={(nextMode === "per_service" ? "btn-rose" : "btn-ghost") + " text-sm"}>
            Mode A · ต่อบริการ
          </button>
          <button onClick={() => setNextMode("tiered_monthly")}
            className={(nextMode === "tiered_monthly" ? "btn-rose" : "btn-ghost") + " text-sm"}>
            Mode B · Tier ยอดรวม
          </button>
        </div>
        {nextMode === "tiered_monthly" && (
          <div className="mb-4 mt-4 space-y-3">
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-mist p-3 sm:grid-cols-[1fr_1fr_100px_auto]">
                <input className="input" placeholder="ตั้งแต่ (บาท)" inputMode="decimal" value={t.min_amount}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, min_amount: e.target.value } : x))} />
                <input className="input" placeholder="น้อยกว่า (ว่าง=ไม่จำกัด)" inputMode="decimal" value={t.max_amount}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, max_amount: e.target.value } : x))} />
                <input className="input" placeholder="%" inputMode="decimal" value={t.pct}
                  onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} />
                <button className="btn-danger text-sm" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>ลบ</button>
              </div>
            ))}
            <button className="btn-ghost text-sm"
              onClick={() => setTiers([...tiers, { min_amount: "", max_amount: "", pct: "" }])}>
              + เพิ่ม tier
            </button>
          </div>
        )}
        <button onClick={saveNextMonth} className="btn-rose w-full">บันทึก (มีผลเดือนถัดไป)</button>
        {msg && <p role="status" className="mt-3 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">{msg}</p>}
      </section>
      </div>
    </div>
  )
}
