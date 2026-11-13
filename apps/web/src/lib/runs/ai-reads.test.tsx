import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { useEngineNames } from './ai-reads';
import { mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { RUNS_SCOPE } from '@/test/ai-runs-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const ENGINES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines');

function Names(): ReactElement {
  const name = useEngineNames(RUNS_SCOPE);
  return <p>{`${name('chatgpt_web')} | ${name('not_an_engine')}`}</p>;
}

describe('useEngineNames', () => {
  it('names an engine from the engines read, and shows the code before it and for an engine it does not list', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    server.use(
      http.get(ENGINES, () =>
        HttpResponse.json({
          data: [
            {
              active_prompts: 3,
              engine: {
                engine_code: 'chatgpt_web',
                exposes_citations: true,
                exposes_fanout: false,
                label: 'ChatGPT',
                max_prompt_chars: 2000,
                observation_class: 'consumer_ui',
                vendor: 'OpenAI',
              },
              estimated_monthly_cost_usd: null,
              is_configured: true,
              is_enabled: true,
              location_ids: [],
              provider_code: 'dataforseo',
              replicates: 1,
            },
          ],
        }),
      ),
    );
    renderWithProviders(<Names />);
    // Never blank while the read is under way: the code stands in
    expect(screen.getByText('chatgpt_web | not_an_engine')).toBeVisible();
    expect(await screen.findByText('ChatGPT | not_an_engine')).toBeVisible();
  });
});
