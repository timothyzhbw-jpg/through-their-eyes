// Inline stroke icons of the Floodlit design: decoration only, so every one is aria-hidden and the
// control that holds it carries the name.

import type { ReactNode } from "react";

function Icon({
  size = 16,
  fill,
  children,
}: {
  size?: number;
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Icon fill>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon fill>
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </Icon>
);

export const ArrowIcon = () => (
  <span className="arrow">
    <Icon>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  </span>
);

export const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={14}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const SoundOnIcon = () => (
  <Icon size={18}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6" />
    <path d="M18 6.5a8 8 0 0 1 0 11" />
  </Icon>
);

export const SoundOffIcon = () => (
  <Icon size={18}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="m16 10 4 4" />
    <path d="m20 10-4 4" />
  </Icon>
);

export const SlidersIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const ExpandIcon = () => (
  <Icon size={14}>
    <path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6" />
  </Icon>
);

export const SpinnerIcon = () => (
  <span className="spin">
    <Icon>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
  </span>
);

export const DotsIcon = () => (
  <Icon fill>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </Icon>
);
