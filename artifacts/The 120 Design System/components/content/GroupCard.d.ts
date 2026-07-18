export interface GroupCardProps {
  /** Mono category label, e.g. "ATHLETES", "GIFTED & TALENTED". */
  category: string;
  /** Group name, e.g. "The Athletes". */
  name: string;
  /** One-line blurb. */
  blurb: string;
  /** Bottom mono CTA line. */
  cta?: string;
  href?: string;
}
export function GroupCard(props: GroupCardProps): JSX.Element;
