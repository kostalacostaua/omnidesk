-- ═══════════════════════════════════════════════════════════════════════
-- ТЕСТ ИЗОЛЯЦИИ ТЕНАНТОВ
--
-- Это главный тест безопасности всей системы. Запускайте его в CI при
-- каждом изменении схемы. Если он падает — не деплойте.
--
--   psql -U app_user -d omnidesk -v ON_ERROR_STOP=1 -f test-isolation.sql
--
-- ВАЖНО: запускать под app_user, а НЕ под postgres. Суперпользователь
-- обходит RLS всегда, и тест будет зелёным при полностью сломанной
-- изоляции.
-- ═══════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off

DO $$
DECLARE
  t_a       uuid;
  t_b       uuid;
  ch_a      uuid;
  ch_b      uuid;
  ct_a      uuid;
  ct_b      uuid;
  cnt       int;
  ok        boolean;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────
  -- Подготовка: два тенанта, у каждого свой канал, контакт и диалог
  -- ─────────────────────────────────────────────────────────────────────
  DELETE FROM tenants WHERE slug IN ('rls-test-a', 'rls-test-b');

  INSERT INTO tenants (slug, name) VALUES ('rls-test-a', 'Тенант A') RETURNING id INTO t_a;
  INSERT INTO tenants (slug, name) VALUES ('rls-test-b', 'Тенант B') RETURNING id INTO t_b;

  -- Данные тенанта A
  PERFORM set_config('app.tenant_id', t_a::text, true);
  INSERT INTO channels (tenant_id, type, display_name, external_id, credentials_enc, status)
    VALUES (t_a, 'telegram_bot', 'Бот A', 'ext-a', '\x00', 'active') RETURNING id INTO ch_a;
  INSERT INTO contacts (tenant_id, display_name) VALUES (t_a, 'Клиент A') RETURNING id INTO ct_a;
  INSERT INTO conversations (tenant_id, channel_id, contact_id) VALUES (t_a, ch_a, ct_a);
  INSERT INTO messages (tenant_id, conversation_id, channel_id, external_id,
                        direction, sender_type, content)
    SELECT t_a, id, ch_a, 'msg-a-1', 'in', 'customer',
           '{"text":"СЕКРЕТ ТЕНАНТА A"}'::jsonb
      FROM conversations WHERE tenant_id = t_a;

  -- Данные тенанта B
  PERFORM set_config('app.tenant_id', t_b::text, true);
  INSERT INTO channels (tenant_id, type, display_name, external_id, credentials_enc, status)
    VALUES (t_b, 'telegram_bot', 'Бот B', 'ext-b', '\x00', 'active') RETURNING id INTO ch_b;
  INSERT INTO contacts (tenant_id, display_name) VALUES (t_b, 'Клиент B') RETURNING id INTO ct_b;
  INSERT INTO conversations (tenant_id, channel_id, contact_id) VALUES (t_b, ch_b, ct_b);
  INSERT INTO messages (tenant_id, conversation_id, channel_id, external_id,
                        direction, sender_type, content)
    SELECT t_b, id, ch_b, 'msg-b-1', 'in', 'customer',
           '{"text":"СЕКРЕТ ТЕНАНТА B"}'::jsonb
      FROM conversations WHERE tenant_id = t_b;

  RAISE NOTICE 'Подготовка завершена: два тенанта с данными';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 1. В контексте A видны только данные A
  -- ─────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.tenant_id', t_a::text, true);

  SELECT count(*) INTO cnt FROM messages;
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'ТЕСТ 1 ПРОВАЛЕН: в контексте A видно % сообщений вместо 1', cnt;
  END IF;

  SELECT content->>'text' = 'СЕКРЕТ ТЕНАНТА A' INTO ok FROM messages;
  IF NOT ok THEN
    RAISE EXCEPTION 'ТЕСТ 1 ПРОВАЛЕН: в контексте A видно чужое сообщение';
  END IF;
  RAISE NOTICE 'Тест 1 пройден: тенант A видит только свои данные';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 2. ЯВНЫЙ запрос чужих данных возвращает пусто.
  -- Это моделирует IDOR: злоумышленник узнал uuid чужого тенанта
  -- и подставил его в запрос.
  -- ─────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO cnt FROM messages WHERE tenant_id = t_b;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 2 ПРОВАЛЕН: явный запрос чужих данных вернул % строк', cnt;
  END IF;

  SELECT count(*) INTO cnt FROM conversations WHERE tenant_id = t_b;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 2 ПРОВАЛЕН: чужие диалоги видны';
  END IF;

  SELECT count(*) INTO cnt FROM contacts WHERE tenant_id = t_b;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 2 ПРОВАЛЕН: чужие контакты видны';
  END IF;
  RAISE NOTICE 'Тест 2 пройден: явный запрос чужого tenant_id даёт ноль строк';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 3. Запись под чужим tenant_id блокируется (WITH CHECK)
  -- ─────────────────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO contacts (tenant_id, display_name) VALUES (t_b, 'Внедрённый контакт');
    RAISE EXCEPTION 'ТЕСТ 3 ПРОВАЛЕН: удалось записать данные в чужого тенанта';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Тест 3 пройден: запись в чужого тенанта отклонена';
  END;

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 4. UPDATE и DELETE чужих строк ничего не задевают
  -- ─────────────────────────────────────────────────────────────────────
  UPDATE messages SET content = '{"text":"ВЗЛОМАНО"}'::jsonb WHERE tenant_id = t_b;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 4 ПРОВАЛЕН: обновлено % чужих строк', cnt;
  END IF;

  DELETE FROM messages WHERE tenant_id = t_b;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 4 ПРОВАЛЕН: удалено % чужих строк', cnt;
  END IF;
  RAISE NOTICE 'Тест 4 пройден: UPDATE и DELETE не достают до чужих данных';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 5. Данные тенанта B на месте — предыдущие тесты их не испортили
  -- ─────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.tenant_id', t_b::text, true);
  SELECT content->>'text' = 'СЕКРЕТ ТЕНАНТА B' INTO ok FROM messages;
  IF NOT ok THEN
    RAISE EXCEPTION 'ТЕСТ 5 ПРОВАЛЕН: данные тенанта B повреждены или недоступны';
  END IF;
  RAISE NOTICE 'Тест 5 пройден: данные тенанта B целы';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 6. БЕЗ контекста тенанта не видно НИЧЕГО.
  -- Это защита от забытого set_config: приложение получит пустой ответ,
  -- а не чужие данные.
  -- ─────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO cnt FROM messages;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 6 ПРОВАЛЕН: без контекста видно % сообщений', cnt;
  END IF;
  RAISE NOTICE 'Тест 6 пройден: без контекста тенанта данные недоступны';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 7. Таблицы маршрутизации читаются без контекста — это и есть
  -- их назначение. Проверяем, что триггер их наполнил.
  -- ─────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO cnt FROM channel_routes WHERE external_id IN ('ext-a', 'ext-b');
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'ТЕСТ 7 ПРОВАЛЕН: в channel_routes % записей вместо 2 — триггер не сработал', cnt;
  END IF;
  RAISE NOTICE 'Тест 7 пройден: маршрутизация работает без контекста тенанта';

  -- ─────────────────────────────────────────────────────────────────────
  -- Тест 8. Дедупликация: повторная вставка того же external_id
  -- не создаёт дубль. Meta ретраит вебхуки до 7 дней.
  -- ─────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.tenant_id', t_a::text, true);
  INSERT INTO messages (tenant_id, conversation_id, channel_id, external_id,
                        direction, sender_type, content)
    SELECT t_a, id, ch_a, 'msg-a-1', 'in', 'customer', '{"text":"дубль"}'::jsonb
      FROM conversations WHERE tenant_id = t_a
    ON CONFLICT (tenant_id, channel_id, external_id) WHERE external_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'ТЕСТ 8 ПРОВАЛЕН: дубликат сообщения записан';
  END IF;
  RAISE NOTICE 'Тест 8 пройден: повторный вебхук не создаёт дубль';

  -- ─────────────────────────────────────────────────────────────────────
  -- Уборка
  -- ─────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.tenant_id', '', true);
  RAISE NOTICE '';
  RAISE NOTICE '═══ ВСЕ ТЕСТЫ ИЗОЛЯЦИИ ПРОЙДЕНЫ ═══';
END
$$;
