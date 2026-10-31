/** Brand mark: three ascending bars (the rank ladder) and the lowercase wordmark. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1E65E3" />
        <rect x="6.5" y="17" width="5" height="8.5" rx="1.4" fill="#fff" opacity=".55" />
        <rect x="13.5" y="12" width="5" height="13.5" rx="1.4" fill="#fff" opacity=".8" />
        <rect x="20.5" y="6.5" width="5" height="19" rx="1.4" fill="#fff" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[-0.04em] text-ink">idraft</span>
    </span>
  );
}
