import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht } from "../../lib/format"
import { useAppDialog } from "../../components/AppDialog.jsx"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

export default function Catalog() {
  const { prompt: openPrompt, confirm: openConfirm } = useAppDialog()
  const [services, setServices] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({ kind: "service", name: "", price: "", commission_pct: "", counts: true })
  const [error, setError] = useState("")

  async function load() {
    const [{ data: sv }, { data: pd }] = await Promise.all([
      supabase.from("services").select("*").order("sort_order"),
      supabase.from("products").select("*").order("name"),
    ])
    setServices(sv || []); setProducts(pd || [])
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.name || !form.price) return
    await supabase.rpc("catalog_create", {
      p_kind: form.kind,
      p_name: form.name,
      p_price: Number(form.price),
      p_commission_pct: Number(form.commission_pct || 0),
      p_counts_toward_points: form.counts,
    })
    setForm({ ...form, name: "", price: "", commission_pct: "" })
    load()
  }

  async function toggleCounts(table, it) {
    setError("")
    const { error: rpcError } = await supabase.rpc("catalog_toggle", {
      p_kind: table === "services" ? "service" : "product",
      p_item: it.id,
      p_field: "counts_toward_points",
    })
    if (rpcError) return setError(rpcError.message)
    load()
  }
  async function toggleActive(table, it) {
    setError("")
    const { error: rpcError } = await supabase.rpc("catalog_toggle", {
      p_kind: table === "services" ? "service" : "product",
      p_item: it.id,
      p_field: "active",
    })
    if (rpcError) return setError(rpcError.message)
    load()
  }
  async function updateCatalogItem(table, it, draft) {
    const name = draft.name.trim()
    const price = Number(draft.price)
    const commissionPct = Number(draft.commission_pct)
    if (!name) return setError("กรุณาระบุชื่อรายการ")
    if (!Number.isFinite(price) || price < 0) return setError("ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป")
    if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) return setError("ค่าคอมต้องอยู่ระหว่าง 0–100%")
    setError("")
    const { error: rpcError } = await supabase.rpc("catalog_update", {
      p_kind: table === "services" ? "service" : "product",
      p_item: it.id,
      p_name: name,
      p_price: price,
      p_commission_pct: commissionPct,
      p_counts_toward_points: draft.counts_toward_points,
    })
    if (rpcError) {
      setError(rpcError.message)
      return false
    }
    await load()
    return true
  }
  async function receiveStock(p) {
    const qtyInput = await openPrompt({
      title: 'รับสินค้าเข้าสต็อก',
      description: `${p.name} มีคงเหลือปัจจุบัน ${p.stock_qty} ชิ้น`,
      label: 'จำนวนที่รับเข้า',
      initialValue: '10',
      placeholder: '0',
      inputMode: 'numeric',
      required: true,
      confirmLabel: 'ยืนยันรับสินค้า',
      helperText: 'จำนวนนี้จะถูกบวกเข้ากับสต็อกปัจจุบัน',
      validate: (value) => {
        const amount = Number(value)
        if (!Number.isInteger(amount) || amount <= 0) return 'กรุณากรอกจำนวนเต็มที่มากกว่า 0'
        return null
      },
    })
    if (qtyInput === null) return
    const qty = Number(qtyInput)
    const note = await openPrompt({
      title: 'รายละเอียดการรับเข้า',
      description: `${p.name} · รับเข้า ${qty} ชิ้น`,
      label: 'แหล่งที่มา / หมายเหตุ',
      placeholder: 'เช่น ซื้อเพิ่มจากร้าน ABC',
      required: true,
      maxLength: 500,
      confirmLabel: 'ตรวจสอบรายการ',
      validate: (value) => value.trim().length >= 2 ? null : 'กรุณาระบุรายละเอียดอย่างน้อย 2 ตัวอักษร',
    })
    if (note === null) return
    const confirmed = await openConfirm({
      title: 'ยืนยันรับสินค้าเข้า',
      description: `${p.name}\nสต็อก ${p.stock_qty} → ${Number(p.stock_qty) + qty} ชิ้น\n${note.trim()}`,
      confirmLabel: 'ยืนยันรับเข้า',
      cancelLabel: 'กลับไปแก้ไข',
    })
    if (!confirmed) return
    setError("")
    const { error: rpcError } = await supabase.rpc("receive_stock", { p_product: p.id, p_qty: qty, p_note: note.trim() })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function adjustStock(p) {
    const qtyInput = await openPrompt({
      title: 'ตัดสต็อก',
      description: `${p.name} · คงเหลือ ${p.stock_qty} ชิ้น`,
      label: 'จำนวนที่ต้องการตัดออก',
      placeholder: '0',
      inputMode: 'numeric',
      required: true,
      confirmLabel: 'ถัดไป',
      helperText: 'ใช้สำหรับสินค้าชำรุด สูญหาย หรือจำนวนคลาดเคลื่อน',
      validate: (value) => {
        const amount = Number(value)
        if (!Number.isInteger(amount) || amount <= 0) return 'กรุณากรอกจำนวนเต็มที่มากกว่า 0'
        if (amount > Number(p.stock_qty)) return `ตัดได้ไม่เกิน ${p.stock_qty} ชิ้น`
        return null
      },
    })
    if (qtyInput === null) return
    const qty = Number(qtyInput)
    const reason = await openPrompt({
      title: 'เหตุผลการตัดสต็อก',
      description: `${p.name} · ตัดออก ${qty} ชิ้น`,
      label: 'เหตุผล',
      placeholder: 'เช่น สินค้าชำรุด 2 ชิ้น',
      required: true,
      maxLength: 500,
      confirmLabel: 'ตรวจสอบรายการ',
      validate: (value) => value.trim().length >= 2 ? null : 'กรุณาระบุเหตุผลอย่างน้อย 2 ตัวอักษร',
    })
    if (reason === null) return
    const confirmed = await openConfirm({
      title: 'ยืนยันตัดสต็อก',
      description: `${p.name}\nสต็อก ${p.stock_qty} → ${Number(p.stock_qty) - qty} ชิ้น\nเหตุผล: ${reason.trim()}`,
      confirmLabel: 'ยืนยันตัดสต็อก',
      cancelLabel: 'กลับไปแก้ไข',
      tone: 'danger',
    })
    if (!confirmed) return
    setError("")
    const { error: rpcError } = await supabase.rpc("adjust_stock", { p_product: p.id, p_qty_change: -qty, p_note: reason.trim() })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  const Row = ({ it, table, isProduct }) => {
    const isActive = table === "services" ? it.is_active : it.active
    const isVariablePrice = table === "services" && it.price_mode === "variable"
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [draft, setDraft] = useState({
      name: it.name,
      price: String(it.price ?? 0),
      commission_pct: String(it.commission_pct ?? 0),
      counts_toward_points: Boolean(it.counts_toward_points),
    })

    function beginEdit() {
      setDraft({
        name: it.name,
        price: String(it.price ?? 0),
        commission_pct: String(it.commission_pct ?? 0),
        counts_toward_points: Boolean(it.counts_toward_points),
      })
      setEditing(true)
    }

    async function saveEdit(event) {
      event.preventDefault()
      setSaving(true)
      const saved = await updateCatalogItem(table, it, draft)
      setSaving(false)
      if (saved) setEditing(false)
    }

    return <>
    <div className={"grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-mist py-2.5 text-sm last:border-0 " + (isProduct ? "sm:grid-cols-[minmax(0,1fr)_80px_72px_72px_auto_auto_auto]" : "sm:grid-cols-[minmax(0,1fr)_80px_72px_auto_auto_auto]")}>
      <span className={"flex min-w-0 items-center gap-2 font-semibold " + (!isActive ? "line-through text-sagegray" : "")}><span className="truncate">{it.name}</span>{isProduct && <span className={(Number(it.stock_qty) <= Number(it.low_stock_alert) ? "bg-danger/10 text-danger" : "badge-success") + " shrink-0 rounded-full px-2 py-1 text-xs font-bold no-underline"}>stock {it.stock_qty}</span>}</span>
      <span className="text-right font-bold tabular-nums">{isVariablePrice ? `฿${baht(it.min_price)}–${baht(it.max_price)}` : `฿${baht(it.price)}`}</span>
      <span className="text-right text-sagegray">คอม {it.commission_pct}%</span>
      {isProduct && (
        <div className="flex items-center justify-end gap-1"><button onClick={() => receiveStock(it)} className="min-h-9 rounded-lg px-1.5 text-xs font-semibold text-rosedeep hover:bg-rose/10">รับเข้า</button><button onClick={() => adjustStock(it)} className="min-h-9 rounded-lg px-1.5 text-xs font-semibold text-danger hover:bg-danger/5">ตัด</button></div>
      )}
      <button onClick={() => toggleCounts(table, it)}
        className={"min-h-9 rounded-lg px-2.5 text-xs font-semibold " + (it.counts_toward_points ? "bg-rose/10 text-rosedeep" : "bg-porcelain text-sagegray")}>
        {it.counts_toward_points ? "นับสะสม" : "ไม่นับ"}
      </button>
      <button onClick={() => toggleActive(table, it)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-sagegray hover:bg-porcelain hover:text-ink" aria-label={`${isActive ? "ปิด" : "เปิด"} ${it.name}`}>
        {isActive ? "ปิด" : "เปิด"}
      </button>
      <button onClick={beginEdit} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-rosedeep hover:bg-rose/10" aria-label={`แก้ไข ${it.name}`}>แก้ไข</button>
    </div>
    {editing && <form onSubmit={saveEdit} className="border-b border-mist bg-porcelain/65 px-3 py-4 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_140px_140px_auto] xl:items-end">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อรายการ</span><input className="input" required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">{isVariablePrice ? "ช่วงราคา" : "ราคา (บาท)"}</span><input className="input" required disabled={isVariablePrice} inputMode="decimal" value={isVariablePrice ? `${baht(it.min_price)}–${baht(it.max_price)}` : draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />{isVariablePrice && <span className="mt-1 block text-xs text-sagegray">POS จะขอราคาและรายละเอียดทุกครั้ง</span>}</label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ค่าคอม (%)</span><input className="input" required inputMode="decimal" value={draft.commission_pct} onChange={(event) => setDraft({ ...draft, commission_pct: event.target.value })} /></label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-sagegray"><input type="checkbox" className="h-4 w-4 accent-rose" checked={draft.counts_toward_points} onChange={(event) => setDraft({ ...draft, counts_toward_points: event.target.checked })} />นับยอดสะสมสิทธิ์</label>
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">ยกเลิก</button><button disabled={saving} className="btn-rose">{saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div>
    </form>}
    </>
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading">
        <div><p className="page-eyebrow">Catalog</p><h1 className="page-title">บริการและสินค้า</h1><p className="page-description">จัดการราคา ค่าคอมมิชชัน สต็อก และรายการที่ร่วมสะสมสิทธิ์</p></div>
      </div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <section className="card mb-5 p-5 sm:p-6">
        <div className="mb-4"><p className="section-title">เพิ่มรายการใหม่</p><p className="section-note">รายการใหม่จะพร้อมใช้งานที่หน้า POS ทันที</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[160px_minmax(220px,1fr)_160px_160px_140px]">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="service">บริการ</option>
            <option value="product">สินค้า</option>
          </select>
          <input className="input" placeholder="ชื่อ" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="ราคา" inputMode="decimal" value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <input className="input" placeholder="คอม %" inputMode="decimal" value={form.commission_pct}
            onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} />
          <button onClick={add} className="btn-rose">เพิ่มรายการ</button>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl bg-porcelain px-3 text-sm font-medium text-sagegray sm:w-fit">
          <input type="checkbox" className="h-4 w-4 accent-rose" checked={form.counts}
            onChange={(e) => setForm({ ...form, counts: e.target.checked })} />
          นับยอดสะสมสิทธิ์
        </label>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-2">
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">บริการ</p><p className="section-note">รายการสำหรับหน้าร้าน</p></div><span className="badge-neutral">{services.length}</span></div>
        <div className="px-5 py-2">
        {services.map((it) => <Row key={it.id} it={it} table="services" />)}
        </div>
      </section>
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">สินค้า</p><p className="section-note">รับเข้า หรือตัดสต็อกพร้อมเหตุผลและการยืนยัน</p></div><span className="badge-neutral">{products.length}</span></div>
        <div className="px-5 py-2">
        {products.map((it) => <Row key={it.id} it={it} table="products" isProduct />)}
        {products.length === 0 && <div className="empty-state my-3">ยังไม่มีสินค้า</div>}
        </div>
      </section>
      </div>
    </div>
  )
}
