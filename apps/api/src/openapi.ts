import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Описание API и страница с ним.
 *
 * Описание написано руками, а не собрано из кода. Причина простая:
 * генератор описывает то, что есть, — включая внутренние ручки, которые
 * никому снаружи не нужны, и без единого слова о том, зачем они. Здесь
 * же документируется то, чем действительно пользуются снаружи: вход,
 * диалоги, сообщения, каналы, шаблоны, сценарии и приём обновлений от
 * своего бота.
 *
 * Плата за ручное описание — оно может отстать от кода. Поэтому в тестах
 * есть проверка: каждый описанный адрес обязан существовать в приложении.
 *
 * Страница со Swagger берёт скрипт с cdnjs — он в списке разрешённых.
 */

const NL = String.fromCharCode(10);

const BEARER = [{ bearerAuth: [] }];

const ERR = {
  description: 'Ошибка. Код в поле error, при наличии — пояснение в detail.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: { error: { type: 'string' }, detail: { type: 'string' } },
      },
    },
  },
};

const json = (schema: unknown, description = 'Успешный ответ') => ({
  description,
  content: { 'application/json': { schema } },
});

export function buildOpenApi(appUrl: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Rozmovio API',
      version: '1.0.0',
      description: [
        'API сервиса Rozmovio: одна скринька для Telegram, Instagram Direct и Facebook Messenger.',
        '',
        'Авторизация — токен в заголовке `Authorization: Bearer <token>`.',
        'Токен выдаётся по коду на почту: `POST /auth/request`, затем `POST /auth/verify`.',
        'Он живёт семь дней и привязан к одной организации.',
        '',
        'Все данные разделены по организациям на уровне базы: запрос с чужим токеном',
        'не вернёт чужую переписку, даже если известен идентификатор диалога.',
      ].join(NL),
      contact: { name: 'KL Systems', email: 'support@rozmovio.com' },
    },
    servers: [{ url: appUrl || 'https://app.rozmovio.com' }],
    tags: [
      { name: 'Вход', description: 'Получение токена по коду на почту' },
      { name: 'Диалоги', description: 'Список, карточка клиента, статусы' },
      { name: 'Сообщения', description: 'Чтение ленты, отправка, реакции' },
      { name: 'Каналы', description: 'Подключение и состояние каналов' },
      { name: 'Шаблоны', description: 'Заготовки ответов и файлы к ним' },
      { name: 'Сценарии', description: 'Цепочки автоматических шагов' },
      { name: 'Свой бот', description: 'Приём обновлений от самописного бота' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['open', 'closed'] },
            display_name: { type: 'string', nullable: true },
            phone_e164: { type: 'string', nullable: true },
            channel_type: {
              type: 'string',
              enum: ['telegram_bot', 'telegram_user', 'instagram', 'messenger'],
            },
            channel_name: { type: 'string', nullable: true },
            unread_count: { type: 'integer' },
            last_message_at: { type: 'string', format: 'date-time', nullable: true },
            window_expires_at: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'До этого момента можно писать свободным текстом.',
            },
            preview: { type: 'string', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            direction: { type: 'string', enum: ['in', 'out'] },
            sender_type: { type: 'string', enum: ['contact', 'user', 'bot'] },
            content: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                attachments: { type: 'array', items: { type: 'object' } },
              },
            },
            status: { type: 'string', enum: ['pending', 'sent', 'delivered', 'read', 'failed'] },
            sent_at: { type: 'string', format: 'date-time' },
            external_id: {
              type: 'string',
              nullable: true,
              description: 'Идентификатор у провайдера. Нужен для ответа и реакции.',
            },
            reactions: { type: 'array', items: { type: 'object' } },
          },
        },
        SendMessage: {
          type: 'object',
          properties: {
            text: { type: 'string', maxLength: 4096 },
            replyToExternalId: {
              type: 'string',
              description: 'Ответ на сообщение: внешний идентификатор цитируемого.',
            },
            attachment: {
              type: 'object',
              description:
                'Либо файл целиком в base64, либо ссылка на файл шаблона — тогда повторной загрузки нет.',
              properties: {
                filename: { type: 'string' },
                mime: { type: 'string' },
                type: { type: 'string', enum: ['image', 'video', 'audio', 'voice', 'document'] },
                dataBase64: { type: 'string' },
                fromQuickReply: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    index: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
        Channel: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            display_name: { type: 'string' },
            status: { type: 'string', enum: ['active', 'degraded', 'disabled'] },
            conversations: { type: 'integer' },
            meta: { type: 'object' },
          },
        },
        Scenario: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            channel_id: { type: 'string', format: 'uuid', nullable: true },
            trigger_type: {
              type: 'string',
              enum: ['welcome', 'keyword', 'exact', 'off_hours', 'fallback'],
            },
            keywords: { type: 'array', items: { type: 'string' } },
            steps: {
              type: 'array',
              description:
                'Шаги по порядку. Вид шага в поле kind: message, ask, delay, condition, tag, handoff, close.',
              items: { type: 'object' },
            },
            is_active: { type: 'boolean' },
            runs_started: { type: 'integer' },
            runs_finished: { type: 'integer' },
          },
        },
      },
    },
    paths: {
      '/auth/request': {
        post: {
          tags: ['Вход'],
          summary: 'Запросить код на почту',
          description:
            'Ответ одинаков для существующей и несуществующей почты — иначе по форме входа ' +
            'перебором выясняется, кто работает в компании. Если передать company, ' +
            'для незнакомой почты код заведёт новую организацию.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    company: { type: 'string', description: 'Название новой компании при регистрации' },
                  },
                },
              },
            },
          },
          responses: {
            200: json({
              type: 'object',
              properties: { sent: { type: 'boolean' }, ttlMinutes: { type: 'integer' } },
            }),
            429: ERR,
          },
        },
      },
      '/auth/verify': {
        post: {
          tags: ['Вход'],
          summary: 'Обменять код на токен',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'code'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    code: { type: 'string', pattern: '^[0-9]{6}$' },
                    tenantId: {
                      type: 'string',
                      description: 'Когда почта заведена в нескольких организациях.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: json({
              type: 'object',
              properties: {
                token: { type: 'string' },
                tenant: { type: 'string' },
                created: { type: 'boolean', description: 'Организация создана этим запросом.' },
              },
            }),
            300: json(
              {
                type: 'object',
                properties: { needsWorkspace: { type: 'array', items: { type: 'object' } } },
              },
              'Почта заведена в нескольких организациях: нужно выбрать.',
            ),
            401: ERR,
          },
        },
      },
      '/me': {
        get: {
          tags: ['Вход'],
          summary: 'Кто я',
          security: BEARER,
          responses: { 200: json({ type: 'object' }), 401: ERR },
        },
      },
      '/conversations': {
        get: {
          tags: ['Диалоги'],
          summary: 'Список диалогов',
          security: BEARER,
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
            },
            {
              name: 'assignee',
              in: 'query',
              schema: { type: 'string', enum: ['all', 'me', 'none'], default: 'all' },
            },
            { name: 'channelId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Поиск по имени и номеру' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 60, maximum: 200 } },
          ],
          responses: {
            200: json({
              type: 'object',
              properties: {
                conversations: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } },
              },
            }),
            401: ERR,
          },
        },
      },
      '/conversations/counts': {
        get: {
          tags: ['Диалоги'],
          summary: 'Счётчики по вкладкам',
          security: BEARER,
          responses: { 200: json({ type: 'object' }), 401: ERR },
        },
      },
      '/conversations/{id}': {
        patch: {
          tags: ['Диалоги'],
          summary: 'Изменить диалог: статус, ответственный, метки, бот',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['open', 'resolved'] },
                    assigneeId: { type: 'string', nullable: true },
                    addTag: { type: 'string' },
                    removeTag: { type: 'string' },
                    botEnabled: { type: 'boolean' },
                    read: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { 200: json({ type: 'object' }), 401: ERR, 404: ERR },
        },
      },
      '/conversations/{id}/card': {
        get: {
          tags: ['Диалоги'],
          summary: 'Карточка клиента: контакт, каналы, заметки, ссылка на CRM',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: json({ type: 'object' }), 401: ERR, 404: ERR },
        },
      },
      '/conversations/{id}/messages': {
        get: {
          tags: ['Сообщения'],
          summary: 'Лента переписки',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: json({
              type: 'object',
              properties: { messages: { type: 'array', items: { $ref: '#/components/schemas/Message' } } },
            }),
            401: ERR,
          },
        },
        post: {
          tags: ['Сообщения'],
          summary: 'Отправить сообщение',
          description:
            'Сообщение сохраняется сразу со статусом pending и уходит очередью. ' +
            'Если окно ответа канала закрыто, вернётся 409 с причиной.',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessage' } } },
          },
          responses: {
            201: json({ type: 'object', properties: { id: { type: 'string' } } }, 'Поставлено в очередь'),
            409: ERR,
            413: ERR,
          },
        },
      },
      '/messages/{id}/reactions': {
        post: {
          tags: ['Сообщения'],
          summary: 'Поставить или снять реакцию',
          description: 'Пустой emoji снимает реакцию. Работает для сообщений, уже дошедших до провайдера.',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { emoji: { type: 'string', nullable: true } } },
              },
            },
          },
          responses: { 202: json({ type: 'object' }, 'Поставлено в очередь'), 409: ERR },
        },
      },
      '/channels': {
        get: {
          tags: ['Каналы'],
          summary: 'Подключённые каналы',
          security: BEARER,
          responses: {
            200: json({
              type: 'object',
              properties: { channels: { type: 'array', items: { $ref: '#/components/schemas/Channel' } } },
            }),
            401: ERR,
          },
        },
      },
      '/settings/channels/telegram': {
        post: {
          tags: ['Каналы', 'Свой бот'],
          summary: 'Подключить Telegram-бота',
          description:
            'По умолчанию сервис ставит боту вебхук на себя. Для самописного бота ' +
            'передайте mode=forward: вебхук останется вашим, а в ответе придут адрес и ' +
            'секрет, на которые ваш код должен присылать копию обновлений.',
          security: BEARER,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['botToken'],
                  properties: {
                    botToken: { type: 'string', example: '123456789:AAF...' },
                    displayName: { type: 'string' },
                    mode: { type: 'string', enum: ['forward'] },
                  },
                },
              },
            },
          },
          responses: {
            201: json({
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                username: { type: 'string' },
                mode: { type: 'string', enum: ['webhook', 'polling', 'forward'] },
                forward: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    header: { type: 'string' },
                    secret: { type: 'string' },
                  },
                },
              },
            }),
            400: ERR,
            409: ERR,
          },
        },
      },
      '/webhooks/telegram/{channelId}': {
        post: {
          tags: ['Свой бот'],
          summary: 'Приём обновления от вашего бота',
          description: [
            'Адрес живёт на сервисе приёма (ingress), а не на этом.',
            'Присылайте телом ровно то, что пришло вам от Telegram, с заголовком',
            '`X-Telegram-Bot-Api-Secret-Token`, значение которого выдано при подключении.',
            'Повторы по update_id отбрасываются, так что ретраи безопасны.',
          ].join(' '),
          parameters: [
            { name: 'channelId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            {
              name: 'X-Telegram-Bot-Api-Secret-Token',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', description: 'Update от Telegram' } } },
          },
          responses: { 200: json({ type: 'object' }, 'Принято'), 401: ERR },
        },
      },
      '/quick-replies': {
        get: {
          tags: ['Шаблоны'],
          summary: 'Шаблоны ответов',
          security: BEARER,
          responses: { 200: json({ type: 'object' }), 401: ERR },
        },
        post: {
          tags: ['Шаблоны'],
          summary: 'Создать или обновить шаблон',
          security: BEARER,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['shortcut', 'body'],
                  properties: {
                    shortcut: { type: 'string', maxLength: 32 },
                    body: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: json({ type: 'object' }), 400: ERR },
        },
      },
      '/quick-replies/{id}/attachment': {
        post: {
          tags: ['Шаблоны'],
          summary: 'Приложить файл к шаблону',
          description: 'До трёх файлов на шаблон. При отправке уходит ссылка на этот файл, а не копия.',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['dataBase64'],
                  properties: {
                    filename: { type: 'string' },
                    mime: { type: 'string' },
                    dataBase64: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: json({ type: 'object' }), 409: ERR, 413: ERR },
        },
      },
      '/scenarios': {
        get: {
          tags: ['Сценарии'],
          summary: 'Список сценариев',
          security: BEARER,
          responses: {
            200: json({
              type: 'object',
              properties: { scenarios: { type: 'array', items: { $ref: '#/components/schemas/Scenario' } } },
            }),
            401: ERR,
          },
        },
        post: {
          tags: ['Сценарии'],
          summary: 'Создать сценарий',
          security: BEARER,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Scenario' } } },
          },
          responses: { 201: json({ type: 'object' }), 400: ERR },
        },
      },
      '/scenarios/{id}': {
        put: {
          tags: ['Сценарии'],
          summary: 'Заменить сценарий целиком',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Scenario' } } },
          },
          responses: { 200: json({ type: 'object' }), 400: ERR, 404: ERR },
        },
        patch: {
          tags: ['Сценарии'],
          summary: 'Включить или выключить сценарий',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { isActive: { type: 'boolean' } } },
              },
            },
          },
          responses: { 200: json({ type: 'object' }), 404: ERR },
        },
        delete: {
          tags: ['Сценарии'],
          summary: 'Удалить сценарий',
          security: BEARER,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: json({ type: 'object' }), 404: ERR },
        },
      },
      '/leads': {
        post: {
          tags: ['Вход'],
          summary: 'Заявка с промо-страницы',
          description: 'Публичный адрес без авторизации. Одна заявка с почты в час.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    name: { type: 'string' },
                    company: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    phone: { type: 'string' },
                    channels: { type: 'string' },
                    note: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: json({ type: 'object' }), 400: ERR, 429: ERR },
        },
      },
    },
  };
}

const DOCS_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rozmovio API</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css">
<style>
  body{margin:0;background:#fff}
  .topbar{display:none}
  .swagger-ui .info{margin:24px 0}
</style>
</head>
<body>
<div id="ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#ui',
  deepLinking: true,
  displayRequestDuration: true,
  tryItOutEnabled: true,
  persistAuthorization: true
});
</script>
</body>
</html>`;

export function registerDocs(app: FastifyInstance, appUrl: string): void {
  const spec = buildOpenApi(appUrl);

  app.get('/openapi.json', async (_req, reply: FastifyReply) =>
    reply.header('cache-control', 'public, max-age=300').send(spec),
  );

  app.get('/docs', async (_req, reply: FastifyReply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(DOCS_HTML),
  );
}
