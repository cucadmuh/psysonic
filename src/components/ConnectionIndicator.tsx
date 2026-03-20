import { useTranslation } from 'react-i18next';
import { ConnectionStatus } from '../hooks/useConnectionStatus';

interface Props {
  status: ConnectionStatus;
  isLan: boolean;
  serverName: string;
}

export default function ConnectionIndicator({ status, isLan, serverName }: Props) {
  const { t } = useTranslation();

  const label = isLan ? 'LAN' : t('connection.extern');
  const title =
    status === 'connected'
      ? t('connection.connected')
      : status === 'disconnected'
      ? t('connection.disconnected')
      : t('connection.checking');

  return (
    <div className="connection-indicator" data-tooltip={title} data-tooltip-pos="bottom">
      <div className={`connection-led connection-led--${status}`} />
      <div className="connection-meta">
        <span className="connection-type">{label}</span>
        <span className="connection-server">{serverName}</span>
      </div>
    </div>
  );
}
