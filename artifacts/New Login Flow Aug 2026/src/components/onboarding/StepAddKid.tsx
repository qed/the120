import React, { useState } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import { PrimaryButton } from '../PrimaryButton';

interface StepAddKidProps {
  onSubmit: (fullName: string, age: string) => void;
}

export function StepAddKid({ onSubmit }: StepAddKidProps) {
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (fullName.trim().length < 2) {
      setError('Please enter your kid’s full name.');
      return;
    }
    const parsed = Number(age);
    if (!age || Number.isNaN(parsed) || parsed < 5 || parsed > 18) {
      setError('Please enter an age between 5 and 18.');
      return;
    }
    setError(null);
    onSubmit(fullName.trim(), age.trim());
  };

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-12 sm:py-16">
      <p className="label-mono text-one20">Welcome from The 120</p>
      <h1 className="mt-3 font-display text-4xl font-black leading-[1.05] text-ink sm:text-5xl">
        Add your kid, and their story starts.
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-stone">
        First Profit turns starting a real, tiny business into a guided graphic novel. It begins
        with one page — theirs.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-9 space-y-5">
        <div>
          <label htmlFor="kid-name" className="label-mono block text-stone">
            Kid’s full name
          </label>
          <input
            id="kid-name"
            type="text"
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Remi Newal"
            className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-display text-lg text-ink shadow-card outline-none transition-colors placeholder:text-ink/25 focus:border-profit" />
          
        </div>

        <div>
          <label htmlFor="kid-age" className="label-mono block text-stone">
            Age
          </label>
          <input
            id="kid-age"
            type="number"
            inputMode="numeric"
            min={5}
            max={18}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="9"
            className="mt-2 w-32 rounded-xl border border-ink/15 bg-white px-4 py-3 font-display text-lg text-ink shadow-card outline-none transition-colors placeholder:text-ink/25 focus:border-profit" />
          
        </div>

        {error &&
        <p role="alert" className="text-sm font-medium text-one20">
            {error}
          </p>
        }

        <PrimaryButton type="submit">
          Start their journey
          <ArrowRightIcon className="h-4 w-4" aria-hidden />
        </PrimaryButton>
      </form>
    </section>);

}