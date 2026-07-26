'use client';

import { useRouter, usePathname } from 'next/navigation';
import { WIZARD_STEPS } from '@/lib/types';
import type { WizardStep } from '@/lib/types';

interface WizardNavProps {
  projectId: string;
  currentStep?: WizardStep;
}

const STEP_ORDER: WizardStep[] = ['search', 'screen', 'extract', 'report'];

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 6L5 9L10 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function WizardNav({ projectId, currentStep }: WizardNavProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Derive active step from URL path if not passed explicitly
  function getActiveStep(): WizardStep {
    if (currentStep) return currentStep;
    for (const step of STEP_ORDER) {
      if (pathname.includes(`/projects/${projectId}/${step}`)) return step;
    }
    return 'search';
  }

  const activeStep = getActiveStep();
  const activeIndex = STEP_ORDER.indexOf(activeStep);

  return (
    <nav
      className="flex items-center gap-0 px-6 py-4 border-b"
      style={{ backgroundColor: 'white', borderColor: '#e5e7eb' }}
      aria-label="Wizard steps"
    >
      {WIZARD_STEPS.map((step, index) => {
        const isActive = step.key === activeStep;
        const isCompleted = index < activeIndex;
        const isClickable = index <= activeIndex + 1;

        return (
          <div key={step.key} className="flex items-center">
            {/* Step item */}
            <button
              onClick={() => {
                if (isClickable) {
                  router.push(`/projects/${projectId}/${step.key}`);
                }
              }}
              disabled={!isClickable}
              className="flex items-center gap-2 px-2 py-1 rounded transition-colors cursor-pointer disabled:cursor-default"
              style={{
                opacity: isClickable ? 1 : 0.45,
              }}
              title={step.description}
              aria-current={isActive ? 'step' : undefined}
            >
              {/* Step circle */}
              <div
                className="flex items-center justify-center rounded-full text-xs font-bold shrink-0 transition-colors"
                style={{
                  width: '28px',
                  height: '28px',
                  backgroundColor: isActive
                    ? 'var(--color-secondary)'
                    : isCompleted
                    ? 'var(--color-primary)'
                    : '#e5e7eb',
                  color: isActive || isCompleted ? 'white' : '#6b7280',
                }}
              >
                {isCompleted ? <CheckIcon /> : index + 1}
              </div>

              {/* Step label */}
              <span
                className="text-sm whitespace-nowrap"
                style={{
                  fontWeight: isActive ? 700 : 400,
                  color: isActive
                    ? 'var(--color-secondary)'
                    : isCompleted
                    ? 'var(--color-primary)'
                    : '#6b7280',
                }}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {index < WIZARD_STEPS.length - 1 && (
              <div
                className="shrink-0 mx-1"
                style={{
                  width: '32px',
                  height: '2px',
                  backgroundColor: index < activeIndex ? 'var(--color-primary)' : '#e5e7eb',
                }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
