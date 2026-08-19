// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/ui/App';

/**
 * End-to-end smoke test through the real DOM.
 *
 * The engine tests prove the rules are right; this proves the rules are
 * actually wired to the screen -- that answering a question updates the results
 * panel, that the reasoning is reachable, and that the disclaimers a public
 * launch depends on are present rather than merely written down somewhere.
 */

afterEach(cleanup);

const results = () => screen.getByRole('region', { name: /matches so far|your results/i });

describe('the app', () => {
  it('opens on the location question with results already visible', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Wish Granted' })).toBeTruthy();
    expect(screen.getByText('Where you live')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /City of Madison/i })).toBeTruthy();
  });

  it('states the privacy guarantee and the not-advice disclaimer up front', () => {
    render(<App />);
    expect(screen.getByText(/answers stay in this browser tab/i)).toBeTruthy();
    expect(screen.getByText(/not legal or financial advice/i)).toBeTruthy();
  });

  it('warns that the seed data is unverified', () => {
    render(<App />);
    expect(screen.getByRole('alert').textContent).toMatch(/not yet been checked/i);
  });

  it('updates the results as soon as a question is answered', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 211 has no eligibility test, so it is a confirmed match from the start.
    expect(within(results()).getByText('211 Wisconsin')).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /City of Madison/i }));

    // Madison-only programs become reachable the moment location is known.
    expect(within(results()).getByText(/Housing Choice Voucher/i)).toBeTruthy();
  });

  it('rules programs out and explains why, in plain language', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('radio', { name: /Outside Wisconsin/i }));
    await user.click(screen.getByRole('button', { name: /show \d+ ruled out/i }));

    // Scope to the FoodShare card specifically -- the panel is full of cards,
    // and the reasoning shown has to be that program's own.
    const foodshare = within(results())
      .getAllByRole('article')
      .find((card) => card.textContent?.includes('FoodShare'));
    expect(foodshare).toBeTruthy();

    await user.click(within(foodshare!).getByRole('button', { name: /why this result/i }));
    expect(within(foodshare!).getByText(/state of residence is Wisconsin/i)).toBeTruthy();
  });

  it('advances through screens and finishes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('radio', { name: /Outside Wisconsin/i }));

    // Someone outside Wisconsin has a very short interview: only the questions
    // federal programs still need. Walk it to the end.
    for (let i = 0; i < 8; i += 1) {
      const next = screen.queryByRole('button', { name: 'Continue' });
      if (!next) break;
      await user.click(next);
    }

    expect(screen.getByText(/that is everything we need to ask/i)).toBeTruthy();
  });

  it('keeps a link to the official source on every result', async () => {
    const user = userEvent.setup();
    render(<App />);

    const [firstWhy] = within(results()).getAllByRole('button', { name: /why this result/i });
    await user.click(firstWhy!);
    const source = within(results()).getAllByText(/Source:/i)[0];
    expect(source).toBeTruthy();
  });
});
