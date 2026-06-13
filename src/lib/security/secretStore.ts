import { deleteDevSecret, getDevSecret, hasDevSecret, saveDevSecret } from "./insecureDevSecretStore";

export interface SecretStore {
  saveSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
  hasSecret(key: string): Promise<boolean>;
}

export const developmentSecretWarning = "Development storage is active. Do not use production keys.";

export const secretStore: SecretStore = {
  saveSecret: saveDevSecret,
  getSecret: getDevSecret,
  deleteSecret: deleteDevSecret,
  hasSecret: hasDevSecret
};

export const saveSecret = secretStore.saveSecret;
export const getSecret = secretStore.getSecret;
export const deleteSecret = secretStore.deleteSecret;
export const hasSecret = secretStore.hasSecret;
