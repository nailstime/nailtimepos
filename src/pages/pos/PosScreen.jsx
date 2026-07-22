import { useEffect, useMemo, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { baht } from '../../lib/format'
import { openThermalReceiptWindow, printThermalReceipt } from '../../lib/thermalReceipt'
import { useAuth } from '../../context/AuthContext.jsx'
import { AlertMark, BrandMark, CheckMark } from '../../components/Brand.jsx'
import { useAppDialog } from '../../components/AppDialog.jsx'

const COUNTER_STORAGE_KEY = 'nailtime-pos-counter'

function getStoredCounter() {
  try {
    return window.sessionStorage.getItem(COUNTER_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function catalogPriceLabel(item) {
  if (item.price_mode === 'variable') return `฿${baht(item.min_price)}–${baht(item.max_price)}`
  return `฿${baht(item.price)}`
}

function normalizeCatalogSearch(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLocaleLowerCase('th-TH')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fuzzyCatalogMatch(value, query) {
  const candidate = normalizeCatalogSearch(value)
  const terms = normalizeCatalogSearch(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  if (terms.every((term) => candidate.includes(term))) return true

  // A forgiving fallback for short hand or a missing character, e.g. “ทาเลบ”.
  const needle = terms.join('')
  let cursor = 0
  for (const char of candidate) {
    if (char === needle[cursor]) cursor += 1
    if (cursor === needle.length) return true
  }
  return false
}

export default function PosScreen() {
  const { staff, logout } = useAuth()
  const { prompt: openPrompt, confirm: openConfirm } = useAppDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const pendingView = location.pathname.endsWith('/pending')
  const [services, setServices] = useState([])
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [rewards, setRewards] = useState([])
  const [techs, setTechs] = useState([])
  const [tab, setTab] = useState('service')
  const [categoryId, setCategoryId] = useState('')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [cart, setCart] = useState([])
  const [member, setMember] = useState(null)
  const [phone, setPhone] = useState('')
  const [stage, setStage] = useState('cart') // cart | paying | done
  const [order, setOrder] = useState(null)
  const [pendingRedeems, setPendingRedeems] = useState(0)
  const [discountReq, setDiscountReq] = useState(null)
  const [pendingApproval, setPendingApproval] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [linkCode, setLinkCode] = useState('')
  const [pendingOrders, setPendingOrders] = useState([])
  const [restoringCounter, setRestoringCounter] = useState(true)
  const [resumeBusy, setResumeBusy] = useState('')
  const [pendingErr, setPendingErr] = useState('')
  const [printBusy, setPrintBusy] = useState(false)
  const [counterCode, setCounterCode] = useState(getStoredCounter)
  const [counters, setCounters] = useState([])
  const [countersLoading, setCountersLoading] = useState(true)
  const [counterError, setCounterError] = useState('')

  const loadCounters = useCallback(async () => {
    setCountersLoading(true)
    const { data, error } = await supabase.rpc('list_pos_counters')
    if (error) {
      setCounters([])
      setCounterError(error.message)
    } else {
      setCounters(data || [])
      setCounterError('')
    }
    setCountersLoading(false)
  }, [])

  useEffect(() => { loadCounters() }, [loadCounters])

  useEffect(() => {
    if (countersLoading || !counterCode || counters.some((counter) => counter.code === counterCode)) return
    try { window.sessionStorage.removeItem(COUNTER_STORAGE_KEY) } catch {}
    setCounterCode('')
  }, [counterCode, counters, countersLoading])

  function selectCounter(code) {
    const normalizedCode = String(code || '').toUpperCase()
    if (!normalizedCode) return
    try { window.sessionStorage.setItem(COUNTER_STORAGE_KEY, normalizedCode) } catch {}
    setCounterCode(normalizedCode)
    setCart([])
    setMember(null)
    setPhone('')
    setOrder(null)
    setResult(null)
    setDiscountReq(null)
    setPendingRedeems(0)
    setPendingApproval(false)
    setLinkCode('')
    setStage('cart')
    setErr('')
  }

  async function changeCounter() {
    const needsConfirmation = cart.length > 0 || order?.status === 'awaiting_payment'
    if (needsConfirmation) {
      const confirmed = await openConfirm({
        title: 'เปลี่ยน Counter',
        description: order?.status === 'awaiting_payment'
          ? `บิล ${order.order_no} จะยังค้างอยู่ที่ Counter ${counterCode} และกลับมาจัดการได้ภายหลัง`
          : 'รายการในบิลที่ยังไม่ได้เปิดจะถูกล้างก่อนเปลี่ยน Counter',
        cancelLabel: 'อยู่ Counter เดิม',
        confirmLabel: 'เปลี่ยน Counter',
      })
      if (!confirmed) return
    }
    try { window.sessionStorage.removeItem(COUNTER_STORAGE_KEY) } catch {}
    setCounterCode('')
    setCart([])
    setMember(null)
    setPhone('')
    setOrder(null)
    setResult(null)
    setDiscountReq(null)
    setPendingRedeems(0)
    setPendingApproval(false)
    setLinkCode('')
    setStage('cart')
    setErr('')
    loadCounters()
  }

  const applyCounterState = useCallback((state) => {
    const activeOrder = state?.order || null
    setOrder(activeOrder)
    setMember(state?.member || null)
    setPendingRedeems(Number(state?.pending_redeems || 0))
    setDiscountReq(state?.discount_request || null)
    setPendingApproval(Boolean(state?.pending_approval))
    if (!activeOrder) {
      setStage('cart')
      setResult(null)
      return
    }
    if (activeOrder.status === 'paid') {
      setResult({
        points_earned: Number(activeOrder.points_awarded || 0),
        points_balance: state?.member?.points_balance,
      })
      setStage('done')
    } else {
      setResult(null)
      setStage('paying')
    }
  }, [])

  const loadPendingOrders = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_pending_pos_orders')
    if (error) {
      setPendingErr(error.message)
      return
    }
    setPendingOrders(data || [])
    setPendingErr('')
  }, [])

  const restoreCounter = useCallback(async () => {
    if (!counterCode) return
    setRestoringCounter(true)
    const [{ data, error }] = await Promise.all([
      supabase.rpc('get_pos_counter_state', { p_counter_code: counterCode }),
      loadPendingOrders(),
    ])
    if (error) setErr(error.message)
    else applyCounterState(data)
    setRestoringCounter(false)
  }, [applyCounterState, counterCode, loadPendingOrders])

  useEffect(() => {
    ;(async () => {
      const [{ data: sv }, { data: pd }, { data: ct }, { data: rw }, { data: st }] = await Promise.all([
        supabase.from('services').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('products').select('*').eq('active', true),
        supabase.from('catalog_categories').select('*').order('sort_order').order('name'),
        supabase.from('rewards').select('*').eq('active', true).order('points_cost'),
        supabase.from('staff').select('id,name').eq('role', 'technician').eq('active', true),
      ])
      setServices(sv || []); setProducts(pd || []); setRewards(rw || [])
      setCategories(ct || [])
      setTechs(st || [])
    })()
  }, [])

  useEffect(() => {
    if (counterCode) restoreCounter()
  }, [counterCode, restoreCounter])

  // realtime: redemption ยืนยัน / ส่วนลดอนุมัติ / บิลถูก void
  const refreshOrder = useCallback(async () => {
    if (!order) return
    const { data, error } = await supabase.rpc('get_pos_counter_state', { p_counter_code: counterCode })
    if (error) return setErr(error.message)
    applyCounterState(data)
    loadPendingOrders()
  }, [order?.id, applyCounterState, counterCode, loadPendingOrders])

  useEffect(() => {
    if (!order || stage !== 'paying') return
    refreshOrder()
    const timer = window.setInterval(refreshOrder, 1500)
    const ch = supabase.channel('pos-order-' + order.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions' }, refreshOrder)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, refreshOrder)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refreshOrder)
      .subscribe()
    return () => {
      window.clearInterval(timer)
      supabase.removeChannel(ch)
    }
  }, [order?.id, stage, refreshOrder])

  const total = useMemo(() => cart.reduce((s, c) => s + c.price * c.qty, 0), [cart])
  const redeemInCart = cart.filter((c) => c.item_type === 'redemption')
  const tabCategories = useMemo(() => (
    tab === 'service' || tab === 'product'
      ? categories.filter((category) => category.kind === tab)
      : []
  ), [categories, tab])
  const visibleCatalogItems = useMemo(() => {
    const source = tab === 'service' ? services : tab === 'product' ? products : rewards
    return source.filter((item) => (
      (!categoryId || (categoryId === '__uncategorized__' ? !item.category_id : item.category_id === categoryId))
      && fuzzyCatalogMatch(item.name, catalogSearch)
    ))
  }, [catalogSearch, categoryId, products, rewards, services, tab])

  function selectCatalogTab(nextTab) {
    setTab(nextTab)
    setCategoryId('')
  }

  async function addItem(it, type) {
    if (type === 'redemption') {
      if (!member) return setErr('เลือกสมาชิกก่อนใช้ NTime')
      if (!member.line_linked) return setErr('ต้องผูก LINE ก่อนใช้ NTime — ออกโค้ดผูก LINE ให้ลูกค้า แล้วให้กรอกในหน้า LIFF')
      const used = redeemInCart.reduce((s, c) => s + c.points_cost, 0)
      if (member.points_balance < used + it.points_cost) return setErr('NTime ของสมาชิกไม่พอ')
      setErr('')
      return setCart((c) => [...c, {
        key: 'r' + it.id + Math.random(), item_type: 'redemption', ref: it.id,
        name: it.name, price: 0, points_cost: it.points_cost,
        commission_pct: 0, counts: false,
        technician_id: staff.role === 'technician' ? staff.id : (techs[0]?.id ?? null), qty: 1,
      }])
    }
    if (type === 'service' && it.price_mode === 'variable') {
      const min = Number(it.min_price)
      const max = Number(it.max_price)
      const priceInput = await openPrompt({
        title: it.name,
        description: `กำหนดราคาได้ตั้งแต่ ฿${baht(min)} ถึง ฿${baht(max)}`,
        label: 'ราคาบริการ (บาท)',
        placeholder: `${min}`,
        inputMode: 'decimal',
        required: true,
        confirmLabel: 'ถัดไป',
        validate: (value) => {
          const amount = Number(value)
          if (!Number.isFinite(amount) || amount < min || amount > max) return `ระบุราคา ฿${baht(min)}–฿${baht(max)}`
          return null
        },
      })
      if (priceInput === null) return
      const reason = await openPrompt({
        title: 'รายละเอียดงานพิเศษ',
        description: `ราคา ฿${baht(Number(priceInput))} จะถูกบันทึกไว้ในประวัติบิล`,
        label: 'รายละเอียด / เหตุผล',
        placeholder: 'เช่น ซ่อมเล็บ 2 นิ้ว',
        required: true,
        maxLength: 500,
        confirmLabel: 'เพิ่มลงบิล',
        validate: (value) => value.trim().length >= 2 ? null : 'กรุณาระบุรายละเอียดอย่างน้อย 2 ตัวอักษร',
      })
      if (reason === null) return
      setErr('')
      setCart((c) => [...c, {
        key: `variable-${it.id}-${Date.now()}`,
        item_type: type, ref: it.id, name: it.name, price: Number(priceInput),
        custom_price_reason: reason.trim(),
        commission_pct: Number(it.commission_pct), counts: it.counts_toward_points,
        technician_id: staff.role === 'technician' ? staff.id : (techs[0]?.id ?? null), qty: 1,
      }])
      return
    }
    setCart((c) => {
      const key = type + it.id
      const found = c.find((x) => x.key === key)
      if (found) return c.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x))
      return [...c, {
        key, item_type: type, ref: it.id, name: it.name, price: Number(it.price),
        commission_pct: Number(it.commission_pct), counts: it.counts_toward_points,
        technician_id: staff.role === 'technician' ? staff.id : (techs[0]?.id ?? null), qty: 1,
      }]
    })
  }
  const removeItem = (key) => setCart((c) => c.filter((x) => x.key !== key))
  const setTech = (key, id) => setCart((c) => c.map((x) => (x.key === key ? { ...x, technician_id: id } : x)))

  async function clearCart() {
    if (!cart.length) return
    const confirmed = await openConfirm({
      title: 'ล้างรายการในบิล',
      description: `รายการทั้งหมด ${cart.length} รายการจะถูกลบออกจากบิลนี้`,
      cancelLabel: 'เก็บรายการไว้',
      confirmLabel: 'ล้างรายการ',
      tone: 'danger',
    })
    if (!confirmed) return
    setCart([])
    setErr('')
  }

  async function findMember() {
    setErr('')
    setLinkCode('')
    const { data, error } = await supabase.rpc('find_member', { p_phone: phone })
    if (error) return setErr(error.message)
    if (!data) return setErr('ไม่พบสมาชิกเบอร์นี้ — สมัครสมาชิกใหม่ที่ POS หรือให้ลูกค้าสมัครผ่าน LINE OA ได้')
    setMember(data)
  }

  async function issueLinkCode() {
    setErr('')
    const { data, error } = await supabase.rpc('issue_member_link_code', { p_member: member.id })
    if (error) return setErr(error.message)
    setLinkCode(data)
  }

  async function registerMemberAtPos() {
    if (busy) return
    const name = await openPrompt({
      title: 'สมัครสมาชิกที่ POS',
      description: 'ขั้นตอน 1 จาก 2 · ลูกค้าสะสม NTime ได้ทันที แม้ยังไม่ผูก LINE',
      label: 'ชื่อลูกค้า',
      placeholder: 'ชื่อที่ใช้ติดต่อ',
      required: true,
      maxLength: 160,
      confirmLabel: 'ถัดไป',
      validate: (value) => value.length > 160 ? 'ชื่อต้องไม่เกิน 160 ตัวอักษร' : null,
    })
    if (name === null) return

    const phoneValue = await openPrompt({
      title: 'สมัครสมาชิกที่ POS',
      description: `ขั้นตอน 2 จาก 2 · ชื่อ ${name}`,
      label: 'เบอร์โทรศัพท์',
      placeholder: '0xx-xxx-xxxx',
      inputMode: 'tel',
      required: true,
      maxLength: 20,
      confirmLabel: 'สร้างสมาชิก',
      helperText: 'ใช้ค้นหาสมาชิกและผูก LINE ในภายหลัง',
      validate: (value) => /^\d{9,15}$/.test(value.replace(/\D/g, '')) ? null : 'กรุณากรอกเบอร์โทรศัพท์ 9–15 หลัก',
    })
    if (phoneValue === null) return

    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('create_pos_member', { p_name: name, p_phone: phoneValue })
      if (error) throw error
      setMember(data.member)
      setPhone(data.member.phone)
      setLinkCode('')
    } catch (error) {
      setErr(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function checkout() {
    if (!cart.length || busy) return
    const zeroBill = total === 0
    const confirmed = await openConfirm({
      title: zeroBill ? 'ยืนยันเปิดบิลใช้ NTime' : 'ยืนยันเปิดบิล',
      description: zeroBill
        ? `ระบบจะสร้างบิล ${cart.length} รายการ ยอด ฿0 เพื่อปิดบิลด้วย NTime`
        : `ระบบจะสร้างบิล ${cart.length} รายการ และแสดง QR ยอด ฿${baht(total)} บนหน้าจอลูกค้า`,
      cancelLabel: 'กลับไปตรวจสอบ',
      confirmLabel: zeroBill ? 'ยืนยันเปิดบิล' : 'เปิดบิลและแสดง QR',
    })
    if (!confirmed) return
    setBusy(true); setErr('')
    try {
      const items = cart.map((c) => ({
        item_type: c.item_type,
        ref_id: c.ref,
        technician_id: c.technician_id,
        qty: c.qty,
        ...(c.custom_price_reason ? { unit_price: c.price, custom_price_reason: c.custom_price_reason } : {}),
      }))
      const { data, error } = await supabase.rpc('create_order', {
        p_counter_code: counterCode,
        p_member: member?.id ?? null,
        p_items: items,
      })
      if (error) throw error
      const o = data.order
      for (const redemptionId of data.redemption_ids || []) {
        supabase.functions.invoke('line-redeem', { body: { redemption_id: redemptionId } }).catch(() => {})
      }
      setOrder(o)
      setPendingRedeems((data.redemption_ids || []).length)
      setStage('paying')
      loadPendingOrders()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function requestDiscount() {
    const amountInput = await openPrompt({
      title: 'ขออนุมัติส่วนลด',
      description: `ระบุจำนวนส่วนลดสำหรับบิล ${order.order_no}`,
      label: 'จำนวนส่วนลด (บาท)',
      placeholder: '0.00',
      inputMode: 'decimal',
      required: true,
      confirmLabel: 'ถัดไป',
      helperText: `ยอดปัจจุบัน ฿${baht(order.total)}`,
      validate: (value) => {
        const amount = Number(value)
        if (!Number.isFinite(amount) || amount <= 0) return 'กรุณาระบุจำนวนส่วนลดที่มากกว่า 0 บาท'
        return null
      },
    })
    if (amountInput === null) return

    const reasonInput = await openPrompt({
      title: 'เหตุผลที่ขอส่วนลด',
      description: `ส่วนลด ฿${baht(Number(amountInput))} จะถูกส่งให้ Owner ตรวจสอบ`,
      label: 'เหตุผลหรือรายละเอียดประกอบ',
      placeholder: 'เช่น ชดเชยบริการ หรือโปรโมชันพิเศษ',
      multiline: true,
      maxLength: 300,
      confirmLabel: 'ส่งคำขอ',
      helperText: 'หากไม่ระบุ ระบบจะบันทึกเป็น “ไม่ระบุเหตุผล”',
    })
    if (reasonInput === null) return

    const amount = Number(amountInput)
    const reason = reasonInput || 'ไม่ระบุเหตุผล'
    const { error } = await supabase.rpc('request_approval', {
      p_order: order.id, p_type: 'discount',
      p_amount: amount, p_reason: reason,
    })
    if (error) setErr(error.message)
    else refreshOrder()
  }

  async function requestVoid() {
    const reasonInput = await openPrompt({
      title: 'ขอยกเลิกบิล',
      description: `บิล ${order.order_no} จะยังไม่ถูกยกเลิกจนกว่า Owner จะอนุมัติ`,
      label: 'เหตุผลที่ขอยกเลิก',
      placeholder: 'อธิบายสาเหตุเพื่อให้ Owner ตรวจสอบ',
      multiline: true,
      maxLength: 300,
      tone: 'danger',
      confirmLabel: 'ส่งคำขอยกเลิก',
      helperText: 'หากไม่ระบุ ระบบจะบันทึกเป็น “ไม่ระบุเหตุผล”',
    })
    if (reasonInput === null) return
    const reason = reasonInput || 'ไม่ระบุเหตุผล'
    const { error } = await supabase.rpc('request_approval', {
      p_order: order.id, p_type: 'void',
      p_amount: null, p_reason: reason,
    })
    if (error) setErr(error.message)
    else {
      setErr('ส่งคำขอยกเลิกแล้ว — รอ Owner อนุมัติ')
      refreshOrder()
    }
  }

  async function confirmPaid() {
    if (busy) return
    let printWindow = null
    try {
      // This must be opened synchronously from the confirmation click; otherwise
      // browsers can block the automatic thermal-print dialog after the RPC.
      printWindow = openThermalReceiptWindow({ order })
    } catch (error) {
      setErr(error.message)
      return
    }
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('process_paid_order', { p_order: order.id })
      if (error) throw error
      setResult(data)
      supabase.functions.invoke('line-notify', { body: { order_id: order.id } }).catch(() => {})
      setStage('done')
      const { data: receipt, error: receiptError } = await supabase.rpc('get_pos_thermal_receipt', { p_order: order.id })
      if (receiptError) throw receiptError
      printThermalReceipt(printWindow, receipt)
      printWindow = null
    } catch (e) {
      printWindow?.close()
      setErr(e.message)
    } finally { setBusy(false) }
  }

  async function reprintReceipt() {
    if (!order || printBusy) return
    let printWindow = null
    try {
      printWindow = openThermalReceiptWindow({ order })
      setPrintBusy(true); setErr('')
      const { data, error } = await supabase.rpc('get_pos_thermal_receipt', { p_order: order.id })
      if (error) throw error
      printThermalReceipt(printWindow, data)
      printWindow = null
    } catch (e) {
      printWindow?.close()
      setErr(e.message)
    } finally { setPrintBusy(false) }
  }

  async function newBill() {
    const { error } = await supabase.rpc('clear_counter', { p_counter_code: counterCode })
    if (error) return setErr(error.message)
    setCart([]); setMember(null); setPhone(''); setOrder(null)
    setResult(null); setDiscountReq(null); setPendingRedeems(0); setPendingApproval(false); setLinkCode(''); setStage('cart')
    loadPendingOrders()
  }

  async function resumePendingOrder(pendingOrder) {
    setResumeBusy(pendingOrder.id)
    setPendingErr('')
    const { data, error } = await supabase.rpc('resume_pending_pos_order', {
      p_order: pendingOrder.id,
      p_counter_code: counterCode,
    })
    setResumeBusy('')
    if (error) return setPendingErr(error.message)
    applyCounterState(data)
    await loadPendingOrders()
    navigate('/pos')
  }

  async function logoutFromPos() {
    try { window.sessionStorage.removeItem(COUNTER_STORAGE_KEY) } catch {}
    await logout()
  }

  const shellProps = {
    staff,
    logout: logoutFromPos,
    counterCode,
    pendingCount: pendingOrders.length,
    onPending: () => navigate('/pos/pending'),
    pendingActive: pendingView,
    onCustomers: () => navigate('/pos/customers'),
    onAdmin: staff.role === 'owner' ? () => navigate('/admin') : null,
    onChangeCounter: changeCounter,
  }

  if (!counterCode || countersLoading) return (
    <Shell {...shellProps} onPending={null} onCustomers={null} onChangeCounter={null}>
      <CounterPicker
        counters={counters}
        loading={countersLoading}
        error={counterError}
        onChoose={selectCounter}
        onRefresh={loadCounters}
      />
    </Shell>
  )

  if (restoringCounter) return (
    <Shell {...shellProps}>
      <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-blush border-t-rose" aria-hidden="true" />
        <p className="mt-4 font-semibold">กำลังตรวจสอบบิลของ Counter {counterCode}</p>
        <p className="mt-1 text-sm text-sagegray">เพื่อป้องกันการเปิดบิลซ้ำหลังรีเฟรชหน้า</p>
      </div>
    </Shell>
  )

  if (pendingView) return (
    <Shell {...shellProps}>
      <PendingOrdersPage
        orders={pendingOrders}
        activeOrder={order}
        counterCode={counterCode}
        busyId={resumeBusy}
        error={pendingErr}
        onRefresh={loadPendingOrders}
        onResume={resumePendingOrder}
        onBack={() => navigate('/pos')}
      />
    </Shell>
  )

  if (stage === 'paying') {
    if (order.status === 'void') return (
      <Shell {...shellProps}>
        <Center>
          <AlertMark className="mx-auto" />
          <p className="mt-5 font-display text-2xl font-semibold">บิลถูกยกเลิกแล้ว</p>
          <p className="mt-1 text-sm text-sagegray">Owner อนุมัติคำขอยกเลิกเรียบร้อย</p>
          <button onClick={newBill} className="btn-rose w-full mt-5">เปิดบิลใหม่</button>
        </Center>
      </Shell>
    )
    const zeroBill = Number(order.total) === 0
    return (
      <Shell {...shellProps}>
        <Center>
          <p className="page-eyebrow">กำลังรอชำระเงิน</p>
          <p className="mt-2 text-sm font-semibold text-sagegray">บิล {order.order_no}</p>
          <p className="mt-3 font-display text-5xl font-semibold tracking-tight">฿{baht(order.total)}</p>
          {Number(order.discount) > 0 && (
            <p className="mt-2 text-sm font-medium text-success">ส่วนลด ฿{baht(order.discount)} (อนุมัติแล้ว)</p>
          )}
          {pendingRedeems > 0 && (
            <p className="mt-5 rounded-xl border border-rose/15 bg-rose/5 p-3 text-sm font-medium text-rosedeep">
              ⏳ รอลูกค้ายืนยันใช้ NTime ใน LINE ({pendingRedeems} รายการ)
            </p>
          )}
          {discountReq?.status === 'pending' && (
            <p className="text-sagegray text-sm mt-2">⏳ ส่วนลด ฿{baht(discountReq.amount)} รอ Owner อนุมัติ</p>
          )}
          {!zeroBill && <p className="mt-5 rounded-xl bg-porcelain px-4 py-3 text-sm text-sagegray">QR แสดงบนจอลูกค้าแล้ว — รอลูกค้าสแกนจ่าย</p>}
          {err && <p role="alert" className="mt-3 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">{err}</p>}
          <button onClick={confirmPaid} disabled={busy || pendingRedeems > 0 || pendingApproval}
            className="btn-rose w-full mt-5 disabled:opacity-40">
            {busy ? 'กำลังบันทึก…' : zeroBill ? 'ปิดบิล (ยอด 0)' : 'ยืนยันรับเงินแล้ว'}
          </button>
          <div className="flex gap-2 mt-3">
            <button onClick={requestDiscount} className="btn-ghost flex-1 text-sm">ขอส่วนลด</button>
            <button onClick={requestVoid} className="btn-ghost flex-1 text-sm">ขอยกเลิกบิล</button>
          </div>
        </Center>
      </Shell>
    )
  }

  if (stage === 'done') return (
    <Shell {...shellProps}>
      <Center>
        <CheckMark className="mx-auto" />
        <p className="mt-5 font-display text-2xl font-semibold">ชำระเงินเรียบร้อย</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">฿{baht(order.total)}</p>
        {result?.points_earned > 0 && (
          <p className="text-rosedeep mt-1">สมาชิกได้รับ +{result.points_earned} NTime</p>
        )}
        {member && (
          <p className="text-sm text-sagegray mt-1">
            NTime คงเหลือ {result?.points_balance ?? member.points_balance} NTime
          </p>
        )}
          {err && <p role="alert" className="mt-4 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">{err}</p>}
          <button onClick={reprintReceipt} disabled={printBusy} className="btn-ghost mt-6 w-full gap-2">
            <PrinterIcon /> {printBusy ? 'กำลังเตรียมใบเสร็จ…' : 'พิมพ์ใบเสร็จซ้ำ (80 มม.)'}
          </button>
          <button onClick={newBill} className="btn-rose w-full mt-3">เปิดบิลใหม่</button>
      </Center>
    </Shell>
  )

  return (
    <Shell {...shellProps}>
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Counter {counterCode}</p>
          <h1 className="page-title">สร้างบิลใหม่</h1>
          <p className="page-description">เลือกบริการหรือสินค้า แล้วตรวจสอบรายการก่อนชำระเงิน</p>
        </div>
        <span className="badge-neutral self-start sm:self-auto">{cart.length} รายการในบิล</span>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="soft-panel hide-scrollbar mb-4 flex gap-1.5 overflow-x-auto p-1.5">
            <button onClick={() => selectCatalogTab('service')} className={(tab === 'service' ? 'btn-rose' : 'btn-ghost') + ' min-w-28 flex-1'}>บริการ</button>
            <button onClick={() => selectCatalogTab('product')} className={(tab === 'product' ? 'btn-rose' : 'btn-ghost') + ' min-w-28 flex-1'}>สินค้า</button>
            <button onClick={() => selectCatalogTab('redeem')} className={(tab === 'redeem' ? 'btn-rose' : 'btn-ghost') + ' min-w-28 flex-1'}>ใช้ NTime</button>
          </div>
          <div className="mb-4 space-y-3">
            <input
              className="input"
              type="search"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder={tab === 'redeem' ? 'ค้นหารางวัลด้วย NTime' : `ค้นหา${tab === 'service' ? 'บริการ' : 'สินค้า'} — พิมพ์บางส่วนได้`}
              aria-label={tab === 'redeem' ? 'ค้นหารางวัลด้วย NTime' : `ค้นหา${tab === 'service' ? 'บริการ' : 'สินค้า'}`}
            />
            {tabCategories.length > 0 && (
              <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-0.5" aria-label="กรองตามหมวดหมู่">
                <button type="button" onClick={() => setCategoryId('')} className={(categoryId === '' ? 'btn-rose' : 'btn-ghost') + ' shrink-0 px-3'}>ทั้งหมด</button>
                <button type="button" onClick={() => setCategoryId('__uncategorized__')} className={(categoryId === '__uncategorized__' ? 'btn-rose' : 'btn-ghost') + ' shrink-0 px-3'}>ยังไม่จัดหมวด</button>
                {tabCategories.map((category) => <button key={category.id} type="button" onClick={() => setCategoryId(category.id)} className={(categoryId === category.id ? 'btn-rose' : 'btn-ghost') + ' shrink-0 px-3'}>{category.name}</button>)}
              </div>
            )}
            <p className="text-xs font-medium text-sagegray">พบ {visibleCatalogItems.length} รายการ</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {tab === 'redeem'
              ? visibleCatalogItems.map((it) => (
                  <button key={it.id} onClick={() => addItem(it, 'redemption')}
                    className="card group min-h-32 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-rose/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose">
                    <p className="font-semibold leading-6 group-hover:text-rosedeep">{it.name}</p>
                    <p className="mt-3 text-sm font-bold text-rosedeep">{it.points_cost} NTime</p>
                  </button>
                ))
              : visibleCatalogItems.map((it) => (
                  <button key={it.id} onClick={() => addItem(it, tab)}
                    className="card group min-h-32 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-rose/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose">
                    <p className="font-semibold leading-6 group-hover:text-rosedeep">{it.name}</p>
                    <p className="mt-3 text-lg font-bold tabular-nums text-rosedeep">{catalogPriceLabel(it)}</p>
                    {it.price_mode === 'variable' && <p className="mt-1 text-xs font-medium text-sagegray">ระบุราคาและรายละเอียด</p>}
                    {tab === 'product' && <p className="text-xs text-sagegray">คงเหลือ {it.stock_qty}</p>}
                  </button>
                ))}
            {visibleCatalogItems.length === 0 && <p className="empty-state col-span-full">ไม่พบรายการที่ตรงกับการค้นหาหรือหมวดหมู่ที่เลือก</p>}
          </div>
        </div>

        <aside className="card h-fit overflow-hidden lg:sticky lg:top-5">
          <div className="border-b border-mist px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-title">รายการในบิล</p>
                <p className="section-note">โต๊ะชำระเงิน · {counterCode}</p>
              </div>
              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <button onClick={clearCart} className="min-h-9 rounded-lg px-2.5 text-sm font-medium text-danger transition hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
                    ล้างรายการ
                  </button>
                )}
                <span className="badge-neutral">{cart.length}</span>
              </div>
            </div>
          </div>
          <div className="p-5">
          <div className="mb-4">
            {member ? (
              <div className="soft-panel flex items-center justify-between p-3.5">
                <div>
                  <p className="font-semibold">{member.name}</p>
              <p className="text-xs text-sagegray">NTime {member.points_balance} · สะสม ฿{baht(member.accumulated_baht)}</p>
                </div>
                <button onClick={() => { setMember(null); setLinkCode(''); setCart((c) => c.filter((x) => x.item_type !== 'redemption')) }}
                  className="text-sagegray text-sm">เปลี่ยน</button>
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  <input className="input" placeholder="เบอร์สมาชิก (ถ้ามี)" value={phone}
                    onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
                  <button onClick={findMember} className="btn-ghost shrink-0">ค้นหา</button>
                </div>
                <button onClick={registerMemberAtPos} disabled={busy} className="btn-ghost mt-2 w-full">
                  สมัครสมาชิกใหม่ที่ POS
                </button>
              </div>
            )}
          </div>
          {member && !member.line_linked && (
            <div className="mb-3 rounded-xl border border-blush p-3 text-sm">
              <p className="mb-2 font-medium text-ink">ยังไม่ผูก LINE — สะสม NTime ได้ แต่ต้องผูก LINE ก่อนใช้ NTime</p>
              {linkCode ? (
                <p>โค้ดผูก LINE (หมดอายุใน 10 นาที): <b className="text-lg tracking-widest">{linkCode}</b></p>
              ) : (
                <button onClick={issueLinkCode} className="underline text-rosedeep">ออกโค้ดผูก LINE ให้ลูกค้า</button>
              )}
            </div>
          )}

          {cart.length === 0 && <div className="empty-state">แตะบริการหรือสินค้าเพื่อเพิ่มลงบิล</div>}
          {cart.map((c) => (
            <div key={c.key} className="border-b border-mist py-3 last:border-0">
              <div className="flex justify-between">
                <p className="font-medium">{c.name} {c.qty > 1 && `×${c.qty}`}</p>
                <p>{c.item_type === 'redemption' ? `${c.points_cost} NTime` : `฿${baht(c.price * c.qty)}`}</p>
              </div>
              {c.custom_price_reason && <p className="mt-1 text-xs text-sagegray">{c.custom_price_reason}</p>}
              <div className="flex justify-between items-center mt-1">
                <select className="min-h-9 rounded-lg bg-porcelain px-2 text-sm text-sagegray outline-none focus:ring-2 focus:ring-rose/30"
                  value={c.technician_id ?? ''} onChange={(e) => setTech(c.key, e.target.value)}>
                  {techs.map((t) => <option key={t.id} value={t.id}>ช่าง{t.name}</option>)}
                </select>
                <button onClick={() => removeItem(c.key)} className="min-h-9 rounded-lg px-2 text-sm font-medium text-danger hover:bg-danger/5">ลบ</button>
              </div>
            </div>
          ))}

          <div className="mt-4 flex justify-between border-t border-mist pt-4 text-lg font-semibold">
            <span>ยอดรวม</span><span className="text-2xl tabular-nums">฿{baht(total)}</span>
          </div>
          {err && <p className="text-rosedeep text-sm mt-2">{err}</p>}
          <button onClick={checkout} disabled={!cart.length || busy} className="btn-rose w-full mt-3 disabled:opacity-40">
            {busy ? 'กำลังสร้างบิล…' : total === 0 && cart.length ? 'ยืนยันบิลใช้ NTime' : 'ชำระเงิน (QR)'}
          </button>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

function CounterPicker({ counters, loading, error, onChoose, onRefresh }) {
  return (
    <div className="mx-auto w-full max-w-3xl py-6 sm:py-10">
      <div className="mb-6 text-center">
        <p className="page-eyebrow">Point of sale</p>
        <h1 className="page-title mt-2">เลือก Counter ที่ใช้งาน</h1>
        <p className="page-description mx-auto mt-2 max-w-xl">เลือก Counter ของเครื่องนี้ก่อนเปิดบิล ระบบจะจำไว้จนกว่าจะออกจากระบบหรือกดเปลี่ยน Counter</p>
      </div>

      {loading ? (
        <div className="card grid min-h-52 place-items-center p-8 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-blush border-t-rose" aria-hidden="true" />
          <p className="-mt-16 text-sm font-medium text-sagegray">กำลังโหลด Counter</p>
        </div>
      ) : error ? (
        <div className="card p-7 text-center">
          <AlertMark className="mx-auto" />
          <h2 className="mt-4 font-display text-2xl font-semibold">โหลด Counter ไม่สำเร็จ</h2>
          <p className="mt-2 text-sm text-danger">{error}</p>
          <button onClick={onRefresh} className="btn-ghost mt-5">ลองอีกครั้ง</button>
        </div>
      ) : counters.length === 0 ? (
        <div className="card p-7 text-center">
          <CounterIcon />
          <h2 className="mt-4 font-display text-2xl font-semibold">ยังไม่มี Counter</h2>
          <p className="mt-2 text-sm text-sagegray">ให้ Owner เพิ่ม Counter ใน ตั้งค่าระบบ → สาขาและเคาน์เตอร์ก่อน</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {counters.map((counter) => (
            <button
              key={counter.code}
              onClick={() => onChoose(counter.code)}
              className="card group min-h-40 p-6 text-left transition hover:-translate-y-0.5 hover:border-rose/35 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose/10 text-rosedeep"><CounterIcon /></span>
                {counter.has_open_order ? <span className="badge-rose">มีบิลค้าง</span> : <span className="badge-success">พร้อมใช้งาน</span>}
              </div>
              <p className="mt-5 font-display text-3xl font-semibold">Counter {counter.code}</p>
              <p className="mt-1 text-sm text-sagegray">{counter.has_open_order ? `บิล ${counter.active_order_no || 'กำลังรอชำระ'}` : 'แตะเพื่อเริ่มขายที่ Counter นี้'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PendingOrdersPage({ orders, activeOrder, counterCode, busyId, error, onRefresh, onResume, onBack }) {
  return (
    <div className="w-full">
      <div className="page-heading">
        <div>
          <button onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-sagegray transition hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose">
            <ArrowLeftIcon /> กลับหน้าขาย
          </button>
          <p className="page-eyebrow">Counter recovery</p>
          <h1 className="page-title">บิลค้างรับ</h1>
          <p className="page-description">บิลที่เปิดแล้วแต่ยังไม่ได้ยืนยันรับเงินจะอยู่ที่นี่ แม้รีเฟรชหน้า ปิดเบราว์เซอร์ หรือเปลี่ยนพนักงาน</p>
        </div>
        <button onClick={onRefresh} className="btn-ghost self-start sm:self-auto">รีเฟรชรายการ</button>
      </div>

      {activeOrder && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose/15 bg-rose/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-rosedeep">Counter {counterCode} กำลังใช้งาน</p>
            <p className="mt-1 text-sm text-sagegray">บิล {activeOrder.order_no} · ฿{baht(activeOrder.total)} ต้องจัดการให้เสร็จก่อนเปิดบิลค้างใบอื่น</p>
          </div>
          <button onClick={onBack} className="btn-rose shrink-0">กลับไปรับชำระ</button>
        </div>
      )}

      {error && <p role="alert" className="mb-5 rounded-xl border border-danger/15 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">{error}</p>}

      {orders.length === 0 ? (
        <div className="card p-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success/10 text-success"><ReceiptIcon /></span>
          <h2 className="mt-5 font-display text-2xl font-semibold">ไม่มีบิลค้างรับ</h2>
          <p className="mt-2 text-sm text-sagegray">บิลที่เปิดอยู่และยังไม่รับเงินจะแสดงในหน้านี้</p>
          <button onClick={onBack} className="btn-rose mt-6">สร้างบิลใหม่</button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((pendingOrder) => {
            const isCurrent = pendingOrder.id === activeOrder?.id
            const linkedElsewhere = pendingOrder.counter_code && pendingOrder.counter_code !== counterCode
            const counterBusy = Boolean(activeOrder) && !isCurrent
            const disabled = Boolean(busyId) || linkedElsewhere || counterBusy
            return (
              <article key={pendingOrder.id} className={`card overflow-hidden ${isCurrent ? 'ring-2 ring-rose/30' : ''}`}>
                <div className="flex items-start justify-between gap-3 border-b border-mist px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-xl font-semibold">บิล {pendingOrder.order_no}</h2>
                      {isCurrent && <span className="badge-rose">กำลังแสดงที่ C1</span>}
                      {!isCurrent && pendingOrder.counter_code && <span className="badge-neutral">Counter {pendingOrder.counter_code}</span>}
                    </div>
                    <p className="mt-1 text-xs text-sagegray">เปิดโดย {pendingOrder.opened_by} · {formatPendingTime(pendingOrder.created_at)}</p>
                  </div>
                  <span className="text-xl font-bold tabular-nums">฿{baht(pendingOrder.total)}</span>
                </div>
                <div className="px-5 py-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-porcelain px-3 py-2.5"><dt className="text-xs text-sagegray">รายการ</dt><dd className="mt-1 font-semibold">{pendingOrder.item_count} รายการ</dd></div>
                    <div className="rounded-xl bg-porcelain px-3 py-2.5"><dt className="text-xs text-sagegray">สมาชิก</dt><dd className="mt-1 truncate font-semibold">{pendingOrder.member_name || 'ลูกค้าทั่วไป'}</dd></div>
                  </dl>
                  <button
                    onClick={() => onResume(pendingOrder)}
                    disabled={disabled}
                    className={`${isCurrent ? 'btn-rose' : 'btn-ghost'} mt-4 w-full`}
                  >
                    {busyId === pendingOrder.id
                      ? 'กำลังเปิดบิล…'
                      : isCurrent
                        ? 'กลับไปรับชำระ'
                        : linkedElsewhere
                          ? `ใช้งานอยู่ที่ ${pendingOrder.counter_code}`
                          : counterBusy
                            ? `จัดการบิล ${activeOrder.order_no} ก่อน`
                            : `เปิดบิลนี้ที่ ${counterCode}`}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatPendingTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function Center({ children }) {
  return <div className="card mx-auto mt-10 max-w-lg p-6 text-center sm:p-9">{children}</div>
}
function Shell({ staff, logout, counterCode, pendingCount = 0, onPending, pendingActive = false, onCustomers, onAdmin, onChangeCounter, children }) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,_rgba(169,79,97,0.07),_transparent_32%),#f7f4f2]">
      <header className="sticky top-0 z-20 border-b border-mist bg-white/90 backdrop-blur-xl">
        <div className="page-shell flex min-h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            {counterCode && onChangeCounter && (
              <button
                onClick={onChangeCounter}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist bg-white px-3 text-sm font-semibold text-sagegray transition hover:border-blush hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"
                aria-label={`เปลี่ยน Counter ปัจจุบัน ${counterCode}`}
              >
                <CounterIcon />
                <span>{counterCode}</span>
                <span className="hidden lg:inline">เปลี่ยน</span>
              </button>
            )}
            {onAdmin && (
              <button
                onClick={onAdmin}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose/20 bg-rose/10 px-3 text-sm font-semibold text-rosedeep transition hover:bg-rose hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"
              >
                <SettingsIcon />
                <span className="hidden sm:inline">หลังร้าน</span>
              </button>
            )}
            {onCustomers && <button
              onClick={onCustomers}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist bg-white px-3 text-sm font-semibold text-sagegray transition hover:border-blush hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"
              aria-label="ดูข้อมูลลูกค้า"
            >
              <CustomerIcon />
              <span className="hidden sm:inline">ลูกค้า (ทีมบริการ)</span>
            </button>}
            {onPending && <button
              onClick={onPending}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose ${pendingActive ? 'border-rose/20 bg-rose/10 text-rosedeep' : 'border-mist bg-white text-sagegray hover:border-blush hover:text-ink'}`}
              aria-label={`บิลค้างรับ ${pendingCount} บิล`}
            >
              <ReceiptIcon />
              <span className="hidden sm:inline">บิลค้างรับ</span>
              <span className={pendingCount ? 'badge-rose min-h-6 px-2 py-0.5' : 'badge-neutral min-h-6 px-2 py-0.5'}>{pendingCount}</span>
            </button>}
            <div className="flex items-center gap-1 rounded-xl border border-mist bg-porcelain px-1.5 py-1 text-sm">
              <span className="hidden px-2 font-semibold text-ink sm:block">{staff.name}</span>
              <button onClick={logout} className="min-h-9 rounded-lg px-3 font-medium text-sagegray transition hover:bg-white hover:text-danger">ออก</button>
            </div>
          </div>
        </div>
      </header>
      <main className="page-shell px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
    </div>
  )
}

function ReceiptIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></svg>
}

function CustomerIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.7-3.5 3.3-5.5 7.5-5.5s6.8 2 7.5 5.5" /></svg>
}

function CounterIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 15h5" /></svg>
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.08h-3v-.08A1.7 1.7 0 0 0 10.66 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.04h-.08v-3h.08A1.7 1.7 0 0 0 7 9.92a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.7v-.08h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>
}

function PrinterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>
}

function ArrowLeftIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}
