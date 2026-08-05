import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Answers, Credentials, Kid } from '../types/onboarding';
import { buildCredentials } from '../utils/story';

interface OnboardingValue {
  kid: Kid;
  setKid: (kid: Kid) => void;
  answers: Answers;
  setAnswer: (id: string, value: string) => void;
  setAnswers: (answers: Answers) => void;
  credentials: Credentials;
}

const OnboardingContext = createContext<OnboardingValue | null>(null);

const EMPTY_KID: Kid = { fullName: '', age: '', photoUrl: null, coverImageUrl: null };

export function OnboardingProvider({ children }: {children: React.ReactNode;}) {
  const [kid, setKid] = useState<Kid>(EMPTY_KID);
  const [answers, setAnswers] = useState<Answers>({});

  const value = useMemo<OnboardingValue>(
    () => ({
      kid,
      setKid,
      answers,
      setAnswers,
      setAnswer: (id, val) => setAnswers((prev) => ({ ...prev, [id]: val })),
      credentials: buildCredentials(kid, answers)
    }),
    [kid, answers]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return ctx;
}