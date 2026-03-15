import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@actual-app/api', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  downloadBudget: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./config', () => ({
  resolveConfig: vi.fn(),
}));

const api = await import('@actual-app/api');
const { resolveConfig } = await import('./config');
const { withConnection } = await import('./connection');

function setConfig(overrides: Record<string, unknown> = {}) {
  vi.mocked(resolveConfig).mockResolvedValue({
    serverUrl: 'http://test',
    password: 'pw',
    dataDir: '/tmp/data',
    budgetId: 'budget-1',
    ...overrides,
  });
}

describe('withConnection', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    setConfig();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('calls api.init with password when no sessionToken', async () => {
    setConfig({ password: 'pw', sessionToken: undefined });

    await withConnection({}, async () => 'ok');

    expect(api.init).toHaveBeenCalledWith({
      serverURL: 'http://test',
      password: 'pw',
      dataDir: '/tmp/data',
      verbose: undefined,
    });
  });

  it('calls api.init with sessionToken when present', async () => {
    setConfig({ sessionToken: 'tok', password: undefined });

    await withConnection({}, async () => 'ok');

    expect(api.init).toHaveBeenCalledWith({
      serverURL: 'http://test',
      sessionToken: 'tok',
      dataDir: '/tmp/data',
      verbose: undefined,
    });
  });

  it('calls api.downloadBudget when budgetId is set', async () => {
    setConfig({ budgetId: 'budget-1' });

    await withConnection({}, async () => 'ok');

    expect(api.downloadBudget).toHaveBeenCalledWith('budget-1', {
      password: undefined,
    });
  });

  it('throws when loadBudget is true but budgetId is not set', async () => {
    setConfig({ budgetId: undefined });

    await expect(withConnection({}, async () => 'ok')).rejects.toThrow(
      'Budget ID is required',
    );
  });

  it('skips budget download when loadBudget is false and budgetId is not set', async () => {
    setConfig({ budgetId: undefined });

    await withConnection({}, async () => 'ok', { loadBudget: false });

    expect(api.downloadBudget).not.toHaveBeenCalled();
  });

  it('does not call api.downloadBudget when loadBudget is false', async () => {
    setConfig({ budgetId: 'budget-1' });

    await withConnection({}, async () => 'ok', { loadBudget: false });

    expect(api.downloadBudget).not.toHaveBeenCalled();
  });

  it('returns callback result', async () => {
    const result = await withConnection({}, async () => 42);
    expect(result).toBe(42);
  });

  it('calls api.shutdown in finally block on success', async () => {
    await withConnection({}, async () => 'ok');
    expect(api.shutdown).toHaveBeenCalled();
  });

  it('calls api.shutdown in finally block on error', async () => {
    await expect(
      withConnection({}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(api.shutdown).toHaveBeenCalled();
  });

  it('does not write to stderr by default', async () => {
    await withConnection({}, async () => 'ok');

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes info to stderr when verbose', async () => {
    await withConnection({ verbose: true }, async () => 'ok');

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Connecting to'),
    );
  });
});
