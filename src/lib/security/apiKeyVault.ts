import { getSecret, hasSecret, saveSecret } from "./secretStore";

export interface ApiKeyVault {
  saveApiKey(value: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  getApiKeyForProviderCall(): Promise<string | null>;
}

const AI_API_KEY = "ai_api_key";

export const apiKeyVault: ApiKeyVault = {
  async saveApiKey(value) {
    await saveSecret(AI_API_KEY, value);
  },
  async hasApiKey() {
    return hasSecret(AI_API_KEY);
  },
  async getApiKeyForProviderCall() {
    return getSecret(AI_API_KEY);
  }
};

export { developmentSecretWarning as devStorageWarning } from "./secretStore";
