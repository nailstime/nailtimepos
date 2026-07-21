// Dynamic PromptPay QR (EMVCo payload + CRC16-CCITT)
// รองรับเบอร์มือถือ / เลขบัตรประชาชน — QR generate จากระบบเท่านั้น
function crc16(payload) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
const f = (id, value) => id + String(value.length).padStart(2, '0') + value

export function promptpayPayload(target, amountBaht) {
  const digits = target.replace(/\D/g, '')
  let acct
  if (digits.length >= 13) acct = f('02', digits) // บัตร ปชช.
  else acct = f('01', '0066' + digits.replace(/^0/, '')) // เบอร์มือถือ
  const merchant = f('29', f('00', 'A000000677010111') + acct)
  let p =
    f('00', '01') +
    f('01', '12') + // 12 = dynamic QR ใช้ครั้งเดียว
    merchant +
    f('53', '764') + // THB
    f('54', Number(amountBaht).toFixed(2)) +
    f('58', 'TH') +
    '6304'
  return p + crc16(p)
}
