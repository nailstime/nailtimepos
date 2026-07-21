const labels = {
  draft: "แบบร่าง",
  awaiting_payment: "รอชำระ",
  paid: "ชำระแล้ว",
  void: "ยกเลิก",
}

export function OrderStatusBadge({ status }) {
  const tone = status === "paid"
    ? "badge-success"
    : status === "void"
      ? "border-danger/20 bg-danger/5 text-danger"
      : status === "awaiting_payment"
        ? "badge-rose"
        : "badge-neutral"

  return (
    <span className={`badge ${tone}`}>
      {labels[status] || status || "ไม่ทราบสถานะ"}
    </span>
  )
}

export const orderStatusLabel = (status) => labels[status] || status || "ไม่ทราบสถานะ"
