export interface FeatureCardProps {
  /** Cover image URL. */
  image?: string;
  alt?: string;
  title: string;
  /** Mono numeric index, e.g. "01". */
  index?: string;
  body: string;
}
export function FeatureCard(props: FeatureCardProps): JSX.Element;
