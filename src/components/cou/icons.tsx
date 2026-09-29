// Minimal outline icons for the customer app (24px grid, stroke = currentColor). No icon dependency.
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  search: (<><circle cx="10" cy="10" r="7" /><path d="m21 21-6-6" /></>),
  bell: (<><path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" /></>),
  user: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.2 18.8a6 6 0 0 1 11.6 0" /></>),
  help: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>),
  // Customer-support agent: head, headband, ear cups and a mic boom.
  support: (<><circle cx="12" cy="9" r="3.5" /><path d="M6.5 10a5.5 5.5 0 0 1 11 0" /><rect x="5" y="9.5" width="2.5" height="4" rx="1.2" /><rect x="16.5" y="9.5" width="2.5" height="4" rx="1.2" /><path d="M17.75 13.5v.5a2.5 2.5 0 0 1-2.5 2.5H13M5.5 21a6.5 6.5 0 0 1 13 0" /></>),
  back: <path d="M5 12h14M5 12l6 6M5 12l6-6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  scan: (<><path d="M4 7V6a2 2 0 0 1 2-2h2M4 17v1a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v1M16 20h2a2 2 0 0 0 2-2v-1M5 12h14" /></>),
  send: <path d="M10 14 21 3M21 3l-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1L21 3" />,
  bank: (<><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" /></>),
  wallet: (<><path d="M17 8V5a1 1 0 0 0-1-1H6a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V6" /><path d="M20 12v4h-4a2 2 0 0 1 0-4h4" /></>),
  battery: (<><path d="M16 7h1a2 2 0 0 1 2 2v.5a.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5.5.5 0 0 0-.5.5v.5a2 2 0 0 1-2 2h-2M8 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1" /><path d="m12 8-2 4h3l-2 4" /></>),
  bulb: (<><path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7-.7.7" /><path d="M9 16a5 5 0 1 1 6 0 3.5 3.5 0 0 0-1 3 2 2 0 0 1-4 0 3.5 3.5 0 0 0-1-3M9.7 17h4.6" /></>),
  phone: (<><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M11 4h2M12 17v.01" /></>),
  road: <path d="M4 19 8 5M16 5l4 14M12 6v2M12 11v2M12 16v2" />,
  flame: <path d="M12 12c2-2.96 0-7-1-8 0 3.04-1.77 4.74-3 6-1.23 1.27-2 3.27-2 5a6 6 0 1 0 12 0c0-1.5-1.06-3.87-2-5-1.79 3-2.8 3-4 2" />,
  droplet: <path d="M7.5 9.5 12 3l4.5 6.5a6 6 0 1 1-9 0" />,
  receipt: <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2M9 7h6M9 11h6M13 15h2" />,
  dots: (<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
  history: (<><path d="M12 8v4l2 2" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></>),
  check: <path d="m5 12 5 5L20 7" />,
  checkCircle: (<><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>),
  alert: (<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  share: (<><circle cx="6" cy="12" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8.7 10.7 6.6-3.4M8.7 13.3l6.6 3.4" /></>),
  download: <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12" />,
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4" /></>),
  repeat: <path d="M4 12V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 12v3a3 3 0 0 1-3 3H4m3 3-3-3 3-3" />,
  card: (<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h.01M11 15h2" /></>),
  upi: <path d="m7 4 5 8-5 8M13 4l5 8-5 8" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
