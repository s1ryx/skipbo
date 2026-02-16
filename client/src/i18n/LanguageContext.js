import React, { createContext, useContext, useState, useCallback } from 'react';
import en from './en.json';
import de from './de.json';
import tr from './tr.json';

const translations = { en, de, tr };
const supportedLanguages = ['en', 'de', 'tr'];
const defaultLanguage = 'en';

const LanguageContext = createContext();

function getInitialLanguage() {
  const saved = localStorage.getItem('skipBoLanguage');
  if (saved && supportedLanguages.includes(saved)) {
    return saved;
  }
  return defaultLanguage;
}

function interpolate(str, params) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return params[key] !== undefined ? params[key] : '';
  });
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage);

  const setLanguage = useCallback((lang) => {
    if (supportedLanguages.includes(lang)) {
      setLanguageState(lang);
      localStorage.setItem('skipBoLanguage', lang);
    }
  }, []);

  const t = useCallback(
    (key, params = {}) => {
      let actualKey = key;

      // Pluralization: when count is provided, select _one or _other variant
      if ('count' in params) {
        const plural = params.count === 1 ? '_one' : '_other';
        const pluralKey = key + plural;
        // Only use plural key if it exists, otherwise fall back to base key
        if (translations[language]?.[pluralKey] || translations[defaultLanguage]?.[pluralKey]) {
          actualKey = pluralKey;
        }
      }

      const value =
        translations[language]?.[actualKey] || translations[defaultLanguage]?.[actualKey] || key;

      return interpolate(value, params);
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, supportedLanguages }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
}
