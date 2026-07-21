import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useAppDialog } from "../../components/AppDialog"
import { baht, bangkokDateStr, bangkokTime } from "../../lib/format"
import { supabase } from "../../lib/supabase"

const money = (value) => Number(value || 0)

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + amount)
  return bangkokDateStr(date)
}

function bangkokLocalInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

function localBangkokToIso(value) {
  return new Date(`${value}:00+07:00`).toISOString()
}

function formatDateTime(value) {
  if (!value) return "-"
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function staffName(value) {
  const staff = Array.isArray(value) ? value[0] : value
  return staff?.name || "-"
}

function friendlyError(error) {
  const message = error?.message || String(error || "เกิดข้อผิดพลาด")
  const mappings = [
    ["opening balance timestamp cannot be in the future", "วันและเวลาของยอดตั้งต้นต้องไม่อยู่ในอนาคต"],
    ["an active bank account already exists", "สาขานี้ตั้งค่าบัญชีธนาคารแล้ว กรุณาโหลดหน้าใหม่"],
    ["business date must be after the last closed period", "วันที่เลือกถูกปิดยอดไปแล้ว กรุณาเลือกวันถัดไป"],
    ["available only after the configured close time", "ยังไม่ถึงเวลาปิดร้าน จึงยังยืนยันปิดรอบไม่ได้"],
    ["reconciliation difference", "ยอดคงเหลือจริงยังไม่ตรงกับยอดที่ระบบคำนวณ"],
    ["closed period", "ไม่สามารถเพิ่มหรือแก้รายการในรอบที่ปิดแล้ว"],
  ]
  return mappings.find(([source]) => message.includes(source))?.[1] || message
}

export default function Reconcile() {
  const { confirm, prompt } = useAppDialog()
  const [date, setDate] = useState(bangkokDateStr())
  const [preview, setPreview] = useState(null)
  const [history, setHistory] = useState([])
  const [actualBalance, setActualBalance] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [adjustmentKind, setAdjustmentKind] = useState(null)
  const [openingBalance, setOpeningBalance] = useState("")
  const [openingDate, setOpeningDate] = useState(addDays(bangkokDateStr(), -1))
  const [closeTime, setCloseTime] = useState("20:00")
  const [accountName, setAccountName] = useState("บัญชี PromptPay")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const [previewResult, historyResult] = await Promise.all([
      supabase.rpc("get_bank_reconciliation_preview", { p_business_date: date }),
      supabase
        .from("bank_reconciliations")
        .select("id, business_date, period_start_at, period_end_at, opening_balance, pos_income_total, other_income_total, expense_total, actual_balance, closed_at, closer:closed_by(name)")
        .order("period_end_at", { ascending: false })
        .limit(14),
    ])
    if (previewResult.error) setError(friendlyError(previewResult.error))
    else setPreview(previewResult.data)
    if (!historyResult.error) setHistory(historyResult.data || [])
    setLoading(false)
  }, [date])

  useEffect(() => {
    load()
  }, [load])

  const actual = actualBalance === "" ? null : money(actualBalance)
  const expected = money(preview?.expected_balance)
  const diff = actual === null ? null : Math.round((actual - expected) * 100) / 100
  const matched = diff !== null && Math.abs(diff) < 0.005

  const formulaItems = useMemo(() => preview?.initialized ? [
    { label: "ยอดปิดรอบล่าสุด", value: preview.opening_balance, sign: "" },
    { label: `รายรับ POS (${preview.payment_count || 0} รายการ)`, value: preview.pos_income_total, sign: "+" },
    { label: "รายรับอื่น", value: preview.other_income_total, sign: "+" },
    { label: "รายจ่าย", value: preview.expense_total, sign: "−" },
  ] : [], [preview])

  async function initialize(event) {
    event.preventDefault()
    if (openingBalance === "" || money(openingBalance) < 0) {
      setError("กรุณากรอกยอดตั้งต้นที่ถูกต้อง")
      return
    }
    setBusy(true)
    setError("")
    const { error: rpcError } = await supabase.rpc("initialize_bank_reconciliation", {
      p_opening_balance: money(openingBalance),
      p_opening_date: openingDate,
      p_close_time: closeTime,
      p_account_name: accountName.trim(),
    })
    setBusy(false)
    if (rpcError) {
      setError(friendlyError(rpcError))
      return
    }
    setNotice("ตั้งค่ายอดเริ่มต้นเรียบร้อยแล้ว")
    await load()
  }

  async function saveAdjustment(values) {
    setBusy(true)
    const { error: rpcError } = await supabase.rpc("add_bank_adjustment", {
      p_kind: adjustmentKind,
      p_amount: money(values.amount),
      p_description: values.description,
      p_occurred_at: localBangkokToIso(values.occurredAt),
      p_category: values.category,
    })
    setBusy(false)
    if (rpcError) throw new Error(friendlyError(rpcError))
    setAdjustmentKind(null)
    setNotice(adjustmentKind === "income" ? "เพิ่มรายรับแล้ว" : "เพิ่มรายจ่ายแล้ว")
    await load()
  }

  async function voidAdjustment(adjustment) {
    const reason = await prompt({
      title: "ยกเลิกรายการปรับยอด",
      description: `${adjustment.description} · ฿${baht(adjustment.amount)}`,
      label: "เหตุผลที่ยกเลิก",
      multiline: true,
      required: true,
      minLength: 3,
      maxLength: 500,
      tone: "danger",
      confirmLabel: "ยืนยันยกเลิก",
      validate: (value) => value.length < 3 ? "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร" : "",
    })
    if (!reason) return
    setBusy(true)
    setError("")
    const { error: rpcError } = await supabase.rpc("void_bank_adjustment", {
      p_adjustment: adjustment.id,
      p_reason: reason,
    })
    setBusy(false)
    if (rpcError) setError(friendlyError(rpcError))
    else {
      setNotice("ยกเลิกรายการแล้ว โดยยังเก็บประวัติไว้ในระบบ")
      await load()
    }
  }

  async function closePeriod() {
    if (!matched || !preview?.can_close) return
    const accepted = await confirm({
      title: "ยืนยันปิดรอบบัญชี",
      description: `ยอดคงเหลือตรงกันที่ ฿${baht(actual)} เมื่อปิดแล้วข้อมูลรอบนี้จะถูกล็อกและแก้ไขไม่ได้`,
      confirmLabel: "ยืนยันปิดรอบ",
      cancelLabel: "ตรวจสอบอีกครั้ง",
    })
    if (!accepted) return

    setBusy(true)
    setError("")
    const { error: rpcError } = await supabase.rpc("close_bank_reconciliation", {
      p_business_date: date,
      p_actual_balance: actual,
    })
    setBusy(false)
    if (rpcError) {
      setError(friendlyError(rpcError))
      await load()
      return
    }
    setNotice(`ปิดรอบวันที่ ${date} เรียบร้อยแล้ว`)
    setActualBalance("")
    setDate(addDays(date, 1))
  }

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Bank reconciliation</p>
          <h1 className="page-title">กระทบยอดบัญชีธนาคาร</h1>
          <p className="page-description">ตรวจยอดคงเหลือจากรอบที่ปิดล่าสุด รวมรายรับ POS รายรับอื่น และรายจ่ายทั้งหมดในช่วงที่ยังไม่ได้ปิดรอบ</p>
        </div>
        {preview?.initialized && <span className="badge-neutral">{preview.account?.name}</span>}
      </div>

      {error && <div role="alert" className="mb-5 rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-semibold text-success">{notice}</div>}

      {loading ? (
        <section className="card p-10 text-center text-sm text-sagegray">กำลังคำนวณรอบบัญชี...</section>
      ) : preview?.initialized === false ? (
        <InitializationCard
          accountName={accountName}
          setAccountName={setAccountName}
          openingBalance={openingBalance}
          setOpeningBalance={setOpeningBalance}
          openingDate={openingDate}
          setOpeningDate={setOpeningDate}
          closeTime={closeTime}
          setCloseTime={setCloseTime}
          busy={busy}
          onSubmit={initialize}
        />
      ) : preview?.initialized ? (
        <>
          <section className="card mb-5 overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-mist px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="section-title">รอบที่กำลังตรวจสอบ</p>
                <p className="section-note">{formatDateTime(preview.period_start_at)} — {formatDateTime(preview.period_end_at)}</p>
              </div>
              <label className="w-full text-sm font-semibold text-ink sm:w-52">
                วันที่ปิดรอบ
                <input type="date" className="input mt-2" value={date} onChange={(event) => {
                  setDate(event.target.value)
                  setActualBalance("")
                  setNotice("")
                }} />
              </label>
            </div>

            <div className="grid gap-px bg-mist sm:grid-cols-2 xl:grid-cols-4">
              {formulaItems.map((item) => (
                <div key={item.label} className="bg-white px-5 py-5 sm:px-6">
                  <p className="text-sm text-sagegray">{item.label}</p>
                  <p className={`mt-2 text-2xl font-bold tabular-nums ${item.sign === "−" ? "text-danger" : item.sign === "+" ? "text-success" : "text-ink"}`}>
                    {item.sign}฿{baht(item.value)}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
              <div className="soft-panel p-5">
                <p className="text-sm font-semibold text-sagegray">ยอดคงเหลือที่ระบบคำนวณ</p>
                <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink">฿{baht(preview.expected_balance)}</p>
                <p className="mt-3 text-sm leading-6 text-sagegray">ยอดตั้งต้น + รายรับ POS + รายรับอื่น − รายจ่าย</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-ink">
                  ยอดคงเหลือจริงในแอปธนาคาร
                  <input
                    className="input mt-2 text-lg font-bold tabular-nums"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={actualBalance}
                    onChange={(event) => setActualBalance(event.target.value)}
                  />
                </label>
                <div className={`mt-3 flex items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold ${matched ? "bg-success/10 text-success" : diff === null ? "bg-porcelain text-sagegray" : "bg-danger/5 text-danger"}`}>
                  <span>{diff === null ? "กรอกยอดเพื่อดูผล" : matched ? "ยอดตรงกัน" : "ส่วนต่าง"}</span>
                  {diff !== null && <span className="tabular-nums">{diff > 0 ? "+" : ""}฿{baht(diff)}</span>}
                </div>
                {!preview.can_close && <p className="mt-3 text-xs leading-5 text-sagegray">สามารถยืนยันปิดรอบได้หลัง {formatDateTime(preview.period_end_at)}</p>}
                <button className="btn-rose mt-4 w-full" disabled={busy || !matched || !preview.can_close} onClick={closePeriod}>
                  {busy ? "กำลังบันทึก..." : "ยอดตรงแล้ว · ยืนยันปิดรอบ"}
                </button>
              </div>
            </div>
          </section>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
            <div className="space-y-5">
              <section className="card overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="section-title">รายรับและรายจ่ายนอก POS</p>
                    <p className="section-note">เพิ่มเฉพาะรายการที่เคลื่อนไหวจริงในบัญชีธนาคาร</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost" onClick={() => setAdjustmentKind("income")}>+ รายรับ</button>
                    <button className="btn-ghost" onClick={() => setAdjustmentKind("expense")}>− รายจ่าย</button>
                  </div>
                </div>
                <div className="px-5 py-2">
                  {(preview.adjustments || []).map((item) => (
                    <div key={item.id} className="data-row grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={item.kind === "income" ? "badge-success" : "badge-rose"}>{item.kind === "income" ? "รายรับ" : "รายจ่าย"}</span>
                          <span className="truncate text-sm font-semibold">{item.description}</span>
                        </div>
                        <p className="mt-1 text-xs text-sagegray">{formatDateTime(item.occurred_at)} · {item.created_by}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold tabular-nums ${item.kind === "income" ? "text-success" : "text-danger"}`}>
                          {item.kind === "income" ? "+" : "−"}฿{baht(item.amount)}
                        </span>
                        <button className="text-xs font-semibold text-sagegray underline decoration-mist underline-offset-4 hover:text-danger" onClick={() => voidAdjustment(item)}>ยกเลิก</button>
                      </div>
                    </div>
                  ))}
                  {(preview.adjustments || []).length === 0 && <div className="empty-state my-3">ไม่มีรายรับหรือรายจ่ายนอก POS ในรอบนี้</div>}
                </div>
              </section>

              <section className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-mist px-5 py-4">
                  <div><p className="section-title">รายการรับเงินจาก POS</p><p className="section-note">นับเฉพาะ QR ที่ยืนยันรับเงินแล้ว</p></div>
                  <span className="badge-neutral">{preview.payment_count || 0} รายการ</span>
                </div>
                <div className="px-5 py-2">
                  {(preview.payments || []).map((payment) => (
                    <div key={payment.payment_id} className="data-row grid-cols-[1fr_auto_auto] text-sm">
                      <span className="font-semibold">{payment.order_no}</span>
                      <span className="text-sagegray">{bangkokTime(payment.confirmed_at)} · {payment.confirmed_by || "-"}</span>
                      <span className="min-w-24 text-right font-bold tabular-nums">฿{baht(payment.amount)}</span>
                    </div>
                  ))}
                  {(preview.payments || []).length === 0 && <div className="empty-state my-3">ยังไม่มีรายการ QR ที่ยืนยันแล้วในรอบนี้</div>}
                </div>
              </section>
            </div>

            <section className="card overflow-hidden">
              <div className="border-b border-mist px-5 py-4">
                <p className="section-title">ประวัติรอบที่ปิดแล้ว</p>
                <p className="section-note">14 รอบล่าสุด · แก้ไขย้อนหลังไม่ได้</p>
              </div>
              <div className="px-5 py-2">
                {history.map((item) => (
                  <div key={item.id} className="border-b border-mist py-4 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">รอบวันที่ {item.business_date}</p>
                        <p className="mt-1 text-xs text-sagegray">{staffName(item.closer)} · {formatDateTime(item.closed_at)}</p>
                      </div>
                      <span className="badge-success">ยอดตรง</span>
                    </div>
                    <div className="mt-3 flex items-end justify-between rounded-xl bg-porcelain px-3 py-2.5">
                      <span className="text-xs text-sagegray">ยอดปิดบัญชี</span>
                      <span className="font-bold tabular-nums">฿{baht(item.actual_balance)}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && <div className="empty-state my-3">ยังไม่มีรอบที่ปิดสำเร็จ</div>}
              </div>
            </section>
          </div>
        </>
      ) : null}

      {adjustmentKind && (
        <AdjustmentModal
          kind={adjustmentKind}
          busy={busy}
          onClose={() => setAdjustmentKind(null)}
          onSave={saveAdjustment}
        />
      )}
    </div>
  )
}

function InitializationCard(props) {
  return (
    <section className="card mx-auto max-w-3xl overflow-hidden">
      <div className="border-b border-mist px-6 py-5">
        <p className="page-eyebrow">First setup</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">กำหนดยอดตั้งต้นของบัญชี</h2>
        <p className="mt-2 text-sm leading-6 text-sagegray">กรอกยอดคงเหลือจริง ณ เวลาปิดร้านของวันก่อนเริ่มใช้งาน ระบบจะใช้ยอดนี้เป็นฐานสำหรับทุกรอบถัดไป</p>
      </div>
      <form onSubmit={props.onSubmit} className="grid gap-5 px-6 py-6 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink sm:col-span-2">
          ชื่อบัญชี
          <input className="input mt-2" required maxLength={120} value={props.accountName} onChange={(event) => props.setAccountName(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          ยอดคงเหลือตั้งต้น
          <input className="input mt-2" required type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={props.openingBalance} onChange={(event) => props.setOpeningBalance(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          วันที่ของยอดตั้งต้น
          <input className="input mt-2" required type="date" value={props.openingDate} onChange={(event) => props.setOpeningDate(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold text-ink">
          เวลาปิดร้าน
          <input className="input mt-2" required type="time" value={props.closeTime} onChange={(event) => props.setCloseTime(event.target.value)} />
        </label>
        <div className="soft-panel flex items-center px-4 py-3 text-xs leading-5 text-sagegray">หากข้ามวันโดยไม่ได้ปิดรอบ รายการทั้งหมดจะสะสมต่อจากยอดตั้งต้นหรือรอบล่าสุดโดยอัตโนมัติ</div>
        <button className="btn-rose sm:col-span-2" disabled={props.busy}>{props.busy ? "กำลังตั้งค่า..." : "เริ่มใช้การกระทบยอดบัญชี"}</button>
      </form>
    </section>
  )
}

function AdjustmentModal({ kind, busy, onClose, onSave }) {
  const isIncome = kind === "income"
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [occurredAt, setOccurredAt] = useState(bangkokLocalInput())
  const [category, setCategory] = useState(isIncome ? "other_income" : "shop_expense")
  const [error, setError] = useState("")

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previous
    }
  }, [busy, onClose])

  async function submit(event) {
    event.preventDefault()
    if (!amount || money(amount) <= 0) {
      setError("กรุณากรอกจำนวนเงินที่มากกว่า 0")
      return
    }
    if (description.trim().length < 3) {
      setError("กรุณาระบุรายละเอียดอย่างน้อย 3 ตัวอักษร")
      return
    }
    try {
      setError("")
      await onSave({ amount, description: description.trim(), occurredAt, category })
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  const categories = isIncome
    ? [["other_income", "รายรับอื่น"], ["rent", "ค่าเช่า"], ["owner_deposit", "เงินนำเข้าบัญชี"]]
    : [["shop_expense", "ค่าใช้จ่ายร้าน"], ["supplies", "วัตถุดิบ/น้ำยาทาเล็บ"], ["refund", "คืนเงินลูกค้า"], ["bank_fee", "ค่าธรรมเนียมธนาคาร"]]

  return createPortal(
    <div className="app-dialog-backdrop fixed inset-0 z-[1000] grid place-items-center overflow-y-auto bg-ink/45 px-4 py-6 backdrop-blur-[3px]" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="adjustment-title" className="app-dialog-panel w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift">
        <form onSubmit={submit}>
          <div className="px-6 pb-6 pt-6 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="page-eyebrow">Manual bank entry</p>
                <h2 id="adjustment-title" className="mt-1 font-display text-2xl font-semibold">เพิ่ม{isIncome ? "รายรับ" : "รายจ่าย"}</h2>
                <p className="mt-1 text-sm leading-6 text-sagegray">บันทึกเฉพาะรายการที่เกิดขึ้นจริงในบัญชีและไม่ได้มาจาก POS</p>
              </div>
              <button type="button" className="grid h-11 w-11 place-items-center rounded-xl text-xl text-sagegray hover:bg-porcelain" onClick={onClose} aria-label="ปิด">×</button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-ink">
                จำนวนเงิน
                <input autoFocus className="input mt-2" required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-ink">
                ประเภท
                <select className="input mt-2" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-ink sm:col-span-2">
                วันและเวลาที่เกิดรายการ
                <input className="input mt-2" required type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
              </label>
              <label className="block text-sm font-semibold text-ink sm:col-span-2">
                รายละเอียด
                <textarea className="input mt-2 min-h-24 resize-none py-3" required maxLength={500} placeholder={isIncome ? "เช่น รายได้ค่าเช่าพื้นที่" : "เช่น ซื้อน้ำยาทาเล็บสำหรับร้าน"} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
            {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-mist bg-porcelain/65 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" className="btn-ghost sm:min-w-28" disabled={busy} onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="btn-rose sm:min-w-32" disabled={busy}>{busy ? "กำลังบันทึก..." : `บันทึก${isIncome ? "รายรับ" : "รายจ่าย"}`}</button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}
