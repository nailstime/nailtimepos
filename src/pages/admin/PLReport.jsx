import { useCallback, useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht, bangkokMonthStr } from "../../lib/format"

const thisMonth = () => bangkokMonthStr()

const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" })
}

const shiftMonth = (m, delta) => {
  const [y, mo] = m.split("-").map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

const num = (v) => Number(v || 0)

export default function PLReport() {
  const [month, setMonth] = useState(thisMonth())
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (m) => {
    setLoading(true)
    setError("")
    setReport(null)
    const { data, error: rpcError } = await supabase.rpc("get_pl_report", { p_month: m })
    if (rpcError) setError(rpcError.message)
    else setReport(data)
    setLoading(false)
  }, [])

  useEffect(() => { load(month) }, [month, load])

  const inc = report?.income || {}
  const exp = report?.expense || {}

  const totalIncome = num(inc.service_sales) + num(inc.product_sales) + num(inc.other_income) + num(inc.rent_received) + num(inc.interest_income)
  const totalExpense = num(exp.water) + num(exp.electricity) + num(exp.internet) + num(exp.phone) + num(exp.product_cost) + num(exp.service_cost) + num(exp.regular_expense) + num(exp.other_expense) + num(exp.interest_fee) + num(exp.refund)
  const netProfit = totalIncome - totalExpense
  const ownerDeposit = num(inc.owner_deposit)

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Finance</p>
          <h1 className="page-title">กำไร-ขาดทุน</h1>
          <p className="page-description">สรุปรายรับ-รายจ่ายรายเดือน จากยอด POS และรายการกระทบยอดธนาคาร</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="เดือนก่อน" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-ghost min-h-10 px-3 text-lg leading-none">‹</button>
          <span className="min-w-[9rem] text-center text-sm font-semibold">{monthLabel(month)}</span>
          <button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth()} className="btn-ghost min-h-10 px-3 text-lg leading-none">›</button>
        </div>
      </div>

      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}

      {loading && <div className="card p-10 text-center text-sm text-sagegray">กำลังโหลด…</div>}

      {!loading && report && <>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="รายรับรวม" value={totalIncome} color="success" />
          <SummaryCard label="รายจ่ายรวม" value={totalExpense} color="danger" />
          <SummaryCard label="กำไรสุทธิ" value={netProfit} color={netProfit >= 0 ? "ink" : "danger"} large />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-2">
          <section className="card overflow-hidden">
            <div className="border-b border-mist bg-success/5 px-5 py-4">
              <p className="section-title text-success">รายรับ</p>
              <p className="section-note">ค่าบริการ/สินค้า POS + รายรับจากบัญชีธนาคาร</p>
            </div>
            <div className="px-5 py-2">
              <PLRow label="ค่าบริการ (POS)" value={inc.service_sales} />
              <PLRow label="ค่าสินค้า (POS)" value={inc.product_sales} />
              <PLRow label="ค่าเช่า" value={inc.rent_received} />
              <PLRow label="ดอกเบี้ยรับ" value={inc.interest_income} />
              <PLRow label="รายรับอื่น" value={inc.other_income} />
              <PLRow label="รวมรายรับ" value={totalIncome} total />
            </div>
            {ownerDeposit > 0 && (
              <div className="border-t border-mist px-5 py-3">
                <div className="flex items-center justify-between text-sm text-sagegray">
                  <span>เงินนำเข้าบัญชี (Owner) · ไม่รวมในรายรับ</span>
                  <span className="tabular-nums">฿{baht(ownerDeposit)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-mist bg-danger/5 px-5 py-4">
              <p className="section-title text-danger">รายจ่าย</p>
              <p className="section-note">รายจ่ายที่บันทึกในการกระทบยอดธนาคาร</p>
            </div>
            <div className="px-5 py-2">
              <PLRow label="ค่าน้ำ" value={exp.water} />
              <PLRow label="ค่าไฟ" value={exp.electricity} />
              <PLRow label="ค่าอินเตอร์เนต" value={exp.internet} />
              <PLRow label="ค่าโทรศัพท์" value={exp.phone} />
              <PLRow label="ต้นทุนสินค้า" value={exp.product_cost} />
              <PLRow label="ต้นทุนค่าบริการ" value={exp.service_cost} />
              <PLRow label="รายจ่ายประจำ" value={exp.regular_expense} />
              <PLRow label="รายจ่ายอื่นๆ" value={exp.other_expense} />
              <PLRow label="ดอกเบี้ย/ค่าธรรมเนียม" value={exp.interest_fee} />
              <PLRow label="คืนเงินลูกค้า" value={exp.refund} />
              <PLRow label="รวมรายจ่าย" value={totalExpense} total />
            </div>
          </section>
        </div>
      </>}
    </div>
  )
}

function SummaryCard({ label, value, color, large }) {
  const colorMap = { success: "text-success", danger: "text-danger", ink: "text-ink" }
  return (
    <div className="card px-5 py-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-sagegray">{label}</p>
      <p className={`mt-2 font-display tabular-nums ${large ? "text-3xl font-bold" : "text-2xl font-semibold"} ${colorMap[color]}`}>
        ฿{baht(value)}
      </p>
    </div>
  )
}

function PLRow({ label, value, total }) {
  const n = num(value)
  if (!total && n === 0) return null
  return (
    <div className={`flex items-center justify-between py-2.5 ${total ? "border-t border-mist mt-1 pt-3 font-semibold" : "border-b border-mist/60 text-sm last:border-b-0"}`}>
      <span className={total ? "text-ink" : "text-sagegray"}>{label}</span>
      <span className={`tabular-nums ${total ? "text-ink" : ""}`}>฿{baht(n)}</span>
    </div>
  )
}
