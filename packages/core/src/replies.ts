/**
 * Папки для шаблонов ответов.
 *
 * Папка — это имя, и больше ничего. Она появляется вместе с первым
 * шаблоном в ней и исчезает вместе с последним. Поэтому здесь нет ни
 * создания, ни удаления папки: есть только приведение имени к виду, в
 * котором две одинаковые на глаз папки не окажутся разными.
 *
 * Это и есть главная опасность имени как ключа: «Доставка» и
 * «доставка », набранные в разное время, дадут две папки, и человек
 * будет искать шаблон в той, где его нет. Регистр мы не трогаем — имя
 * показывается человеку, — но пробелы по краям и внутри сводим, а
 * сравниваем без регистра.
 */

/** Длина имени папки: заголовок группы в узкой колонке настроек. */
export const FOLDER_NAME_MAX = 40;

/** Имя папки в том виде, в каком оно ложится в базу. */
export function replyFolder(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
    .slice(0, FOLDER_NAME_MAX);
}

/** Две папки — одна и та же? Регистр и раскладка пробелов не в счёт. */
export function sameFolder(a: unknown, b: unknown): boolean {
  return replyFolder(a).toLowerCase() === replyFolder(b).toLowerCase();
}

export interface FolderGroup<T> {
  /** Пустая строка — шаблоны вне папок. */
  folder: string;
  items: T[];
}

/**
 * Разложить шаблоны по папкам.
 *
 * Порядок групп: папки по алфавиту, а «без папки» — последней. Не
 * первой: шаблоны вне папок обычно случайные остатки, и держать их
 * наверху значит показывать мусор раньше порядка.
 *
 * Имя группы берётся у первого шаблона с таким именем: если кто-то
 * завёл «Доставка» и «доставка», в списке будет одна папка, а не две
 * почти одинаковые строки подряд.
 */
export function groupByFolder<T extends { folder?: string | null; shortcut: string }>(
  list: T[],
): FolderGroup<T>[] {
  const groups = new Map<string, FolderGroup<T>>();

  for (const item of list) {
    const name = replyFolder(item.folder);
    const key = name.toLowerCase();
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { folder: name, items: [item] });
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.items.sort((a, b) => a.shortcut.localeCompare(b.shortcut, 'uk'));
  }

  return out.sort((a, b) => {
    if (!a.folder) return 1;
    if (!b.folder) return -1;
    return a.folder.localeCompare(b.folder, 'uk');
  });
}

/** Имена папок для выпадающего списка: по алфавиту, без пустой. */
export function folderNames<T extends { folder?: string | null; shortcut: string }>(
  list: T[],
): string[] {
  return groupByFolder(list)
    .map((g) => g.folder)
    .filter(Boolean);
}
