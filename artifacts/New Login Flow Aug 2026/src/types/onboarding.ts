export interface Kid {
  fullName: string;
  age: string;
  photoUrl: string | null;
  /** The customized graphic-novel art generated from the uploaded photo. */
  coverImageUrl: string | null;
}

export type Answers = Record<string, string>;

export interface Credentials {
  email: string;
  password: string;
}

export interface StoryQuestion {
  id: string;
  question: string;
  hint?: string;
  sample: string;
  rows: number;
}