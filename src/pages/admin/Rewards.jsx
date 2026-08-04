import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { useAppDialog } from "../../components/AppDialog.jsx"
import SettingsBackLink from "../../components/SettingsBackLink.jsx"

export default function Rewards() {
  const { confirm } = useAppDialog()
  const [rewards, setRewards] = useState([])
  const [threshold, setThreshold] = useState("")
  const [form, setForm] = useState({ name: "", points_cost: "1", description: "" })
  const [error, setError] = useState("")

  async function load() {
    const { data } = await supabase.from("rewards").select("*").eq("terminated", false).order("points_cost")
    setRewards(data || [])
    const { data: s } = await supabase.from("settings").select("value").eq("key", "point_threshold_baht").single()
    setThreshold(s?.value || "1500")
  }
  useEffect(() => { load() }, [])

  async function saveThreshold() {
    setError("")
    const { error: rpcError } = await supabase.rpc("set_points_threshold", { p_threshold: Number(threshold) })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function add() {
    if (!form.name) return
    setError("")
    const { error: rpcError } = await supabase.rpc("create_reward", {
      p_name: form.name,
      p_points_cost: Number(form.points_cost),
      p_description: form.description,
    })
    if (rpcError) return setError(rpcError.message)
    setForm({ name: "", points_cost: "1", description: "" })
    load()
  }

  async function toggle(r) {
    setError("")
    const { error: rpcError } = await supabase.rpc("toggle_reward", { p_reward: r.id })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  async function saveEdit(r, draft) {
    setError("")
    const { error: rpcError } = await supabase.rpc("update_reward", {
      p_reward: r.id,
      p_name: draft.name,
      p_points_cost: Number(draft.points_cost),
      p_description: draft.description,
    })
    if (rpcError) { setError(rpcError.message); return false }
    await load()
    return true
  }

  async function terminate(r) {
    const ok = await confirm({
      title: `ยกเลิกรางวัล "${r.name}"`,
      description: `รางวัลนี้จะหายออกจากระบบถาวร สมาชิกและพนักงานจะไม่เห็นอีก\n\nประวัติการแลกที่ผ่านมาจะยังคงอยู่ครบถ้วน`,
      confirmLabel: "ยกเลิกรางวัล",
      cancelLabel: "ไม่ยกเลิก",
      tone: "danger",
    })
    if (!ok) return
    setError("")
    const { error: rpcError } = await supabase.rpc("terminate_reward", { p_reward: r.id })
    if (rpcError) return setError(rpcError.message)
    load()
  }

  const RewardRow = ({ r }) => {
    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [draft, setDraft] = useState({ name: r.name, points_cost: String(r.points_cost), description: r.description || "" })

    function beginEdit() {
      setDraft({ name: r.name, points_cost: String(r.points_cost), description: r.description || "" })
      setEditing(true)
    }

    async function handleSave(event) {
      event.preventDefault()
      if (!draft.name.trim() || Number(draft.points_cost) <= 0) return
      setSaving(true)
      const saved = await saveEdit(r, draft)
      setSaving(false)
      if (saved) setEditing(false)
    }

    return <>
      <div className="data-row grid-cols-[minmax(0,1fr)_auto]">
        <div className={!r.active ? "text-sagegray" : ""}>
          <p className={"font-semibold " + (!r.active ? "line-through" : "")}>{r.name}</p>
          <p className="mt-0.5 text-sm text-sagegray">ใช้ {r.points_cost} NTime{r.description ? ` · ${r.description}` : ""}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggle(r)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-sagegray hover:bg-porcelain hover:text-ink">
            {r.active ? "ปิด" : "เปิด"}
          </button>
          <button onClick={beginEdit} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-rosedeep hover:bg-rose/10">แก้ไข</button>
          <button onClick={() => terminate(r)} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-danger hover:bg-danger/5">ยกเลิก</button>
        </div>
      </div>
      {editing && <form onSubmit={handleSave} className="border-b border-mist bg-porcelain/65 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">ชื่อรางวัล</span>
            <input className="input" required maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">NTime ที่ใช้แลก</span>
            <input className="input" required inputMode="numeric" min="1" value={draft.points_cost} onChange={(e) => setDraft({ ...draft, points_cost: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-sagegray">รายละเอียด (ถ้ามี)</span>
            <input className="input" maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost">ยกเลิก</button>
          <button disabled={saving} className="btn-rose">{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        </div>
      </form>}
    </>
  }

  return (
    <div className="w-full">
      <SettingsBackLink />
      <div className="page-heading"><div><p className="page-eyebrow">Loyalty</p><h1 className="page-title">NTime และรางวัล</h1><p className="page-description">กำหนดเป้าหมายสะสมและรายการที่สมาชิกใช้ NTime แลกได้</p></div></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <div className="mb-5 grid items-stretch gap-5 xl:grid-cols-[.7fr_1.3fr]">
        <section className="card p-5 sm:p-6">
          <p className="section-title">ยอดสะสมต่อ 1 NTime</p>
          <p className="section-note">จำนวนเงินบาทที่สมาชิกต้องสะสม</p>
          <div className="mt-5 flex gap-2">
            <input className="input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <button onClick={saveThreshold} className="btn-rose shrink-0">บันทึก</button>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <p className="section-title">เพิ่มรางวัล</p>
          <p className="section-note">ตั้งชื่อและจำนวน NTime ที่ใช้แลก</p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input className="input md:col-span-2" placeholder="ชื่อรางวัล เช่น เพ้นท์เล็บฟรี" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="ใช้กี่ NTime" inputMode="numeric" value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} />
            <button onClick={add} className="btn-rose">เพิ่ม</button>
          </div>
          <input className="input mt-3" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mist px-5 py-4">
          <div><p className="section-title">รางวัลทั้งหมด</p><p className="section-note">รายการที่แสดงบนหน้า POS และ LINE</p></div>
          <span className="badge-neutral">{rewards.length}</span>
        </div>
        <div className="px-5 py-2">
          {rewards.map((r) => <RewardRow key={r.id} r={r} />)}
          {rewards.length === 0 && <div className="empty-state my-3">ยังไม่มีรางวัล — เพิ่มรายการด้านบน</div>}
        </div>
      </section>
    </div>
  )
}
