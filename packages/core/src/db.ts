import pg from 'pg';

/**
 * Доступ к БД с принудительной изоляцией тенантов.
 *
 * Правило проекта: НИКАКОЙ код не обращается к пулу напрямую. Только через
 * withTenant(). Это единственный способ гарантировать, что контекст RLS
 * выставлен, — а без него запрос вернёт ноль строк (или, если кто-то
 * отключит RLS, чужие данные).
 *
 * Заведите ESLint-правило, запрещающее импорт `pool` за пределами этого файла.
 */

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface TenantClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TenantContextError extends Error {}

export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Пул обязан подключаться под app_user, а не под владельцем БД:
    // владелец обходит политики RLS, если для таблицы не задан FORCE.
    application_name: 'omnidesk',
  });
}

/**
 * Выполняет callback в транзакции с выставленным контекстом тенанта.
 *
 * set_config(..., true) — третий аргумент означает «только на текущую
 * транзакцию». Без него значение утечёт на следующий запрос, который
 * возьмёт это же соединение из пула. Это самая опасная ошибка в мультитенанте:
 * она проявляется редко, под нагрузкой, и выглядит как «клиент увидел чужие
 * данные».
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (db: TenantClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    // Параметризация ниже и так защищает от инъекции, но невалидный uuid —
    // это симптом ошибки в вызывающем коде, и лучше упасть громко.
    throw new TenantContextError(`Некорректный tenantId: ${tenantId}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* соединение уже мертво — игнорируем */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Таблицы маршрутизации — намеренно без RLS.
 *
 * Их читают ДО того, как известен тенант: когда приходит вебхук, мы
 * определяем по phone_number_id или channel_id, чей это канал.
 *
 * Пользовательских данных в них нет — только соответствие внешнего
 * идентификатора тенанту. Список должен совпадать с исключениями
 * в 02-schema.sql.
 *
 * Мы сознательно НЕ заводим роль с BYPASSRLS для системных запросов:
 * такая роль умеет прочитать переписку всех клиентов сразу, и рано или
 * поздно через неё выполнят обычный запрос. При текущей схеме в системе
 * не существует соединения, способного это сделать.
 */
/**
 * Таблицы маршрутизации: сознательное исключение из RLS.
 *
 * Все три нужны ДО того, как тенант известен: пришёл вебхук, открылся
 * виджет Zoho, человек ввёл почту на форме входа. Контекст RLS выставить
 * не из чего, а таблица под RLS вернёт пусто.
 *
 * Плата — любое подключение читает их целиком. Поэтому в них только
 * идентификаторы: ни переписки, ни имён, ни токенов. Добавлять сюда можно
 * лишь таблицу, которая нужна до определения тенанта И не содержит данных
 * клиентов. Проверка при старте падает на всём, чего здесь нет.
 */
export const ROUTING_TABLES = [
  'channel_routes',
  'zoho_org_routes',
  'user_routes',
  'data_deletion_requests',
] as const;

/**
 * Для операций, выполняемых до определения тенанта: маршрутизация вебхуков,
 * поиск установки Zoho, регистрация нового тенанта.
 *
 * Соединение то же самое, под app_user — то есть RLS продолжает действовать.
 * Читать здесь можно только таблицы маршрутизации; попытка обратиться
 * к conversations или messages вернёт ноль строк, а не чужие данные.
 */
export async function withSystem<T>(
  pool: Pool,
  reason: string,
  fn: (db: TenantClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* noop */
    }
    throw new Error(`Системная операция «${reason}» не выполнена: ${String(err)}`, { cause: err });
  } finally {
    client.release();
  }
}

/**
 * Проверка, что ни одна таблица с tenant_id не осталась без RLS.
 * Вызывать на старте приложения и в CI. Должна возвращать пустой массив.
 */
export async function findTablesWithoutRls(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
        AND c.relname <> ALL($1::text[])
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = c.relname
             AND column_name = 'tenant_id'
        )`,
    [ROUTING_TABLES],
  );
  return rows.map((r) => r.relname);
}

/**
 * Стартовая проверка. Падаем на старте, а не в проде через месяц.
 */
export async function assertRlsIntegrity(pool: Pool): Promise<void> {
  const unprotected = await findTablesWithoutRls(pool);
  if (unprotected.length > 0) {
    throw new Error(
      `Таблицы с tenant_id без RLS: ${unprotected.join(', ')}. ` +
        `Добавьте SELECT apply_tenant_rls('<таблица>') в миграцию.`,
    );
  }
}
