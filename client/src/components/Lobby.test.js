import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Lobby from './Lobby';
import { LanguageProvider } from '../i18n';

const renderLobby = (props = {}) => {
  const defaultProps = {
    onCreateRoom: jest.fn(),
    onJoinRoom: jest.fn(),
    initialRoomId: null,
  };
  return render(
    <LanguageProvider>
      <Lobby {...defaultProps} {...props} />
    </LanguageProvider>
  );
};

describe('Lobby', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('create game form', () => {
    it('renders the create game form by default', () => {
      renderLobby();
      expect(screen.getByText('Create a New Game')).toBeInTheDocument();
    });

    it('renders player name input', () => {
      renderLobby();
      expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument();
    });

    it('renders max players selector', () => {
      renderLobby();
      expect(screen.getByText('Max Players:')).toBeInTheDocument();
    });

    it('renders create room button', () => {
      renderLobby();
      expect(screen.getByText('Create Room')).toBeInTheDocument();
    });

    it('calls onCreateRoom with name, maxPlayers, stockpileSize on submit', () => {
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Alice' },
      });
      fireEvent.click(screen.getByText('Create Room'));

      expect(onCreateRoom).toHaveBeenCalledWith('Alice', 2, 30);
    });

    it('does not call onCreateRoom with empty name', () => {
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });

      fireEvent.click(screen.getByText('Create Room'));

      expect(onCreateRoom).not.toHaveBeenCalled();
    });
  });

  describe('join game form', () => {
    it('switches to join form when clicking join button', () => {
      renderLobby();
      fireEvent.click(screen.getByText('Join Existing Room'));
      expect(screen.getByText('Join a Game')).toBeInTheDocument();
    });

    it('renders room ID input in join form', () => {
      renderLobby();
      fireEvent.click(screen.getByText('Join Existing Room'));
      expect(screen.getByPlaceholderText('Enter room ID')).toBeInTheDocument();
    });

    it('calls onJoinRoom with uppercase room ID and name', () => {
      const onJoinRoom = jest.fn();
      renderLobby({ onJoinRoom });

      fireEvent.click(screen.getByText('Join Existing Room'));

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Bob' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter room ID'), {
        target: { value: 'abc123' },
      });
      fireEvent.click(screen.getByText('Join Room'));

      expect(onJoinRoom).toHaveBeenCalledWith('ABC123', 'Bob');
    });

    it('switches back to create form', () => {
      renderLobby();
      fireEvent.click(screen.getByText('Join Existing Room'));
      fireEvent.click(screen.getByText('Back to Create Room'));
      expect(screen.getByText('Create a New Game')).toBeInTheDocument();
    });
  });

  describe('game settings', () => {
    it('passes custom maxPlayers to onCreateRoom', () => {
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Alice' },
      });
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: '4' },
      });
      fireEvent.click(screen.getByText('Create Room'));

      expect(onCreateRoom).toHaveBeenCalledWith('Alice', 4, 30);
    });

    it('passes custom stockpileSize to onCreateRoom', () => {
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Alice' },
      });
      fireEvent.change(screen.getByRole('slider'), {
        target: { value: '15' },
      });
      fireEvent.click(screen.getByText('Create Room'));

      expect(onCreateRoom).toHaveBeenCalledWith('Alice', 2, 15);
    });

    it('caps stockpile size when maxPlayers increases to 5+', () => {
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Alice' },
      });
      // Default stockpile is 30, then switch to 6 players (max 20)
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: '6' },
      });
      fireEvent.click(screen.getByText('Create Room'));

      expect(onCreateRoom).toHaveBeenCalledWith('Alice', 6, 20);
    });
  });

  describe('join form validation', () => {
    it('does not call onJoinRoom with empty room ID', () => {
      const onJoinRoom = jest.fn();
      renderLobby({ onJoinRoom });

      fireEvent.click(screen.getByText('Join Existing Room'));

      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'Bob' },
      });
      // Leave room ID empty, click join
      fireEvent.click(screen.getByText('Join Room'));

      expect(onJoinRoom).not.toHaveBeenCalled();
    });
  });

  describe('player name persistence', () => {
    it('loads player name from localStorage on mount', () => {
      localStorage.setItem('skipBoPlayerName', 'SavedName');
      renderLobby();
      expect(screen.getByPlaceholderText('Enter your name').value).toBe('SavedName');
    });

    it('saves player name to localStorage on change', () => {
      renderLobby();
      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'NewName' },
      });
      expect(localStorage.getItem('skipBoPlayerName')).toBe('NewName');
    });

    it('uses persisted name when creating room', () => {
      localStorage.setItem('skipBoPlayerName', 'PersistedAlice');
      const onCreateRoom = jest.fn();
      renderLobby({ onCreateRoom });
      fireEvent.click(screen.getByText('Create Room'));
      expect(onCreateRoom).toHaveBeenCalledWith('PersistedAlice', 2, 30);
    });

    it('uses persisted name when joining room', () => {
      localStorage.setItem('skipBoPlayerName', 'PersistedBob');
      const onJoinRoom = jest.fn();
      renderLobby({ onJoinRoom });
      fireEvent.click(screen.getByText('Join Existing Room'));
      fireEvent.change(screen.getByPlaceholderText('Enter room ID'), {
        target: { value: 'ABC123' },
      });
      fireEvent.click(screen.getByText('Join Room'));
      expect(onJoinRoom).toHaveBeenCalledWith('ABC123', 'PersistedBob');
    });
  });

  describe('initialRoomId', () => {
    it('shows join form when initialRoomId is provided', () => {
      renderLobby({ initialRoomId: 'ABCD12' });
      expect(screen.getByText('Join a Game')).toBeInTheDocument();
    });

    it('pre-fills room ID input from initialRoomId', () => {
      renderLobby({ initialRoomId: 'ABCD12' });
      const input = screen.getByPlaceholderText('Enter room ID');
      expect(input.value).toBe('ABCD12');
    });
  });
});
