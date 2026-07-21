import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

export default function Rewards() {
  const [rewards, setRewards] = useState([])
  const [threshold, setThreshold] = useState("")
  const [form, setForm] = useState({ name: "", points_cost: "1", description: "" })

  async function load() {
    const { data } = await supabase.from("rewards").select("*").order("points_cost")
    setRewards(data || [])
    const { data: s } = await supabase.from("settings").select("value").eq("key", "point_threshold_baht").single()
    setThreshold(s?.value || "1500")
  }
  useEffect(() => { load() }, [])

  async function saveThreshold() {
    await supabase.rpc("set_points_threshold", { p_threshold: Number(threshold) })
    load()
  }
  async function add() {
    if (!form.name) return
    await supabase.rpc("create_reward", {
      p_name: form.name,
      p_points_cost: Number(form.points_cost),
      p_description: form.description,
    })
    setForm({ name: "", points_cost: "1", description: "" })
    load()
  }
  async function toggle(r) {
    await supabase.rpc("toggle_reward", { p_reward: r.id })
    load()
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">Loyalty</p><h1 className="page-title">สิทธิ์และรางวัล</h1><p className="page-description">กำหนดเป้าหมายสะสมและรายการที่สมาชิกใช้สิทธิ์แลกได้</p></div></div>
      <div className="mb-5 grid items-stretch gap-5 xl:grid-cols-[.7fr_1.3fr]">
      <section className="card p-5 sm:p-6">
        <p className="section-title">ยอดสะสมต่อ 1 สิทธิ์</p>
        <p className="section-note">จำนวนเงินบาทที่สมาชิกต้องสะสม</p>
        <div className="mt-5 flex gap-2">
          <input className="input" inputMode="decimal" value={threshold}
            onChange={(e) => setThreshold(e.target.value)} />
          <button onClick={saveThreshold} className="btn-rose shrink-0">บันทึก</button>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <p className="section-title">เพิ่มรางวัล</p>
        <p className="section-note">ตั้งชื่อและจำนวนสิทธิ์ที่ใช้แลก</p>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <input className="input md:col-span-2" placeholder="ชื่อรางวัล เช่น เพ้นท์เล็บฟรี"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="ใช้กี่สิทธิ์" inputMode="numeric"
            value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} />
          <button onClick={add} className="btn-rose">เพิ่ม</button>
        </div>
        <input className="input mt-3" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4"><div><p className="section-title">รางวัลทั้งหมด</p><p className="section-note">รายการที่แสดงบนหน้า POS และ LINE</p></div><span className="badge-neutral">{rewards.length}</span></div>
        <div className="px-5 py-2">
        {rewards.map((r) => (
          <div key={r.id} className="data-row grid-cols-[minmax(0,1fr)_auto]">
            <div className={!r.active ? "line-through text-sagegray" : ""}>
              <p className="font-semibold">{r.name}</p><p className="mt-1 text-sm text-sagegray">ใช้ {r.points_cost} สิทธิ์</p>
            </div>
            <button onClick={() => toggle(r)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-sagegray hover:bg-porcelain hover:text-ink">
              {r.active ? "ปิด" : "เปิด"}
            </button>
          </div>
        ))}
        {rewards.length === 0 && <div className="empty-state my-3">ยังไม่มีรางวัล — เพิ่มรายการด้านบน</div>}
        </div>
      </section>
    </div>
  )
}
