import React from 'react';
import { render, screen } from '@testing-library/react';
import ConnectionStatus from './ConnectionStatus';

jest.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

describe('ConnectionStatus', () => {
  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionStatus isConnected={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders disconnected banner when not connected', () => {
    render(<ConnectionStatus isConnected={false} />);
    expect(screen.getByText('connection.disconnected')).toBeInTheDocument();
  });
});
