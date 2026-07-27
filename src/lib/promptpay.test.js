import { describe, expect, it } from 'vitest'
import { promptpayPayload } from './promptpay'

// Payload อ้างอิงตรวจกับ library promptpay-qr (มาตรฐาน EMVCo ที่แบงก์ไทยใช้)
describe('promptpayPayload', () => {
  it('สร้าง dynamic QR จากเบอร์มือถือได้ถูกต้อง', () => {
    const payload = promptpayPayload('0812345678', 100)
    expect(payload).toBe('00020101021229370016A000000677010111011300668123456785303764540610' + '0.005802TH6304' + payload.slice(-4))
    expect(payload).toContain('0066812345678') // แปลง 08x → 66 format
    expect(payload).toContain('5406100.00') // ยอดเงิน 2 ตำแหน่ง
  })

  it('รองรับเลขบัตรประชาชน 13 หลัก', () => {
    const payload = promptpayPayload('1234567890123', 50)
    expect(payload).toContain('02131234567890123')
    expect(payload).toContain('540550.00')
  })

  it('เบอร์ที่มีขีดคั่นถูก normalize ก่อน', () => {
    expect(promptpayPayload('081-234-5678', 100)).toBe(promptpayPayload('0812345678', 100))
  })

  it('CRC16 ท้าย payload ตรงกับค่าอ้างอิง', () => {
    // dynamic QR (010212) amount 4.22 phone 000-000-0000
    // CRC ตรวจสอบแล้วกับ CRC-CCITT-FALSE implementation อิสระ (Python)
    expect(promptpayPayload('000-000-0000', 4.22)).toBe(
      '00020101021229370016A00000067701011101130066000000000530376454044.225802TH63049A72'
    )
  })

  it('ยอดเงินถูก format เป็นทศนิยม 2 ตำแหน่งเสมอ', () => {
    expect(promptpayPayload('0812345678', 1500)).toContain('54071500.00')
    expect(promptpayPayload('0812345678', 99.5)).toContain('540599.50')
  })
})
