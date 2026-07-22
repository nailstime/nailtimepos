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
  const [form, setForm] = useState({ kind: "service", category_id: "", name: "", price: "", counts: true })
  const [error, setError] = useState("")

  async function load() {
    const [{ data: sv }, { data: pd }, { data: ct }] = await Promise.all([
      supabase.from("services").select("*").order("sort_order"),
      supabase.from("products").select("*").order("name"),
      supabase.from("catalog_categories").select("*").order("sort_order").order("name"),
    ])
    setServices(sv || []); setProducts(pd || []); setCategories(ct || [])
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
    })

    function beginEdit() {
      setDraft({
        name: it.name,
        price: String(it.price ?? 0),
        counts_toward_points: Boolean(it.counts_toward_points),
        category_id: it.category_id || '',
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
    <div className={"grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-mist py-2.5 text-sm last:border-0 " + (isProduct ? "sm:grid-cols-[minmax(0,1fr)_80px_auto_auto_auto_auto]" : "sm:grid-cols-[minmax(0,1fr)_80px_auto_auto_auto]")}>
      <span className={"flex min-w-0 items-center gap-2 font-semibold " + (!isActive ? "line-through text-sagegray" : "")}><span className="truncate">{it.name}</span>{categoryName(it.category_id) && <span className="badge-neutral shrink-0 no-underline">{categoryName(it.category_id)}</span>}{isProduct && <span className={(Number(it.stock_qty) <= Number(it.low_stock_alert) ? "bg-danger/10 text-danger" : "badge-success") + " shrink-0 rounded-full px-2 py-1 text-xs font-bold no-underline"}>stock {it.stock_qty}</span>}</span>
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
    </div>
    {editing && <form onSubmit={saveEdit} className="border-b border-mist bg-porcelain/65 px-3 py-4 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_160px_140px_auto] xl:items-end">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อรายการ</span><input className="input" required maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">หมวดหมู่</span><select className="input" value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}><option value="">ยังไม่จัดหมวด</option>{categoriesFor(table === 'services' ? 'service' : 'product').map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">{isVariablePrice ? "ช่วงราคา" : "ราคา (บาท)"}</span><input className="input" required disabled={isVariablePrice} inputMode="decimal" value={isVariablePrice ? `${baht(it.min_price)}–${baht(it.max_price)}` : draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />{isVariablePrice && <span className="mt-1 block text-xs text-sagegray">POS จะขอราคาและรายละเอียดทุกครั้ง</span>}</label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-sagegray"><input type="checkbox" className="h-4 w-4 accent-rose" checked={draft.counts_toward_points} onChange={(event) => setDraft({ ...draft, counts_toward_points: event.target.checked })} />นับยอดสะสม NTime</label>
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">ยกเลิก</button><button disabled={saving} className="btn-rose">{saving ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div>
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
