type Item = { key: string; label: string };

export default function Sidebar({
  items,
  active,
  onSelect,
  children,
}: {
  items: Item[];
  active: string;
  onSelect: (key: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <aside className="w-72 shrink-0 h-screen bg-slate-900 backdrop-blur-xl border-r border-slate-700 flex flex-col transition-all duration-300 shadow-lg">
      <div className="px-4 pt-6 pb-4">
        <div className="text-xl font-medium tracking-tight text-white">HowTo</div>
      </div>
      {children && (
        <div className="px-3 pb-4">
          {children}
        </div>
      )}
      <nav className="px-3 py-2 flex-1">
        <div className="space-y-1">
          {items.map((it) => (
            <button
              key={it.key}
              className={`
                w-full text-left px-3 py-2.5 rounded-lg font-medium text-sm transition-all duration-200
                ${active === it.key 
                  ? 'bg-slate-700/80 text-white shadow-sm' 
                  : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                }
                active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0
              `}
              onClick={() => onSelect(it.key)}
            >
              {it.label}
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
