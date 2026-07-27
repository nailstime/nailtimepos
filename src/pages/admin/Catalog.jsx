import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht } from "../../lib/format"
import { useAppDialog } from "../../components/AppDialog.jsx"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

export default function Catalog() {
  const { prompt: openPrompt, confirm: openConfirm } = useAppDialog()
  const [services, setServices] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [promotions, setPromotions] = useState([])
  const [form, setForm] = useState({ kind: "service", category_id: "", name: "", price: "", counts: true })
  const [promotionForm, setPromotionForm] = useState({ name: "", discount_type: "percent", discount_value: "", min_subtotal: "" })
  const [error, setError] = useState("")

  async function load() {
    const results = await Promise.all([
      supabase.from("services").select("*").order("sort_order"),
      supabase.from("products").select("*").order("name"),
      supabase.from("catalog_categories").select("*").order("sort_order").order("name"),
      supabase.rpc("promotion_list"),
    ])
    const failed = results.find((result) => result.error)
    if (failed) return setError(failed.error.message)
    const [{ data: sv }, { data: pd }, { data: ct }, { data: pr }] = results
    setServices(sv || []); setProducts(pd || []); setCategories(ct || []); setPromotions(pr || [])
    setError("")
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.name || !form.price) return
    await supabase.rpc("catalog_create", {
      p_kind: form.kind,
      p_name: form.name,
      p_price: Number(form.price),
      p_counts_toward_points: form.counts,
      p_category: form.category_id || null,
    })
    setForm({ ...form, name: "", price: "" })
    load()
  }

  async function addPromotion() {
    const name = promotionForm.name.trim()
    const value = Number(promotionForm.discount_value)
    const minimum = promotionForm.min_subtotal === '' ? 0 : Number(promotionForm.min_subtotal)
    if (!name) return setError('กรุณาระบุชื่อโปรโมชัน')
    if (!Number.isFinite(value) || value <= 0 || (promotionForm.discount_type === 'percent' && value > 100)) {
      return setError(promotionForm.discount_type === 'percent' ? 'ส่วนลดเปอร์เซ็นต์ต้องมากกว่า 0 และไม่เกิน 100' : 'กรุณาระบุส่วนลดเป็นจำนวนเงินที่มากกว่า 0')
    }
    if (!Number.isFinite(minimum) || minimum < 0) return setError('ยอดขั้นต่ำต้องเป็น 0 หรือมากกว่า')
    setError('')
    const { error: rpcError } = await supabase.rpc('promotion_create', {
      p_name: name,
      p_discount_type: promotionForm.discount_type,
      p_discount_value: value,
      p_min_subtotal: minimum,
    })
    if (rpcError) return setError(rpcError.message)
    setPromotionForm({ name: '', discount_type: 'percent', discount_value: '', min_subtotal: '' })
    load()
  }

  async function togglePromotion(promotion) {
    setError('')
    const { error: rpcError } = await supabase.rpc('promotion_toggle', { p_promotion: promotion.id })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function deletePromotion(promotion) {
    const confirmed = await openConfirm({
      title: 'ลบโปรโมชันถาวร',
      description: `“${promotion.name}” จะไม่สามารถเลือกใช้กับบิลใหม่ได้อีก\n\nบิลเก่าจะยังแสดงชื่อและส่วนลดเดิมครบถ้วน`,
      confirmLabel: 'ลบโปรโมชัน',
      cancelLabel: 'ยกเลิก',
      tone: 'danger',
    })
    if (!confirmed) return
    setError('')
    const { error: rpcError } = await supabase.rpc('promotion_delete', { p_promotion: promotion.id })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function updatePromotion(promotion, draft) {
    const name = draft.name.trim()
    const value = Number(draft.discount_value)
    const minimum = draft.min_subtotal === '' ? 0 : Number(draft.min_subtotal)
    if (!name) return setError('กรุณาระบุชื่อโปรโมชัน')
    if (!Number.isFinite(value) || value <= 0 || (draft.discount_type === 'percent' && value > 100)) return setError('ข้อมูลส่วนลดไม่ถูกต้อง')
    if (!Number.isFinite(minimum) || minimum < 0) return setError('ยอดขั้นต่ำต้องเป็น 0 หรือมากกว่า')
    setError('')
    const { error: rpcError } = await supabase.rpc('promotion_update', {
      p_promotion: promotion.id,
      p_name: name,
      p_discount_type: draft.discount_type,
      p_discount_value: value,
      p_min_subtotal: minimum,
    })
    if (rpcError) {
      setError(rpcError.message)
      return false
    }
    await load()
    return true
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
  async function deleteCatalogItem(table, it) {
    const kind = table === 'services' ? 'service' : 'product'
    const confirmed = await openConfirm({
      title: `ลบ${kind === 'service' ? 'บริการ' : 'สินค้า'}ถาวร`,
      description: `“${it.name}” จะหายจากระบบทันที\n\nลบได้เฉพาะรายการที่ยังไม่มีประวัติบิลหรือสต็อกเท่านั้น หากเคยใช้งานแล้วให้กด “ปิด” แทน`,
      confirmLabel: 'ลบถาวร',
      cancelLabel: 'ยกเลิก',
      tone: 'danger',
    })
    if (!confirmed) return
    setError('')
    const { error: rpcError } = await supabase.rpc('catalog_delete', { p_kind: kind, p_item: it.id })
    if (rpcError) return setError(rpcError.message)
    load()
  }
  async function updateCatalogItem(table, it, draft) {
    const name = draft.name.trim()
    const price = Number(draft.price)
    if (!name) return setError("กรุณาระบุชื่อรายการ")
    if (!Number.isFinite(price) || price < 0) return setError("ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป")
    setError("")
    const { error: rpcError } = await supabase.rpc("catalog_update", {
      p_kind: table === "services" ? "service" : "product",
      p_item: it.id,
      p_name: name,
      p_price: price,
      p_counts_toward_points: draft.counts_toward_points,
      p_category: draft.category_id || null,
    })
    if (rpcError) {
      setError(rpcError.message)
      return false
    }
    if (table === 'services' && Boolean(draft.is_bookable) !== Boolean(it.is_bookable)) {
      const { error: bookingError } = await supabase.rpc('catalog_set_booking_visibility', {
        p_service: it.id,
        p_is_bookable: Boolean(draft.is_bookable),
      })
      if (bookingError) {
        setError(bookingError.message)
        return false
      }
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

  const categoriesFor = (kind) => categories.filter((category) => category.kind === kind)
  const categoryName = (categoryId) => categories.find((category) => category.id === categoryId)?.name || ''

  async function createCategory(kind) {
    const name = await openPrompt({
      title: `เพิ่มหมวด${kind === 'service' ? 'บริการ' : 'สินค้า'}`,
      label: 'ชื่อหมวดหมู่',
      placeholder: kind === 'service' ? 'เช่น เล็บมือ' : 'เช่น สีทาเล็บ',
      required: true,
      maxLength: 80,
      confirmLabel: 'เพิ่มหมวดหมู่',
      validate: (value) => value.trim().length ? null : 'กรุณาระบุชื่อหมวดหมู่',
    })
    if (name === null) return
    setError('')
    const { error: rpcError } = await supabase.rpc('catalog_category_create', { p_kind: kind, p_name: name.trim() })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function renameCategory(category) {
    const name = await openPrompt({
      title: `เปลี่ยนชื่อหมวด ${category.name}`,
      label: 'ชื่อหมวดหมู่',
      initialValue: category.name,
      required: true,
      maxLength: 80,
      confirmLabel: 'บันทึกชื่อ',
      validate: (value) => value.trim().length ? null : 'กรุณาระบุชื่อหมวดหมู่',
    })
    if (name === null || name.trim() === category.name) return
    setError('')
    const { error: rpcError } = await supabase.rpc('catalog_category_rename', { p_category: category.id, p_name: name.trim() })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function deleteCategory(category) {
    const confirmed = await openConfirm({
      title: `ลบหมวด ${category.name}`,
      description: 'รายการในหมวดนี้จะไม่ถูกลบ แต่จะกลับไปอยู่ใน “ยังไม่จัดหมวด”',
      confirmLabel: 'ลบหมวดหมู่',
      cancelLabel: 'ยกเลิก',
      tone: 'danger',
    })
    if (!confirmed) return
    setError('')
    const { error: rpcError } = await supabase.rpc('catalog_category_delete', { p_category: category.id })
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
      counts_toward_points: Boolean(it.counts_toward_points),
      category_id: it.category_id || '',
      is_bookable: Boolean(it.is_bookable),
    })

    function beginEdit() {
      setDraft({
        name: it.name,
        price: String(it.price ?? 0),
        counts_toward_points: Boolean(it.counts_toward_points),
        category_id: it.category_id || '',
        is_bookable: Boolean(it.is_bookable),
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
    <div className={"grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-mist py-2.5 text-sm last:border-0 " + (isProduct ? "sm:grid-cols-[minmax(0,1fr)_80px_auto_auto_auto_auto_auto]" : "sm:grid-cols-[minmax(0,1fr)_80px_auto_auto_auto_auto]")}>
      <span className={"flex min-w-0 items-center gap-2 font-semibold " + (!isActive ? "line-through text-sagegray" : "")}><span className="truncate">{it.name}</span>{categoryName(it.category_id) && <span className="badge-neutral shrink-0 no-underline">{categoryName(it.category_id)}</span>}{!isProduct && <span className={(it.is_bookable ? 'badge-success' : 'badge-neutral') + ' shrink-0 no-underline'}>{it.is_bookable ? 'จองออนไลน์' : 'ไม่แสดงจอง'}</span>}{isProduct && <span className={(Number(it.stock_qty) <= Number(it.low_stock_alert) ? "bg-danger/10 text-danger" : "badge-success") + " shrink-0 rounded-full px-2 py-1 text-xs font-bold no-underline"}>stock {it.stock_qty}</span>}</span>
      <span className="text-right font-bold tabular-nums">{isVariablePrice ? `฿${baht(it.min_price)}–${baht(it.max_price)}` : `฿${baht(it.price)}`}</span>
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
      <button onClick={() => deleteCatalogItem(table, it)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-danger hover:bg-danger/5" aria-label={`ลบ ${it.name}`}>ลบ</button>
    </div>
    {editing && <form onSubmit={saveEdit} className="border-b border-mist bg-porcelain/65 px-3 py-4 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_160px_140px_auto_auto] xl:items-end">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อรายการ</span><input className="input" required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">หมวดหมู่</span><select className="input" value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}><option value="">ยังไม่จัดหมวด</option>{categoriesFor(table === 'services' ? 'service' : 'product').map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">{isVariablePrice ? "ช่วงราคา" : "ราคา (บาท)"}</span><input className="input" required disabled={isVariablePrice} inputMode="decimal" value={isVariablePrice ? `${baht(it.min_price)}–${baht(it.max_price)}` : draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />{isVariablePrice && <span className="mt-1 block text-xs text-sagegray">POS จะขอราคาและรายละเอียดทุกครั้ง</span>}</label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-sagegray"><input type="checkbox" className="h-4 w-4 accent-rose" checked={draft.counts_toward_points} onChange={(event) => setDraft({ ...draft, counts_toward_points: event.target.checked })} />นับยอดสะสม NTime</label>
        {!isProduct && <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-sagegray"><input type="checkbox" className="h-4 w-4 accent-rose" checked={draft.is_bookable} onChange={(event) => setDraft({ ...draft, is_bookable: event.target.checked })} />แสดงในการจองออนไลน์</label>}
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">ยกเลิก</button><button disabled={saving} className="btn-rose">{saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div>
    </form>}
    </>
  }

  const PromotionRow = ({ promotion }) => {
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [draft, setDraft] = useState({
      name: promotion.name,
      discount_type: promotion.discount_type,
      discount_value: String(promotion.discount_value),
      min_subtotal: String(promotion.min_subtotal ?? 0),
    })
    const label = promotion.discount_type === 'percent'
      ? `ลด ${Number(promotion.discount_value)}%`
      : `ลด ฿${baht(promotion.discount_value)}`

    function beginEdit() {
      setDraft({
        name: promotion.name,
        discount_type: promotion.discount_type,
        discount_value: String(promotion.discount_value),
        min_subtotal: String(promotion.min_subtotal ?? 0),
      })
      setEditing(true)
    }

    async function save(event) {
      event.preventDefault()
      setSaving(true)
      const saved = await updatePromotion(promotion, draft)
      setSaving(false)
      if (saved) setEditing(false)
    }

    return <>
      <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-mist py-3 text-sm last:border-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className={'font-semibold ' + (!promotion.active ? 'text-sagegray line-through' : '')}>{promotion.name}</span><span className="badge-neutral">{label}</span></div>
          <p className="mt-1 text-xs text-sagegray">{Number(promotion.min_subtotal) > 0 ? `ใช้ได้เมื่อยอดตั้งแต่ ฿${baht(promotion.min_subtotal)}` : 'ไม่มีขั้นต่ำ'}</p>
        </div>
        <button type="button" onClick={() => togglePromotion(promotion)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-sagegray hover:bg-porcelain hover:text-ink">
          {promotion.active ? 'ปิด' : 'เปิด'}
        </button>
        <button type="button" onClick={beginEdit} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-rosedeep hover:bg-rose/10">แก้ไข</button>
        <button type="button" onClick={() => deletePromotion(promotion)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-danger hover:bg-danger/5">ลบ</button>
      </div>
      {editing && <form onSubmit={save} className="border-b border-mist bg-porcelain/65 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_130px_130px_160px] xl:items-end">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อโปรโมชัน</span><input className="input" required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">รูปแบบส่วนลด</span><select className="input" value={draft.discount_type} onChange={(event) => setDraft({ ...draft, discount_type: event.target.value })}><option value="percent">เปอร์เซ็นต์ (%)</option><option value="fixed">จำนวนเงิน (บาท)</option></select></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">{draft.discount_type === 'percent' ? 'ลดกี่ %' : 'ลดกี่บาท'}</span><input className="input" required min="0.01" max={draft.discount_type === 'percent' ? '100' : undefined} inputMode="decimal" value={draft.discount_value} onChange={(event) => setDraft({ ...draft, discount_value: event.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ยอดขั้นต่ำ (บาท)</span><input className="input" min="0" inputMode="decimal" value={draft.min_subtotal} onChange={(event) => setDraft({ ...draft, min_subtotal: event.target.value })} /></label>
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">ยกเลิก</button><button disabled={saving} className="btn-rose">{saving ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</button></div>
      </form>}
    </>
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading">
        <div><p className="page-eyebrow">Catalog</p><h1 className="page-title">บริการและสินค้า</h1><p className="page-description">จัดการราคา สต็อก และรายการที่ร่วมสะสม NTime</p></div>
      </div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <section className="card mb-5 p-5 sm:p-6">
        <div className="mb-4"><p className="section-title">เพิ่มรายการใหม่</p><p className="section-note">รายการใหม่จะพร้อมใช้งานที่หน้า POS ทันที</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[140px_160px_minmax(200px,1fr)_130px_130px]">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, category_id: "" })}>
            <option value="service">บริการ</option>
            <option value="product">สินค้า</option>
          </select>
          <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
            <option value="">ยังไม่จัดหมวด</option>
            {categoriesFor(form.kind).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <input className="input" placeholder="ชื่อ" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="ราคา" inputMode="decimal" value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <button onClick={add} className="btn-rose">เพิ่มรายการ</button>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl bg-porcelain px-3 text-sm font-medium text-sagegray sm:w-fit">
          <input type="checkbox" className="h-4 w-4 accent-rose" checked={form.counts}
            onChange={(e) => setForm({ ...form, counts: e.target.checked })} />
          นับยอดสะสม NTime
        </label>
      </section>

      <section className="card mb-5 overflow-hidden">
        <div className="border-b border-mist px-5 py-4 sm:px-6">
          <p className="section-title">โปรโมชันและส่วนลด</p>
          <p className="section-note">ส่วนลดจะคำนวณจากยอดก่อนลดใน POS และใช้ได้เพียง 1 โปรโมชันต่อบิล</p>
        </div>
        <div className="border-b border-mist bg-porcelain/45 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_150px_140px_170px_auto] xl:items-end">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อโปรโมชัน</span><input className="input" maxLength={160} value={promotionForm.name} onChange={(event) => setPromotionForm({ ...promotionForm, name: event.target.value })} placeholder="เช่น ลดเปิดร้าน" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">รูปแบบส่วนลด</span><select className="input" value={promotionForm.discount_type} onChange={(event) => setPromotionForm({ ...promotionForm, discount_type: event.target.value })}><option value="percent">เปอร์เซ็นต์ (%)</option><option value="fixed">จำนวนเงิน (บาท)</option></select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">{promotionForm.discount_type === 'percent' ? 'ลดกี่ %' : 'ลดกี่บาท'}</span><input className="input" min="0.01" max={promotionForm.discount_type === 'percent' ? '100' : undefined} inputMode="decimal" value={promotionForm.discount_value} onChange={(event) => setPromotionForm({ ...promotionForm, discount_value: event.target.value })} placeholder={promotionForm.discount_type === 'percent' ? '10' : '100'} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ใช้ได้เมื่อยอดตั้งแต่</span><input className="input" min="0" inputMode="decimal" value={promotionForm.min_subtotal} onChange={(event) => setPromotionForm({ ...promotionForm, min_subtotal: event.target.value })} placeholder="ไม่มีขั้นต่ำ" /></label>
            <button type="button" onClick={addPromotion} className="btn-rose">เพิ่มโปรโมชัน</button>
          </div>
        </div>
        <div className="px-5 py-2 sm:px-6">
          {promotions.map((promotion) => <PromotionRow key={promotion.id} promotion={promotion} />)}
          {promotions.length === 0 && <div className="empty-state my-3">ยังไม่มีโปรโมชัน — เพิ่มส่วนลดที่ต้องการใช้ใน POS ได้จากด้านบน</div>}
        </div>
      </section>

      <section className="card mb-5 p-5 sm:p-6">
        <div><p className="section-title">หมวดหมู่</p><p className="section-note">จัดบริการและสินค้าให้ POS ค้นหาและกรองได้รวดเร็วขึ้น</p></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {['service', 'product'].map((kind) => {
            const kindCategories = categoriesFor(kind)
            const categoryItems = kind === 'service' ? services : products
            return <div key={kind} className="rounded-2xl border border-mist bg-porcelain/45 p-4">
              <div className="flex items-center justify-between gap-3"><p className="font-semibold">{kind === 'service' ? 'หมวดบริการ' : 'หมวดสินค้า'}</p><button type="button" onClick={() => createCategory(kind)} className="btn-ghost min-h-9 px-3">เพิ่มหมวด</button></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {kindCategories.map((category) => <div key={category.id} className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-mist bg-white py-1 pl-3 pr-1 text-sm font-semibold"><span>{category.name}</span><span className="text-xs font-medium text-sagegray">{categoryItems.filter((item) => item.category_id === category.id).length}</span><button type="button" onClick={() => renameCategory(category)} className="rounded-lg px-2 py-1 text-xs text-rosedeep hover:bg-rose/10">แก้ไข</button><button type="button" onClick={() => deleteCategory(category)} className="rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/5">ลบ</button></div>)}
                {kindCategories.length === 0 && <p className="text-sm text-sagegray">ยังไม่มีหมวดหมู่</p>}
              </div>
            </div>
          })}
        </div>
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
