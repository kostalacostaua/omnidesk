/**
 * Создание первого тенанта и пользователя + выпуск токена для разработки.
 *
 *   npm run seed -- --name "Моя компания" --email me@example.com
 *
 * Зачем это нужно отдельной командой, а не ручкой в API.
 *
 * Все ручки требуют авторизации, а авторизация приходит либо из Zoho,
 * либо из логина — которого на этом этапе ещё нет. Получается курица и яйцо:
 * поднял стек, а сделать ничего не можешь, потому что некому выдать токен.
 *
 * Соблазн — сделать эндпоинт /dev/bootstrap с флагом в переменных окружения.
 * Так делать не надо: флаг однажды окажется включённым в проде, и любой
 * желающий заведёт себе тенанта в вашей системе. Отдельная CLI-команда
 * не может быть вызвана из интернета в принципе.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { createPool, withSystem, withTenant } from '@omnidesk/core';

interface Args {
  name: string;
  email: string;
  days: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    name: get('--name') ?? 'Local Dev',
    email: get('--email') ?? 'dev@localhost',
    days: Number(get('--days') ?? 30),
  };
}

/**
 * Slug из названия. Кириллица транслитерируется, а не выбрасывается:
 * иначе «Тестовая компания» превращается в бессмысленный tenant-4540e01d,
 * и потом никто не понимает, чей это тенант в логах.
 */
const TRANSLIT: Record<string, string> = {
  а:'a', б:'b', в:'v', г:'g', ґ:'g', д:'d', е:'e', є:'ye', ё:'e', ж:'zh',
  з:'z', и:'i', і:'i', ї:'yi', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o',
  п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'kh', ц:'ts', ч:'ch',
  ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
};

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length >= 3 ? s.slice(0, 40).replace(/-+$/, '') : `tenant-${randomUUID().slice(0, 8)}`;
}

function signJwt(secret: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const b64 = (v: string): string => Buffer.from(v).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const DATABASE_URL = process.env['DATABASE_URL'];
  const JWT_SECRET = process.env['JWT_SECRET'];

  if (!DATABASE_URL) throw new Error('DATABASE_URL не задан');
  if (!JWT_SECRET) throw new Error('JWT_SECRET не задан — возьмите из .env');

  const pool = createPool(DATABASE_URL);

  try {
    const slug = slugify(args.name);

    // Тенант заводится вне контекста: таблица tenants — это сам справочник
    // тенантов, RLS к ней не применяется.
    const tenant = await withSystem(pool, 'создание тенанта', async (db) => {
      const { rows } = await db.query<{ id: string; slug: string }>(
        `INSERT INTO tenants (slug, name, plan)
         VALUES ($1, $2, 'trial')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, slug`,
        [slug, args.name],
      );
      return rows[0]!;
    });

    // Пользователь — уже в контексте тенанта. Политика WITH CHECK не даст
    // записать его в чужого тенанта, даже если ошибиться в коде.
    const user = await withTenant(pool, tenant.id, async (db) => {
      const { rows } = await db.query<{ id: string; role: string }>(
        `INSERT INTO users (tenant_id, email, full_name, role, is_active)
         VALUES ($1, $2, $3, 'owner', true)
         ON CONFLICT (tenant_id, email) DO UPDATE SET is_active = true
         RETURNING id, role`,
        [tenant.id, args.email, args.name],
      );
      return rows[0]!;
    });

    const ttl = args.days * 24 * 3600;
    const token = signJwt(JWT_SECRET, { sub: user.id, tid: tenant.id, role: user.role }, ttl);

    const line = '─'.repeat(72);
    console.log(`
${line}
  Тенант создан

  Название   ${args.name}
  Slug       ${tenant.slug}
  Tenant ID  ${tenant.id}
  User ID    ${user.id}
  Роль       ${user.role}

${line}
  Токен на ${args.days} дней — им авторизуются запросы к API:

${token}

${line}
  Проверьте, что он работает:

  curl -s http://localhost:3000/conversations \\
    -H "Authorization: Bearer ${token.slice(0, 24)}..." | jq

  Подключите Telegram-бота:

  curl -X POST http://localhost:3000/channels/telegram \\
    -H "Authorization: Bearer <токен выше>" \\
    -H "content-type: application/json" \\
    -d '{"botToken":"<токен от @BotFather>","displayName":"Тест"}'

${line}
  ⚠️  Токен подписан вашим JWT_SECRET. Он даёт полный доступ к тенанту —
     не публикуйте его и не коммитьте в репозиторий.
${line}
`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('\n✖ Не удалось создать тенанта:', err instanceof Error ? err.message : err);
  process.exit(1);
});
