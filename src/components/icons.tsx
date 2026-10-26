import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </Base>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5" />
      <path d="M8 7.5h7M8 11h5" />
    </Base>
  );
}

export function IconStar(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.2l1.7 4.9 5.1 1.1-3.8 3.8.7 5.2-3.7-2.6-3.7 2.6.7-5.2L4.2 9.2l5.1-1.1z" />
    </Base>
  );
}

export function IconMuseum(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 9.2 12 4l9 5.2" />
      <path d="M5 9.5V19M9.5 9.5V19M14.5 9.5V19M19 9.5V19" />
      <path d="M3 19h18M3 21h18" />
    </Base>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Base>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5l1.3 3.7 3.7 1.3-3.7 1.3L12 13.5l-1.3-3.7L7 8.5l3.7-1.3z" />
      <path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      <path d="M5.5 13.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
    </Base>
  );
}

export function IconHourglass(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3v3.2c0 1 .5 1.9 1.4 2.5L12 10.5l2.6-1.8c.9-.6 1.4-1.5 1.4-2.5V3" />
      <path d="M8 21v-3.2c0-1 .5-1.9 1.4-2.5L12 13.5l2.6 1.8c.9.6 1.4 1.5 1.4 2.5V21" />
    </Base>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.2 13.2a7.6 7.6 0 0 0 0-2.4l2-1.4-2-3.4-2.3.8a7.7 7.7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.7 7.7 0 0 0-2 1.2l-2.3-.8-2 3.4 2 1.4a7.6 7.6 0 0 0 0 2.4l-2 1.4 2 3.4 2.3-.8a7.7 7.7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 2-1.2l2.3.8 2-3.4z" />
    </Base>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Base>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Base>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m9 5 7 7-7 7" />
    </Base>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m15 5-7 7 7 7" />
    </Base>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </Base>
  );
}

export function IconEdit(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m14.5 5.5 3 3" />
    </Base>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </Base>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Base>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />
    </Base>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.5" />
    </Base>
  );
}

export function IconUnlock(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 7.2-2.4" />
      <path d="M12 14v2.5" />
    </Base>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m4.5 17 5-5 3.5 3.5 2.5-2.5 4 4" />
    </Base>
  );
}

export function IconAudio(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 14v-4M8 17V7M12 19V5M16 16V8M20 14v-4" />
    </Base>
  );
}

export function IconVideo(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="m15 10 5-2.5v9L15 14" />
    </Base>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 1 0-5-5L11 7.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0L6.5 13a3.5 3.5 0 1 0 5 5l1.5-1.5" />
    </Base>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </Base>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4.5 20 20" />
      <path d="M9.9 5.8A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4.1M6.2 7.3A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Base>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </Base>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function IconPin(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </Base>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </Base>
  );
}

export function IconLeaf(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 19c8 1 14-4 14-14-8 0-14 4-14 14Z" />
      <path d="M5 19c2-4 5-7 9-9" />
    </Base>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3.5 19 6v6c0 4.5-3 7-7 8.5C8 19 5 16.5 5 12V6z" />
      <path d="m9 12 2 2 4-4" />
    </Base>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
      <path d="M5.5 9v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </Base>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Base>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Base>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </Base>
  );
}
