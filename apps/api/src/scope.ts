/**
 * Какие каналы видит человек.
 *
 * До этого любой сотрудник видел всю переписку компании. Для магазина
 * из двух человек это норма, для агентства с подрядчиками — нет:
 * оператор, которого взяли вести один Instagram, читал и личные
 * диалоги владельца в Telegram.
 *
 * Правило:
 *
 *   владелец и администратор       — видят всё;
 *   у кого список каналов пуст     — видят всё;
 *   у кого список задан            — видят только эти каналы.
 *
 * Пустой список означает «все», а не «ничего», намеренно. Обратный
 * порядок выглядит строже, но на деле означает, что каждый новый
 * сотрудник в первый день видит пустой экран и пишет в поддержку.
 *
 * Проверка сделана условием в запросе, а не отдельным походом в базу:
 * лишний запрос перед каждым чтением — это и задержка, и соблазн
 * где-нибудь его не написать. Условие же либо есть в SQL, либо его
 * отсутствие сразу видно в самом запросе.
 */

/**
 * Условие для WHERE. Принимает выражение, дающее идентификатор канала
 * (обычно `c.channel_id`), и место подстановки идентификатора
 * пользователя — одно и то же в трёх подзапросах.
 *
 * @example
 *   const uid = push(auth.userId);       // '$3'
 *   where.push(channelScope('c.channel_id', uid));
 */
export function channelScope(channelExpr: string, userParam: string): string {
  return `(
    EXISTS (SELECT 1 FROM users su
             WHERE su.id = ${userParam}::uuid AND su.role IN ('owner','admin'))
    OR NOT EXISTS (SELECT 1 FROM user_channels sc WHERE sc.user_id = ${userParam}::uuid)
    OR ${channelExpr} IN (SELECT sc.channel_id FROM user_channels sc
                           WHERE sc.user_id = ${userParam}::uuid)
  )`.replace(/\s+/g, ' ');
}

/**
 * То же правило для списка каналов: показывать человеку каналы, к
 * которым у него нет доступа, — значит предлагать фильтр, который
 * всегда возвращает пусто.
 */
export function channelListScope(userParam: string): string {
  return channelScope('c.id', userParam);
}

/**
 * То же правило для папок шаблонов.
 *
 * Отдельная функция, а не параметр у предыдущей: таблицы разные, и
 * попытка обобщить их одной строкой с подстановкой имени таблицы
 * означала бы собирать SQL из кусков там, где сейчас читается глазами.
 *
 * Шаблоны вне папок в это правило не попадают вовсе: условие говорит
 * только про строки с папкой, а «без папки» разрешается отдельно в
 * самом запросе. Так видно, что это решение принято, а не забыто.
 */
export function folderScope(folderExpr: string, userParam: string): string {
  return `(
    EXISTS (SELECT 1 FROM users su
             WHERE su.id = ${userParam}::uuid AND su.role IN ('owner','admin'))
    OR NOT EXISTS (SELECT 1 FROM user_reply_folders sf WHERE sf.user_id = ${userParam}::uuid)
    OR lower(${folderExpr}) IN (SELECT lower(f.name) FROM reply_folders f
                          JOIN user_reply_folders sf ON sf.folder_id = f.id
                         WHERE sf.user_id = ${userParam}::uuid)
  )`.replace(/\s+/g, ' ');
}
