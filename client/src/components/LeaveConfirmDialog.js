import React from 'react';
import { useTranslation } from '../i18n';

function LeaveConfirmDialog({ onConfirm, onCancel }) {
  const { t } = useTranslation();

  return (
    <div className="leave-confirm-overlay">
      <div className="leave-confirm-dialog">
        <p>{t('game.leaveConfirm')}</p>
        <div className="leave-confirm-buttons">
          <button onClick={onConfirm} className="btn-leave-confirm">
            {t('game.leaveYes')}
          </button>
          <button onClick={onCancel} className="btn-leave-cancel">
            {t('game.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LeaveConfirmDialog;
