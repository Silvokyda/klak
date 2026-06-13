import { deleteDevSecret, getDevSecret, hasDevSecret, saveDevSecret } from "./insecureDevSecretStore";
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface SecretStore {
  saveSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
  hasSecret(key: string): Promise<boolean>;
}

export const developmentSecretWarning = "Development storage is active. Do not use production keys.";
export const secureSecretStatus = "Windows-backed secret storage is active.";

export const secretStore: SecretStore = {
  async saveSecret(key, value) {
    if (isTauri()) return invoke("save_secret", { key, value });
    return saveDevSecret(key, value);
  },
  async getSecret(key) {
    if (isTauri()) return invoke<string | null>("get_secret", { key });
    return getDevSecret(key);
  },
  async deleteSecret(key) {
    if (isTauri()) return invoke("delete_secret", { key });
    return deleteDevSecret(key);
  },
  async hasSecret(key) {
    if (isTauri()) return invoke<boolean>("has_secret", { key });
    return hasDevSecret(key);
  }
};

export function getSecretStorageStatus(): string {
  return isTauri() ? secureSecretStatus : developmentSecretWarning;
}

export const saveSecret = secretStore.saveSecret;
export const getSecret = secretStore.getSecret;
export const deleteSecret = secretStore.deleteSecret;
export const hasSecret = secretStore.hasSecret;
