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

describe('open in editor / folder / terminal', () => {
  test('each button hands the project id and the right target to the API', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo' })];
    render(<App />);
    // Open the drawer for the card.
    (await screen.findByText('demo')).click();

    for (const [title, target] of [
      ['Open in your editor', 'editor'],
      ['Open the folder', 'folder'],
      ['Open a terminal here', 'terminal'],
    ] as const) {
      const btn = await screen.findByTitle(title);
      btn.click();
      await waitFor(() => expect(fetchCalls('/api/open').length).toBeGreaterThan(0));
      const last = fetchCalls('/api/open').at(-1)!;
      expect(bodyOf(last)).toEqual({ id: 'demo', target });
    }
    expect(fetchCalls('/api/open').length).toBe(3);
  });

  test('a missing editor is reported, not swallowed', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo' })];
    apiState.openFails = { code: 'TOOL_MISSING', message: 'Could not run `code` — is it installed and on your PATH?' };
    render(<App />);
    (await screen.findByText('demo')).click();
    (await screen.findByTitle('Open in your editor')).click();
    await waitFor(() => expect(document.body.textContent).toMatch(/is it installed/));
  });
});

describe('crash recovery from the UI', () => {
  test('the card marks a project that will restart itself', async () => {
    apiState.projects = [
      makeProject({ id: 'armed', name: 'armed', autoRestart: true }),
      makeProject({ id: 'plain', name: 'plain' }),
    ];
    render(<App />);
    await screen.findByText('armed');
    // Exactly one mark: what is armed must be visible, and what is not must not
    // pretend to be.
    const marks = document.querySelectorAll('.auto-restart-mark');
    expect(marks.length).toBe(1);
    expect(marks[0].closest('.card')?.textContent).toContain('armed');
  });

  test('the drawer toggle patches the project config', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo', autoRestart: false })];
    render(<App />);
    (await screen.findByText('demo')).click();

    const box = (await screen.findByText(/Bring it back automatically/))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.click();

    await waitFor(() => expect(fetchCalls('/config').length).toBe(1));
    expect(bodyOf(fetchCalls('/config')[0])).toEqual({ autoRestart: true });
    expect(fetchCalls('/config')[0].url).toContain('/api/projects/demo/config');
  });

  test('turning it off sends false, not nothing', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo', autoRestart: true })];
    render(<App />);
    (await screen.findByText('demo')).click();
    const box = (await screen.findByText(/Bring it back automatically/))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.click();
    await waitFor(() => expect(fetchCalls('/config').length).toBe(1));
    expect(bodyOf(fetchCalls('/config')[0])).toEqual({ autoRestart: false });
  });

  test('a project that cannot be launched is not offered crash recovery', async () => {
    apiState.projects = [makeProject({ id: 'static', name: 'static', runnable: false })];
    render(<App />);
    (await screen.findByText('static')).click();
    await waitFor(() => expect(document.querySelector('.drawer')).toBeTruthy());
    expect(screen.queryByText(/Bring it back automatically/)).toBeNull();
  });
});

describe('reaching a project, and warnings that stay put', () => {
  test('the grid itself can open a project in the editor', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo' })];
    render(<App />);
    await screen.findByText('demo');

    // On the card, not in the drawer: no click-through required.
    const card = document.querySelector('.card') as HTMLElement;
    const btn = card.querySelector('.act-btn.open-editor') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();

    await waitFor(() => expect(fetchCalls('/api/open').length).toBe(1));
    expect(bodyOf(fetchCalls('/api/open')[0])).toEqual({ id: 'demo', target: 'editor' });
    // And the drawer did not open just because we clicked inside the card.
    expect(document.querySelector('.drawer')).toBeNull();
  });

  test('a subproject can be opened on its own, not just its parent', async () => {
    apiState.projects = [
      makeProject({
        id: 'mono',
        name: 'mono',
        subprojects: [
          {
            id: 'mono-backend',
            name: 'backend',
            path: '/code/mono/backend',
            type: 'express-node',
            command: 'npm run dev',
            assignedPort: 4001,
            defaultPort: 3000,
            portStrategy: 'env PORT',
            status: 'stopped',
            pid: null,
            portInUse: false,
          },
        ],
      }),
    ];
    render(<App />);
    (await screen.findByText('mono')).click();

    const btn = await screen.findByTitle('Open backend in your editor');
    btn.click();
    await waitFor(() => expect(fetchCalls('/api/open').length).toBe(1));
    // The SUBPROJECT id, not the parent's: opening the wrong folder is the
    // whole failure mode here.
    expect(bodyOf(fetchCalls('/api/open')[0])).toEqual({ id: 'mono-backend', target: 'editor' });
  });

  test('an error toast waits to be dismissed; news does not', async () => {
    apiState.projects = [makeProject({ id: 'demo', name: 'demo' })];
    apiState.openFails = { code: 'TOOL_MISSING', message: 'Could not run `code`.' };
    render(<App />);
    await screen.findByText('demo');
    (document.querySelector('.card .act-btn.open-editor') as HTMLButtonElement).click();

    await waitFor(() => expect(document.querySelectorAll('.toast').length).toBe(1));
    // Six seconds is exactly how you miss something you had to act on.
    await new Promise((r) => setTimeout(r, 6500));
    expect(document.querySelectorAll('.toast').length).toBe(1);
    expect(document.querySelector('.toast')?.getAttribute('data-kind')).toBe('error');
  }, 15000);

  test('…but news still gets out of the way on its own', async () => {
    // The other half of the rule. Without this, making EVERY toast permanent
    // would pass just as happily, and the surface would fill with notices
    // nobody has any reason to dismiss.
    apiState.projects = [makeProject({ id: 'demo', name: 'demo', autoRestart: false })];
    render(<App />);
    (await screen.findByText('demo')).click();
    const box = (await screen.findByText(/Bring it back automatically/))
      .closest('label')!
      .querySelector('input') as HTMLInputElement;
    box.click();

    await waitFor(() => expect(document.querySelectorAll('.toast[data-kind="info"]').length).toBe(1));
    await new Promise((r) => setTimeout(r, 6500));
    expect(document.querySelectorAll('.toast[data-kind="info"]').length).toBe(0);
  }, 15000);
});
