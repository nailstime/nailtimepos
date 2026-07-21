import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { BrandMark } from '../components/Brand.jsx'

export default function PinLogin() {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pinRef = useRef('')
  const submittingRef = useRef(false)
  const { staff, loginWithPin } = useAuth()
  const nav = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!staff) return
    const requestedPath = location.state?.from
    const safeRequestedPath = typeof requestedPath === 'string'
      && requestedPath.startsWith('/')
      && !requestedPath.startsWith('/login')
      ? requestedPath
      : null
    nav(safeRequestedPath || (staff.role === 'owner' ? '/admin' : '/pos'), { replace: true })
  }, [staff, nav, location.state])

  async function press(d) {
    if (submittingRef.current) return
    setErr('')
    if (d === 'del') {
      const next = pinRef.current.slice(0, -1)
      pinRef.current = next
      setPin(next)
      return
    }
    const next = (pinRef.current + d).slice(0, 6)
    pinRef.current = next
    setPin(next)
    if (next.length === 6) {
      submittingRef.current = true
      setSubmitting(true)
      try {
        await loginWithPin(next)
      } catch (e) {
        setErr(e.message)
        pinRef.current = ''
        setPin('')
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (submitting || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return

      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        press(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        press('del')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const keys = ['1','2','3','4','5','6','7','8','9','','0','del']
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_rgba(169,79,97,0.12),_transparent_38%),linear-gradient(135deg,#f7f4f2_0%,#f1e9e6_100%)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-lift sm:min-h-[calc(100dvh-3rem)] lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-32 -top-32 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-rose/20 blur-3xl" />
          <BrandMark inverse />
          <div className="relative max-w-md">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Nail salon workspace</p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">ทุกงานหน้าร้าน<br />อยู่ในจังหวะเดียวกัน</h1>
            <p className="mt-4 max-w-sm text-sm leading-7 text-white/60">เปิดบิล รับชำระ จัดการสมาชิก และดูภาพรวมร้านได้จากพื้นที่ทำงานเดียว</p>
          </div>
          <p className="relative text-xs tracking-wide text-white/35">Secure staff access · Session protected</p>
        </section>

        <section className="flex items-center justify-center p-5 sm:p-10 lg:p-14">
          <div className="w-full max-w-sm">
            <div className="mb-8 lg:hidden"><BrandMark /></div>
            <div className="mb-7 text-left">
              <p className="page-eyebrow">Staff sign in</p>
              <h2 className="page-title">เข้าสู่ระบบด้วย PIN</h2>
              <p className="page-description">กรอก PIN 6 หลักของคุณเพื่อเริ่มงาน</p>
            </div>
            <div className="mb-7 flex items-center justify-between rounded-2xl border border-mist bg-porcelain/80 px-5 py-4" aria-label={`กรอก PIN แล้ว ${pin.length} จาก 6 หลัก`}>
              <div className="flex gap-3">
                {[...Array(6)].map((_, i) => (
                  <span key={i} className={`h-3 w-3 rounded-full transition ${i < pin.length ? 'scale-110 bg-rose' : 'bg-blush'}`} />
                ))}
              </div>
              <span className="text-xs font-semibold text-sagegray">{pin.length}/6</span>
            </div>
            <p className="-mt-4 mb-5 text-center text-xs text-sagegray">ใช้แป้นตัวเลขบนคีย์บอร์ดได้ · Backspace เพื่อลบ</p>
            {err && <p role="alert" className="mb-4 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{err}</p>}
            <div className="grid grid-cols-3 gap-3">
              {keys.map((k, i) =>
                k === '' ? <span key={i} /> : (
                  <button key={i} onClick={() => press(k)} disabled={submitting} aria-label={k === 'del' ? 'ลบตัวเลขล่าสุด' : `เลข ${k}`}
                    className="grid min-h-16 place-items-center rounded-2xl border border-mist bg-white text-xl font-semibold text-ink shadow-sm transition hover:border-rose/40 hover:bg-blush/20 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2">
                    {k === 'del' ? (
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current" strokeWidth="1.8">
                        <path d="M9.5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-9L4 12l5.5-5Z" />
                        <path d="m13 10 4 4m0-4-4 4" />
                      </svg>
                    ) : k}
                  </button>
                )
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
