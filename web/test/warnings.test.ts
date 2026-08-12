// What a warning looks like by the time a person reads it.
// ---------------------------------------------------------------------------
// The dashboard used to put the machine code straight in the toast title —
// so the first thing you read was `AUTO_RESTART_GAVE_UP` — and painted every
// warning red, including the one that means "I am fixing it".
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'vitest';
import { warningTitle, warningToastKind, prettifyCode } from '../src/utils/warnings';

describe('warning presentation', () => {
  test('known codes get written copy, never the constant', () => {
    for (const code of ['PORT_IN_USE', 'PORT_NOT_BOUND', 'AUTO_RESTARTING', 'AUTO_RESTART_GAVE_UP']) {
      const title = warningTitle(code, 'demo');
      expect(title).not.toContain(code);
      expect(title).not.toMatch(/_/);
      expect(title.startsWith('demo: ')).toBe(true);
    }
  });

  test('an unknown code is read as words, not shouted', () => {
    expect(prettifyCode('SOMETHING_NEW_HAPPENED')).toBe('Something new happened');
    expect(warningTitle('SOMETHING_NEW_HAPPENED')).toBe('Something new happened');
    // Degenerate input still produces something a person can read.
    expect(prettifyCode('')).toBe('Something happened');
  });

  test('the project name is only prefixed when we know it', () => {
    expect(warningTitle('PORT_IN_USE', 'api')).toMatch(/^api: /);
    expect(warningTitle('PORT_IN_USE')).not.toMatch(/^: /);
  });

  test('severity comes from the server, and recovery is not painted as failure', () => {
    expect(warningToastKind('info')).toBe('info');
    expect(warningToastKind('warn')).toBe('warn');
    expect(warningToastKind('error')).toBe('error');
  });

  test('a server that sends no level keeps the old, loud behaviour', () => {
    // Downgrading an unknown severity to a friendly note would silence real
    // problems coming from an older server.
    expect(warningToastKind(undefined)).toBe('error');
    expect(warningToastKind('nonsense')).toBe('error');
  });
});
