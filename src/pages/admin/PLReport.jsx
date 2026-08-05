import { useCallback, useEffect, useState } from "react"
import * as XLSX from "xlsx"
import { supabase } from "../../lib/supabase"
import { baht, bangkokMonthStr } from "../../lib/format"

const thisMonth = () => bangkokMonthStr()
const thisYear = () => bangkokMonthStr().slice(0, 4)

const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" })
}
const monthShort = (m) => {
  const [y, mo] = m.split("-").map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString("th-TH", { month: "short" })
}
const shiftMonth = (m, d) => {
  const [y, mo] = m.split("-").map(Number)
  const dt = new Date(y, mo - 1 + d, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
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

function buildTotals(inc, exp) {
  const totalIncome = INCOME_ROWS.reduce((s, r) => s + num(inc[r.key]), 0)
  const totalExpense = EXPENSE_ROWS.reduce((s, r) => s + num(exp[r.key]), 0)
  return { totalIncome, totalExpense, netProfit: totalIncome - totalExpense }
}

function exportMonthly(month, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit) {
  const rows = [
    ["งบกำไร-ขาดทุน", monthLabel(month)],
    [],
    ["รายรับ", "จำนวน (บาท)"],
  ]
  for (const r of INCOME_ROWS) {
    const v = num(inc[r.key])
    if (v !== 0) rows.push([r.label, v])
  }
  rows.push(["รวมรายรับ", totalIncome])
  if (ownerDeposit > 0) rows.push(["เงินนำเข้าบัญชี (Owner) *ไม่รวมในรายรับ", ownerDeposit])
  rows.push([], ["รายจ่าย", "จำนวน (บาท)"])
  for (const r of EXPENSE_ROWS) {
    const v = num(exp[r.key])
    if (v !== 0) rows.push([r.label, v])
  }
  rows.push(["รวมรายจ่าย", totalExpense], [], ["กำไรสุทธิ", netProfit])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws["!cols"] = [{ wch: 36 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "P&L")
  XLSX.writeFile(wb, `PL_${month}.xlsx`)
}

function exportYearly(year, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit, months) {
  // Sheet 1: annual totals
  const summaryRows = [
    ["งบกำไร-ขาดทุน", `ปี ${year}`],
    [],
    ["รายรับ", "จำนวน (บาท)"],
  ]
  for (const r of INCOME_ROWS) {
    const v = num(inc[r.key])
    if (v !== 0) summaryRows.push([r.label, v])
  }
  summaryRows.push(["รวมรายรับ", totalIncome])
  if (ownerDeposit > 0) summaryRows.push(["เงินนำเข้าบัญชี (Owner) *ไม่รวมในรายรับ", ownerDeposit])
  summaryRows.push([], ["รายจ่าย", "จำนวน (บาท)"])
  for (const r of EXPENSE_ROWS) {
    const v = num(exp[r.key])
    if (v !== 0) summaryRows.push([r.label, v])
  }
  summaryRows.push(["รวมรายจ่าย", totalExpense], [], ["กำไรสุทธิ", netProfit])

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows)
  ws1["!cols"] = [{ wch: 36 }, { wch: 18 }]

  // Sheet 2: monthly breakdown
  const monthRows = [
    [`รายเดือนปี ${year}`],
    ["เดือน", "ค่าบริการ POS", "ค่าสินค้า POS", "รายรับรวม", "รายจ่ายรวม", "กำไรสุทธิ"],
  ]
  let sumInc = 0, sumExp = 0, sumNet = 0
  for (const m of months) {
    monthRows.push([
      monthShort(m.month),
      num(m.service_sales),
      num(m.product_sales),
      num(m.total_income),
      num(m.total_expense),
      num(m.net_profit),
    ])
    sumInc += num(m.total_income)
    sumExp += num(m.total_expense)
    sumNet += num(m.net_profit)
  }
  monthRows.push(["รวมทั้งปี", "", "", sumInc, sumExp, sumNet])

  const ws2 = XLSX.utils.aoa_to_sheet(monthRows)
  ws2["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, "สรุปรายปี")
  XLSX.utils.book_append_sheet(wb, ws2, "รายเดือน")
  XLSX.writeFile(wb, `PL_${year}.xlsx`)
}

export default function PLReport() {
  const [mode, setMode] = useState("month")
  const [month, setMonth] = useState(thisMonth())
  const [year, setYear] = useState(thisYear())
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (m, mo, yr) => {
    setLoading(true)
    setError("")
    setReport(null)
    const { data, error: rpcError } = m === "month"
      ? await supabase.rpc("get_pl_report", { p_month: mo })
      : await supabase.rpc("get_pl_report_year", { p_year: yr })
    if (rpcError) setError(rpcError.message)
    else setReport(data)
    setLoading(false)
  }, [])

  useEffect(() => { load(mode, month, year) }, [mode, month, year, load])

  const inc = report?.income || {}
  const exp = report?.expense || {}
  const { totalIncome, totalExpense, netProfit } = buildTotals(inc, exp)
  const ownerDeposit = num(inc.owner_deposit)
  const months = report?.months || []

  function handleExport() {
    if (mode === "month") exportMonthly(month, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit)
    else exportYearly(year, inc, exp, totalIncome, totalExpense, netProfit, ownerDeposit, months)
  }

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Finance</p>
          <h1 className="page-title">กำไร-ขาดทุน</h1>
          <p className="page-description">สรุปรายรับ-รายจ่ายจากยอด POS และรายการกระทบยอดธนาคาร</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-mist bg-porcelain p-0.5">
            <button type="button" onClick={() => setMode("month")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mode === "month" ? "bg-white text-ink shadow-sm" : "text-sagegray hover:text-ink"}`}>รายเดือน</button>
            <button type="button" onClick={() => setMode("year")}  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${mode === "year"  ? "bg-white text-ink shadow-sm" : "text-sagegray hover:text-ink"}`}>รายปี</button>
          </div>

          {mode === "month" ? (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="เดือนก่อน" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-ghost min-h-9 px-3 text-lg leading-none">‹</button>
              <span className="min-w-[9rem] text-center text-sm font-semibold">{monthLabel(month)}</span>
              <button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth()} className="btn-ghost min-h-9 px-3 text-lg leading-none">›</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="ปีก่อน" onClick={() => setYear((y) => String(Number(y) - 1))} className="btn-ghost min-h-9 px-3 text-lg leading-none">‹</button>
              <span className="min-w-[5rem] text-center text-sm font-semibold">ปี {year}</span>
              <button type="button" aria-label="ปีถัดไป" onClick={() => setYear((y) => String(Number(y) + 1))} disabled={year >= thisYear()} className="btn-ghost min-h-9 px-3 text-lg leading-none">›</button>
            </div>
          )}

          {report && (
            <button type="button" onClick={handleExport} className="btn-ghost flex items-center gap-1.5 text-sm">
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

        {mode === "year" && months.length > 0 && (
          <section className="card mt-5 overflow-hidden">
            <div className="border-b border-mist px-5 py-4">
              <p className="section-title">รายละเอียดรายเดือน</p>
              <p className="section-note">สรุปยอดแต่ละเดือนตลอดปี {year}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-mist bg-porcelain/60 text-xs font-semibold text-sagegray">
                    <th className="px-5 py-3 text-left">เดือน</th>
                    <th className="px-4 py-3 text-right">รายรับรวม</th>
                    <th className="px-4 py-3 text-right">รายจ่ายรวม</th>
                    <th className="px-5 py-3 text-right">กำไรสุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const net = num(m.net_profit)
                    const hasData = num(m.total_income) > 0 || num(m.total_expense) > 0
                    return (
                      <tr key={m.month} className="border-b border-mist/60 last:border-b-0 hover:bg-porcelain/40">
                        <td className={`px-5 py-3 font-semibold ${!hasData ? "text-sagegray/50" : ""}`}>{monthShort(m.month)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${!hasData ? "text-sagegray/40" : "text-success"}`}>฿{baht(m.total_income)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${!hasData ? "text-sagegray/40" : "text-danger"}`}>฿{baht(m.total_expense)}</td>
                        <td className={`px-5 py-3 text-right font-bold tabular-nums ${!hasData ? "text-sagegray/40" : net >= 0 ? "text-ink" : "text-danger"}`}>฿{baht(net)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-mist bg-porcelain/60 font-semibold">
                    <td className="px-5 py-3">รวมทั้งปี</td>
                    <td className="px-4 py-3 text-right tabular-nums text-success">฿{baht(totalIncome)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-danger">฿{baht(totalExpense)}</td>
                    <td className={`px-5 py-3 text-right font-bold tabular-nums ${netProfit >= 0 ? "text-ink" : "text-danger"}`}>฿{baht(netProfit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}
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
