import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export default function PrimaryButton({
  children,
  className = '',
  disabled,
  ...props
}: PrimaryButtonProps) {
  return (
    <button
      className={[
        'h-14 w-full rounded-[18px] px-5 text-[16px] font-extrabold transition active:scale-[0.99]',
        disabled
          ? 'cursor-not-allowed bg-slate-200 text-slate-400'
          : 'bg-meet-blue text-white shadow-sm hover:bg-[#5aa7e9]',
        className,
      ].join(' ')}
      disabled={disabled}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
