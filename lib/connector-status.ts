export type ConnectorDisplayStatus =
  | 'disabled'
  | 'setup_required'
  | 'starting'
  | 'online'
  | 'syncing'
  | 'delayed'
  | 'offline'
  | 'degraded'
  | 'error'
  | 'stopping';

export type ConnectorStatusSeverity = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export type ConnectorStatusInput = {
  status?: string | null;
  reported_state?: string | null;
  last_heartbeat_at?: string | null;
  last_seen_at?: string | null;
  live_poll_interval_seconds?: number | null;
};

export type DerivedConnectorStatus = {
  key: ConnectorDisplayStatus;
  label: string;
  heartbeatAgeSeconds: number | null;
  isHeartbeatStale: boolean;
  severity: ConnectorStatusSeverity;
  explanation: string;
  pollingIntervalSeconds: number;
  usingLegacyHeartbeat: boolean;
};

const DEFAULT_POLLING_INTERVAL_SECONDS = 120;

const STATUS_DETAILS: Record<
  ConnectorDisplayStatus,
  Pick<DerivedConnectorStatus, 'label' | 'severity'>
> = {
  disabled: { label: 'Disabled', severity: 'neutral' },
  setup_required: { label: 'Setup required', severity: 'warning' },
  starting: { label: 'Starting', severity: 'info' },
  online: { label: 'Online', severity: 'success' },
  syncing: { label: 'Syncing', severity: 'info' },
  delayed: { label: 'Delayed', severity: 'warning' },
  offline: { label: 'Offline', severity: 'danger' },
  degraded: { label: 'Degraded', severity: 'warning' },
  error: { label: 'Error', severity: 'danger' },
  stopping: { label: 'Stopping', severity: 'neutral' },
};

function normalizedValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

function resolvePollingInterval(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_POLLING_INTERVAL_SECONDS;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function result(
  key: ConnectorDisplayStatus,
  options: Omit<DerivedConnectorStatus, 'key' | 'label' | 'severity'>
): DerivedConnectorStatus {
  return {
    key,
    label: STATUS_DETAILS[key].label,
    severity: STATUS_DETAILS[key].severity,
    ...options,
  };
}

export function deriveConnectorStatus(
  connector: ConnectorStatusInput,
  referenceTime: Date | number | string = new Date()
): DerivedConnectorStatus {
  const pollingIntervalSeconds = resolvePollingInterval(connector.live_poll_interval_seconds);
  const status = normalizedValue(connector.status);
  const reportedState = normalizedValue(connector.reported_state);

  if (status === 'disabled') {
    return result('disabled', {
      heartbeatAgeSeconds: null,
      isHeartbeatStale: false,
      explanation: 'This connector is administratively disabled.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat: false,
    });
  }

  const heartbeatValue = connector.last_heartbeat_at || connector.last_seen_at;
  const usingLegacyHeartbeat = !connector.last_heartbeat_at && Boolean(connector.last_seen_at);
  if (!heartbeatValue) {
    return result('setup_required', {
      heartbeatAgeSeconds: null,
      isHeartbeatStale: true,
      explanation: 'No connector heartbeat has been received yet.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }

  const heartbeatTimestamp = toTimestamp(heartbeatValue);
  const referenceTimestamp =
    referenceTime instanceof Date
      ? referenceTime.getTime()
      : typeof referenceTime === 'number'
        ? referenceTime
        : Date.parse(referenceTime);

  if (heartbeatTimestamp === null || !Number.isFinite(referenceTimestamp)) {
    return result('offline', {
      heartbeatAgeSeconds: null,
      isHeartbeatStale: true,
      explanation: 'The most recent connector heartbeat timestamp is invalid.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }

  const heartbeatAgeSeconds = Math.max(0, Math.floor((referenceTimestamp - heartbeatTimestamp) / 1000));
  const delayedAfterSeconds = pollingIntervalSeconds * 3;
  const offlineAfterSeconds = pollingIntervalSeconds * 10;
  const isOffline = heartbeatAgeSeconds > offlineAfterSeconds;
  const isHeartbeatStale = heartbeatAgeSeconds > delayedAfterSeconds;

  if (reportedState === 'error') {
    return result('error', {
      heartbeatAgeSeconds,
      isHeartbeatStale,
      explanation: 'The connector reported an error state.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (reportedState === 'degraded') {
    return result('degraded', {
      heartbeatAgeSeconds,
      isHeartbeatStale,
      explanation: 'The connector reported a degraded state.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (reportedState === 'stopping') {
    return result('stopping', {
      heartbeatAgeSeconds,
      isHeartbeatStale,
      explanation: 'The connector is stopping.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (reportedState === 'starting' && !isOffline) {
    return result('starting', {
      heartbeatAgeSeconds,
      isHeartbeatStale,
      explanation: 'The connector is starting and has recently checked in.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (isOffline) {
    return result('offline', {
      heartbeatAgeSeconds,
      isHeartbeatStale: true,
      explanation: `No heartbeat has been received within ${offlineAfterSeconds} seconds.`,
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (isHeartbeatStale) {
    return result('delayed', {
      heartbeatAgeSeconds,
      isHeartbeatStale: true,
      explanation: `Heartbeat is later than the expected ${delayedAfterSeconds}-second window.`,
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }
  if (reportedState === 'syncing') {
    return result('syncing', {
      heartbeatAgeSeconds,
      isHeartbeatStale: false,
      explanation: 'The connector is actively synchronizing.',
      pollingIntervalSeconds,
      usingLegacyHeartbeat,
    });
  }

  return result('online', {
    heartbeatAgeSeconds,
    isHeartbeatStale: false,
    explanation: usingLegacyHeartbeat
      ? 'Using the legacy last-seen timestamp until a heartbeat is available.'
      : 'The connector is checking in within its expected polling window.',
    pollingIntervalSeconds,
    usingLegacyHeartbeat,
  });
}
