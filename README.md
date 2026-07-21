# Nail Time & Spa — POS + CRM (Phase 1)

React + Vite + Tailwind + Supabase สำหรับแท็บเล็ต Android 2 จอ (พนักงาน + ลูกค้า)

## โครงสร้าง

```text
supabase/migrations/001_init.sql             schema, constraints และ indexes
supabase/migrations/002_security_and_api.sql Auth session, RPC, RLS และ explicit grants
supabase/seed.example.sql                    template ตั้งค่าร้าน (ไม่มี secret จริงใน repo)
supabase/functions/line-member/              ตรวจ LINE ID token และบริการสมาชิก
supabase/functions/line-notify/              แจ้งผลชำระเงินทาง LINE
supabase/functions/line-redeem/              ส่งปุ่มยืนยันใช้สิทธิ์
src/pages/pos/PosScreen.jsx                   จอพนักงาน (/pos)
src/pages/display/CustomerDisplay.jsx         จอลูกค้าแบบมี display token
src/pages/admin/                              หลังบ้าน Owner (/admin)
```

## Security model

- Browser สร้าง Supabase anonymous Auth session ก่อนล็อกอิน PIN จากนั้นฐานข้อมูลผูก `auth.uid()` กับพนักงานเป็นเวลา 12 ชั่วโมง
- PIN ผิดครบ 5 ครั้งล็อก session 15 นาที ควรเปิด CAPTCHA/Turnstile และคง Auth rate limit ไว้ด้วย
- Client อ่านข้อมูลผ่าน RLS ตามสาขาและบทบาท แต่ไม่มีสิทธิ์เขียนตารางธุรกรรมโดยตรง
- ราคา ยอดรวม ส่วนลด แต้ม stock และเลขบิลคำนวณใน transaction ฝั่ง Postgres
- จอลูกค้าอ่านข้อมูลที่ตัดแล้วผ่าน token ประจำจอ ไม่สามารถอ่านตารางบิล/สมาชิกโดยตรง
- LIFF ส่ง ID token ให้ Edge Function ตรวจผ่าน LINE ก่อนใช้ LINE user ID
- Edge Functions ที่ส่งข้อความ LINE ตรวจ Supabase user JWT และ staff session ทุกครั้ง

## ติดตั้ง Supabase

1. สร้าง Supabase project และเปิด **Auth → Anonymous Sign-Ins** แนะนำให้เปิด CAPTCHA/Cloudflare Turnstile ด้วย
2. รัน migration ตามลำดับใน SQL Editor:

   ```text
   supabase/migrations/20260720084306_website_security_hardening.sql
   supabase/migrations/20260720084657_pos_schema_integration.sql
   supabase/migrations/20260720084717_pos_security_api_integration.sql
   supabase/migrations/20260720084933_pos_fk_indexes.sql
   ```

3. สำเนา `supabase/seed.example.sql` เป็น `supabase/seed.local.sql` แล้วเปลี่ยนค่าทุก `CHANGE_ME` ได้แก่:

   - branch code เช่น `MAIN`
   - ชื่อสาขา
   - PromptPay ID จริง
   - ชื่อและ PIN Owner
   - display token แบบสุ่มอย่างน้อย 32 ตัวอักษร

   จากนั้นรัน `seed.local.sql` ใน SQL Editor ไฟล์นี้ถูก `.gitignore` ไว้แล้ว

4. ตรวจ Security Advisor และ Database Advisor หลัง migration ก่อนใส่ข้อมูลจริง

## ตั้งค่าแอป

สำเนา `.env.example` เป็น `.env` แล้วใส่ URL, publishable key และ LIFF ID:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_LIFF_ID=YOUR_LIFF_ID
```

จากนั้น:

```bash
npm install
npm run build
```

## ตั้งค่า LINE และ Edge Functions

LIFF app ต้องเปิด scopes `openid` และ `profile` แล้วตั้ง Endpoint URL เป็น `https://YOUR_APP/liff`

ตั้ง secrets โดยไม่ใส่ค่าเหล่านี้ใน `.env` ของ frontend:

```bash
supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=xxx
supabase secrets set LINE_LOGIN_CHANNEL_ID=1234567890
supabase secrets set LIFF_URL=https://liff.line.me/YOUR_LIFF_ID
supabase secrets set DEFAULT_BRANCH_CODE=MAIN
supabase secrets set APP_ORIGIN=https://YOUR_APP
```

Deploy ทั้งสามฟังก์ชัน:

```bash
supabase functions deploy line-member
supabase functions deploy line-notify
supabase functions deploy line-redeem
```

`line-member` เปิดรับ request สาธารณะเพราะใช้ LINE ID token เป็นหลักฐานตัวตน ส่วนอีกสองฟังก์ชันบังคับ Supabase JWT ตาม `supabase/config.toml`

## URL ใช้งาน

| จอ | URL | หมายเหตุ |
|---|---|---|
| ช่าง/แคชเชียร์ | `/pos` | PIN 6 หลัก + session ฝั่ง server |
| Owner | `/admin` | Owner PIN เท่านั้น |
| สมาชิก LINE | `/liff` | ต้องเปิดผ่าน LIFF ที่มี `openid` scope |
| จอลูกค้า | `/display?counter=C1#token=DISPLAY_TOKEN` | token อยู่ใน URL fragment จึงไม่ถูกส่งไปยัง web server |

ไม่มีโหมดปลอม `line_user_id` สำหรับทดสอบ หากต้องทดสอบ LIFF ให้ใช้ LIFF URL หรือ LIFF Inspector เพื่อให้ได้ ID token จริง

## Flow หน้าร้าน

เปิดบิล → Postgres ดึงราคาจริงและสร้างเลขบิลแบบ atomic → จอลูกค้าโหลดรายการผ่าน display token → QR สร้างจากยอดที่ฐานข้อมูลคำนวณ → พนักงานยืนยันรับเงิน → transaction ตัด stock และคำนวณแต้ม → Edge Function แจ้ง LINE

การยกเลิกบิลที่มีสมาชิกต้องยกเลิกจากบิลล่าสุดย้อนขึ้นมาก่อน เพื่อให้สามารถคืนยอดสะสมและแต้มได้ตรงตามลำดับ หากลูกค้าใช้แต้มที่บิลนั้นสร้างไปแล้ว ระบบจะไม่ยอม void จนกว่าจะแก้ยอดสิทธิ์ให้เพียงพอ

## ก่อนเปิดใช้งานจริง

- ทดสอบสร้างบิลพร้อมกันอย่างน้อย 2 เครื่อง
- ทดสอบ stock คงเหลือ 1 ชิ้นแล้วพยายามปิดสองบิลพร้อมกัน
- ทดสอบส่วนลด 0, ติดลบ, เกินยอด และคำขอซ้ำ
- ทดสอบ redemption, void และการคืนสิทธิ์
- ทดสอบ PIN lockout, session หมดอายุ และปิดบัญชีพนักงาน
- หมุน display token ใหม่หาก URL หลุด และห้ามบันทึก token ลง repository

## Phase 2

Payment gateway webhook, เชื่อมระบบจอง, multi-branch UI และ retention report
