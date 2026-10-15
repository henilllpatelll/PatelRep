import { api } from '@/lib/api/client';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;

describe('API client — caller cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
  });

  it('aborts the underlying request when the caller aborts, and rejects with an AbortError', async () => {
    let seen: AbortSignal | undefined;
    global.fetch = jest.fn((_url: string, init?: { signal?: AbortSignal }) => {
      seen = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const pending = api.post('/ai/copilot/chat', { message: 'hi' }, { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });

  it('does not send anything if it was already cancelled', async () => {
    global.fetch = jest.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(api.post('/x', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is unchanged for a caller that passes no signal', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ ok: true }) });
    await expect(api.post('/x', { a: 1 })).resolves.toEqual({ ok: true });
    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST');
  });
});
