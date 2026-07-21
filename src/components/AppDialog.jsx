import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolverRef = useRef(null)

  const prompt = useCallback((options) => new Promise((resolve) => {
    if (resolverRef.current) resolverRef.current(null)
    resolverRef.current = resolve
    setDialog({ ...options, key: Date.now() })
  }), [])

  const confirm = useCallback((options) => prompt({ ...options, mode: 'confirm' }), [prompt])

  const resolveDialog = useCallback((value) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setDialog(null)
    resolve?.(value)
  }, [])

  useEffect(() => () => {
    resolverRef.current?.(null)
    resolverRef.current = null
  }, [])

  const api = useMemo(() => ({ prompt, confirm }), [prompt, confirm])

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <AppDialog key={dialog.key} options={dialog} onResolve={resolveDialog} />}
    </DialogContext.Provider>
  )
}

export function useAppDialog() {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useAppDialog must be used inside DialogProvider')
  return value
}

function AppDialog({ options, onResolve }) {
  const [value, setValue] = useState(String(options.initialValue ?? ''))
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const confirmRef = useRef(null)
  const panelRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()
  const isDanger = options.tone === 'danger'
  const isConfirm = options.mode === 'confirm'

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => {
      const target = isConfirm ? confirmRef.current : inputRef.current
      target?.focus()
      target?.select?.()
    }, 0)

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onResolve(null)
        return
      }
      if (event.key === 'Tab') {
        const focusable = [...(panelRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [isConfirm, onResolve])

  function submit(event) {
    event.preventDefault()
    if (isConfirm) {
      onResolve(true)
      return
    }
    const result = options.trim === false ? value : value.trim()
    if (options.required && !result) {
      setError(options.requiredMessage || 'กรุณากรอกข้อมูลก่อนดำเนินการต่อ')
      inputRef.current?.focus()
      return
    }
    const validationError = options.validate?.(result)
    if (validationError) {
      setError(validationError)
      inputRef.current?.focus()
      return
    }
    onResolve(result)
  }

  const fieldProps = {
    ref: inputRef,
    className: 'input min-h-12',
    value,
    placeholder: options.placeholder || '',
    inputMode: options.inputMode,
    autoComplete: options.autoComplete || 'off',
    maxLength: options.maxLength,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${descriptionId}-error` : descriptionId,
    onChange: (event) => {
      setValue(event.target.value)
      if (error) setError('')
    },
  }

  return createPortal(
    <div
      className="app-dialog-backdrop fixed inset-0 z-[1000] grid place-items-center overflow-y-auto bg-ink/45 px-4 py-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve(null)
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="app-dialog-panel w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
      >
        <form onSubmit={submit}>
          <div className="px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
            <div className="flex items-start gap-4">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isDanger ? 'bg-danger/10 text-danger' : 'bg-rose/10 text-rosedeep'}`} aria-hidden="true">
                {isDanger ? <DangerIcon /> : <EditIcon />}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id={titleId} className="font-display text-xl font-semibold leading-7 text-ink">{options.title}</h2>
                <p id={descriptionId} className="mt-1 text-sm leading-6 text-sagegray">{options.description}</p>
              </div>
              <button
                type="button"
                onClick={() => onResolve(null)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sagegray transition hover:bg-porcelain hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose"
                aria-label="ปิดหน้าต่าง"
              >
                <CloseIcon />
              </button>
            </div>

            {!isConfirm && (
              <>
                <label className="mt-6 block text-sm font-semibold text-ink" htmlFor={`${titleId}-field`}>
                  {options.label}
                  {options.required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
                </label>
                {options.multiline ? (
                  <textarea id={`${titleId}-field`} rows={4} {...fieldProps} className={`${fieldProps.className} resize-none py-3 leading-6`} />
                ) : (
                  <input id={`${titleId}-field`} type={options.type || 'text'} {...fieldProps} />
                )}
                {error ? (
                  <p id={`${descriptionId}-error`} role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>
                ) : options.helperText ? (
                  <p className="mt-2 text-xs leading-5 text-sagegray">{options.helperText}</p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-mist bg-porcelain/65 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <button type="button" onClick={() => onResolve(null)} className="btn-ghost sm:min-w-28">
              {options.cancelLabel || 'ยกเลิก'}
            </button>
            <button ref={confirmRef} type="submit" className={`${isDanger ? 'btn-danger' : 'btn-rose'} sm:min-w-32`}>
              {options.confirmLabel || 'ยืนยัน'}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

function EditIcon() {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
}

function DangerIcon() {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.8 19h18.4Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
}
