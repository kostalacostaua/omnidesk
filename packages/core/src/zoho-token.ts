/**
 * Маркер доступа к Zoho.
 *
 * Живёт час, а обменов refresh-токена Zoho считает и режет при
 * превышении. Поэтому маркер лежит в общем кэше пятьдесят минут, и
 * ключ у кэша один на всё приложение: воркер и api обращаются к одной
 * записи. Две записи означали бы вдвое больше обменов и вдвое ближе
 * предел — при том, что маркер один и тот же.
 *
 * Хранилище описано минимальным интерфейсом, а не типом ioredis: ядро
 * не должно тащить за собой драйвер ради двух методов, а подменить его
 * в проверке становится нечем сложнее объекта с двумя функциями.
 */

export interface TokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export interface ZohoTokenInput {
  cache: TokenCache;
  tenantId: string;
  accountsServer: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

/** Пятьдесят минут при часовой жизни: запас на долгую задачу. */
export const ZOHO_TOKEN_TTL_SEC = 50 * 60;

export function zohoTokenKey(tenantId: string): string {
  return `zoho:at:${tenantId}`;
}

export type ZohoTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Взять маркер из кэша или обменять refresh-токен.
 *
 * Отказ возвращается значением, а не исключением: «Zoho отозвала
 * доступ» — это не сбой программы, а состояние, которое нужно показать
 * человеку и записать в подключение. Решать, что с этим делать, —
 * работа вызывающего: у воркера и у формы настроек ответы разные.
 */
export async function zohoAccessToken(input: ZohoTokenInput): Promise<ZohoTokenResult> {
  const key = zohoTokenKey(input.tenantId);
  const cached = await input.cache.get(key);
  if (cached) return { ok: true, token: cached };

  const res = await fetch(`${input.accountsServer}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };

  if (!res.ok || !body.access_token) {
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }

  await input.cache.set(key, body.access_token, 'EX', ZOHO_TOKEN_TTL_SEC);
  return { ok: true, token: body.access_token };
}
