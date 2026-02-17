import React from 'react';
import { render, screen } from '@testing-library/react';
import Card from './Card';
import { LanguageProvider } from '../i18n';

const renderCard = (props = {}) => {
  const defaultProps = { value: 5, isVisible: true };
  return render(
    <LanguageProvider>
      <Card {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('Card', () => {
  it('displays numeric value', () => {
    renderCard({ value: 7 });
    // Card shows value in center and corners
    expect(screen.getByText('7', { selector: '.card-value-center' })).toBeInTheDocument();
  });

  it('displays "SB" for SKIP-BO cards', () => {
    renderCard({ value: 'SKIP-BO' });
    expect(screen.getByText('SB', { selector: '.card-value-center' })).toBeInTheDocument();
  });

  it('shows WILD label on SKIP-BO cards', () => {
    renderCard({ value: 'SKIP-BO' });
    expect(screen.getByText('WILD')).toBeInTheDocument();
  });

  it('does not show WILD label on numbered cards', () => {
    renderCard({ value: 3 });
    expect(screen.queryByText('WILD')).not.toBeInTheDocument();
  });

  it('applies correct color classes', () => {
    const { container: blue } = renderCard({ value: 2 });
    expect(blue.querySelector('.blue-card')).toBeInTheDocument();

    const { container: green } = renderCard({ value: 6 });
    expect(green.querySelector('.green-card')).toBeInTheDocument();

    const { container: red } = renderCard({ value: 10 });
    expect(red.querySelector('.red-card')).toBeInTheDocument();

    const { container: wild } = renderCard({ value: 'SKIP-BO' });
    expect(wild.querySelector('.wild-card')).toBeInTheDocument();
  });

  it('shows card back when not visible', () => {
    const { container } = renderCard({ isVisible: false });
    expect(container.querySelector('.card-back')).toBeInTheDocument();
    expect(container.querySelector('.card-content')).not.toBeInTheDocument();
  });

  it('applies size class', () => {
    const { container } = renderCard({ size: 'small' });
    expect(container.querySelector('.small')).toBeInTheDocument();
  });
});
