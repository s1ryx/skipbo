import React from 'react';
import { useTranslation } from '../i18n';

function ConnectionStatus({ isConnected }) {
  const { t } = useTranslation();

  if (isConnected) return null;

  return (
    <div className="connection-status disconnected">
      {t('connection.disconnected')}
    </div>
  );
}

export default ConnectionStatus;
