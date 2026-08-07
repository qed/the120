import type { Answers, Credentials, Kid } from '../types/onboarding';

const STOP_WORDS = new Set([
'my',
'the',
'a',
'an',
'i',
'we',
'that',
'this',
'it',
'and',
'is',
'are',
'to',
'of',
'in',
'for']
);

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || '';
}

/** The first meaningful word the kid used in their application, e.g. "soccer". */
export function applicationWord(answers: Answers): string {
  const source = answers.matters || answers.intro || '';
  const word = source.
  toLowerCase().
  replace(/[^a-z\s]/g, ' ').
  split(/\s+/).
  find((w) => w.length > 3 && !STOP_WORDS.has(w));
  return word || 'business';
}

export function buildCredentials(kid: Kid, answers: Answers): Credentials {
  const handle = firstName(kid.fullName).toLowerCase().replace(/[^a-z]/g, '') || 'founder';
  return {
    email: `${handle}@firstprofit.school`,
    password: `ilove${applicationWord(answers)}`
  };
}