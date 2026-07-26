

import type { TaskCardData } from '../hq/TaskCard';
import type { EvidenceItem } from '../system/ReviewPanel';
import type { WisdomEntry } from '../system/Wisdom';

export const NOW_TASK: TaskCardData = {
  id: '1.2.4',
  title: 'Ask until one yes',
  body: 'Make real asks to real customers who are not family, until one person says yes and money changes hands.',
  doneWhen: 'Money from a non-family customer is in hand and the sale is logged (who, what, amount, date).',
  bandVariant: 'Grades 3–5: a parent may stand beside them at the door, but cannot make the ask.',
  state: 'available',
  phase: 'sell'
};

export const SUBMITTED_TASK: TaskCardData = {
  id: '1.1.3',
  title: 'Record the 60-second pitch',
  body: 'Film a clean 60-second pitch of the product to an adult who is not family, without notes.',
  doneWhen: 'Three consecutive clean runs are recorded and one is submitted.',
  state: 'submitted',
  phase: 'sell'
};

export const NOT_YET_TASK: TaskCardData = {
  id: '1.1.3',
  title: 'Record the 60-second pitch',
  body: 'Film a clean 60-second pitch of the product to an adult who is not family, without notes.',
  doneWhen: 'Three consecutive clean runs are recorded and one is submitted.',
  state: 'not_yet',
  phase: 'sell',
  reviewNote: 'Great energy — but it needs three clean runs in a row. Resubmit when ready.'
};

export const VERIFIED_TASK: TaskCardData = {
  id: '1.2.4',
  title: 'Ask until one yes',
  body: 'Make real asks to real customers who are not family, until one person says yes.',
  doneWhen: 'Money from a non-family customer is in hand and the sale is logged.',
  state: 'verified',
  phase: 'sell',
  verifierComment: 'You knocked on nine doors and never lost the smile. Proud of you.'
};

export const LIVE_TASK: TaskCardData = {
  id: '2.5.4',
  title: 'Deliver the live demo',
  body: 'Present a 3–5 minute live demo to a real audience: the build, the results, the lessons.',
  doneWhen: 'The demo is delivered live to a non-family audience and recorded.',
  state: 'in_progress',
  phase: 'build',
  liveMoment: true
};

export const REVIEW_EVIDENCE: EvidenceItem[] = [
{ kind: 'photo', label: 'Photo — the toonie in hand at the door' },
{ kind: 'log', label: 'Sale log — Mrs. Okafor · bracelet · $2 · Sat' },
{ kind: 'video', label: 'Clip — the ask and the yes' }];


export const WISDOM_QUOTE: WisdomEntry = {
  text: 'Price is what you pay. Value is what you get.',
  attribution: 'Warren Buffett'
};

export const WISDOM_ORIGINAL: WisdomEntry = {
  text: 'A no is not a door closing. It is a map telling you where the wall is.',
  attribution: 'The 120',
  original: true
};

export const MONTAGE = ["/d66d4c8e-8390-4a5d-9676-7eee05ebe673.jpg", "/37891ec0-3b6a-452a-bdda-aa5c8d390324.jpg", "/80c4af3b-019c-4b52-8045-9c753c7171a6.jpg", "/f99682ad-2ff4-4a7f-83b9-b0292c629cf4.jpg"];