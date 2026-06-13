const PREFIX = "klak.insecure_dev_secret.";

export async function saveDevSecret(key: string, value: string): Promise<void> {
  localStorage.setItem(`${PREFIX}${key}`, value);
}

export async function getDevSecret(key: string): Promise<string | null> {
  return localStorage.getItem(`${PREFIX}${key}`);
}

export async function deleteDevSecret(key: string): Promise<void> {
  localStorage.removeItem(`${PREFIX}${key}`);
}

export async function hasDevSecret(key: string): Promise<boolean> {
  return Boolean(await getDevSecret(key));
}
