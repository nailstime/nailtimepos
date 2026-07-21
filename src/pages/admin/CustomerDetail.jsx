import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../../lib/supabase.js"
import { baht, bangkokDate, bangkokDateTime, dateOnlyThai } from "../../lib/format.js"

const paymentLabels = { qr: "PromptPay QR", promptpay: "PromptPay", cash: "เงินสด", transfer: "โอนเงิน" }

export default function CustomerDetail() {
  const { memberId } = useParams()
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({ name: "", phone: "", birth_date: "" })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    const { data, error: rpcError } = await supabase.rpc("admin_customer_detail", { p_member: memberId })
    if (rpcError) setError(rpcError.message)
    else {
      setDetail(data)
      setForm({ name: data.member.name || "", phone: data.member.phone || "", birth_date: data.member.birth_date || "" })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    const { error: rpcError } = await supabase.rpc("admin_update_member_profile", {
      p_member: memberId,
      p_name: form.name,
      p_phone: form.phone,
      p_birth_date: form.birth_date || null,
    })
    if (rpcError) setError(rpcError.message)
    else {
      setMessage("บันทึกข้อมูลลูกค้าแล้ว")
      await load()
    }
    setSaving(false)
  }

  if (loading) return <CustomerDetailSkeleton />
  if (error && !detail) return <div className="w-full"><Link to="/admin/customers" className="btn-ghost mb-5">กลับไปรายชื่อลูกค้า</Link><div className="card p-5"><div className="empty-state"><p className="font-semibold text-danger">เปิดข้อมูลลูกค้าไม่ได้</p><p className="mt-1">{error}</p><button onClick={load} className="btn-ghost mt-4">ลองอีกครั้ง</button></div></div></div>

  const { member, stats, favorite_services: favorites, receipts } = detail
  const initial = member.name?.trim()?.charAt(0)?.toUpperCase() || "N"

  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <Link to="/admin/customers" className="inline-flex min-h-10 items-center text-sm font-semibold text-sagegray hover:text-ink">← ลูกค้าทั้งหมด</Link>
          <h1 className="page-title">ประวัติลูกค้า</h1>
          <p className="page-description">ยอดใช้จ่าย บริการที่ใช้บ่อย และบิลย้อนหลังของลูกค้ารายนี้</p>
        </div>
      </div>

      {(message || error) && <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm font-medium ${error ? "border-danger/20 bg-danger/5 text-danger" : "border-success/20 bg-success/5 text-success"}`}>{error || message}</div>}

      <section className="card mb-5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blush text-xl font-bold text-rosedeep">{initial}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-display text-2xl font-semibold">{member.name}</h2>{member.line_linked && <span className="badge-success">เชื่อม LINE แล้ว</span>}</div>
              <p className="mt-1 text-sm text-sagegray">{member.phone} · สมาชิกตั้งแต่ {bangkokDate(member.joined_at)}</p>
              <p className="mt-1 text-sm text-sagegray">วันเกิด {dateOnlyThai(member.birth_date)}</p>
            </div>
          </div>
          <span className="badge-rose">คงเหลือ {member.points_balance} สิทธิ์</span>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="บิลที่ชำระแล้ว" value={`${stats.paid_bills} บิล`} />
        <Stat label="ยอดใช้จ่ายทั้งหมด" value={`฿${baht(stats.lifetime_spend)}`} />
        <Stat label="ยอดเฉลี่ยต่อบิล" value={`฿${baht(stats.average_ticket)}`} />
        <Stat label="มาครั้งล่าสุด" value={stats.last_visit ? bangkokDate(stats.last_visit) : "ยังไม่มี"} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <div className="border-b border-mist px-5 py-4"><p className="section-title">บิลย้อนหลัง</p><p className="section-note">แสดงสูงสุด 50 บิลล่าสุดที่ชำระแล้ว</p></div>
            {receipts.length === 0 ? <div className="p-5"><div className="empty-state">ลูกค้ารายนี้ยังไม่มีบิลที่ชำระแล้ว</div></div> : receipts.map((receipt) => (
              <Link key={receipt.id} to={`/admin/receipts/${receipt.id}`} className="grid min-h-20 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-mist px-5 py-4 transition last:border-b-0 hover:bg-porcelain/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose sm:grid-cols-[minmax(0,1fr)_160px_120px]">
                <div><p className="font-semibold">{receipt.order_no}</p><p className="mt-1 text-xs text-sagegray">{receipt.item_count} รายการ · {paymentLabels[receipt.payment_method] || receipt.payment_method || "ไม่ระบุวิธีชำระ"}</p></div>
                <span className="hidden text-sm text-sagegray sm:block">{bangkokDateTime(receipt.paid_at)}</span>
                <span className="text-right font-semibold">฿{baht(receipt.total)}</span>
              </Link>
            ))}
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-mist px-5 py-4"><p className="section-title">บริการที่ใช้บ่อย</p><p className="section-note">จัดอันดับจากจำนวนครั้งในบิลที่ชำระแล้ว</p></div>
            {favorites.length === 0 ? <div className="p-5"><div className="empty-state">ยังไม่มีประวัติบริการเพียงพอสำหรับจัดอันดับ</div></div> : favorites.map((service, index) => (
              <div key={service.name} className="grid min-h-16 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-mist px-5 py-3 last:border-b-0">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-porcelain text-sm font-bold text-rosedeep">{index + 1}</span>
                <div><p className="font-semibold">{service.name}</p><p className="mt-0.5 text-xs text-sagegray">ล่าสุด {bangkokDate(service.last_used_at)}</p></div>
                <div className="text-right"><p className="font-semibold">{service.usage_count} ครั้ง</p><p className="mt-0.5 text-xs text-sagegray">฿{baht(service.total_spend)}</p></div>
              </div>
            ))}
          </section>
        </div>

        <aside className="card h-fit p-5 sm:p-6 xl:sticky xl:top-8">
          <h2 className="section-title">ข้อมูลลูกค้า</h2>
          <p className="section-note">วันเกิดเป็นข้อมูลส่วนบุคคลและแสดงเฉพาะ Owner</p>
          <form onSubmit={save} className="mt-5 space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อ</span><input className="input" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">เบอร์โทรศัพท์</span><input className="input" required inputMode="tel" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-sagegray">วันเกิด</span><input type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /><span className="mt-1.5 block text-xs text-sagegray">ไม่จำเป็นต้องระบุ หากลูกค้าไม่สะดวกให้ข้อมูล</span></label>
            <button disabled={saving} className="btn-rose w-full">{saving ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button>
          </form>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return <div className="card min-h-28 p-4 sm:p-5"><p className="text-xs font-semibold text-sagegray">{label}</p><p className="mt-3 text-xl font-bold sm:text-2xl">{value}</p></div>
}

function CustomerDetailSkeleton() {
  return <div className="animate-pulse"><div className="mb-5 h-10 w-52 rounded bg-blush/60" /><div className="card mb-5 h-32 bg-white" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((n) => <div key={n} className="card h-28 bg-white" />)}</div></div>
}
