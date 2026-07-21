import { baht, bangkokDateTime } from './format'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[character]))
}

function paymentLabel(method) {
  return method === 'cash' ? 'เงินสด' : 'PromptPay QR'
}

/**
 * Opens a self-contained 80 mm document. It intentionally uses a separate
 * window so the receipt's paper size never affects the A4 admin receipt.
 */
export function openThermalReceiptWindow(receipt) {
  const printWindow = window.open('', 'nailtime-thermal-receipt', 'width=390,height=720')
  if (!printWindow) throw new Error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up สำหรับหน้านี้')

  printWindow.opener = null
  printWindow.document.title = `ใบเสร็จ ${receipt.order.order_no}`
  printWindow.document.write('<!doctype html><title>กำลังเตรียมใบเสร็จ…</title>')
  printWindow.document.close()
  return printWindow
}

export function printThermalReceipt(printWindow, receipt) {
  const items = (receipt.items || []).map((item) => `
    <div class="item">
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-qty">${Number(item.qty)} ×</div>
      <div class="amount">${escapeHtml(baht(item.line_total))}</div>
    </div>`).join('')
  const member = receipt.member
    ? `<div class="meta">ลูกค้า: ${escapeHtml(receipt.member.name || receipt.member.phone || 'สมาชิก')}</div>`
    : ''
  const discount = Number(receipt.order.discount) > 0
    ? `<div class="total-row"><span>ส่วนลด</span><span>- ${escapeHtml(baht(receipt.order.discount))}</span></div>`
    : ''

  printWindow.document.open()
  printWindow.document.write(`<!doctype html>
    <html lang="th"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ใบเสร็จ ${escapeHtml(receipt.order.order_no)}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      * { box-sizing: border-box; }
      html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: "Noto Sans Thai", Tahoma, sans-serif; font-size: 11px; line-height: 1.45; }
      .receipt { width: 80mm; padding: 4mm 4mm 5mm; }
      .center { text-align: center; } .brand-icon { display: block; width: 27px; height: 27px; margin: 0 auto 3px; stroke: #000; stroke-width: 2; } .store { font-size: 16px; font-weight: 700; } .branch { margin-top: 1px; color: #333; }
      .title { margin: 10px 0 6px; font-size: 13px; font-weight: 700; } .meta { margin-top: 2px; overflow-wrap: anywhere; }
      .rule { border-top: 1px dashed #000; margin: 8px 0; }
      .item { display: grid; grid-template-columns: minmax(0, 1fr) 28px 62px; gap: 5px; align-items: start; margin: 5px 0; }
      .item-name { overflow-wrap: anywhere; } .item-qty { text-align: right; white-space: nowrap; } .amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .total-row { display: flex; justify-content: space-between; gap: 12px; margin: 3px 0; }
      .grand { font-size: 16px; font-weight: 700; margin-top: 5px; } .foot { margin-top: 12px; color: #333; }
      @media print { .receipt { break-inside: avoid; } }
    </style></head><body><main class="receipt">
      <div class="center">
        <svg class="brand-icon" viewBox="0 0 40 40" fill="none" aria-label="Nail Time & Spa">
          <path d="M20 6.5c4.2 3.6 6.3 7.2 6.3 10.7 0 3.8-2.7 6.8-6.3 6.8s-6.3-3-6.3-6.8C13.7 13.7 15.8 10.1 20 6.5Z" />
          <path d="M20 33.5c-4.2-3.6-6.3-7.2-6.3-10.7 0-3.8 2.7-6.8 6.3-6.8s6.3 3 6.3 6.8c0 3.5-2.1 7.1-6.3 10.7Z" />
          <circle cx="20" cy="20" r="3.2" />
        </svg>
        <div class="store">${escapeHtml(receipt.branch.name || 'Nail Time & Spa')}</div>
        <div class="branch">สาขา ${escapeHtml(receipt.branch.code || '-')}</div></div>
      <div class="title center">ใบเสร็จรับเงิน / RECEIPT</div>
      <div class="meta">เลขที่: ${escapeHtml(receipt.order.order_no)}</div>
      <div class="meta">วันที่: ${escapeHtml(bangkokDateTime(receipt.order.paid_at || receipt.order.created_at))}</div>
      ${member}
      <div class="rule"></div>
      ${items}
      <div class="rule"></div>
      <div class="total-row"><span>รวมก่อนส่วนลด</span><span>${escapeHtml(baht(receipt.order.subtotal))}</span></div>
      ${discount}
      <div class="total-row grand"><span>ยอดชำระ</span><span>฿${escapeHtml(baht(receipt.order.total))}</span></div>
      <div class="rule"></div>
      <div class="total-row"><span>ชำระโดย</span><span>${paymentLabel(receipt.payment?.method)}</span></div>
      <div class="center foot">ขอบคุณที่ใช้บริการ<br/>โปรดเก็บใบเสร็จไว้เป็นหลักฐาน</div>
    </main></body></html>`)
  printWindow.document.close()

  window.setTimeout(() => {
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }, 250)
}
