import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { DetailsSection, detailsSummary } from './details-section';
import { initialValues, type AddValues } from './add-values';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'prompts.add.details' });

function Section(): ReactElement {
  const form = useForm<AddValues>({ defaultValues: initialValues({ languageCode: 'en', countryIso: 'DE' }) });
  return <DetailsSection control={form.control} />;
}

describe('the details summary', () => {
  const start = initialValues({ languageCode: 'en', countryIso: 'DE' });

  it('says the type is set from wording while nothing was chosen', () => {
    expect(detailsSummary(start, t)).toBe('Type: set from wording');
  });

  it('adds each detail that was changed, in the order of the fields', () => {
    expect(
      detailsSummary(
        { ...start, prompt_type: 'how_to', intent: 'local', funnel_stage: 'mofu', importance: '5', branded: 'always' },
        t,
      ),
    ).toBe('Type: How to, Intent: Local, Stage: Middle (mofu), Importance: 5, lowest, Branded: always');
  });
});

describe('the details section', () => {
  it('opens and closes from the keyboard, keeps the fields in the form while closed, and is axe clean', async () => {
    const { user, container } = renderWithProviders(<Section />);
    const toggle = screen.getByRole('button', { name: /^Details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull();
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Set from wording');
    expect(screen.getByRole('combobox', { name: 'Importance' })).toHaveTextContent('3, default');
    expect(screen.getByRole('radio', { name: 'Set from brand names (recommended)' })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
