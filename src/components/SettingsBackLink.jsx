import { Link } from 'react-router-dom'

export default function SettingsBackLink() {
  return (
    <Link to="/admin/settings" className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-sagegray transition hover:bg-white hover:text-rosedeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      กลับไปตั้งค่าระบบ
    </Link>
  )
}
