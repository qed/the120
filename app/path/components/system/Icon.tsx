import {
  LockIcon,
  CircleDashedIcon,
  CircleDotIcon,
  ClockIcon,
  StampIcon,
  CheckIcon,
  RadioIcon,
  BackpackIcon,
  BellIcon,
  CameraIcon,
  VideoIcon,
  UploadIcon,
  ImageIcon,
  FileTextIcon,
  StarIcon,
  PlusIcon,
  XIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ArrowRightIcon,
  ShieldCheckIcon,
  ClipboardCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon — the Lucide glyph set, 2px stroke, inlined SVG (no CDN), per the design
 * handoff contract. A general-purpose primitive for surface and nav chrome:
 * callers pass a stable kebab-case `name` from this curated, typed registry
 * instead of reaching for a lucide component, keeping the icon vocabulary in one
 * place. Components that carry a FIXED per-state glyph vocabulary (StatusChip's
 * six states, TrailStep's step marks) import those specific icons directly and
 * colocate the state->icon mapping — that is clearer than an indirection, not a
 * violation of this registry. The registry is tree-shakeable: only the icons
 * named here are bundled.
 *
 * Add an icon by importing its lucide component and adding one registry line —
 * `IconName` widens automatically.
 */
const REGISTRY = {
  lock: LockIcon,
  "circle-dashed": CircleDashedIcon,
  "circle-dot": CircleDotIcon,
  clock: ClockIcon,
  stamp: StampIcon,
  check: CheckIcon,
  radio: RadioIcon,
  backpack: BackpackIcon,
  bell: BellIcon,
  camera: CameraIcon,
  video: VideoIcon,
  upload: UploadIcon,
  image: ImageIcon,
  "file-text": FileTextIcon,
  star: StarIcon,
  plus: PlusIcon,
  x: XIcon,
  "chevron-right": ChevronRightIcon,
  "chevron-left": ChevronLeftIcon,
  "arrow-right": ArrowRightIcon,
  "shield-check": ShieldCheckIcon,
  "clipboard-check": ClipboardCheckIcon,
  sparkles: SparklesIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof REGISTRY;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Accessible label. When omitted the glyph is marked decorative. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 20, strokeWidth = 2, title, className }: IconProps) {
  const Glyph = REGISTRY[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
