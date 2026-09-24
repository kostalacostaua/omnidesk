-- Миграция 026 — папки шаблонов как самостоятельный список.
--
-- В миграции 025 папка была только именем в поле шаблона. Этого мало:
-- человек раскладывает шаблоны так же, как раскладывает бумаги — сперва
-- заводит папки, потом кладёт в них. Папка, которую нельзя создать
-- пустой и нельзя удалить отдельно, ведёт себя не как папка, а как
-- метка, и объяснить эту разницу человеку нечем.
--
-- Поэтому список папок теперь живёт сам по себе, а поле folder у
-- шаблона остаётся тем, чем было, — указанием, в какой папке он лежит.
--
-- Удаление папки шаблоны не трогает: они выходят из папки, а не
-- исчезают вместе с ней. Внешнего ключа здесь намеренно нет — иначе
-- удаление папки либо утащило бы шаблоны за собой, либо запретило бы
-- удалять непустую, а верно ни то, ни другое.
--
-- Сравнение имён без регистра: «Доставка» и «доставка» — одна папка, и
-- уникальный индекс обязан думать так же, как код.
--
-- Идемпотентна.

BEGIN;

CREATE TABLE IF NOT EXISTS reply_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reply_folders_name_idx
  ON reply_folders (tenant_id, lower(name));

SELECT apply_tenant_rls('reply_folders');

-- Папки, заведённые до этой миграции, существуют только как имена на
-- шаблонах. Переносим их в список, иначе они исчезли бы из настроек
-- ровно в тот момент, когда из папки забрали последний шаблон.
INSERT INTO reply_folders (tenant_id, name)
SELECT DISTINCT ON (tenant_id, lower(folder)) tenant_id, folder
  FROM quick_replies
 WHERE folder <> ''
 ORDER BY tenant_id, lower(folder), folder
ON CONFLICT DO NOTHING;

COMMIT;
