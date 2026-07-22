import { useEffect, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../../lib/supabase'
import { promptpayPayload } from '../../lib/promptpay'
import { baht } from '../../lib/format'
import { AlertMark, BrandMark, CheckMark } from '../../components/Brand.jsx'

const CUSTOMER_DISPLAY_BUCKET = 'customer-display-media'
const DISPLAY_CREDENTIAL_STORAGE_KEY = 'nailtime-customer-display-credential'

function readStoredDisplayCredential() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DISPLAY_CREDENTIAL_STORAGE_KEY) || 'null')
    if (stored && typeof stored.counterCode === 'string' && typeof stored.displayToken === 'string' && stored.displayToken) {
      return stored
    }
  } catch {}
  return null
}

function storeDisplayCredential(credential) {
  try { window.localStorage.setItem(DISPLAY_CREDENTIAL_STORAGE_KEY, JSON.stringify(credential)) } catch {}
}

function clearStoredDisplayCredential() {
  try { window.localStorage.removeItem(DISPLAY_CREDENTIAL_STORAGE_KEY) } catch {}
}

// ใช้ token ประจำจอใน URL fragment เพื่อไม่ให้ token ถูกส่งไปยัง web server/log:
// /display?counter=C1#token=<DISPLAY_TOKEN>
export default function CustomerDisplay() {
  const scannedCounterCode = (new URLSearchParams(location.search).get('counter') || 'C1').toUpperCase()
  const scannedDisplayToken = new URLSearchParams(location.hash.slice(1)).get('token') || ''
  const [credential, setCredential] = useState(() => (
    scannedDisplayToken
      ? { counterCode: scannedCounterCode, displayToken: scannedDisplayToken }
      : readStoredDisplayCredential()
  ))
  const counterCode = credential?.counterCode || scannedCounterCode
  const displayToken = credential?.displayToken || ''
  const [branch, setBranch] = useState(null)
  const [order, setOrder] = useState(null)
  const [items, setItems] = useState([])
  const [member, setMember] = useState(null)
  const [campaign, setCampaign] = useState(null)
  const [authorized, setAuthorized] = useState(null)
  const [pairingCounterCode, setPairingCounterCode] = useState(scannedCounterCode)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')

  useEffect(() => {
    if (!scannedDisplayToken) return
    const nextCredential = { counterCode: scannedCounterCode, displayToken: scannedDisplayToken }
    storeDisplayCredential(nextCredential)
    setCredential(nextCredential)
    window.history.replaceState(window.history.state, '', `/display?counter=${encodeURIComponent(scannedCounterCode)}`)
  }, [scannedCounterCode, scannedDisplayToken])

  const load = useCallback(async () => {
    if (!displayToken) return
    const { data, error } = await supabase.rpc('get_customer_display', {
      p_counter_code: counterCode,
      p_display_token: displayToken,
    })
    if (error || !data) {
      setAuthorized(false)
      return
    }
    setAuthorized(true)
    setBranch(data.branch || null)
    setOrder(data.order || null)
    setItems(data.items || [])
    setMember(data.member || null)
    setCampaign(data.campaign || null)
  }, [counterCode, displayToken])

  useEffect(() => {
    if (!displayToken) return
    load()
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [displayToken, load])

  async function pairDisplay(event) {
    event.preventDefault()
    const nextCounterCode = pairingCounterCode.trim().toUpperCase()
    const nextPairingCode = pairingCode.trim().toUpperCase()
    if (!nextCounterCode || !nextPairingCode) {
      setPairingError('กรุณากรอก Counter และรหัสจับคู่')
      return
    }
    setPairingBusy(true)
    setPairingError('')
    const { data, error } = await supabase.rpc('pair_customer_display', {
      p_counter_code: nextCounterCode,
      p_pairing_code: nextPairingCode,
    })
    setPairingBusy(false)
    if (error || !data?.device_token) {
      setPairingError(error?.message === 'pairing code is invalid or expired'
        ? 'รหัสจับคู่ไม่ถูกต้องหรือหมดอายุแล้ว'
        : (error?.message || 'ไม่สามารถจับคู่จอได้'))
      return
    }
    const nextCredential = { counterCode: data.counter_code, displayToken: data.device_token }
    storeDisplayCredential(nextCredential)
    setCredential(nextCredential)
    setPairingCode('')
    setAuthorized(null)
    window.history.replaceState(window.history.state, '', `/display?counter=${encodeURIComponent(data.counter_code)}`)
  }

  function resetPairing() {
    clearStoredDisplayCredential()
    setCredential(null)
    setPairingCounterCode(counterCode)
    setPairingCode('')
    setPairingError('')
    setAuthorized(null)
  }

  if (!displayToken) return (
    <Screen>
      <DisplayPairing
        counterCode={pairingCounterCode}
        pairingCode={pairingCode}
        busy={pairingBusy}
        error={pairingError}
        onCounterCodeChange={(value) => setPairingCounterCode(value.toUpperCase())}
        onPairingCodeChange={(value) => setPairingCode(value.toUpperCase())}
        onSubmit={pairDisplay}
      />
    </Screen>
  )

  if (authorized === false) return (
    <Screen>
      <div className="card max-w-md p-8 text-center">
        <AlertMark className="mx-auto" />
        <p className="mt-5 font-display text-2xl font-semibold">จอลูกค้ายังไม่ได้รับอนุญาต</p>
        <p className="mt-2 text-sm leading-6 text-sagegray">รหัสเดิมอาจถูกยกเลิกแล้ว โปรดขอรหัสจับคู่ใหม่จาก Owner</p>
        <button type="button" onClick={resetPairing} className="btn-rose mt-6 w-full">จับคู่จอใหม่</button>
      </div>
    </Screen>
  )

  if (!order) return (
    <Screen>
      <IdleSignage branch={branch} campaign={campaign} />
    </Screen>
  )

  if (order.status === 'paid') return (
    <Screen>
      <div className="card w-full max-w-2xl p-8 text-center sm:p-12">
        <CheckMark className="mx-auto" />
        <p className="mt-6 font-display text-3xl font-semibold">ขอบคุณที่ใช้บริการ</p>
        <p className="mt-3 text-sm font-semibold uppercase tracking-[0.16em] text-success">ชำระเงินสำเร็จ</p>
        <p className="mt-2 text-4xl font-bold tabular-nums">฿{baht(order.total)}</p>
        {member && (
          <p className="soft-panel mt-6 p-4 text-lg font-semibold text-rosedeep">
            สิทธิ์สะสมของคุณ{member.name}: {member.points_balance} สิทธิ์
          </p>
        )}
        <p className="mt-4 text-sm text-sagegray">ตรวจสอบสิทธิ์ได้ทาง LINE ทันที</p>
      </div>
    </Screen>
  )

  const qrPayload = order.status === 'awaiting_payment' && branch?.promptpay_id
    ? promptpayPayload(branch.promptpay_id, order.total)
    : null

  return (
    <Screen>
      <div className="w-full max-w-6xl">
        <div className="mb-7 flex items-center justify-between">
          <BrandMark compact />
          <span className="badge-neutral">บิล {order.order_no}</span>
        </div>
      <div className="grid w-full items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="card p-6 sm:p-8">
          <p className="page-eyebrow">Order summary</p>
          <p className="mt-2 font-display text-3xl font-semibold">รายการของคุณ</p>
          {member && (
            <p className="text-sm text-sagegray mt-1">
              คุณ{member.name} · สิทธิ์ {member.points_balance} · สะสม ฿{baht(member.accumulated_baht)}
            </p>
          )}
          <div className="mt-6 space-y-1">
            {items.map((it) => (
              <div key={it.id} className="flex min-h-12 items-center justify-between border-b border-mist py-2 text-lg last:border-0">
                <span>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</span>
                <span>฿{baht(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          {Number(order.discount) > 0 && (
            <div className="mt-2 flex justify-between text-success">
              <span>ส่วนลด</span><span>-฿{baht(order.discount)}</span>
            </div>
          )}
          <div className="mt-5 flex justify-between border-t-2 border-ink pt-5 text-2xl font-semibold">
            <span>รวมทั้งหมด</span><span className="text-3xl tabular-nums">฿{baht(order.total)}</span>
          </div>
        </div>

        {qrPayload && (
          <div className="card flex flex-col items-center justify-center p-6 text-center sm:p-8">
            <span className="badge-rose">PromptPay</span>
            <p className="mt-4 font-display text-2xl font-semibold">สแกนเพื่อชำระเงิน</p>
            <p className="mt-1 text-sm text-sagegray">บัญชีร้าน · {branch.name}</p>
            <div className="mt-5 inline-block rounded-2xl border border-mist bg-white p-4 shadow-sm">
              <QRCodeSVG value={qrPayload} size={220} />
            </div>
            <p className="mt-5 font-display text-4xl font-semibold tabular-nums">฿{baht(order.total)}</p>
            <p className="mt-2 text-sm text-sagegray">กรุณาตรวจสอบยอดก่อนยืนยันการชำระ</p>
          </div>
        )}
      </div>
      </div>
    </Screen>
  )
}

function DisplayPairing({ counterCode, pairingCode, busy, error, onCounterCodeChange, onPairingCodeChange, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="card w-full max-w-md p-7 sm:p-9">
      <BrandMark compact />
      <p className="page-eyebrow mt-8">Customer display</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">จับคู่จอลูกค้า</h1>
      <p className="mt-3 text-sm leading-6 text-sagegray">ขอรหัสจับคู่ชั่วคราวจาก Owner ในเมนู ตั้งค่าระบบ › สาขาและ Counter แล้วกรอกด้านล่าง</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm font-medium text-danger">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-[.7fr_1.3fr]">
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Counter</span><input className="input uppercase" required maxLength={20} value={counterCode} onChange={(event) => onCounterCodeChange(event.target.value)} disabled={busy} /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">รหัสจับคู่ 8 ตัว</span><input className="input font-mono uppercase tracking-[0.18em]" required inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck="false" maxLength={8} placeholder="เช่น A1B2C3D4" value={pairingCode} onChange={(event) => onPairingCodeChange(event.target.value.replace(/[^a-fA-F0-9]/g, ''))} disabled={busy} /></label>
      </div>
      <button disabled={busy} className="btn-rose mt-6 w-full">{busy ? 'กำลังจับคู่…' : 'ยืนยันการจับคู่'}</button>
      <p className="mt-4 text-center text-xs leading-5 text-sagegray">รหัสใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที เครื่องนี้จะจำการเชื่อมต่อไว้แม้ปิดแล้วเปิด PWA ใหม่</p>
    </form>
  )
}

function Screen({ children }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top_right,_rgba(169,79,97,0.10),_transparent_35%),linear-gradient(135deg,#f7f4f2_0%,#efe7e4_100%)] p-5 sm:p-8 lg:p-10">
      {children}
    </div>
  )
}

function IdleSignage({ branch, campaign }) {
  const campaignMediaUrl = campaign?.path
    ? supabase.storage.from(CUSTOMER_DISPLAY_BUCKET).getPublicUrl(campaign.path).data.publicUrl
    : ''
  const hasCampaignMedia = Boolean(campaignMediaUrl && campaign?.type !== 'artwork')
  const isVideo = campaign?.type === 'video'

  return (
    <section className="relative min-h-[calc(100dvh-4rem)] w-full max-w-[1520px] overflow-hidden rounded-[2rem] border border-white/75 bg-porcelain shadow-lift sm:rounded-[2.5rem]" aria-label="สื่อประชาสัมพันธ์ร้าน">
      {hasCampaignMedia ? (
        <div className="absolute inset-0 bg-ink">
          {isVideo ? (
            <video className="h-full w-full object-cover opacity-90" src={campaignMediaUrl} autoPlay muted loop playsInline aria-hidden="true" />
          ) : (
            <img className="h-full w-full object-cover opacity-90" src={campaignMediaUrl} alt="สื่อประชาสัมพันธ์ Nail Time & Spa" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-ink/70 via-ink/25 to-transparent" />
        </div>
      ) : (
        <DefaultArtwork />
      )}

      <div className={(hasCampaignMedia ? 'text-white' : 'text-ink') + ' relative flex min-h-[calc(100dvh-4rem)] flex-col p-7 sm:p-10 lg:p-14'}>
        <header className="flex items-center justify-between gap-4">
          <BrandMark compact inverse={hasCampaignMedia} />
          <span className={(hasCampaignMedia ? 'border-white/30 bg-white/15 text-white' : 'badge-neutral') + ' rounded-full border px-3 py-1.5 text-xs font-semibold'}>{branch?.name || 'Nail Time & Spa'}</span>
        </header>

        <div className="my-auto max-w-3xl py-14 sm:py-20">
          <p className={(hasCampaignMedia ? 'text-white/90' : 'text-rosedeep') + ' text-sm font-bold uppercase tracking-[0.22em]'}>Nail Time Member</p>
          <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.06] tracking-tight sm:text-6xl lg:text-8xl">สวยในแบบคุณ<br />ทุกวัน</h1>
          <p className={(hasCampaignMedia ? 'text-white/85' : 'text-sagegray') + ' mt-7 max-w-xl text-lg leading-8 sm:text-xl'}>สะสมยอดครบทุก ฿1,500 รับ 1 สิทธิ์ เพื่อแลกบริการฟรี</p>
          <div className={(hasCampaignMedia ? 'border-white/20 bg-white/10' : 'border-rose/15 bg-white/70') + ' mt-9 inline-flex items-center gap-3 rounded-2xl border px-5 py-4 backdrop-blur-sm'}>
            <span className={(hasCampaignMedia ? 'bg-white text-rosedeep' : 'bg-rose text-white') + ' grid h-9 w-9 place-items-center rounded-xl text-sm font-bold'}>LINE</span>
            <div><p className="text-xs font-semibold uppercase tracking-wider opacity-70">สิทธิพิเศษสำหรับสมาชิก</p><p className="mt-0.5 font-semibold">เพิ่มเพื่อน @nailtimetk22</p></div>
          </div>
        </div>

        <footer className={(hasCampaignMedia ? 'border-white/20 text-white/75' : 'border-mist text-sagegray') + ' flex items-center justify-between border-t pt-5 text-sm'}>
          <span>Care in every detail</span>
          <span>{hasCampaignMedia ? 'กำลังนำเสนอโปรโมชั่น' : 'โปรโมชั่นและสิทธิพิเศษ'}</span>
        </footer>
      </div>
    </section>
  )
}

function DefaultArtwork() {
  return <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_12%_15%,rgba(255,255,255,0.98),transparent_29%),radial-gradient(circle_at_90%_16%,rgba(169,79,97,0.17),transparent_34%),linear-gradient(135deg,#fbf7f5_0%,#f0e1df_100%)]">
    <div className="absolute -right-24 top-1/4 h-[48vw] w-[48vw] max-h-[700px] max-w-[700px] rounded-full border border-white/75 bg-white/20" />
    <div className="absolute right-[12%] top-[18%] h-44 w-44 rounded-full border-[18px] border-rose/15 sm:h-64 sm:w-64" />
    <div className="absolute bottom-[12%] right-[27%] h-20 w-20 rounded-full bg-rose/15 blur-[1px]" />
    <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-white/45 to-transparent" />
  </div>
}
