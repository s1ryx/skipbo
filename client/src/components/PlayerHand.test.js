import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PlayerHand from './PlayerHand';
import { LanguageProvider } from '../i18n';

const renderPlayerHand = (props = {}) => {
  const defaultProps = {
    hand: [1, 3, 5, 7, 9],
    selectedCard: null,
    selectedSource: null,
    onCardSelect: jest.fn(),
    disabled: false,
  };
  return render(
    <LanguageProvider>
      <PlayerHand {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('PlayerHand', () => {
  it('renders all cards in hand', () => {
    const { container } = renderPlayerHand();
    const cards = container.querySelectorAll('.hand-card');
    expect(cards).toHaveLength(5);
  });

  it('shows empty message when hand is empty', () => {
    renderPlayerHand({ hand: [] });
    expect(screen.getByText('No cards in hand')).toBeInTheDocument();
  });

  it('calls onCardSelect with card and source on click', () => {
    const onCardSelect = jest.fn();
    const { container } = renderPlayerHand({ onCardSelect });

    const firstCard = container.querySelectorAll('.hand-card')[0];
    fireEvent.click(firstCard);

    expect(onCardSelect).toHaveBeenCalledWith(1, 'hand-0');
  });

  it('marks selected card with selected class', () => {
    const { container } = renderPlayerHand({
      selectedCard: 5,
      selectedSource: 'hand-2',
    });

    const cards = container.querySelectorAll('.hand-card');
    expect(cards[2]).toHaveClass('selected');
    expect(cards[0]).not.toHaveClass('selected');
  });

  it('does not call onCardSelect when disabled', () => {
    const onCardSelect = jest.fn();
    const { container } = renderPlayerHand({ onCardSelect, disabled: true });

    const firstCard = container.querySelectorAll('.hand-card')[0];
    fireEvent.click(firstCard);

    expect(onCardSelect).not.toHaveBeenCalled();
  });
});
