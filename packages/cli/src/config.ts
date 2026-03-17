import { homedir } from 'os';
import { join } from 'path';

import { cosmiconfig } from 'cosmiconfig';

export type CliConfig = {
  serverUrl: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir: string;
  encryptionPassword?: string;
};

export type CliGlobalOpts = {
  serverUrl?: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir?: string;
  encryptionPassword?: string;
  format?: 'json' | 'table' | 'csv';
  verbose?: boolean;
};

type ConfigFileContent = {
  serverUrl?: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir?: string;
  encryptionPassword?: string;
};

async function loadConfigFile(): Promise<ConfigFileContent> {
  const explorer = cosmiconfig('actual', {
    searchPlaces: [
      'package.json',
      '.actualrc',
      '.actualrc.json',
      '.actualrc.yaml',
      '.actualrc.yml',
      'actual.config.json',
      'actual.config.yaml',
      'actual.config.yml',
    ],
  });
  const result = await explorer.search();
  if (result && !result.isEmpty) {
    return result.config as ConfigFileContent;
  }
  return {};
}

export async function resolveConfig(
  cliOpts: CliGlobalOpts,
): Promise<CliConfig> {
  const fileConfig = await loadConfigFile();

  const serverUrl =
    cliOpts.serverUrl ??
    process.env.ACTUAL_SERVER_URL ??
    fileConfig.serverUrl ??
    '';

  const password =
    cliOpts.password ?? process.env.ACTUAL_PASSWORD ?? fileConfig.password;

  const sessionToken =
    cliOpts.sessionToken ??
    process.env.ACTUAL_SESSION_TOKEN ??
    fileConfig.sessionToken;

  const syncId =
    cliOpts.syncId ?? process.env.ACTUAL_SYNC_ID ?? fileConfig.syncId;

  const dataDir =
    cliOpts.dataDir ??
    process.env.ACTUAL_DATA_DIR ??
    fileConfig.dataDir ??
    join(homedir(), '.actual-cli', 'data');

  const encryptionPassword =
    cliOpts.encryptionPassword ??
    process.env.ACTUAL_ENCRYPTION_PASSWORD ??
    fileConfig.encryptionPassword;

  if (!serverUrl) {
    throw new Error(
      'Server URL is required. Set --server-url, ACTUAL_SERVER_URL env var, or serverUrl in config file.',
    );
  }

  if (!password && !sessionToken) {
    throw new Error(
      'Authentication required. Set --password/--session-token, ACTUAL_PASSWORD/ACTUAL_SESSION_TOKEN env var, or password/sessionToken in config file.',
    );
  }

  return {
    serverUrl,
    password,
    sessionToken,
    syncId,
    dataDir,
    encryptionPassword,
  };
}
