import React, { useState } from 'react';
import { ArrowRightIcon, CheckIcon, CopyIcon, KeyRoundIcon } from 'lucide-react';
import { PrimaryButton } from '../PrimaryButton';
import { ComicCover } from '../ComicCover';
import { firstName } from '../../utils/story';
import type { Credentials } from '../../types/onboarding';

interface StepAccountReadyProps {
  fullName: string;
  age: string;
  photoUrl: string | null;
  coverImageUrl: string | null;
  credentials: Credentials;
  onContinue: () => void;
}

export function StepAccountReady({
  fullName,
  age,
  photoUrl,
  coverImageUrl,
  credentials,
  onContinue
}: StepAccountReadyProps) {
  const name = firstName(fullName);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(`${credentials.email} / ${credentials.password}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="label-mono text-profit">Intro page + Page 1 · Done</p>
          <h1 className="mt-3 font-display text-3xl font-black leading-[1.1] text-ink sm:text-[40px]">
            {name}’s journey has its first two pages.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-stone">
            Behind the scenes we also created an account, so {name} can keep building. You can
            change the title of the journey later on.
          </p>

          <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
            <div className="flex items-center gap-2">
              <KeyRoundIcon className="h-4 w-4 text-profit" aria-hidden />
              <h2 className="label-mono text-stone">Your new login</h2>
            </div>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="label-mono text-stone">Username</dt>
                <dd className="font-mono text-[15px] text-ink">{credentials.email}</dd>
              </div>
              <div>
                <dt className="label-mono text-stone">Password</dt>
                <dd className="font-mono text-[15px] text-ink">{credentials.password}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={copy}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 label-mono text-stone transition-colors hover:text-ink">
              
              {copied ?
              <CheckIcon className="h-3.5 w-3.5 text-profit" aria-hidden /> :

              <CopyIcon className="h-3.5 w-3.5" aria-hidden />
              }
              {copied ? 'Copied' : 'Copy login'}
            </button>
          </div>

          <div className="mt-8">
            <PrimaryButton onClick={onContinue}>
              Keep building {name}’s journey
              <ArrowRightIcon className="h-4 w-4" aria-hidden />
            </PrimaryButton>
            <p className="mt-3 label-mono text-stone">Takes you to the First Profit app</p>
          </div>
        </div>

        <div className="lg:pl-4">
          <ComicCover
            age={age}
            photoUrl={coverImageUrl ? photoUrl : null}
            imageUrl={coverImageUrl}
            title={coverImageUrl ? `Meet ${name}` : undefined}
            caption={`${name}'s First Profit Journey — page 1 of many.`} />
          
        </div>
      </div>
    </section>);

}