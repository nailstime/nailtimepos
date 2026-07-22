import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { supabase } from "../../lib/supabase.js"
import { baht, bangkokDateTime } from "../../lib/format.js"
import { OrderStatusBadge } from "../../components/OrderStatusBadge.jsx"

const paymentLabels = { qr: "PromptPay QR", promptpay: "PromptPay", cash: "เงินสด", transfer: "โอนเงิน" }

export default function ReceiptDetail() {
  const { orderId } = useParams()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    const { data, error: rpcError } = await supabase.rpc("admin_receipt_detail", { p_order: orderId })
    setDetail(data || null)
    setError(rpcError?.message || "")
    setLoading(false)
  }

  useEffect(() => { load() }, [orderId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <ReceiptSkeleton />
  if (error || !detail) return (
    <div className="w-full">
      <Link to="/admin/receipts" className="btn-ghost mb-5">กลับไปประวัติบิล</Link>
      <div className="card p-5"><div className="empty-state"><p className="font-semibold text-danger">เปิดบิลนี้ไม่ได้</p><p className="mt-1">{error || "ไม่พบข้อมูล"}</p><button onClick={load} className="btn-ghost mt-4">ลองอีกครั้ง</button></div></div>
    </div>
  )

  const { order, branch, member, payment, staff, items } = detail
  return (
    <div className="w-full">
      <div className="no-print page-heading">
        <div>
          <Link to="/admin/receipts" className="inline-flex min-h-10 items-center text-sm font-semibold text-sagegray hover:text-ink">← ประวัติบิล</Link>
          <h1 className="page-title">บิล {order.order_no}</h1>
          <p className="page-description">รายละเอียดรายการชำระเงินและผู้ให้บริการ</p>
        </div>
        <button onClick={() => window.print()} className="btn-ghost">พิมพ์ใบเสร็จ</button>
      </div>

      <article className="receipt-paper card mx-auto max-w-4xl overflow-hidden">
        <header className="border-b border-mist px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose">Nail Time & Spa</p>
              <h2 className="mt-2 font-display text-2xl font-semibold">ใบเสร็จรับเงิน</h2>
              <p className="mt-2 text-sm text-sagegray">{branch.name} · สาขา {branch.code}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-lg font-bold">{order.order_no}</p>
              <p className="mt-1 text-sm text-sagegray">{bangkokDateTime(order.paid_at || order.created_at)}</p>
              <div className="mt-3 sm:flex sm:justify-end"><OrderStatusBadge status={order.status} /></div>
            </div>
          </div>
        </header>

        <div className="grid gap-5 border-b border-mist px-5 py-5 sm:grid-cols-2 sm:px-8">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wider text-sagegray">ลูกค้า</p>
            {member ? <>
              <Link to={`/admin/customers/${member.id}`} className="no-print mt-2 inline-block font-semibold text-rosedeep hover:underline">{member.name}</Link>
              <p className="print-only mt-2 font-semibold">{member.name}</p>
              <p className="mt-1 text-sm text-sagegray">{member.phone}</p>
            </> : <p className="mt-2 font-semibold">ลูกค้าทั่วไป</p>}
          </section>
          <section className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-sagegray">การชำระเงิน</p>
            <p className="mt-2 font-semibold">{payment ? paymentLabels[payment.method] || payment.method : "ยังไม่มีการชำระ"}</p>
            {payment?.confirmed_at && <p className="mt-1 text-sm text-sagegray">ยืนยันโดย {payment.confirmed_by || "-"} · {bangkokDateTime(payment.confirmed_at)}</p>}
          </section>
        </div>

        <section className="px-5 py-5 sm:px-8">
          <div className="grid grid-cols-[minmax(0,1fr)_60px_100px] gap-3 border-b border-mist pb-3 text-xs font-semibold text-sagegray sm:grid-cols-[minmax(0,1fr)_160px_60px_110px]">
            <span>รายการ</span><span className="hidden sm:block">ผู้ให้บริการ</span><span className="text-center">จำนวน</span><span className="text-right">รวม</span>
          </div>
          {items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_60px_100px] gap-3 border-b border-mist py-4 text-sm sm:grid-cols-[minmax(0,1fr)_160px_60px_110px]">
            <div><p className="font-semibold">{item.name}</p>{item.custom_price_reason && <p className="mt-1 text-xs font-medium text-rosedeep">รายละเอียดงานพิเศษ: {item.custom_price_reason}</p>}<p className="mt-1 text-xs text-sagegray">฿{baht(item.price)} / รายการ<span className="sm:hidden"> · {item.technician}</span></p></div>
            <span className="hidden text-sagegray sm:block">{item.technician}</span>
            <span className="text-center">{item.qty}</span>
            <span className="text-right font-semibold">฿{baht(item.line_total)}</span>
          </div>)}

          <div className="ml-auto mt-5 max-w-sm space-y-3 text-sm">
            <div className="flex justify-between gap-6"><span className="text-sagegray">ยอดก่อนส่วนลด</span><span>฿{baht(order.subtotal)}</span></div>
            {Number(order.discount) > 0 && <div className="flex justify-between gap-6 text-danger"><span>ส่วนลด</span><span>-฿{baht(order.discount)}</span></div>}
            <div className="flex justify-between gap-6 border-t border-ink pt-4 text-xl font-bold"><span>ยอดสุทธิ</span><span>฿{baht(order.total)}</span></div>
          </div>
        </section>

        <footer className="border-t border-mist bg-porcelain/55 px-5 py-5 text-sm text-sagegray sm:px-8">
          <p>เปิดบิลโดย {staff.opened_by || "-"}{order.points_awarded ? ` · ได้รับ ${order.points_awarded} NTime` : ""}</p>
          {order.void_reason && <p className="mt-2 text-danger">เหตุผลที่ยกเลิก: {order.void_reason}{staff.void_approved_by ? ` · อนุมัติโดย ${staff.void_approved_by}` : ""}</p>}
        </footer>
      </article>
    </div>
  )
}

function ReceiptSkeleton() {
  return <div className="mx-auto max-w-4xl animate-pulse"><div className="mb-5 h-10 w-52 rounded bg-blush/60" /><div className="card h-[560px] bg-white" /></div>
}
