// Does the dashboard actually run?
// ---------------------------------------------------------------------------
// `tsc -b && vite build` proves the app COMPILES. It does not prove it renders:
// a React major bump passed CI on that gap. These tests mount the real <App/>
// against a stubbed API and assert the things a broken render would take down
// first — the shell, a card, the friendly states, and the warning banner.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { apiState, makeProject } from './setup';

describe('dashboard smoke', () => {
  test('mounts and renders its shell without throwing', async () => {
    render(<App />);
    // The brand wordmark lives in the top bar and is present from first paint.
    expect(await screen.findByText(/mission control/i)).toBeTruthy();
  });

  test('renders a project card from the API', async () => {
    apiState.projects = [makeProject({ id: 'my-app', name: 'my-app' })];
    render(<App />);
    expect(await screen.findByText('my-app')).toBeTruthy();
    // A stopped card deliberately shows no port — nothing is serving one yet.
    expect(document.body.textContent).not.toContain(':4000');
    // …and it offers the action that matters.
    expect(document.body.textContent).toMatch(/start/i);
  });

  test('a needs-install project offers Install instead of Start', async () => {
    apiState.projects = [
      makeProject({ id: 'fresh', name: 'fresh', needsInstall: true, failureClass: 'needs-install' }),
    ];
    render(<App />);
    await screen.findByText('fresh');
    expect(document.body.textContent).toMatch(/install/i);
  });

  test('a running project shows its port and a way to stop it', async () => {
    apiState.projects = [
      makeProject({ id: 'up', name: 'up', status: 'running', pid: 123, portInUse: true, portOwnedByUs: true }),
    ];
    render(<App />);
    await screen.findByText('up');
    await waitFor(() => expect(document.body.textContent).toMatch(/stop/i));
    // The port IS shown once something is serving it — that is the payoff of
    // the collision-free allocation.
    expect(document.body.textContent).toContain('4000');
  });

  test('discovery warnings reach the screen', async () => {
    apiState.projects = [makeProject()];
    apiState.warnings = ['No projects directly under "/code" — found 3 one level deeper'];
    render(<App />);
    expect(await screen.findByText(/one level deeper/)).toBeTruthy();
  });

  test('no warnings means no banner', async () => {
    apiState.projects = [makeProject()];
    render(<App />);
    await screen.findByText('demo');
    expect(document.querySelector('.warn-banner')).toBeNull();
  });

  test('an empty catalog renders the empty state, not a blank page', async () => {
    render(<App />);
    await waitFor(() => expect(document.body.textContent?.trim().length).toBeGreaterThan(20));
  });
});
