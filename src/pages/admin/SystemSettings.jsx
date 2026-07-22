import { Link } from 'react-router-dom'

const settings = [
  {
    to: '/admin/settings/display',
    eyebrow: 'Customer display',
    title: 'จอลูกค้า',
    description: 'อัปโหลด Artwork หรือวิดีโอสำหรับแสดงระหว่างยังไม่มีบิล',
    Icon: DisplayIcon,
  },
  {
    to: '/admin/settings/branch-counters',
    eyebrow: 'Branch & counter',
    title: 'สาขาและ Counter',
    description: 'ตั้งค่าชื่อสาขา PromptPay และจอลูกค้าของแต่ละ Counter',
    Icon: BranchIcon,
  },
  {
    to: '/admin/settings/catalog',
    eyebrow: 'Catalog',
    title: 'บริการและสินค้า',
    description: 'จัดการรายการ ราคา ค่าคอม สต็อก และการสะสม NTime',
    Icon: CatalogIcon,
  },
  {
    to: '/admin/settings/rewards',
    eyebrow: 'Loyalty',
    title: 'NTime และรางวัล',
    description: 'กำหนดยอดสะสมและรางวัลที่สมาชิกนำมาใช้ได้',
    Icon: RewardIcon,
  },
  {
    to: '/admin/settings/commission',
    eyebrow: 'Commission',
    title: 'ค่าคอม',
    description: 'ตั้งค่าวิธีและเงื่อนไขคำนวณค่าคอมมิชชัน',
    Icon: CommissionIcon,
  },
  {
    to: '/admin/settings/people',
    eyebrow: 'People',
    title: 'พนักงานและสมาชิก',
    description: 'เพิ่มพนักงาน กำหนด PIN และดูข้อมูลสมาชิกของร้าน',
    Icon: PeopleIcon,
  },
]

export default function SystemSettings() {
  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">System settings</p>
          <h1 className="page-title">ตั้งค่าระบบ</h1>
          <p className="page-description">จัดการข้อมูลพื้นฐานและรูปแบบการทำงานของร้านจากที่เดียว</p>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {settings.map(({ to, eyebrow, title, description, Icon }) => (
          <Link key={to} to={to} className="group card flex min-h-52 flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-rose/30 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose sm:p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose/10 text-rosedeep transition group-hover:bg-rose group-hover:text-white"><Icon /></span>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-rosedeep">{eyebrow}</p>
            <div className="mt-2 flex items-center justify-between gap-3"><p className="font-display text-xl font-semibold text-ink">{title}</p><ArrowIcon /></div>
            <p className="mt-2 text-sm leading-6 text-sagegray">{description}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}

function DisplayIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
}
function BranchIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M14 9h4a2 2 0 0 1 2 2v10M2 21h20M8 7h2m-2 4h2m-2 4h2m8-2h.01" /></svg>
}
function CatalogIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="m3 12 9 4 9-4M3 17l9 4 9-4" /></svg>
}
function RewardIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7" /><path d="M2 7h20v5H2zM12 7v14M12 7H7.5a2.5 2.5 0 1 1 2.5-2.5C10 5.9 12 7 12 7Zm0 0h4.5A2.5 2.5 0 1 0 14 4.5C14 5.9 12 7 12 7Z" /></svg>
}
function CommissionIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></svg>
}
function PeopleIcon() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}
function ArrowIcon() {
  return <svg className="shrink-0 text-sagegray transition group-hover:translate-x-0.5 group-hover:text-rosedeep" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}
