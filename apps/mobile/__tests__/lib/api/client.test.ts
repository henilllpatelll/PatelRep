import { api } from '@/lib/api/client';
import { supabase } from '@/lib/supabase';

// Mock supabase module
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
    },
  },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockRefreshSession = supabase.auth.refreshSession as jest.Mock;

describe('API client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    // Default: getSession returns token-1
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });

    // Default: refreshSession succeeds with token-2 and updates getSession
    mockRefreshSession.mockImplementation(async () => {
      // After refresh, getSession should return token-2
      mockGetSession.mockResolvedValue({
        data: { session: { access_token: 'token-2' } },
      });
      return { data: { session: { access_token: 'token-2' } }, error: null };
    });
  });

  it('retries once with refreshed token on 401', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ ok: true }) });

    await api.get('/test');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(secondCall[1].headers['Authorization']).toBe('Bearer token-2');
  });

  it('does not retry a second time (isRetry guard)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({}),
    });

    await expect(api.get('/test')).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-401 errors without retry', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({ detail: 'Server error' }),
    });

    await expect(api.get('/test')).rejects.toThrow('Server error');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
