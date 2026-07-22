import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { baht, bangkokMonthStr } from "../../lib/format"
import { useAuth } from "../../context/AuthContext.jsx"
import { useAppDialog } from "../../components/AppDialog.jsx"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

const commissionPeriod = () => bangkokMonthStr()

export default function People() {
  const { staff } = useAuth()
  const { prompt: openPrompt, confirm } = useAppDialog()
  const [staffList, setStaffList] = useState([])
  const [branches, setBranches] = useState([])
  const [branchSelection, setBranchSelection] = useState({})
  const [editingStaffId, setEditingStaffId] = useState(null)
  const [members, setMembers] = useState([])
  const [q, setQ] = useState("")
  const [newStaff, setNewStaff] = useState({ name: "", role: "technician", pin: "", branch_id: "" })
  const [msg, setMsg] = useState("")

  async function load() {
    const [{ data: settings, error: staffError }, { data: mb }] = await Promise.all([
      supabase.rpc("admin_staff_settings"),
      supabase.from("members").select("id,profile_id,branch_id,name,phone,line_user_id,accumulated_baht,points_balance,joined_at").order("joined_at", { ascending: false }).limit(50),
    ])
    if (staffError) return setMsg(staffError.message)
    const nextBranches = settings?.branches || []
    setBranches(nextBranches)
    setStaffList(settings?.staff || [])
    setMembers(mb || [])
    setNewStaff((current) => current.branch_id || nextBranches.length === 0
      ? current
      : { ...current, branch_id: nextBranches[0].id })
  }
  useEffect(() => { load() }, [])

  async function addStaff() {
    setMsg("")
    if (!newStaff.branch_id) return setMsg("กรุณาเลือกสาขาของพนักงาน")
    const { error } = await supabase.rpc("create_staff", {
      p_name: newStaff.name,
      p_role: newStaff.role,
      p_pin: newStaff.pin,
      p_branch: newStaff.branch_id,
    })
    if (error) return setMsg(error.message)
    const assignedBranch = newStaff.branch_id
    setNewStaff({ name: "", role: "technician", pin: "", branch_id: assignedBranch })
    setMsg("เพิ่มพนักงานและผูกสาขาแล้ว")
    load()
  }

  async function moveStaff(s) {
    const branchId = branchSelection[s.id] || s.branch_id
    if (branchId === s.branch_id) return
    const target = branches.find((item) => item.id === branchId)
    if (!target) return setMsg("กรุณาเลือกสาขาที่ใช้งานอยู่")
    const approved = await confirm({
      title: `ย้าย ${s.name} ไป ${target.code}`,
      description: `พนักงานจะถูกออกจากระบบบนเครื่องที่เปิดอยู่ และเมื่อล็อกอินด้วย PIN ครั้งถัดไปจะเข้า POS ของสาขา ${target.name}`,
      confirmLabel: "ย้ายสาขา",
      cancelLabel: "ยกเลิก",
    })
    if (!approved) return
    const { error } = await supabase.rpc("move_staff_branch", { p_staff: s.id, p_branch: branchId })
    setMsg(error ? error.message : `ย้าย ${s.name} ไปสาขา ${target.code} แล้ว`)
    if (!error) {
      setEditingStaffId(null)
      load()
    }
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
    setMsg(error ? error.message : "เปลี่ยน PIN แล้ว และออกจาก session เดิมแล้ว")
  }

  async function toggleStaff(s) {
    const { error } = await supabase.rpc("toggle_staff_active", { p_staff: s.id })
    setMsg(error ? error.message : `${s.active ? "ปิดใช้งาน" : "เปิดใช้งาน"} ${s.name} แล้ว`)
    if (!error) load()
  }

  async function setCommissionBonus(s) {
    const value = await openPrompt({
      title: `โบนัสคอมรอบ ${commissionPeriod()}`,
      description: `${s.name} · สาขา ${s.branch_code}\nโบนัสจะบวกจาก Tier ของทีม และทำงานเมื่อยอดทีมถึงขั้นต่ำเท่านั้น`,
      label: 'เพิ่มจาก Tier ทีม (%)',
      initialValue: String(s.commission_bonus_pct ?? 0),
      placeholder: 'เช่น 1',
      inputMode: 'decimal',
      required: true,
      confirmLabel: 'บันทึกโบนัสค่าคอม',
      helperText: 'กรอก 0 เพื่อล้างโบนัสพิเศษของพนักงานคนนี้',
      validate: (input) => {
        const bonus = Number(input)
        if (!Number.isFinite(bonus) || bonus < 0 || bonus > 100) return 'กรุณากรอกตัวเลขระหว่าง 0–100'
        return null
      },
    })
    if (value === null) return
    const bonus = Number(value)
    const { error } = await supabase.rpc('save_staff_commission_bonus', {
      p_staff: s.id,
      p_effective_month: commissionPeriod(),
      p_bonus_pct: bonus,
    })
    setMsg(error ? error.message : (bonus > 0 ? `ตั้งโบนัสค่าคอม +${bonus}% สำหรับ ${s.name} แล้ว` : `ล้างโบนัสค่าคอมของ ${s.name} แล้ว`))
    if (!error) load()
  }

  async function adjustPoints(m) {
    const changeInput = await openPrompt({
      title: 'ปรับ NTime สมาชิก',
      description: `เพิ่มหรือลดจำนวน NTime ของ ${m.name}`,
      label: 'จำนวนที่ต้องการปรับ',
      initialValue: '1',
      placeholder: 'เช่น 1 หรือ -1',
      inputMode: 'numeric',
      required: true,
      confirmLabel: 'บันทึกการปรับ',
      helperText: 'ใช้จำนวนบวกเพื่อเพิ่ม และจำนวนติดลบเพื่อลด NTime',
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
    setMsg(error ? error.message : "ปรับ NTime แล้ว")
    load()
  }

  const filtered = members.filter((m) => !q || m.name?.includes(q) || m.phone?.includes(q))

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">People</p><h1 className="page-title">พนักงานและสมาชิก</h1><p className="page-description">กำหนดสาขาประจำให้พนักงาน เพื่อให้ PIN พาเข้า POS ได้ถูกสาขา</p></div></div>
      {msg && <p role="status" className="mb-4 rounded-xl border border-mist bg-white px-4 py-3 text-sm font-medium">{msg}</p>}

      <section className="card mb-5 p-5 sm:p-6">
        <p className="section-title">เพิ่มพนักงานใหม่</p>
        <p className="section-note mt-1">ระบุสาขาประจำก่อนเพิ่ม — PIN จะเข้า POS ของสาขานี้เท่านั้น</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">ชื่อพนักงาน</span><input className="input" placeholder="เช่น นิดา" value={newStaff.name} onChange={(event) => setNewStaff({ ...newStaff, name: event.target.value })} /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">สาขาประจำ</span><select className="input" value={newStaff.branch_id} onChange={(event) => setNewStaff({ ...newStaff, branch_id: event.target.value })} disabled={branches.length === 0}><option value="" disabled>เลือกสาขา</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">บทบาท</span><select className="input" value={newStaff.role} onChange={(event) => setNewStaff({ ...newStaff, role: event.target.value })}><option value="technician">ช่าง</option><option value="owner">Owner</option></select></label>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">PIN 6 หลัก</span><input className="input" placeholder="ตัวเลข 6 หลัก" inputMode="numeric" maxLength={6} value={newStaff.pin} onChange={(event) => setNewStaff({ ...newStaff, pin: event.target.value.replace(/\D/g, '') })} /></label>
        </div>
        <button type="button" onClick={addStaff} disabled={branches.length === 0} className="btn-rose mt-5 w-full sm:w-auto">เพิ่มพนักงาน</button>
      </section>

      <section className="card mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">พนักงานในระบบ</p><p className="section-note">ดูสาขาประจำ และจัดการ PIN หรือสถานะ</p></div><span className="badge-neutral">{staffList.length}</span></div>
        <div className="px-5 py-2">
          {staffList.map((s) => {
            const selectedBranch = branchSelection[s.id] || s.branch_id
            const canMove = s.id !== staff?.id
            const isEditing = editingStaffId === s.id
            return (
              <div key={s.id} className="border-b border-mist py-4 last:border-b-0">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className={!s.active ? "line-through text-sagegray" : ""}>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{s.name}</p><span className="badge-neutral">{s.role === "owner" ? "Owner" : "ช่าง"}</span>{Number(s.commission_bonus_pct) > 0 && <span className="badge-rose">Bonus {s.commission_bonus_pct}%</span>}{!s.active && <span className="badge-rose">ปิดใช้งาน</span>}</div>
                    <p className="mt-1.5 text-sm text-sagegray">สาขาประจำ <span className="font-semibold text-ink">{s.branch_code}</span> · {s.branch_name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  {canMove && <button type="button" onClick={() => { setEditingStaffId(isEditing ? null : s.id); setBranchSelection({ ...branchSelection, [s.id]: s.branch_id }) }} className="min-h-10 rounded-xl px-3 font-semibold text-rosedeep hover:bg-rose/10">{isEditing ? "ยกเลิกเปลี่ยนสาขา" : "เปลี่ยนสาขา"}</button>}
                  <button type="button" onClick={() => setCommissionBonus(s)} disabled={!s.active || s.branch_id !== staff?.branch_id} className="min-h-10 rounded-xl px-3 font-semibold text-rosedeep hover:bg-rose/10">โบนัสคอม</button>
                  <button type="button" onClick={() => resetPin(s)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-ink">เปลี่ยน PIN</button>
                  {s.id !== staff?.id && <button type="button" onClick={() => toggleStaff(s)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-danger">{s.active ? "ปิดใช้" : "เปิดใช้"}</button>}
                  </div>
                </div>
                {isEditing && <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-rose/20 bg-rose/5 p-4 sm:flex-row sm:items-end">
                  <label className="block flex-1"><span className="mb-1.5 block text-sm font-semibold text-ink">ย้ายไปสาขา</span><select aria-label={`เลือกสาขาใหม่ของ ${s.name}`} className="input" value={selectedBranch} onChange={(event) => setBranchSelection({ ...branchSelection, [s.id]: event.target.value })}>{branches.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
                  <button type="button" onClick={() => moveStaff(s)} disabled={selectedBranch === s.branch_id} className="btn-rose sm:min-w-32">ยืนยันย้าย</button>
                </div>}
              </div>
            )
          })}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="section-title">สมาชิก</p><p className="section-note">50 รายการล่าสุดของสาขาที่กำลังล็อกอิน</p></div>
          <input aria-label="ค้นหาสมาชิก" className="input sm:w-64" placeholder="ค้นหาชื่อหรือเบอร์โทร" value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <div className="px-5 py-2">
          {filtered.map((m) => (
            <div key={m.id} className="data-row grid-cols-[minmax(0,1fr)_auto] text-sm lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <div><p className="font-semibold">{m.name}</p><p className="mt-1 text-xs text-sagegray">{m.phone}{!m.line_user_id && <span className="text-rosedeep"> · ยังไม่ผูก LINE</span>}</p></div>
              <span className="text-sagegray">สะสม ฿{baht(m.accumulated_baht)}</span>
              <span className="badge-rose">{m.points_balance} NTime</span>
              <button type="button" onClick={() => adjustPoints(m)} className="min-h-10 rounded-xl px-3 font-semibold text-sagegray hover:bg-porcelain hover:text-ink">ปรับ NTime</button>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty-state my-3">ไม่พบสมาชิก</div>}
        </div>
      </section>
    </div>
  )
}
