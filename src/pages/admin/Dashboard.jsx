import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../../lib/supabase"
import { baht, bangkokDate, bangkokDateStr } from "../../lib/format"

export default function Dashboard() {
  const defaultRange = reportingRange("week")
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom)
  const [dateTo, setDateTo] = useState(defaultRange.dateTo)
  const [overview, setOverview] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [approvalBusyId, setApprovalBusyId] = useState("")
  const [error, setError] = useState("")
  const [approvalError, setApprovalError] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const shouldLoadDailyContext = dayCount(dateFrom, dateTo) <= 31
    const chartFrom = minDate(dateFrom, addDays(dateTo, -6))
    const yearFrom = `${dateTo.slice(0, 4)}-01-01`
    const [{ data, error: requestError }, { data: pendingApprovals, error: pendingError }, { data: chartData, error: chartError }, { data: yearData, error: yearError }] = await Promise.all([
      supabase.rpc("get_owner_dashboard_range", { p_date_from: dateFrom, p_date_to: dateTo }),
      supabase.from("approval_requests").select("id, type, amount, reason, created_at, orders(order_no, total), staff:requested_by(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(6),
      !shouldLoadDailyContext || chartFrom === dateFrom ? Promise.resolve({ data: null, error: null }) : supabase.rpc("get_owner_dashboard_range", { p_date_from: chartFrom, p_date_to: dateTo }),
      yearFrom === dateFrom ? Promise.resolve({ data: null, error: null }) : supabase.rpc("get_owner_dashboard_range", { p_date_from: yearFrom, p_date_to: dateTo }),
    ])
    if (requestError || chartError || yearError) {
      setError((requestError || chartError || yearError).message)
      setOverview(null)
    } else {
      setOverview({
        ...data,
        ...(chartData ? { daily: chartData.daily, chart_period: chartData.period } : {}),
        ...(yearData ? { monthly: yearData.monthly, monthly_period: yearData.period } : {}),
      })
    }
    setApprovals(pendingApprovals || [])
    setApprovalError(pendingError?.message || "")
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => {
    load()
    const channel = supabase.channel("dashboard-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [load])

  function applyPreset(preset) {
    const next = reportingRange(preset)
    setDateFrom(next.dateFrom)
    setDateTo(next.dateTo)
  }

  function changeDateFrom(value) {
    setDateFrom(value)
    if (value > dateTo) setDateTo(value)
  }

  function changeDateTo(value) {
    setDateTo(value)
    if (value < dateFrom) setDateFrom(value)
  }

  async function decideApproval(id, approve) {
    setApprovalBusyId(id)
    setApprovalError("")
    const { error: decisionError } = await supabase.rpc("decide_approval", { p_request: id, p_approve: approve })
    if (decisionError) setApprovalError(decisionError.message)
    await load()
    setApprovalBusyId("")
  }

  if (loading) return <DashboardSkeleton />
  if (error) return <DashboardError error={error} onRetry={load} />

  const summary = overview?.summary || {}
  const daily = overview?.daily || []
  const monthly = overview?.monthly || []
  const monthlyPeriod = overview?.monthly_period || overview?.period || {}
  const technicians = overview?.technicians || []
  const cashIn = number(summary.pos_income) + number(summary.other_income)
  const showDailyChart = dayCount(dateFrom, dateTo) <= 31

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Business overview</p>
          <h1 className="page-title">ภาพรวมรายได้และกระแสเงินสด</h1>
          <p className="page-description">เลือกช่วงเวลาเพื่อดูยอดขาย เงินเข้า–ออก และผลงานของช่างในสาขา</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="badge-neutral">{formatDateRange(dateFrom, dateTo)}</span>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" onClick={load}>รีเฟรช</button>
        </div>
      </div>

      <DateRangeControls dateFrom={dateFrom} dateTo={dateTo} onDateFrom={changeDateFrom} onDateTo={changeDateTo} onPreset={applyPreset} />

      <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="ยอดรับจาก POS ในช่วงเลือก" value={`฿${baht(summary.pos_income)}`} note={`${number(summary.bill_count)} บิล`} />
        <MetricCard label="กระแสเงินสดสุทธิในช่วงเลือก" value={`฿${baht(summary.net_cashflow)}`} note={number(summary.net_cashflow) >= 0 ? "เงินเข้า มากกว่าเงินออก" : "เงินออก มากกว่าเงินเข้า"} tone={number(summary.net_cashflow) >= 0 ? "positive" : "negative"} />
        <MetricCard label="เงินเข้าที่บันทึกในช่วงเลือก" value={`฿${baht(cashIn)}`} note={`POS ฿${baht(summary.pos_income)} · อื่น ฿${baht(summary.other_income)}`} />
        <MetricCard label="รายจ่ายที่บันทึกในช่วงเลือก" value={`฿${baht(summary.expense)}`} note={`${number(summary.bill_count)} บิลที่ชำระแล้ว`} tone="negative" />
      </section>

      <DashboardApprovalQueue rows={approvals} error={approvalError} busyId={approvalBusyId} onDecide={decideApproval} />

      <div className="grid items-start gap-5">
        {showDailyChart ? <section className="card overflow-hidden">
          <header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div>
              <p className="section-title">รายได้ POS รายวัน</p>
              <p className="section-note">ย้อนหลัง {daily.length} วัน · นับเฉพาะ QR ที่ยืนยันรับเงินแล้ว</p>
            </div>
            <span className="badge-neutral">รวม ฿{baht(summary.pos_income)}</span>
          </header>
          <DailyRevenueChart rows={daily} />
        </section> : <section className="card overflow-hidden">
          <header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div>
              <p className="section-title">รายได้ POS รายเดือน</p>
              <p className="section-note">ช่วงที่เลือกเกิน 31 วัน · รวมยอดตามเดือนเพื่อให้อ่านแนวโน้มได้ชัดเจน</p>
            </div>
            <span className="badge-neutral">รวม ฿{baht(summary.pos_income)}</span>
          </header>
          <MonthlyRevenueChart rows={monthly} />
        </section>}
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.78fr)]">
        <section className="card overflow-hidden">
          <header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
            <div>
              <p className="section-title">สรุปกระแสเงินสดในช่วงเลือก</p>
              <p className="section-note">เงินที่ระบบเห็นจาก POS และรายการรายรับ–รายจ่ายที่บันทึกไว้</p>
            </div>
            <span className={number(summary.net_cashflow) >= 0 ? "badge-success" : "badge-rose"}>{number(summary.net_cashflow) >= 0 ? "สุทธิเป็นบวก" : "สุทธิเป็นลบ"}</span>
          </header>
          <div className="grid divide-y divide-mist sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <CashLine label="รับจาก POS" value={summary.pos_income} sign="+" tone="positive" />
            <CashLine label="รายรับอื่น" value={summary.other_income} sign="+" tone="positive" />
            <CashLine label="รายจ่าย" value={summary.expense} sign="−" tone="negative" />
            <CashLine label="กระแสเงินสดสุทธิ" value={summary.net_cashflow} tone={number(summary.net_cashflow) >= 0 ? "positive" : "negative"} strong />
          </div>
        </section>

        <section className="card overflow-hidden">
          <header className="border-b border-mist px-5 py-4 sm:px-6">
            <p className="section-title">บิลในช่วงเลือก</p>
            <p className="section-note">การชำระเงินสำเร็จในช่วงวันที่เลือก</p>
          </header>
          <div className="grid grid-cols-3 divide-x divide-mist p-4 text-center sm:p-5">
            <MiniMetric label="ทั้งหมด" value={summary.bill_count} />
            <MiniMetric label="สมาชิก" value={summary.member_bill_count} />
            <MiniMetric label="Walk-in" value={summary.walk_in_bill_count} />
          </div>
        </section>
      </div>

      <TechnicianSales rows={technicians} dateFrom={dateFrom} dateTo={dateTo} />

      <section className="card mt-5 overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="section-title">รายละเอียดกระแสเงินสดรายเดือน</p>
            <p className="section-note">ตั้งแต่ต้นปีถึง {shortMonth(monthlyPeriod.date_to)} · สุทธิ = POS + รายรับอื่น − รายจ่าย</p>
          </div>
          <span className="badge-neutral">{monthly.length} เดือน</span>
        </header>
        <MonthlyTrend rows={monthly} />
      </section>

      <p className="mt-5 rounded-xl border border-mist bg-white/70 px-4 py-3 text-xs leading-5 text-sagegray">
        หมายเหตุ: นี่คือ “สรุปกระแสเงินสดจากระบบ” ไม่ใช่งบกำไรขาดทุน — ยังไม่รวมต้นทุนสินค้า ค่าแรงค้างจ่าย ค่าเสื่อม หรือรายการบัญชีที่ไม่ได้บันทึกผ่าน POS / Reconcile
      </p>
    </div>
  )
}

function DateRangeControls({ dateFrom, dateTo, onDateFrom, onDateTo, onPreset }) {
  const presets = [
    { id: "today", label: "วันนี้" },
    { id: "yesterday", label: "เมื่อวาน" },
    { id: "week", label: "7 วันล่าสุด" },
    { id: "thisWeek", label: "สัปดาห์นี้" },
    { id: "month", label: "เดือนนี้" },
  ]
  const maxDate = bangkokDateStr()
  const dateToMax = minDate(addDays(dateFrom, 365), maxDate)

  return <section className="card mb-5 px-4 py-3.5 sm:px-5">
    <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
      <div className="mr-1 shrink-0">
        <p className="section-title">ช่วงวันที่รายงาน</p>
        <p className="section-note">สูงสุด 1 ปี</p>
      </div>
      <div role="group" aria-label="เลือกช่วงวันที่แบบรวดเร็ว" className="flex shrink-0 rounded-xl border border-mist bg-porcelain p-1">
        {presets.map((preset) => {
          const active = isCurrentRange(preset.id, dateFrom, dateTo)
          return <button key={preset.id} type="button" onClick={() => onPreset(preset.id)} className={active ? "inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-white px-3 text-xs font-semibold text-rosedeep shadow-sm outline-none ring-1 ring-rose/15 focus-visible:ring-2 focus-visible:ring-rose" : "inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg px-3 text-xs font-semibold text-sagegray outline-none transition-colors hover:bg-white/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-rose"}>{preset.label}</button>
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
        <label className="flex items-center gap-2 text-xs font-semibold text-sagegray">ตั้งแต่
          <input type="date" aria-label="วันเริ่มต้น" className="input min-h-10 w-[154px] px-3 text-sm font-semibold text-ink" value={dateFrom} min={addDays(dateTo, -365)} max={dateTo} onChange={(event) => onDateFrom(event.target.value)} />
        </label>
        <span className="text-sagegray">–</span>
        <label className="flex items-center gap-2 text-xs font-semibold text-sagegray">ถึง
          <input type="date" aria-label="วันสิ้นสุด" className="input min-h-10 w-[154px] px-3 text-sm font-semibold text-ink" value={dateTo} min={dateFrom} max={dateToMax} onChange={(event) => onDateTo(event.target.value)} />
        </label>
      </div>
    </div>
  </section>
}

function MetricCard({ label, value, note, tone = "default" }) {
  const valueClass = tone === "negative" ? "text-danger" : tone === "positive" ? "text-success" : "text-ink"
  return <section className="card min-w-0 p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-sagegray">{label}</p><p className={`mt-3 truncate font-display text-2xl font-semibold tabular-nums sm:text-3xl ${valueClass}`}>{value}</p><p className="mt-2 truncate text-xs text-sagegray">{note}</p></section>
}

function CashLine({ label, value, sign, tone, strong }) {
  const amount = number(value)
  const amountClass = tone === "negative" ? "text-danger" : tone === "positive" ? "text-success" : "text-ink"
  return <div className="flex min-h-24 items-center justify-between gap-4 px-5 py-4 sm:px-6"><span className={strong ? "font-bold" : "text-sm font-semibold"}>{label}</span><span className={`${strong ? "text-xl" : "text-base"} font-bold tabular-nums ${amountClass}`}>{sign}{sign && "฿"}{!sign && amount < 0 ? "−" : ""}฿{baht(Math.abs(amount))}</span></div>
}

function MiniMetric({ label, value }) {
  return <div className="min-w-0 px-2"><p className="font-display text-2xl font-semibold tabular-nums">{number(value)}</p><p className="mt-1 text-xs text-sagegray">{label}</p></div>
}

function DailyRevenueChart({ rows }) {
  const max = Math.max(...rows.map((row) => number(row.pos_income)), 1)
  const scaleMax = niceChartMaximum(max)
  const totalBills = rows.reduce((sum, row) => sum + number(row.bill_count), 0)
  const width = 900
  const height = 230
  const bottom = 30
  const left = 76
  const right = 12
  const gap = 10
  const chartWidth = width - left - right
  const barWidth = Math.max(8, (chartWidth - gap * (rows.length + 1)) / Math.max(rows.length, 1))
  return <div className="p-5 sm:p-6"><div className="relative"><svg className="h-52 w-full sm:h-64" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`กราฟรายได้ POS ย้อนหลัง ${rows.length} วัน รวม ${baht(rows.reduce((sum, row) => sum + number(row.pos_income), 0))} บาท`}>
    {[0, 0.25, 0.5, 0.75, 1].map((step) => { const y = height - bottom - ((height - bottom - 12) * step); return <g key={step}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#eeeae7" strokeWidth="1" /><text x={left - 10} y={y + 4} textAnchor="end" fontSize="10" fill="#70686b">฿{baht(scaleMax * step)}</text></g> })}
    {rows.map((row, index) => { const income = number(row.pos_income); const barHeight = income === 0 ? 2 : Math.max(7, ((height - bottom - 12) * income) / scaleMax); const x = left + gap + index * (barWidth + gap); const y = height - bottom - barHeight; return <g key={row.date} tabIndex="0"><title>{`${shortDay(row.date)}: ฿${baht(income)} · ${number(row.bill_count)} บิล`}</title>{income > 0 && <text x={x + barWidth / 2} y={Math.max(13, y - 7)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#7d3546">฿{baht(income)}</text>}<rect x={x} y={y} width={barWidth} height={barHeight} rx="5" fill="#a94f61" opacity={income === 0 ? "0.22" : "0.9"} /><text x={x + barWidth / 2} y={height - 7} textAnchor="middle" fontSize="10" fill="#70686b">{shortDayNumber(row.date)}</text></g> })}
  </svg></div><div className="mt-3 flex items-center justify-between gap-3 text-xs text-sagegray"><span>{shortDay(rows[0]?.date)}</span><span>{totalBills} บิลในช่วงนี้</span><span>{shortDay(rows.at(-1)?.date)}</span></div></div>
}

function MonthlyRevenueChart({ rows }) {
  const max = Math.max(...rows.map((row) => number(row.pos_income)), 1)
  const scaleMax = niceChartMaximum(max)
  const width = 900
  const height = 230
  const bottom = 32
  const left = 76
  const right = 12
  const gap = 12
  const chartWidth = width - left - right
  const barWidth = Math.max(16, (chartWidth - gap * (rows.length + 1)) / Math.max(rows.length, 1))
  return <div className="p-5 sm:p-6"><div className="relative"><svg className="h-52 w-full sm:h-64" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`กราฟรายได้ POS รายเดือน ${rows.length} เดือน`}>
    {[0, 0.25, 0.5, 0.75, 1].map((step) => { const y = height - bottom - ((height - bottom - 12) * step); return <g key={step}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#eeeae7" strokeWidth="1" /><text x={left - 10} y={y + 4} textAnchor="end" fontSize="10" fill="#70686b">฿{baht(scaleMax * step)}</text></g> })}
    {rows.map((row, index) => { const income = number(row.pos_income); const barHeight = income === 0 ? 2 : Math.max(7, ((height - bottom - 12) * income) / scaleMax); const x = left + gap + index * (barWidth + gap); const y = height - bottom - barHeight; return <g key={row.month} tabIndex="0"><title>{`${shortMonth(row.month)}: ฿${baht(income)} · ${number(row.bill_count)} บิล`}</title>{income > 0 && <text x={x + barWidth / 2} y={Math.max(13, y - 7)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#7d3546">฿{baht(income)}</text>}<rect x={x} y={y} width={barWidth} height={barHeight} rx="5" fill="#a94f61" opacity={income === 0 ? "0.22" : "0.9"} /><text x={x + barWidth / 2} y={height - 7} textAnchor="middle" fontSize="10" fill="#70686b">{shortMonth(row.month)}</text></g> })}
  </svg></div><p className="mt-3 text-center text-xs text-sagegray">แสดงยอดรับจาก POS แยกตามเดือนในช่วงที่เลือก</p></div>
}

function DashboardApprovalQueue({ rows, error, busyId, onDecide }) {
  return <section className="card mb-5 overflow-hidden"><header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6"><div><p className="section-title">คิวอนุมัติ</p><p className="section-note">อนุมัติส่วนลดหรือยกเลิกบิลได้ทันที · ประวัติทั้งหมดอยู่ที่หน้าคิวอนุมัติ</p></div><div className="flex items-center gap-2"><span className={rows.length ? "badge-rose" : "badge-neutral"}>{rows.length} รายการรอ</span><Link to="/admin/approvals" className="btn-ghost min-h-9 px-3 text-xs">ดูทั้งหมด</Link></div></header>{error && <p role="alert" className="mx-5 mt-4 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger sm:mx-6">{error}</p>}{rows.length === 0 ? <div className="px-5 py-5 sm:px-6"><div className="empty-state py-6">ไม่มีคำขอที่รออนุมัติ</div></div> : <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3 sm:p-6">{rows.map((request) => <article key={request.id} className="rounded-xl border border-mist bg-porcelain/45 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{approvalType(request.type)} · {request.orders?.order_no || "ไม่พบเลขบิล"}</p><p className="mt-1 text-xs text-sagegray">โดย {request.staff?.name || "พนักงาน"}</p></div><span className="badge-neutral shrink-0">{request.type === "discount" ? `฿${baht(request.amount)}` : "ยกเลิก"}</span></div><p className="mt-3 line-clamp-2 text-sm leading-6 text-sagegray">เหตุผล: {request.reason}</p><p className="mt-2 text-sm font-semibold">ยอดบิล ฿{baht(request.orders?.total)}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => onDecide(request.id, true)} className="btn-rose min-h-10 px-3 text-sm disabled:opacity-50">{busyId === request.id ? "กำลังบันทึก…" : "อนุมัติ"}</button><button type="button" disabled={Boolean(busyId)} onClick={() => onDecide(request.id, false)} className="btn-danger min-h-10 px-3 text-sm disabled:opacity-50">ปฏิเสธ</button></div></article>)}</div>}</section>
}

function MonthlyTrend({ rows }) {
  const ordered = useMemo(() => [...rows].sort((a, b) => String(a.month).localeCompare(String(b.month))), [rows])
  const max = Math.max(...ordered.map((row) => Math.abs(number(row.net_cashflow))), 1)
  if (ordered.length === 0) return <div className="p-5 sm:p-6"><div className="empty-state py-6">ยังไม่มีข้อมูลรายเดือนในปีที่เลือก</div></div>
  return <div className="grid divide-y divide-mist lg:grid-cols-2 lg:divide-x lg:divide-y-0">{ordered.map((row) => { const net = number(row.net_cashflow); const width = Math.max(net === 0 ? 0 : 5, Math.round((Math.abs(net) / max) * 100)); return <article key={row.month} className="px-5 py-4 sm:px-6"><div className="flex items-center justify-between gap-4"><p className="font-semibold">{shortMonth(row.month)}</p><p className={`font-bold tabular-nums ${net >= 0 ? "text-success" : "text-danger"}`}>{net >= 0 ? "+" : "−"}฿{baht(Math.abs(net))}</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-porcelain"><div className={net >= 0 ? "h-full rounded-full bg-success" : "h-full rounded-full bg-danger"} style={{ width: `${width}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs text-sagegray"><span>เข้า ฿{baht(number(row.pos_income) + number(row.other_income))}</span><span>ออก ฿{baht(row.expense)}</span><span className="text-right">{number(row.bill_count)} บิล</span></div></article> })}</div>
}

function TechnicianSales({ rows, dateFrom, dateTo }) {
  return <section className="card mt-5 overflow-hidden">
    <header className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div>
        <p className="section-title">รายได้ตามช่าง</p>
        <p className="section-note">ยอดสุทธิหลังหักส่วนลดและโปรโมชัน · {formatDateRange(dateFrom, dateTo)}</p>
      </div>
      <span className="badge-neutral">{rows.length} ช่าง</span>
    </header>
    {rows.length === 0 ? <div className="p-5 sm:p-6"><div className="empty-state py-7">ยังไม่มีรายการบริการที่ระบุช่างในช่วงที่เลือก</div></div> : <div className="divide-y divide-mist">
      {rows.map((staff, index) => <article key={staff.staff_id} className="flex min-h-20 items-center gap-3 px-5 py-4 sm:px-6">
        <span className={index < 3 ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose/10 text-sm font-bold text-rosedeep" : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-porcelain text-sm font-bold text-sagegray"}>{index + 1}</span>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{staff.name}</p><p className="mt-1 text-xs text-sagegray">{number(staff.bill_count)} บิล · {number(staff.item_count)} รายการ</p></div>
        <div className="shrink-0 text-right"><p className="font-display text-xl font-semibold tabular-nums text-ink sm:text-2xl">฿{baht(staff.net_sales)}</p><p className="mt-1 text-xs text-sagegray">ยอดสุทธิ</p></div>
      </article>)}
    </div>}
  </section>
}

function DashboardSkeleton() {
  return <div className="animate-pulse"><div className="mb-6 h-20 w-72 rounded-2xl bg-porcelain" /><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="card h-32 bg-white" />)}</div><div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,.6fr)]"><div className="card h-80" /><div className="card h-80" /></div></div>
}

function DashboardError({ error, onRetry }) {
  return <div><div className="page-heading"><div><p className="page-eyebrow">Business overview</p><h1 className="page-title">ภาพรวมรายได้และกระแสเงินสด</h1></div></div><section className="card p-5"><div className="empty-state"><p className="font-semibold text-danger">โหลดข้อมูล Dashboard ไม่สำเร็จ</p><p className="mt-1 break-words">{error}</p><button type="button" className="btn-ghost mt-4" onClick={onRetry}>ลองอีกครั้ง</button></div></section></div>
}

function shortDay(value) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`))
}

function shortDayNumber(value) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`))
}

function shortMonth(value) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("th-TH", { month: "short", year: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`))
}

function formatDateRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return "เลือกช่วงวันที่"
  if (dateFrom === dateTo) return bangkokDate(dateFrom)
  return `${shortDay(dateFrom)} – ${shortDay(dateTo)} ${new Intl.DateTimeFormat("th-TH", { year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(`${dateTo}T12:00:00+07:00`))}`
}

function reportingRange(preset) {
  const today = bangkokDateStr()
  if (preset === "today") return { dateFrom: today, dateTo: today }
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1)
    return { dateFrom: yesterday, dateTo: yesterday }
  }
  if (preset === "thisWeek") {
    const value = new Date(`${today}T12:00:00Z`)
    const day = value.getUTCDay() || 7
    return { dateFrom: addDays(today, 1 - day), dateTo: today }
  }
  if (preset === "month") return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today }
  return { dateFrom: addDays(today, -6), dateTo: today }
}

function isCurrentRange(preset, dateFrom, dateTo) {
  const range = reportingRange(preset)
  return range.dateFrom === dateFrom && range.dateTo === dateTo
}

function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function minDate(first, second) { return first < second ? first : second }

function dayCount(dateFrom, dateTo) {
  const start = new Date(`${dateFrom}T12:00:00Z`).getTime()
  const end = new Date(`${dateTo}T12:00:00Z`).getTime()
  return Math.floor((end - start) / 86_400_000) + 1
}

function number(value) { return Number(value || 0) }

function niceChartMaximum(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)))
  const normalized = value / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

function approvalType(type) { return type === "void" ? "ยกเลิกบิล" : "ส่วนลด" }
