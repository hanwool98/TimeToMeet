const tabs = ['##', '##', '##', '##'];

export default function BottomTabs() {
  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[430px] border-t border-black bg-meet-tab"
    >
      <div className="grid grid-cols-4">
        {tabs.map((tab, index) => (
          <button
            aria-label={`${tab} 메뉴`}
            className="flex h-[74px] min-w-0 flex-col items-center justify-center gap-2 border-r border-white/80 text-[#5f4646] last:border-r-0"
            key={tab}
            type="button"
          >
            <span
              className={[
                'h-7 w-7 rounded-[8px] border-[3px]',
                index === 0 ? 'border-black bg-white' : 'border-[#7a5454] bg-[#fff6f6]',
              ].join(' ')}
            />
            <span className="text-[12px] font-semibold italic leading-none">{tab}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
