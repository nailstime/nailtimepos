export function BrandMark({ inverse = false, compact = false, suffix = '' }) {
  return (
    <div className="brand-lockup">
      <span className={"brand-symbol " + (inverse ? "brand-symbol-inverse" : "")} aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M20 6.5c4.2 3.6 6.3 7.2 6.3 10.7 0 3.8-2.7 6.8-6.3 6.8s-6.3-3-6.3-6.8C13.7 13.7 15.8 10.1 20 6.5Z" />
          <path d="M20 33.5c-4.2-3.6-6.3-7.2-6.3-10.7 0-3.8 2.7-6.8 6.3-6.8s6.3 3 6.3 6.8c0 3.5-2.1 7.1-6.3 10.7Z" />
          <circle cx="20" cy="20" r="3.2" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className={"block font-display font-semibold tracking-tight " + (compact ? "text-lg" : "text-xl") + (inverse ? " text-white" : " text-ink")}>
          Nail Time <span className={inverse ? "text-white/70" : "text-rosedeep"}>&amp; Spa</span>
        </span>
        {!compact && <span className={"block text-[11px] font-medium tracking-[0.18em] uppercase " + (inverse ? "text-white/55" : "text-sagegray")}>Care in every detail{suffix}</span>}
      </span>
    </div>
  )
}

export function CheckMark({ className = '' }) {
  return (
    <span className={"status-icon status-icon-success " + className} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.5 3.4 3.4 7.6-8" /></svg>
    </span>
  )
}

export function AlertMark({ className = '' }) {
  return (
    <span className={"status-icon status-icon-danger " + className} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 7.5v5.5M12 16.5h.01" /><circle cx="12" cy="12" r="9" /></svg>
    </span>
  )
}
