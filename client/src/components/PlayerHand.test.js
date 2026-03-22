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

  it('sorts cards ascending when sortHandEnabled is true', () => {
    const onCardSelect = jest.fn();
    const { container } = renderPlayerHand({
      hand: [3, 1, 2],
      onCardSelect,
      sortHandEnabled: true,
    });

    const firstCard = container.querySelectorAll('.hand-card')[0];
    fireEvent.click(firstCard);

    expect(onCardSelect).toHaveBeenCalledWith(1, 'hand-0');
  });

  it('places SKIP-BO wildcards last when sorted', () => {
    const onCardSelect = jest.fn();
    const { container } = renderPlayerHand({
      hand: [5, 'SKIP-BO', 2, 'SKIP-BO'],
      onCardSelect,
      sortHandEnabled: true,
    });

    const cards = container.querySelectorAll('.hand-card');
    fireEvent.click(cards[2]);
    expect(onCardSelect).toHaveBeenCalledWith('SKIP-BO', 'hand-2');
    fireEvent.click(cards[3]);
    expect(onCardSelect).toHaveBeenCalledWith('SKIP-BO', 'hand-3');
  });

  it('preserves original order when sortHandEnabled is false', () => {
    const onCardSelect = jest.fn();
    const { container } = renderPlayerHand({
      hand: [3, 1, 2],
      onCardSelect,
      sortHandEnabled: false,
    });

    const firstCard = container.querySelectorAll('.hand-card')[0];
    fireEvent.click(firstCard);

    expect(onCardSelect).toHaveBeenCalledWith(3, 'hand-0');
  });

  it('selected class matches sorted display position', () => {
    const { container } = renderPlayerHand({
      hand: [3, 1, 2],
      selectedCard: 1,
      selectedSource: 'hand-0',
      sortHandEnabled: true,
    });

    const cards = container.querySelectorAll('.hand-card');
    expect(cards[0]).toHaveClass('selected');
    expect(cards[1]).not.toHaveClass('selected');
    expect(cards[2]).not.toHaveClass('selected');
  });
});
