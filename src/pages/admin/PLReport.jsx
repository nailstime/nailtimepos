import { useCallback, useEffect, useState } from "react"
import * as XLSX from "xlsx"
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

const INCOME_ROWS = [
  { key: "service_sales",   label: "ค่าบริการ (POS)" },
  { key: "product_sales",   label: "ค่าสินค้า (POS)" },
  { key: "rent_received",   label: "ค่าเช่า" },
  { key: "interest_income", label: "ดอกเบี้ยรับ" },
  { key: "other_income",    label: "รายรับอื่น" },
]

const EXPENSE_ROWS = [
  { key: "water",              label: "ค่าน้ำ" },
  { key: "electricity",        label: "ค่าไฟ" },
  { key: "internet",           label: "ค่าอินเตอร์เนต" },
  { key: "phone",              label: "ค่าโทรศัพท์" },
  { key: "product_cost",       label: "ต้นทุนสินค้า" },
  { key: "service_cost",       label: "ต้นทุนค่าบริการ" },
  { key: "salary",             label: "เงินเดือน" },
  { key: "commission_expense", label: "ค่าคอมมิชชั่น" },
  { key: "regular_expense",    label: "รายจ่ายประจำ" },
  { key: "other_expense",      label: "รายจ่ายอื่นๆ" },
  { key: "interest_fee",       label: "ดอกเบี้ย/ค่าธรรมเนียม" },
  { key: "refund",             label: "คืนเงินลูกค้า" },
]

function exportToExcel(month, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit) {
  const label = monthLabel(month)
  const rows = []

  rows.push(["งบกำไร-ขาดทุน", label])
  rows.push([])
  rows.push(["รายรับ", "จำนวน (บาท)"])
  for (const r of INCOME_ROWS) {
    const v = num(inc[r.key])
    if (v !== 0) rows.push([r.label, v])
  }
  rows.push(["รวมรายรับ", totalIncome])
  if (ownerDeposit > 0) rows.push(["เงินนำเข้าบัญชี (Owner) *ไม่รวมในรายรับ", ownerDeposit])
  rows.push([])
  rows.push(["รายจ่าย", "จำนวน (บาท)"])
  for (const r of EXPENSE_ROWS) {
    const v = num(exp[r.key])
    if (v !== 0) rows.push([r.label, v])
  }
  rows.push(["รวมรายจ่าย", totalExpense])
  rows.push([])
  rows.push(["กำไรสุทธิ", netProfit])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws["!cols"] = [{ wch: 36 }, { wch: 18 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "P&L")
  XLSX.writeFile(wb, `PL_${month}.xlsx`)
}

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

  const totalIncome = INCOME_ROWS.reduce((s, r) => s + num(inc[r.key]), 0)
  const totalExpense = EXPENSE_ROWS.reduce((s, r) => s + num(exp[r.key]), 0)
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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="เดือนก่อน" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-ghost min-h-10 px-3 text-lg leading-none">‹</button>
            <span className="min-w-[9rem] text-center text-sm font-semibold">{monthLabel(month)}</span>
            <button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth()} className="btn-ghost min-h-10 px-3 text-lg leading-none">›</button>
          </div>
          {report && (
            <button
              type="button"
              onClick={() => exportToExcel(month, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit)}
              className="btn-ghost flex items-center gap-1.5 text-sm"
            >
              <span>↓</span> Excel
            </button>
          )}
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
              {INCOME_ROWS.map((r) => <PLRow key={r.key} label={r.label} value={inc[r.key]} />)}
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
              {EXPENSE_ROWS.map((r) => <PLRow key={r.key} label={r.label} value={exp[r.key]} />)}
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
    <div className={`flex items-center justify-between py-2.5 ${total ? "mt-1 border-t border-mist pt-3 font-semibold" : "border-b border-mist/60 text-sm last:border-b-0"}`}>
      <span className={total ? "text-ink" : "text-sagegray"}>{label}</span>
      <span className={`tabular-nums ${total ? "text-ink" : ""}`}>฿{baht(n)}</span>
    </div>
  )
}
