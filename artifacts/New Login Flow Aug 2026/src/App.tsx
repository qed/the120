import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { OnboardingProvider } from './contexts/OnboardingContext';
import { Onboarding } from './pages/Onboarding';
import { Login } from './pages/Login';

export function App() {
  return (
    <OnboardingProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Onboarding />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </OnboardingProvider>);

}