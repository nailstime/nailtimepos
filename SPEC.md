# Spec: Nail Salon POS + CRM Membership System

**Version:** Draft 1.0 (สำหรับรีวิว)
**Stack:** React + Vite + Tailwind + Supabase (Postgres, Realtime, Edge Functions, RLS) + LINE Messaging API
**อุปกรณ์:** แท็บเล็ต Android 2 เครื่อง (จอพนักงาน + จอลูกค้า) รัน browser kiosk mode

---

## 1. เป้าหมายของระบบ

1. ทุกธุรกรรมต้องผ่านระบบ — ป้องกันการไม่ลงบิล / เก็บส่วนต่าง โดยใช้ลูกค้าเป็นผู้ตรวจสอบผ่านจอลูกค้าและ LINE แจ้งแต้มทันที
2. เงินเข้าบัญชีร้านเท่านั้น (QR only, dynamic QR generate จากระบบ)
3. Membership สะสมยอดแลกสิทธิ์ ผูกลูกค้ากับร้าน ไม่ใช่ตัวช่าง
4. เจ้าของ reconcile ยอดได้ใน 5 นาที/วัน ไม่ต้องเฝ้าหน้าร้าน
5. รองรับหลายสาขาในอนาคตตั้งแต่ระดับ schema

---

## 2. ผู้ใช้งานและสิทธิ์ (Roles)

| Role | สิทธิ์ |
|---|---|
| **Owner** | ทุกอย่าง: ตั้งค่าบริการ/ราคา/คอม, ตั้งค่าแต้ม/สิทธิ์, void บิล, ดู dashboard/reconcile, จัดการ staff |
| **Technician (ช่าง)** | เปิดบิล, คีย์รายการ, กดยืนยันรับเงิน, ดูคิว/บิลของตัวเอง — **แก้ราคาไม่ได้, ให้ส่วนลดไม่ได้, void ไม่ได้** |

- Login ด้วย PIN 6 หลักบนแท็บเล็ต โดยผูกกับ Supabase anonymous Auth session ฝั่ง server — ทุก action หา staff_id จาก `auth.uid()` และบันทึก timestamp
- ส่วนลด/แก้ราคา/void ต้องผ่าน owner session เท่านั้น (Owner อนุมัติจากมือถือได้ ไม่ต้องส่ง owner UUID จาก client)

---

## 3. Database Schema (Supabase / Postgres)

ทุกตารางธุรกรรมมี `branch_id` ตั้งแต่วันแรก (default = สาขา 1) เพื่อรองรับขยายสาขาโดยไม่ต้อง migrate

### 3.1 Core

```
branches
  id, name, promptpay_id (เบอร์/เลขบัตร ปชช. ของบัญชีรับเงิน), active

staff
  id, branch_id, name, role (owner|technician), pin_hash, active

services
  id, branch_id (null = ใช้ทุกสาขา), name, price, commission_pct, 
  counts_toward_points (bool, default true), active, sort_order
  -- ค่าคอมเซตรายบริการตอนสร้าง / เลือกได้ว่ารายการนี้นับยอดสะสมสิทธิ์ไหม

products
  id, branch_id, name, price, commission_pct, counts_toward_points (bool),
  stock_qty, low_stock_alert, active

stock_movements
  id, product_id, qty (+รับเข้า / -ขายหรือปรับ), type (purchase|sale|adjust),
  ref_order_id, staff_id, note, created_at
  -- stock_qty อัปเดตผ่าน movement เท่านั้น ห้ามแก้ตรง → audit ได้ทุกชิ้น
```

### 3.2 Orders & Payments

```
orders
  id, branch_id, order_no (running ต่อวัน เช่น 260719-001), member_id (nullable),
  opened_by_staff_id, status (draft → awaiting_payment → paid | void),
  subtotal, discount, total, void_reason, void_approved_by, created_at, paid_at

order_items
  id, order_id, item_type (service|product),
  service_id / product_id, name_snapshot, price_snapshot, commission_pct_snapshot,
  technician_id, qty
  -- snapshot ราคา/คอม ณ วันขาย → แก้ราคาบริการทีหลังไม่กระทบ report ย้อนหลัง
  -- technician_id ต่อรายการ → บิลเดียวช่าง 2 คนแบ่งคอมถูกต้อง

payments
  id, order_id, method (qr|cash), amount, status,
  confirmed_by_staff_id, confirmed_at, verified (bool, default false)
  -- verified จะถูกติ๊กตอน reconcile หรือโดย webhook ใน Phase 2
```

### 3.3 Membership & Points

```
members
  id, name, phone, line_user_id (unique), 
  accumulated_baht (ยอดสะสมคงเหลือที่ยังไม่ครบ threshold),
  points_balance, joined_at, branch_id (สาขาที่สมัคร)

points_ledger
  id, member_id, change (+earn / -redeem), balance_after,
  source (order_paid|redemption|manual_adjust), ref_order_id, ref_redemption_id,
  staff_id (กรณี manual), created_at
  -- points_balance คำนวณจาก ledger เสมอ ห้ามแก้ตรง

rewards
  id, name, points_cost (1, 2, ...), description, active, sort_order
  -- Owner ตั้งเองว่ากี่สิทธิ์แลกอะไร ตาม requirement

redemptions
  id, member_id, reward_id, order_id (บิลที่ใช้สิทธิ์), 
  status (pending → confirmed | cancelled),
  confirmed_via (line_liff), created_at, confirmed_at

settings  (key-value, แก้ได้จากหน้า Owner)
  point_threshold_baht = 1500        -- ยอดสะสมต่อ 1 สิทธิ์
  qr_timeout_minutes, receipt_footer, ...
  -- การนับยอดสะสมกำหนดรายบริการ/สินค้าผ่าน counts_toward_points แทน
```

**Logic การสะสมสิทธิ์** (ทำงานตอน order → paid) — สิทธิ์**ไม่หมดอายุ**:

```
eligible_total = sum(order_items ที่ counts_toward_points = true)
accumulated_baht += eligible_total
points_earned = floor(accumulated_baht / point_threshold_baht)
accumulated_baht = accumulated_baht % point_threshold_baht
points_balance += points_earned  (ผ่าน ledger)
```

ตัวอย่างตามที่ Note ให้: จ่าย 890 → สะสม 890, เหลืออีก 610 บาทได้ 1 สิทธิ์ → LINE แจ้ง:

> ✅ ชำระเงินเรียบร้อย
> รายการชำระวันนี้ 890 บาท
> สะสมเพิ่มอีก 610 บาท รับ 1 สิทธิ์
> สิทธิ์ที่มีตอนนี้: 0 สิทธิ์

### 3.4 ระบบค่าคอม — เลือกได้ 2 แบบ (เปลี่ยนได้เฉพาะรอบเดือน)

```
commission_settings
  id, branch_id, mode (per_service | tiered_monthly),
  effective_month (YYYY-MM), created_by, created_at
  -- โหมดผูกกับเดือน: ตั้งล่วงหน้าได้ แต่มีผลเดือนถัดไปเท่านั้น
  -- แต่ละเดือนมีโหมดเดียวชัดเจน ไม่มีเปลี่ยนกลางเดือน

commission_tiers   (ใช้เมื่อ mode = tiered_monthly)
  id, branch_id, min_amount, max_amount (null = ไม่จำกัด), pct, effective_month
  -- ตัวอย่าง: 0–49,999 → 3% | 50,000–80,000 → 4% | 80,001+ → 5%
```

**Mode A — per_service:** คอม = Σ (price_snapshot × commission_pct_snapshot) ของรายการที่ช่างคนนั้นทำ — คิดจบรายบิลทันที

**Mode B — tiered_monthly:** สิ้นเดือนรวมยอดบริการของช่างแต่ละคน → หา tier ที่ยอดตก → **คูณทั้งก้อนด้วย % ของ tier นั้น** (ไม่ใช่ขั้นบันได) เช่น ยอด 60,000 ตก tier 50,000–80,000 → คอม = 60,000 × 4% = 2,400

กติกา:
- Dashboard ระหว่างเดือนโชว์ "คอมโดยประมาณ ณ tier ปัจจุบัน" ให้ช่างเห็นแรงจูงใจดันยอดขึ้น tier
- order_items เก็บ commission_pct_snapshot ไว้เสมอแม้เดือนนั้นใช้ Mode B — ถ้าสลับโหมดเดือนหน้า ข้อมูลย้อนหลังครบ ไม่ต้อง migrate
- รายงานคอมสิ้นเดือนระบุชัดว่าเดือนนั้นคิดด้วยโหมดไหน + tier ที่ใช้

### 3.5 Reconcile & Dual-screen

```
daily_reconciliations
  id, branch_id, date, system_total, bank_total (Owner กรอก), 
  diff, status (matched|mismatched), note, reconciled_by, created_at

counter_sessions   -- ผูกจอพนักงานกับจอลูกค้า
  id, branch_id, counter_code, staff_screen_token, customer_screen_token, active
```

---

## 4. Flow หลัก

### 4.1 เปิดบิล → จ่ายเงิน (Dual-screen)

1. ช่างเปิดบิลบนจอพนักงาน เลือกบริการ/สินค้า + เลือกช่างผู้ทำต่อรายการ
2. **จอลูกค้าอัปเดต real-time ทุกการคีย์** (Supabase Realtime subscribe order เดียวกัน): รายการ, ราคา, ยอดรวม
3. ถ้าเป็นสมาชิก: ช่างค้นจากเบอร์โทร หรือลูกค้าสแกน QR สมาชิกจาก LINE → จอลูกค้าโชว์ชื่อ + สิทธิ์คงเหลือ + ยอดสะสม
4. กด "ชำระเงิน" → ระบบ generate **dynamic PromptPay QR** (payload ฝังยอดเงิน, บัญชีร้านจาก `branches.promptpay_id`) ขึ้นจอลูกค้า — ช่างเอา QR อื่นมาแสดงแทนไม่ได้
5. ลูกค้าสแกนจ่าย → ช่างเห็นแจ้งเตือนเงินเข้า (แอปธนาคารร้าน/SMS) → กด "ยืนยันรับเงิน" (บันทึก staff_id)
6. Order → paid → trigger:
   - ตัด stock (ถ้ามีสินค้า)
   - คำนวณสิทธิ์ + ledger
   - Edge Function ยิง LINE push แจ้งลูกค้าทันที (ข้อความตามรูปแบบข้อ 3.3)
   - จอลูกค้าโชว์หน้ายืนยัน "ชำระแล้ว + สิทธิ์อัปเดต"

### 4.2 สมัครสมาชิก

1. ลูกค้าสแกน QR เพิ่มเพื่อน LINE OA ที่หน้าร้าน
2. Rich menu → "สมัครสมาชิก" → LIFF form (ชื่อ + เบอร์) → ผูก line_user_id อัตโนมัติ
3. สมัครเสร็จได้ QR สมาชิกใน LINE ไว้สแกนหน้าร้าน

### 4.3 ใช้สิทธิ์ (Redemption) — ต้องยืนยันจากมือถือลูกค้าเท่านั้น

1. ช่างเพิ่มรายการ "ใช้สิทธิ์" ในบิล → เลือก reward
2. ระบบสร้าง redemption (pending) → **LINE push ไปหาลูกค้า "ยืนยันการใช้ 1 สิทธิ์แลก [รายการ]?"**
3. ลูกค้ากดยืนยันใน LINE (LIFF) → redemption confirmed → หักสิทธิ์ผ่าน ledger → จอลูกค้าอัปเดต
4. ช่างกดยืนยันแทนลูกค้าไม่ได้ในทุกกรณี — ปิดช่องเอาสิทธิ์ลูกค้าคนอื่นมาใช้

### 4.4 Reconcile รายวัน (Owner, ~5 นาที)

1. Dashboard โชว์ system_total ของวัน (แยกต่อบิล + คนกดยืนยัน)
2. Owner ดูยอดรวมเงินเข้าจากแอปธนาคาร → กรอก bank_total
3. ตรง = matched ✅ / ไม่ตรง = ระบบลิสต์บิลของวันพร้อม confirmed_by + เวลา ให้ไล่เช็คทันที

### 4.5 Void / ส่วนลด

- ช่างกดขอ void หรือส่วนลด → สถานะ pending → Owner อนุมัติด้วย owner session จากมือถือ → จึงมีผล
- ทุก void เก็บเหตุผล + ผู้อนุมัติ

---

## 5. หน้าจอ (Screens)

**จอพนักงาน (แท็บเล็ต 1):** Login PIN → หน้าขาย (grid บริการ/สินค้า, ตะกร้า, เลือกช่างต่อรายการ, ค้นสมาชิก) → หน้ารอชำระ → ประวัติบิลวันนี้ (ของตัวเอง)

**จอลูกค้า (แท็บเล็ต 2):** Idle (โปรโมชัน + QR สมัครสมาชิก) → รายการบิล real-time → หน้า QR ชำระเงิน → หน้ายืนยัน + สิทธิ์อัปเดต → กลับ idle

**หลังบ้าน Owner (มือถือ/desktop):**
- Dashboard: ยอดวันนี้, จำนวนบิล, ลูกค้าใหม่/เก่า, ยอดต่อช่าง
- Reconcile รายวัน
- จัดการบริการ/ราคา/คอม (+ toggle นับยอดสะสม), สินค้า + stock, rewards + threshold, staff
- ตั้งค่าโหมดค่าคอม (Mode A/B + tier table) — มีผลเดือนถัดไป
- คิวอนุมัติ void/ส่วนลด
- รายงานคอมช่าง (จาก snapshot รายเดือน)

**LINE OA (ลูกค้า):** Rich menu — สมัครสมาชิก / สิทธิ์ของฉัน (LIFF: สิทธิ์คงเหลือ, ยอดสะสม, ประวัติ) / โปรโมชัน

---

## 6. LINE Messaging

| Event | ประเภท | ค่าใช้จ่าย |
|---|---|---|
| แจ้งชำระเงิน + สิทธิ์ | Push รายคน | นับโควต้า push |
| ยืนยัน redemption | Push รายคน | นับโควต้า |
| ลูกค้าเช็คสิทธิ์เอง | LIFF / Reply | ฟรี |
| แคมเปญ | Broadcast | เดือนละ 1–2 ครั้ง |

ที่ 10–15 ลูกค้า/วัน ≈ 300–450 push/เดือน → อยู่ในแพ็กเกจฟรี/เริ่มต้นของ LINE OA สบาย

---

## 7. Phase Plan

**Phase 1 (build ก่อน):**
- POS dual-screen + dynamic PromptPay QR (บัญชีบุคคล)
- พนักงานกดยืนยันรับเงิน + audit trail
- Membership + สะสมสิทธิ์ (threshold ตั้งได้) + LINE push แจ้งทันที
- Redemption ยืนยันผ่าน LINE ลูกค้า
- สินค้า + stock movement
- Dashboard สรุป + Reconcile รายวัน
- Void/ส่วนลดผ่าน Owner approve

**Phase 2 (เมื่อพร้อม/ยอดโตขึ้น):**
- Payment gateway webhook (GB Prime Pay / Omise) → ตัดขั้นตอนกดยืนยัน + reconcile อัตโนมัติ
- เชื่อมระบบจองคิว website เดิม (คิว → เปิดบิลอัตโนมัติ)
- เปิดใช้ multi-branch จริง (schema พร้อมแล้ว)
- รายงานเชิงลึก: retention ครั้งที่ 2, top services, cost ratio สินค้า

---

## 8. Branding & ข้อมูลร้าน (จาก nailtimebytt.com)

- **ชื่อร้าน:** Nail Time & Spa (ネイルタイム) — ดอนหัวฬอ ชลบุรี
- **โทนแบรนด์:** พรีเมียม สไตล์ญี่ปุ่น/เกาหลี (GellyFit Korea) — จอลูกค้าและ LIFF ใช้โทนละมุน เรียบหรู ให้เข้ากับเว็บเดิม
- **LINE OA เดิม:** @nailtimetk22 — ใช้ตัวนี้ต่อ (เพิ่ม Messaging API channel + LIFF)
- **ระบบจองเดิม:** nailtimebytt.com/booking — Phase 2 เชื่อมคิวจอง → เปิดบิลอัตโนมัติ
- **บริการอ้างอิงเริ่มต้น:** ทำเล็บเจล 450, เพ้นท์เล็บ 200, ต่อเล็บเจล / อะคริลิก / PVC (Owner ใส่ราคา+คอมเองในระบบ)
- **เวลาเปิด:** ทุกวัน 09:00–19:00

## 9. ข้อสรุปที่ยืนยันแล้ว

| เรื่อง | ข้อสรุป |
|---|---|
| การนับยอดสะสม | เลือกรายบริการ/สินค้า (`counts_toward_points`) |
| อายุสิทธิ์ | ไม่หมดอายุ |
| ลูกค้าไม่เป็นสมาชิก | ขายได้ปกติ ไม่สะสมสิทธิ์ |
| ค่าคอม | เลือกโหมด A (ต่อบริการ) หรือ B (tier ยอดรวมรายเดือน คูณทั้งก้อน) — เปลี่ยนได้เฉพาะรอบเดือน |
| Threshold สิทธิ์ | 1,500 บาท/สิทธิ์ (ตั้งค่าได้) |
| การชำระเงิน | QR only, PromptPay บุคคล, dynamic QR จากระบบ |
