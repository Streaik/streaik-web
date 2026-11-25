export function DialogTabs<T extends string>({ id, label, tabs, value, onChange, className = 'chat-tool-tabs' }: {
  id: string; label: string; tabs: ReadonlyArray<readonly [T, string]>; value: T; onChange: (tab: T) => void; className?: string;
}) {
  return <div className={className} role="tablist" aria-label={label}>
    {tabs.map(([key, title], index) => <button key={key} id={`${id}-${key}-tab`} type="button" role="tab"
      aria-selected={value === key} aria-controls={`${id}-${key}-panel`} tabIndex={value === key ? 0 : -1}
      onClick={() => onChange(key)} onKeyDown={event => {
        const count = tabs.length;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
          : event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : undefined;
        if (next === undefined) return;
        event.preventDefault();
        const [target] = tabs[next];
        onChange(target);
        document.getElementById(`${id}-${target}-tab`)?.focus();
      }}>{title}</button>)}
  </div>;
}
