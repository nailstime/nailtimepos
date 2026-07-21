import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht } from "../../lib/format"
import { useAuth } from "../../context/AuthContext.jsx"
import { useAppDialog } from "../../components/AppDialog.jsx"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

export default function People() {
  const { staff } = useAuth()
  const { prompt: openPrompt } = useAppDialog()
  const [staffList, setStaffList] = useState([])
  const [members, setMembers] = useState([])
  const [q, setQ] = useState("")
  const [newStaff, setNewStaff] = useState({ name: "", role: "technician", pin: "" })
  const [msg, setMsg] = useState("")

  async function load() {
    const [{ data: st }, { data: mb }] = await Promise.all([
      supabase.from("staff").select("id,branch_id,name,role,active,created_at").order("created_at"),
      supabase.from("members").select("id,profile_id,branch_id,name,phone,line_user_id,accumulated_baht,points_balance,joined_at").order("joined_at", { ascending: false }).limit(50),
    ])
    setStaffList(st || []); setMembers(mb || [])
  }
  useEffect(() => { load() }, [])

  async function addStaff() {
    setMsg("")
    const { error } = await supabase.rpc("create_staff", {
      p_name: newStaff.name, p_role: newStaff.role, p_pin: newStaff.pin,
    })
    if (error) return setMsg(error.message)
    setNewStaff({ name: "", role: "technician", pin: "" })
    setMsg("เพิ่มพนักงานแล้ว")
    load()
  }
  async function resetPin(s) {
    const pin = await openPrompt({
      title: 'เปลี่ยน PIN พนักงาน',
      description: `ตั้ง PIN สำหรับ ${s.name} เพื่อใช้เข้าสู่ระบบหน้าร้าน`,
      label: 'PIN ใหม่ 6 หลัก',
      placeholder: '••••••',
      type: 'password',
      inputMode: 'numeric',
      maxLength: 6,
      required: true,
      confirmLabel: 'บันทึก PIN',
      helperText: 'ใช้ตัวเลข 6 หลักและไม่ควรใช้เลขที่คาดเดาง่าย',
      validate: (value) => /^\d{6}$/.test(value) ? null : 'PIN ต้องเป็นตัวเลข 6 หลัก',
    })
    if (pin === null) return
    const { error } = await supabase.rpc("reset_staff_pin", { p_staff: s.id, p_pin: pin })
    setMsg(error ? error.message : "เปลี่ยน PIN แล้ว")
  }
  async function toggleStaff(s) {
    await supabase.rpc("toggle_staff_active", { p_staff: s.id })
    load()
  }
  async function adjustPoints(m) {
    const changeInput = await openPrompt({
      title: 'ปรับสิทธิ์สมาชิก',
      description: `เพิ่มหรือลดจำนวนสิทธิ์ของ ${m.name}`,
      label: 'จำนวนที่ต้องการปรับ',
      initialValue: '1',
      placeholder: 'เช่น 1 หรือ -1',
      inputMode: 'numeric',
      required: true,
      confirmLabel: 'บันทึกการปรับ',
      helperText: 'ใช้จำนวนบวกเพื่อเพิ่ม และจำนวนติดลบเพื่อลดสิทธิ์',
      validate: (value) => {
        const amount = Number(value)
        if (!Number.isInteger(amount) || amount === 0) return 'กรุณากรอกจำนวนเต็มที่ไม่เท่ากับ 0'
        return null
      },
    })
    if (changeInput === null) return
    const change = Number(changeInput)
    if (!change) return
    const { error } = await supabase.rpc("adjust_member_points", {
      p_member: m.id, p_change: change, p_note: "manual",
    })
    setMsg(error ? error.message : "ปรับสิทธิ์แล้ว")
    load()
  }

  const filtered = members.filter((m) =>
    !q || m.name?.includes(q) || m.phone?.includes(q))

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">People</p><h1 className="page-title">พนักงานและสมาชิก</h1><p className="page-description">ดูแลสิทธิ์พนักงาน PIN และข้อมูลสมาชิกจากพื้นที่เดียว</p></div></div>
      {msg && <p role="status" className="mb-4 rounded-xl border border-mist bg-white px-4 py-3 text-sm font-medium">{msg}</p>}
      <section className="card mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">พนักงาน</p><p className="section-note">จัดการบทบาท สถานะ และ PIN</p></div><span className="badge-neutral">{staffList.length}</span></div>
        <div className="px-5 py-2">
        {staffList.map((s) => (
          <div key={s.id} className="data-row grid-cols-[minmax(0,1fr)_auto] text-sm">
            <div className={!s.active ? "line-through text-sagegray" : ""}>
              <p className="font-semibold">{s.name}</p><p className="mt-1 text-xs text-sagegray">{s.role === "owner" ? "Owner" : "ช่าง"} · {s.active ? "ใช้งานอยู่" : "ปิดใช้งาน"}</p>
            </div>
            <span className="flex flex-wrap justify-end gap-1.5">
              <button onClick={() => resetPin(s)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-ink">เปลี่ยน PIN</button>
              {s.id !== staff.id && (
                <button onClick={() => toggleStaff(s)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-danger">
                  {s.active ? "ปิดใช้" : "เปิดใช้"}
                </button>
              )}
            </span>
          </div>
        ))}
        </div>
        <div className="border-t border-mist bg-porcelain/55 p-5">
          <p className="mb-3 text-sm font-bold">เพิ่มพนักงานใหม่</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_180px_180px_140px]">
          <input className="input" placeholder="ชื่อ" value={newStaff.name}
            onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} />
          <select className="input" value={newStaff.role}
            onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}>
            <option value="technician">ช่าง</option>
            <option value="owner">Owner</option>
          </select>
          <input className="input" placeholder="PIN 6 หลัก" inputMode="numeric" value={newStaff.pin}
            onChange={(e) => setNewStaff({ ...newStaff, pin: e.target.value })} />
          <button onClick={addStaff} className="btn-rose text-sm">เพิ่ม</button>
        </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="section-title">สมาชิก</p><p className="section-note">50 รายการล่าสุด</p></div>
          <input aria-label="ค้นหาสมาชิก" className="input sm:w-64" placeholder="ค้นหาชื่อหรือเบอร์โทร" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="px-5 py-2">
        {filtered.map((m) => (
          <div key={m.id} className="data-row grid-cols-[minmax(0,1fr)_auto] text-sm lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div><p className="font-semibold">{m.name}</p><p className="mt-1 text-xs text-sagegray">{m.phone}{!m.line_user_id && <span className="text-rosedeep"> · ยังไม่ผูก LINE</span>}</p></div>
            <span className="text-sagegray">สะสม ฿{baht(m.accumulated_baht)}</span>
            <span className="badge-rose">{m.points_balance} สิทธิ์</span>
            <button onClick={() => adjustPoints(m)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-ink">ปรับสิทธิ์</button>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state my-3">ไม่พบสมาชิก</div>}
        </div>
      </section>
    </div>
  )
}
