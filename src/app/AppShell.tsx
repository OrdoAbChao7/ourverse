import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/app/AuthContext';
import { StarField } from '@/app/StarField';
import { Wordmark } from '@/app/Wordmark';
import { initials } from '@/lib/text';
import { applyAccent } from '@/lib/accent';
import { Badge } from '@/components/ui/Primitives';
import {
  IconBook,
  IconHome,
  IconHourglass,
  IconMuseum,
  IconSettings,
  IconSparkles,
  IconStar,
  IconUser,
} from '@/components/icons';

const NAV = [
  { to: '/app', label: '首页', icon: IconHome, end: true },
  { to: '/app/timeline', label: '时光长廊', short: '回忆', icon: IconBook },
  { to: '/app/stars', label: '星空', short: '星空', icon: IconStar },
  { to: '/app/gallery', label: '数字博物馆', short: '博物馆', icon: IconMuseum },
  { to: '/app/capsules', label: '时间胶囊', short: '胶囊', icon: IconHourglass },
  { to: '/app/ask', label: '记忆助手', short: '助手', icon: IconSparkles },
] as const;

const MOBILE_NAV = [
  { to: '/app', label: '首页', icon: IconHome, end: true },
  { to: '/app/timeline', label: '回忆', icon: IconBook },
  { to: '/app/stars', label: '星空', icon: IconStar },
  { to: '/app/gallery', label: '博物馆', icon: IconMuseum },
  { to: '/app/settings', label: '我的', icon: IconUser },
] as const;

function MemberBadge({ name, index }: { name: string; index: number }) {
  const tones = ['from-[#b9a1e8]/35 to-[#b9a1e8]/5', 'from-[#f0d49c]/30 to-[#f0d49c]/5'];
  return (
    <span
      className={cn(
        'flex size-8 items-center justify-center rounded-full border border-white/12 bg-gradient-to-b text-[12px] text-ink/90',
        tones[index % tones.length],
      )}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

function SidebarNav() {
  const { state, session } = useAuth();
  const members = session?.members ?? [];
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/[0.06] bg-[rgba(5,11,20,0.55)] backdrop-blur-xl lg:flex">
      <div className="px-6 pb-6 pt-7">
        <Wordmark />
        <p className="mt-4 flex items-center gap-1.5 text-[10.5px] tracking-[0.08em] text-dim/85">
          <span className="size-1 rounded-full bg-cyan/70" />
          仅限两位成员的私人空间
        </p>
      </div>

      <nav aria-label="主导航" className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : undefined}
            className={({ isActive }) =>
              cn(
                'group flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors duration-200',
                isActive ? 'bg-white/[0.06] text-ink' : 'text-mist/75 hover:bg-white/[0.035] hover:text-mist',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={17} className={isActive ? 'text-violet' : 'text-dim group-hover:text-mist'} />
                <span>{item.label}</span>
                {isActive && <span className="ml-auto size-1 rounded-full bg-violet/80" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 px-3 pb-6">
        <NavLink
          to="/app/settings"
          className={({ isActive }) =>
            cn(
              'group flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors duration-200',
              isActive ? 'bg-white/[0.06] text-ink' : 'text-mist/75 hover:bg-white/[0.035] hover:text-mist',
            )
          }
        >
          <IconSettings size={17} className="text-dim group-hover:text-mist" />
          设置
        </NavLink>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="label-caps text-[10px]">这颗星球</span>
            {state.isDemo && <Badge tone="gold">DEMO</Badge>}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            {members.map((member, index) => (
              <MemberBadge key={member.userId} name={member.profile.displayName} index={index} />
            ))}
            {members.length < 2 && (
              <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-white/15 text-[11px] text-dim">
                +
              </span>
            )}
            <div className="min-w-0 flex-1 pl-1">
              <p className="truncate text-[12px] text-ink/85">
                {members.length === 2
                  ? members.map((member) => member.profile.displayName).join(' · ')
                  : members[0]?.profile.displayName ?? '尚未配对'}
              </p>
              <p className="mt-0.5 truncate text-[10.5px] text-dim">
                {session?.space?.displayName ?? '还没有空间'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  const { state } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[rgba(6,12,22,0.72)] backdrop-blur-xl lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <NavLink to="/app" aria-label="OURVERSE 首页">
          <Wordmark compact />
        </NavLink>
        <div className="flex items-center gap-1">
          {state.isDemo && <Badge tone="gold" className="mr-1">DEMO</Badge>}
          <NavLink
            to="/app/capsules"
            aria-label="时间胶囊"
            className={({ isActive }) =>
              cn('rounded-lg p-2', isActive ? 'text-violet' : 'text-mist hover:text-ink')
            }
          >
            <IconHourglass size={19} />
          </NavLink>
          <NavLink
            to="/app/ask"
            aria-label="记忆助手"
            className={({ isActive }) =>
              cn('rounded-lg p-2', isActive ? 'text-violet' : 'text-mist hover:text-ink')
            }
          >
            <IconSparkles size={19} />
          </NavLink>
        </div>
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-[rgba(6,12,22,0.82)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex h-[62px] max-w-md items-stretch justify-around px-2">
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : undefined}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10.5px] transition-colors',
                isActive ? 'text-ink' : 'text-dim hover:text-mist',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} className={isActive ? 'text-violet' : undefined} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function AppShell() {
  const { pathname } = useLocation();
  const { session } = useAuth();
  const reduced = useReducedMotion();
  const mainRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    applyAccent(session?.space?.settings.accent ?? 'violet');
  }, [session?.space?.settings.accent]);

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-night"
      >
        跳到主要内容
      </a>
      <StarField intensity={0.85} />
      <ScrollToTop />
      <SidebarNav />
      <MobileHeader />

      <div className="relative z-10 lg:pl-64">
        <main
          id="main"
          ref={mainRef}
          className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={mounted ? { opacity: 0, y: reduced ? 0 : 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -4 }}
              transition={{ duration: reduced ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
