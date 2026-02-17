import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { LanguageProvider } from './i18n';

// socket.io-client is auto-mocked via src/__mocks__/socket.io-client.js

describe('App', () => {
  it('renders without crashing', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
  });

  it('renders the app title', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
    expect(screen.getByText('Skip-Bo Card Game')).toBeInTheDocument();
  });

  it('shows the lobby by default', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
    expect(screen.getByText('Create a New Game')).toBeInTheDocument();
  });

  it('renders the language selector', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('renders the version in the footer', () => {
    render(
      <LanguageProvider>
        <App />
      </LanguageProvider>
    );
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
  });
});
