import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BrandHeader } from '../components/BrandHeader';
import { StepAddKid } from '../components/onboarding/StepAddKid';
import { StepCover } from '../components/onboarding/StepCover';
import { StepStoryPage } from '../components/onboarding/StepStoryPage';
import { StepAccountReady } from '../components/onboarding/StepAccountReady';
import { useOnboarding } from '../contexts/OnboardingContext';
import { storyQuestions } from '../data/storyQuestions';
import type { Answers } from '../types/onboarding';

const STEP_LABELS = ['Add your kid', 'Their cover', 'Page 1', 'Account ready'];

export function Onboarding() {
  const { kid, setKid, answers, setAnswer, setAnswers, credentials } = useOnboarding();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  const goTo = (next: number) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fillSample = () => {
    const sample: Answers = {};
    storyQuestions.forEach((q) => {
      sample[q.id] = q.sample;
    });
    setAnswers(sample);
  };

  return (
    <div className="min-h-screen w-full bg-cream paper-grain">
      <BrandHeader step={step + 1} totalSteps={STEP_LABELS.length} stepLabel={STEP_LABELS[step]} />

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            
            {step === 0 &&
            <StepAddKid
              onSubmit={(fullName, age) => {
                setKid({ fullName, age, photoUrl: null, coverImageUrl: null });
                goTo(1);
              }} />

            }

            {step === 1 &&
            <StepCover
              fullName={kid.fullName}
              age={kid.age}
              photoUrl={kid.photoUrl}
              coverImageUrl={kid.coverImageUrl}
              onPhotoChange={(photoUrl, coverImageUrl) =>
              setKid({ ...kid, photoUrl, coverImageUrl })
              }
              onContinue={() => goTo(2)} />

            }

            {step === 2 &&
            <StepStoryPage
              fullName={kid.fullName}
              photoUrl={kid.photoUrl}
              coverImageUrl={kid.coverImageUrl}
              answers={answers}
              onAnswer={setAnswer}
              onFillSample={fillSample}
              onContinue={() => goTo(3)} />

            }

            {step === 3 &&
            <StepAccountReady
              fullName={kid.fullName}
              age={kid.age}
              photoUrl={kid.photoUrl}
              coverImageUrl={kid.coverImageUrl}
              credentials={credentials}
              onContinue={() => navigate('/login')} />

            }
          </motion.div>
        </AnimatePresence>
      </main>
    </div>);

}