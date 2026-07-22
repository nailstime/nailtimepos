import { useCallback, useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht, bangkokMonthStr } from "../../lib/format"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

const thisMonth = () => bangkokMonthStr()
const dateTimeLabel = (value) => value ? new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
}).format(new Date(value)) : ''
const editUntilLabel = (value) => value ? dateTimeLabel(new Date(new Date(value).getTime() - 60_000)) : ''

const defaultTiers = [{ max_amount: "", pct: "3" }]

export default function Commission() {
  const [month, setMonth] = useState(thisMonth())
  const [report, setReport] = useState(null)
  const [branchId, setBranchId] = useState(null)
  const [teamMinimum, setTeamMinimum] = useState("")
  const [tiers, setTiers] = useState(defaultTiers)
  const [msg, setMsg] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (selectedMonth) => {
    setMsg("")
    const { data: branch, error: branchError } = await supabase.from("branches").select("id").limit(1).single()
    if (branchError) return setMsg(branchError.message)
    setBranchId(branch.id)

    const [{ data: reportData, error: reportError }, { data: config, error: configError }] = await Promise.all([
      supabase.rpc("commission_report", { p_month: selectedMonth }),
      supabase.from("commission_settings")
        .select("team_minimum_amount")
        .eq("branch_id", branch.id)
        .eq("effective_month", selectedMonth)
        .maybeSingle(),
    ])
    if (reportError) return setMsg(reportError.message)
    if (configError) return setMsg(configError.message)
    setReport(reportData)

    if (config) {
      const { data: savedTiers, error: tiersError } = await supabase.from("commission_tiers")
        .select("min_amount,max_amount,pct")
        .eq("branch_id", branch.id)
        .eq("effective_month", selectedMonth)
        .order("min_amount")
      if (tiersError) return setMsg(tiersError.message)
      setTeamMinimum(String(config.team_minimum_amount ?? 0))
      const nextTiers = (savedTiers || []).map((tier) => ({
        max_amount: tier.max_amount == null ? "" : String(tier.max_amount),
        pct: String(tier.pct),
      }))
      setTiers(nextTiers.length > 0 ? nextTiers : defaultTiers)
    } else {
      setTeamMinimum("")
      setTiers(defaultTiers)
    }
  }, [])

  useEffect(() => { load(month) }, [month, load])

  const tierStart = (index) => index === 0 ? teamMinimum : tiers[index - 1]?.max_amount

  async function saveCommissionSettings() {
    setMsg("")
    const minimum = Number(teamMinimum)
    if (!Number.isFinite(minimum) || minimum < 0) return setMsg("ยอดทีมขั้นต่ำต้องเป็นจำนวนเงินตั้งแต่ ฿0 ขึ้นไป")

    let previousMax = minimum
    const payload = []
    for (let index = 0; index < tiers.length; index += 1) {
      const tier = tiers[index]
      const pct = Number(tier.pct)
      const isLast = index === tiers.length - 1
      const maxAmount = tier.max_amount === "" ? null : Number(tier.max_amount)
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setMsg(`Tier ${index + 1} ต้องกำหนดอัตรา 0–100%`)
      if (!isLast && (!Number.isFinite(maxAmount) || maxAmount <= previousMax)) {
        return setMsg(`Tier ${index + 1} ต้องมียอดสิ้นสุดมากกว่า ฿${baht(previousMax)}`)
      }
      if (isLast && maxAmount !== null) return setMsg("Tier สุดท้ายต้องเว้นยอดสิ้นสุดไว้")
      payload.push({ min_amount: previousMax, max_amount: maxAmount, pct })
      if (maxAmount !== null) previousMax = maxAmount
    }

    setSaving(true)
    const { error } = await supabase.rpc("save_team_commission_configuration", {
      p_effective_month: month,
      p_team_minimum_amount: minimum,
      p_tiers: payload,
    })
    setSaving(false)
    if (error) return setMsg(error.message)
    setMsg(`บันทึกกติกาคอมรอบ ${month} แล้ว`)
    load(month)
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Commission</p>
          <h1 className="page-title">ค่าคอมมิชชั่นทีม</h1>
          <p className="page-description">คิดจากยอดสุทธิของทีมหลังหักส่วนลด แล้วแบ่งตามยอดงานสุทธิของพนักงานแต่ละคน</p>
        </div>
      </div>

      {msg && <p role="status" className="mb-5 rounded-xl border border-mist bg-white px-4 py-3 text-sm font-medium text-ink">{msg}</p>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
        <section className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="section-title">รายงานค่าคอม</p><p className="section-note">รายงานใช้ยอดสุทธิหลังหักส่วนลดและโปรโมชัน</p></div>
            <input aria-label="เดือนรายงานค่าคอม" type="month" className="input sm:w-auto" value={month} onChange={(event) => setMonth(event.target.value)} />
          </div>
          <div className="p-5">
            {!report && <div className="empty-state">กำลังโหลดรายงาน…</div>}
            {report && !report.configured && <div className="empty-state">ยังไม่มีกติกาคอมสำหรับรอบนี้</div>}
            {report?.configured && <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="ยอดสุทธิทีม" value={`฿${baht(report.team_net_sales)}`} />
                <Metric label="ยอดเริ่มจ่ายคอม" value={`฿${baht(report.team_minimum_amount)}`} />
                <Metric label="Tier ทีม" value={report.team_threshold_met ? `${report.tier_pct}%` : "ยังไม่ถึงขั้นต่ำ"} highlight={report.team_threshold_met} />
              </div>
              {!report.team_threshold_met && <p className="mt-4 rounded-xl bg-porcelain px-3 py-2 text-sm text-sagegray">ยอดทีมยังไม่ถึงขั้นต่ำ จึงยังไม่มีค่าคอมของเดือนนี้</p>}
              <div className="mt-5 overflow-hidden rounded-2xl border border-mist">
                <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-mist bg-porcelain/60 px-4 py-3 text-xs font-semibold text-sagegray sm:grid">
                  <span>พนักงาน</span><span>ยอดสุทธิ</span><span>อัตราคอม</span><span className="text-right">ค่าคอม</span>
                </div>
                {(report.rows || []).map((row) => (
                  <div key={row.staff_id} className="grid gap-x-3 gap-y-1 border-b border-mist px-4 py-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                    <span className="font-semibold">{row.technician}</span>
                    <span className="text-sm text-sagegray">฿{baht(row.total_sales)}</span>
                    <span className="text-sm text-sagegray">{row.tier_pct}%{Number(row.bonus_pct) > 0 && ` + ${row.bonus_pct}%`}</span>
                    <span className="font-bold tabular-nums sm:text-right">฿{baht(row.commission)}</span>
                  </div>
                ))}
                {(report.rows || []).length === 0 && <div className="empty-state m-3">ยังไม่มีรายการบริการหรือสินค้าที่ชำระแล้ว</div>}
              </div>
            </>}
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <p className="section-title">ตั้งค่าคอมรอบ {month}</p>
          <p className="section-note">{report?.finalized ? `ระบบปิดและ snapshot ผลแล้วเมื่อ ${dateTimeLabel(report.close_at)}` : report?.can_edit ? `แก้ไขได้ถึง ${editUntilLabel(report.close_at)}` : "รอบนี้ปิดแล้ว ระบบจะคำนวณและล็อกผลอัตโนมัติ"}</p>

          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">ยอดสุทธิทีมขั้นต่ำเพื่อเริ่มจ่ายคอม</span>
            <input disabled={!report?.can_edit} className="input" inputMode="decimal" placeholder="เช่น 30000" value={teamMinimum} onChange={(event) => setTeamMinimum(event.target.value)} />
            <span className="mt-1.5 block text-xs text-sagegray">หากยอดทีมต่ำกว่านี้ พนักงานทุกคนจะไม่ได้รับค่าคอม</span>
          </label>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-ink">Tier ยอดทีม</p><p className="mt-1 text-xs text-sagegray">ช่วงยอดจะต่อเนื่องให้อัตโนมัติจากยอดขั้นต่ำ</p></div><span className="badge-neutral">{tiers.length} Tier</span></div>
            <div className="mt-3 space-y-3">
              {tiers.map((tier, index) => {
                const isLast = index === tiers.length - 1
                return <div key={index} className="rounded-2xl border border-mist bg-porcelain/45 p-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px_auto] sm:items-end">
                    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ตั้งแต่</span><div className="input flex items-center bg-white/65 text-sagegray">฿{Number(tierStart(index) || 0).toLocaleString('th-TH')}</div></label>
                    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ถึง</span><input className="input" disabled={isLast || !report?.can_edit} placeholder={isLast ? "ไม่จำกัด" : "เช่น 50000"} inputMode="decimal" value={tier.max_amount} onChange={(event) => setTiers(tiers.map((item, itemIndex) => itemIndex === index ? { ...item, max_amount: event.target.value } : item))} /></label>
                    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">คอม %</span><input className="input" disabled={!report?.can_edit} placeholder="3" inputMode="decimal" value={tier.pct} onChange={(event) => setTiers(tiers.map((item, itemIndex) => itemIndex === index ? { ...item, pct: event.target.value } : item))} /></label>
                    <button type="button" onClick={() => setTiers(tiers.filter((_, itemIndex) => itemIndex !== index))} disabled={tiers.length === 1 || !report?.can_edit} className="btn-danger text-sm">ลบ</button>
                  </div>
                  {isLast && <p className="mt-2 text-xs text-sagegray">Tier สุดท้ายไม่มีเพดานยอด</p>}
                </div>
              })}
            </div>
            <button type="button" disabled={!report?.can_edit} className="btn-ghost mt-3 w-full" onClick={() => setTiers([...tiers.map((tier, index) => index === tiers.length - 1 ? { ...tier, max_amount: tier.max_amount } : tier), { max_amount: "", pct: "" }])}>+ เพิ่ม Tier</button>
          </div>

          <p className="mt-5 rounded-xl bg-porcelain px-3 py-3 text-sm leading-6 text-sagegray">โบนัสรายพนักงานตั้งค่าได้ในหน้า “พนักงานและสมาชิก” โดยจะบวกจากอัตรา Tier ของทีม เช่น Tier 3% + โบนัส 1% = 4%</p>
          <button type="button" onClick={saveCommissionSettings} disabled={saving || !report?.can_edit} className="btn-rose mt-5 w-full">{saving ? "กำลังบันทึก…" : report?.can_edit ? "บันทึกกติกาคอม" : "รอบนี้ปิดแล้ว"}</button>
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value, highlight = false }) {
  return <div className="rounded-xl bg-porcelain px-3 py-3"><p className="text-xs font-semibold text-sagegray">{label}</p><p className={(highlight ? "text-success" : "text-ink") + " mt-1 font-display text-xl font-semibold tabular-nums"}>{value}</p></div>
}
