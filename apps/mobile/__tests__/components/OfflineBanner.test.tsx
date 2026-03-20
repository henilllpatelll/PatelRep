import React from 'react';
import { render } from '@testing-library/react-native';

// Mock appStore
const mockUseAppStore = jest.fn();
jest.mock('@/stores/appStore', () => ({
  useAppStore: (selector: (s: unknown) => unknown) => mockUseAppStore(selector),
}));

// Import after mock setup
// eslint-disable-next-line import/first
import { OfflineBanner } from '@/components/shared/OfflineBanner';

describe('OfflineBanner', () => {
  it('renders offline banner when isOnline is false', () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: false })
    );
    const { getByText } = render(<OfflineBanner />);
    expect(getByText(/no internet connection/i)).toBeTruthy();
  });

  it('renders nothing when isOnline is true', () => {
    mockUseAppStore.mockImplementation((selector: (s: { isOnline: boolean }) => unknown) =>
      selector({ isOnline: true })
    );
    const { toJSON } = render(<OfflineBanner />);
    expect(toJSON()).toBeNull();
  });
});
