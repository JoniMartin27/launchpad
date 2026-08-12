// The batch buttons must hit the right endpoint with the right projects.
// ---------------------------------------------------------------------------
// Until now the frontend suite only proved the app RENDERS. These press the
// buttons and assert what leaves the browser — a wrong id list here would stop
// somebody's database or start a project they had deliberately left down.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { apiState, makeProject, fetchCalls, bodyOf } from './setup';

/** Wait for a card to be on screen, so the batch buttons have settled. */
async function ready(name: string) {
  await screen.findByText(name);
}

describe('batch start/stop', () => {
  test('Start N sends only the projects that can actually start', async () => {
    apiState.projects = [
      makeProject({ id: 'ready', name: 'ready' }),
      makeProject({ id: 'up', name: 'up', status: 'running' }),
      makeProject({ id: 'fresh', name: 'fresh', needsInstall: true }),
      makeProject({ id: 'static-only', name: 'static-only', runnable: false }),
    ];
    render(<App />);
    await ready('ready');

    // The count in the label is the promise the button makes.
    const btn = await screen.findByRole('button', { name: /Start 1/ });
    btn.click();

    await waitFor(() => expect(fetchCalls('/api/batch/start').length).toBe(1));
    expect(bodyOf(fetchCalls('/api/batch/start')[0])).toEqual({ ids: ['ready'] });
  });

  test('Stop all sends everything running or starting, and nothing else', async () => {
    apiState.projects = [
      makeProject({ id: 'up', name: 'up', status: 'running' }),
      makeProject({ id: 'booting', name: 'booting', status: 'starting' }),
      makeProject({ id: 'down', name: 'down', status: 'stopped' }),
    ];
    render(<App />);
    await ready('up');

    (await screen.findByRole('button', { name: /Stop all/ })).click();

    await waitFor(() => expect(fetchCalls('/api/batch/stop').length).toBe(1));
    const sent = bodyOf(fetchCalls('/api/batch/stop')[0]) as { ids: string[] };
    expect(sent.ids.sort()).toEqual(['booting', 'up']);
  });

  test('with nothing running there is no Stop all button to press by accident', async () => {
    apiState.projects = [makeProject({ id: 'down', name: 'down' })];
    render(<App />);
    await ready('down');
    expect(screen.queryByRole('button', { name: /Stop all/ })).toBeNull();
  });

  test('Start N only counts what is visible after filtering', async () => {
    apiState.projects = [
      makeProject({ id: 'alpha', name: 'alpha' }),
      makeProject({ id: 'beta', name: 'beta' }),
    ];
    render(<App />);
    await ready('alpha');
    expect(await screen.findByRole('button', { name: /Start 2/ })).toBeTruthy();

    // Narrow the grid; the button must promise only what is on screen.
    const search = document.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(search, 'alpha');
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const narrowed = await screen.findByRole('button', { name: /Start 1/ });
    narrowed.click();
    await waitFor(() => expect(fetchCalls('/api/batch/start').length).toBe(1));
    expect(bodyOf(fetchCalls('/api/batch/start')[0])).toEqual({ ids: ['alpha'] });
  });

  test('a partial batch is reported as such, not as success', async () => {
    apiState.projects = [makeProject({ id: 'a', name: 'a' }), makeProject({ id: 'b', name: 'b' })];
    apiState.batchResponse = {
      ok: false,
      action: 'start',
      requested: 2,
      succeeded: 1,
      failed: 1,
      results: [
        { id: 'a', outcome: 'started' },
        { id: 'b', outcome: 'failed', reason: 'Port 4001 is already in use by a foreign process.' },
      ],
    };
    render(<App />);
    await ready('a');
    (await screen.findByRole('button', { name: /Start 2/ })).click();

    // The toast must carry the failure, not a blanket "done".
    await waitFor(() => expect(document.body.textContent).toMatch(/1 failed/));
    expect(document.body.textContent).toMatch(/already in use/);
  });
});
