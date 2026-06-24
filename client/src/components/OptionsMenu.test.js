// Treat the build as a debug build so the debug-console toggle renders.
jest.mock('../debugLog', () => ({
  __esModule: true,
  default: jest.fn(),
  DEBUG_ENABLED: true,
}));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OptionsMenu from './OptionsMenu';
import { LanguageProvider } from '../i18n';

const renderMenu = (props = {}) => {
  const defaultProps = {
    roomId: 'ROOM01',
    quickDiscardEnabled: false,
    onToggleQuickDiscard: jest.fn(),
    debugConsoleEnabled: false,
    onToggleDebugConsole: jest.fn(),
    onLeaveGame: jest.fn(),
  };
  const result = render(
    <LanguageProvider>
      <OptionsMenu {...defaultProps} {...props} />
    </LanguageProvider>
  );
  // Open the dropdown so the menu items render.
  fireEvent.click(result.container.querySelector('.btn-options'));
  return result;
};

const debugCheckbox = () =>
  screen.getByText('Debug Console').closest('label').querySelector('input[type="checkbox"]');

describe('OptionsMenu debug console toggle (debug build)', () => {
  it('renders the debug console checkbox', () => {
    renderMenu();
    expect(screen.getByText('Debug Console')).toBeInTheDocument();
  });

  it('reflects the debugConsoleEnabled prop', () => {
    renderMenu({ debugConsoleEnabled: true });
    expect(debugCheckbox()).toBeChecked();
  });

  it('calls onToggleDebugConsole when clicked', () => {
    const onToggleDebugConsole = jest.fn();
    renderMenu({ onToggleDebugConsole });
    fireEvent.click(debugCheckbox());
    expect(onToggleDebugConsole).toHaveBeenCalledTimes(1);
  });
});
