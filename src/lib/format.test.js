import { describe, expect, it } from 'vitest'
import { baht, bangkokDateStr, bangkokDayRange } from './format'

describe('baht', () => {
  it('จำนวนเต็มไม่แสดงทศนิยม', () => {
    expect(baht(1500)).toBe('1,500')
    expect(baht(0)).toBe('0')
  })
  it('มีสตางค์แสดง 2 ตำแหน่งเสมอ (150.50 ต้องไม่กลายเป็น 150.5)', () => {
    expect(baht(150.5)).toBe('150.50')
    expect(baht(99.99)).toBe('99.99')
  })
  it('ค่า null/undefined/string ตัวเลข ไม่พัง', () => {
    expect(baht(null)).toBe('0')
    expect(baht(undefined)).toBe('0')
    expect(baht('1234.5')).toBe('1,234.50')
  })
})

describe('bangkok date helpers', () => {
  it('bangkokDateStr คืนรูปแบบ YYYY-MM-DD ตามโซนไทย', () => {
    // 2026-01-01 23:30 Bangkok = 16:30 UTC
    expect(bangkokDateStr(new Date('2026-01-01T16:30:00Z'))).toBe('2026-01-01')
    // ข้ามวันเมื่อเลยเที่ยงคืนไทย
    expect(bangkokDateStr(new Date('2026-01-01T17:30:00Z'))).toBe('2026-01-02')
  })
  it('bangkokDayRange ครอบ 24 ชั่วโมงพอดี', () => {
    const { start, end } = bangkokDayRange('2026-07-27')
    expect(start).toBe('2026-07-26T17:00:00.000Z')
    expect(end).toBe('2026-07-27T17:00:00.000Z')
  })
})
