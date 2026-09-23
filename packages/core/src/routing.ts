/**
 * Кому достаётся новый диалог.
 *
 * Видеть канал и отвечать в нём — разные вещи. Когда операторов больше
 * одного, диалог без ответственного висит ничьим: каждый думает, что
 * его возьмёт другой. Дольше всех ждёт клиент.
 *
 * Правил намеренно три, а не «конструктор условий». Сложные схемы
 * распределения — расписания, навыки, нагрузка — начинают требовать
 * настройки раньше, чем приносят пользу, и первым делом их выключают.
 */

export type RoutingMode = 'none' | 'round_robin' | 'user';

export interface Routing {
  mode: RoutingMode;
  /** Кому назначать при mode: user. */
  userId: string | null;
  /** Кто получил прошлый диалог: с него продолжается круг. */
  lastUserId: string | null;
}

export const ROUTING_DEFAULT: Routing = { mode: 'none', userId: null, lastUserId: null };

/** Разбор настройки из канала: чужие поля и мусор игнорируются. */
export function parseRouting(raw: unknown): Routing {
  const r = (raw ?? {}) as Record<string, unknown>;
  const mode = r['mode'];
  return {
    mode: mode === 'round_robin' || mode === 'user' ? mode : 'none',
    userId: typeof r['userId'] === 'string' && r['userId'] ? r['userId'] : null,
    lastUserId: typeof r['lastUserId'] === 'string' && r['lastUserId'] ? r['lastUserId'] : null,
  };
}

/**
 * Выбрать ответственного.
 *
 * `candidates` — те, кому канал виден, в устойчивом порядке (по имени):
 * круг обязан быть предсказуемым, иначе «по очереди» превращается в
 * «как повезёт», и это первое, на что жалуются.
 *
 * Возвращается null, когда назначать некому или не нужно, — и тогда
 * диалог остаётся общим, как раньше.
 */
export function pickAssignee(routing: Routing, candidates: string[]): string | null {
  if (routing.mode === 'none' || !candidates.length) return null;

  if (routing.mode === 'user') {
    // Человека могли уволить или лишить доступа к каналу. Назначать на
    // него после этого — значит прятать диалоги у того, кто их не видит.
    return routing.userId && candidates.includes(routing.userId) ? routing.userId : null;
  }

  const last = routing.lastUserId ? candidates.indexOf(routing.lastUserId) : -1;
  return candidates[(last + 1) % candidates.length] ?? null;
}

/** Человеческое название режима: им подписан выбор в настройках. */
export const ROUTING_TITLES: Record<RoutingMode, string> = {
  none: 'Нікому: беруть вручну',
  round_robin: 'По черзі між операторами',
  user: 'Завжди одній людині',
};
