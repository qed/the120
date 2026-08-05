import React, { useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PrimaryButton } from '../components/PrimaryButton';
import { useOnboarding } from '../contexts/OnboardingContext';
import { firstName } from '../utils/story';

export function Login() {
  const { kid, credentials } = useOnboarding();
  const name = firstName(kid.fullName);
  const [email, setEmail] = useState(kid.fullName ? credentials.email : '');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    window.setTimeout(() => {
      const ok = email.trim() === credentials.email && password === credentials.password;
      setStatus(ok ? 'done' : 'error');
    }, 700);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-ink px-5 py-14">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <span aria-hidden className="flex items-end gap-[3px]">
            <span className="block h-3 w-1.5 rounded-sm bg-profit" />
            <span className="block h-4 w-1.5 rounded-sm bg-sun" />
            <span className="block h-5 w-1.5 rounded-sm bg-one20" />
          </span>
          <span className="label-mono font-bold text-white">First Profit</span>
        </div>

        <div className="rounded-2xl bg-cream p-8">
          <h1 className="font-display text-3xl font-black leading-tight text-ink">
            {name ? `Log in to keep building ${name}’s journey` : 'Log in'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stone">
            Use the login we just created for you.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="email" className="label-mono block text-stone">
                Username
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition-colors focus:border-profit" />
              
            </div>
            <div>
              <label htmlFor="password" className="label-mono block text-stone">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-mono text-sm text-ink outline-none transition-colors placeholder:text-ink/25 focus:border-profit" />
              
            </div>

            {status === 'error' &&
            <p role="alert" className="text-sm font-medium text-one20">
                That username and password don’t match. Check the login on the last screen.
              </p>
            }
            {status === 'done' &&
            <p role="status" className="text-sm font-medium text-profit">
                Welcome back — loading {name || 'your'} journey…
              </p>
            }

            <PrimaryButton type="submit" className="w-full" disabled={status === 'loading'}>
              {status === 'loading' ?
              <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> :

              <>
                  Log in
                  <ArrowRightIcon className="h-4 w-4" aria-hidden />
                </>
              }
            </PrimaryButton>
          </form>
        </div>

        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 label-mono text-white/60 transition-colors hover:text-white">
          
          <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden />
          Back to onboarding
        </Link>
      </div>
    </div>);

}