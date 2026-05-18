import { createClient } from '@supabase/supabase-js';
import type { ApiKey } from '@/types';
import { createLogger } from './logger';

const log = createLogger('lib/api-keys');

// Service-role client for privileged DB ops
function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role env vars not set');
  return createClient(url, key);
}

// Generate a cryptographically random API key: "cms_" prefix + 40 hex chars
export function generateRawKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `cms_${hex}`;
}

export async function hashKey(rawKey: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(rawKey));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createApiKey(userId: string, name: string): Promise<{
  apiKey: ApiKey;
  rawKey: string;   // shown once; never stored
} | null> {
  const rawKey  = generateRawKey();
  const keyHash = await hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  const { data, error } = await adminDb()
    .from('api_keys')
    .insert({ user_id: userId, key_hash: keyHash, key_prefix: keyPrefix, name })
    .select('*')
    .single();

  if (error) {
    log.error({ userId, err: error.message }, 'createApiKey failed');
    return null;
  }

  return { apiKey: rowToApiKey(data), rawKey };
}

export async function validateApiKey(rawKey: string): Promise<ApiKey | null> {
  const keyHash = await hashKey(rawKey);

  const { data, error } = await adminDb()
    .from('api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !data) return null;

  // Update last_used_at asynchronously — don't block the request
  adminDb()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: e }) => { if (e) log.warn({ id: data.id }, 'last_used_at update failed'); });

  return rowToApiKey(data);
}

export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const { error } = await adminDb()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error) { log.error({ keyId, err: error.message }, 'revokeApiKey failed'); return false; }
  return true;
}

export async function listUserApiKeys(userId: string): Promise<ApiKey[]> {
  const { data, error } = await adminDb()
    .from('api_keys')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) { log.error({ userId, err: error.message }, 'listUserApiKeys failed'); return []; }
  return (data ?? []).map(rowToApiKey);
}

function rowToApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id:          row.id as string,
    userId:      row.user_id as string,
    keyHash:     row.key_hash as string,
    keyPrefix:   row.key_prefix as string,
    name:        row.name as string,
    lastUsedAt:  row.last_used_at ? new Date(row.last_used_at as string) : undefined,
    createdAt:   new Date(row.created_at as string),
    revokedAt:   row.revoked_at ? new Date(row.revoked_at as string) : undefined,
  };
}
