export const tokens = {
  bg: {
    global: 'bg-[#f7f7f5]',
    page: 'bg-[#f7f7f5]',
    surface: 'bg-white',
    soft: 'bg-[#f0efec]',
    subtle: 'bg-[#f7f7f5]',
    overlay: 'bg-black/30',
    command: 'bg-white/95 backdrop-blur',
    userBubble: 'bg-[#1a1917]',
    assistantBubble: 'bg-white',
    warning: 'bg-amber-50',
    danger: 'bg-rose-50',
  },
  border: {
    default: 'border border-[#e5e4df]',
    subtle: 'border border-[#eeede9]',
    strong: 'border border-[#d4d3ce]',
    top: 'border-t border-[#e5e4df]',
    right: 'border-r border-[#e5e4df]',
    divider: 'border-t border-[#eeede9]',
    urgent: 'border-l-4 border-l-[#e05b4b]',
    warning: 'border border-amber-200',
    danger: 'border border-rose-200',
  },
  text: {
    primary: 'text-[#1a1917]',
    secondary: 'text-[#6b6a65]',
    muted: 'text-[#9c9b96]',
    inverse: 'text-white',
    warning: 'text-amber-800',
    warningSubtle: 'text-amber-700',
    danger: 'text-rose-700',
    greeting: 'text-[22px] font-semibold tracking-tight leading-snug',
    greetingSub: 'text-sm leading-relaxed',
    cardTitle: 'text-[13px] font-medium leading-snug',
    cardSub: 'text-xs leading-relaxed',
    button: 'text-[13px] font-medium',
    nav: 'text-[13px] font-medium',
    tiny: 'text-[11px]',
    mono: 'font-mono text-[11px]',
  },
  nav: {
    itemActive: 'bg-[#f0efec] text-[#1a1917]',
    itemIdle: 'text-[#6b6a65] hover:bg-[#f7f7f5] hover:text-[#1a1917]',
  },
  radius: {
    card: 'rounded-2xl',
    button: 'rounded-xl',
    pill: 'rounded-full',
    bubble: 'rounded-2xl',
    input: 'rounded-2xl',
  },
  shadow: {
    topbar: 'shadow-[0_1px_0_#e5e4df]',
    command: 'shadow-[0_-1px_0_#e5e4df]',
    card: 'shadow-[0_1px_3px_rgba(0,0,0,0.06)]',
    hover: 'hover:shadow-[0_8px_16px_rgba(0,0,0,0.08)] transition-shadow duration-150',
  },
  anim: {
    enter: 'animate-in fade-in slide-in-from-bottom-2 duration-300',
    fade: 'animate-in fade-in duration-200',
    resolve: 'animate-out fade-out slide-out-to-top-2 duration-200',
    snooze: 'animate-out fade-out slide-out-to-bottom-2 duration-200',
  },
  button: {
    primary:
      'inline-flex min-h-11 items-center justify-center px-4 bg-[#1a1917] text-white text-[13px] font-medium rounded-xl hover:bg-[#2d2c29] transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'inline-flex min-h-11 items-center justify-center px-4 bg-[#f0efec] text-[#1a1917] text-[13px] font-medium rounded-xl hover:bg-[#e8e7e3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    ghost:
      'inline-flex min-h-9 items-center justify-center px-3 text-[13px] font-medium text-[#6b6a65] rounded-xl hover:bg-[#f0efec] transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    icon:
      'inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#6b6a65] hover:bg-[#f0efec] hover:text-[#1a1917] transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  },
  badge: {
    base: 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
    neutral: 'bg-[#f0efec] text-[#6b6a65]',
    urgent: 'bg-rose-50 text-rose-700',
  },
  layout: {
    topbarHeight: 'h-12',
    sidebarWidth: 'w-60',
    stageMax: 'max-w-3xl',
    stagePad: 'px-4 md:px-6',
    stageInset: 'pt-6 pb-28',
  },
  input: {
    command:
      'min-h-10 flex-1 bg-transparent outline-none text-[13px] text-[#1a1917] placeholder:text-[#b8b7b2] disabled:opacity-50',
  },
  misc: {
    staleDot: 'bg-amber-400',
    skeleton: 'bg-slate-200',
    skeletonSoft: 'bg-slate-100',
  },
} as const;

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
