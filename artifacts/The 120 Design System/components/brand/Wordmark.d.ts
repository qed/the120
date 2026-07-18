export interface WordmarkProps {
  /** Surface the lockup sits on. Light = bone wordmark + blush sublabel. */
  tone?: "dark" | "light";
  /** Letterspaced sublabel under the wordmark (e.g. "TORONTO", "GT TORONTO"). */
  sublabel?: string;
  /** Show the sublabel line. */
  stacked?: boolean;
}
export function Wordmark(props: WordmarkProps): JSX.Element;
