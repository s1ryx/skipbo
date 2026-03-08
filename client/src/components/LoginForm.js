import React, { useState } from 'react';
import { useTranslation } from '../i18n';
import './LoginForm.css';

export default function LoginForm({ loginState, onLogin, onLogout }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onLogin(username.trim(), password || null);
  };

  if (loginState.isLoggedIn) {
    return (
      <div className="login-status">
        <span className="login-username">
          {t('login.loggedInAs', { username: loginState.username })}
        </span>
        <button className="login-logout-btn" onClick={onLogout} type="button">
          {t('login.logout')}
        </button>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="login-input"
        placeholder={t('login.username')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={20}
      />
      <input
        type="password"
        className="login-input"
        placeholder={t('login.password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="login-btn" type="submit">
        {t('login.login')}
      </button>
      {loginState.error && <span className="login-error">{t(loginState.error)}</span>}
    </form>
  );
}
