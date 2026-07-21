import { NavLink, Outlet } from "react-router-dom"
import { useAuth } from "../../context/AuthContext.jsx"
import { BrandMark } from "../../components/Brand.jsx"

const tabs = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/reconcile", label: "Reconcile" },
  { to: "/admin/receipts", label: "ประวัติบิล" },
  { to: "/admin/customers", label: "ลูกค้า · Owner" },
  { to: "/admin/approvals", label: "คิวอนุมัติ" },
  { to: "/admin/settings", label: "ตั้งค่าระบบ" },
]

export default function AdminLayout() {
  const { staff, logout } = useAuth()
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_right,_rgba(169,79,97,0.06),_transparent_28%),#f7f4f2] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-mist bg-[#ede8e5] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex min-h-16 items-center justify-between px-4 sm:px-6 lg:min-h-0 lg:block lg:px-5 lg:pb-6 lg:pt-7">
          <BrandMark />
          <div className="flex items-center gap-2 lg:hidden">
            <span className="text-sm font-semibold">{staff.name}</span>
            <button onClick={logout} className="min-h-9 rounded-lg px-3 text-sm font-medium text-sagegray hover:bg-white">ออก</button>
          </div>
        </div>
        <nav aria-label="เมนูหลังบ้าน" className="hide-scrollbar flex gap-1.5 overflow-x-auto px-4 pb-4 sm:px-6 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => (isActive ? "admin-nav-active" : "admin-nav") + " whitespace-nowrap"}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden p-4 lg:block">
          <div className="rounded-2xl border border-white/70 bg-white/55 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sagegray">Signed in as</p>
            <p className="mt-2 font-semibold text-ink">{staff.name}</p>
            <p className="mt-0.5 text-xs text-sagegray">Owner · MAIN</p>
            <button onClick={logout} className="mt-3 min-h-10 w-full rounded-xl border border-mist bg-white text-sm font-semibold text-sagegray transition hover:text-danger">ออกจากระบบ</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
        <div className="page-shell"><Outlet /></div>
      </main>
    </div>
  )
}
