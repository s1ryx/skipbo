import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import './OptionsMenu.css';
import LoginForm from './LoginForm';
import { useTranslation } from '../i18n';

function OptionsMenu({
  roomId,
  quickDiscardEnabled,
  onToggleQuickDiscard,
  onLeaveGame,
  loginState,
  onLogin,
  onLogout,
}) {
  const { t, language, setLanguage, supportedLanguages } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const [dropdownTop, setDropdownTop] = useState(0);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownTop(rect.bottom + 8);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleClickOutside = (e) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  const dropdown = isOpen
    ? ReactDOM.createPortal(
        <div className="options-dropdown" ref={dropdownRef} style={{ top: dropdownTop }}>
          <div className="options-item options-room">
            <span className="room-label">{roomId}</span>
          </div>
          <div className="options-item">
            <label>
              <input
                type="checkbox"
                checked={quickDiscardEnabled}
                onChange={onToggleQuickDiscard}
              />
              {t('game.quickDiscard')}
            </label>
          </div>
          <div className="options-item">
            <label>
              {t('game.language')}
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {supportedLanguages.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(`language.${lang}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="options-item options-login">
            <LoginForm loginState={loginState} onLogin={onLogin} onLogout={onLogout} />
          </div>
          <div className="options-item">
            <button className="btn-leave" onClick={onLeaveGame}>
              {t('game.leaveGame')}
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="options-menu">
      <button
        ref={buttonRef}
        className={`btn-options ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={t('game.options')}
        aria-expanded={isOpen}
      >
        <span className="options-icon">&#9881;</span>
      </button>
      {dropdown}
    </div>
  );
}

export default OptionsMenu;
