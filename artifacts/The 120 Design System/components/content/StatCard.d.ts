export interface StatCardProps {
  /** The number/value, e.g. "1400". */
  value: string;
  /** Optional red accent character, e.g. "+". */
  accent?: string;
  /** Mono data label under the numeral. */
  label: string;
  /** Optional supporting sentence. */
  note?: string;
}
export function StatCard(props: StatCardProps): JSX.Element;
