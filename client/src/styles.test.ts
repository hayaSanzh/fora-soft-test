/**
 * Стражи вёрстки комнаты.
 *
 * Появились после дефекта приёмки группы 10: при переписывании CSS пропали
 * правила `.tile__media` / `.tile__video` / `.tile__caption`, и разметка
 * осталась «валидной» — все 475 тестов проходили, потому что проверяли только
 * HTML. Видимые последствия были тяжёлыми: плитка росла сама каждые несколько
 * секунд (размер задавал поток, а WebRTC поднимает разрешение ступенями),
 * заглушка-силуэт растягивалась на всю страницу (оверлей без позиционированного
 * родителя считается от начального контейнера), заголовок уезжал за экран.
 *
 * jsdom здесь не помог бы: он не считает раскладку. Поэтому проверяется сам
 * CSS как текст — грубо, зато ловит именно «класс есть в разметке, правила нет».
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * ★ Комментарии вырезаются до любого разбора. Здесь это не косметика: в
 * комментариях классы упоминаются по имени (`.tile__media` описан в комментарии
 * рядом с правилом), и проверка «класс не описан» прошла бы на одном упоминании,
 * то есть пропустила бы ровно тот дефект, ради которого написана.
 */
const css = readFileSync(path.join(srcDir, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Все .tsx компонентов (без тестов). */
function componentFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...componentFiles(full));
    else if (full.endsWith('.tsx') && !full.includes('.test.')) found.push(full);
  }
  return found;
}

/** Классы из `className=` — строкой, шаблоном или литералом в фигурных скобках. */
function usedClasses(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of componentFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3] ?? '';
      for (const name of value.split(/[\s${}?:|]+/).filter(Boolean)) {
        used.set(name, [...(used.get(name) ?? []), path.basename(file)]);
      }
    }
  }
  return used;
}

/** Объявления правила, в списке селекторов которого есть ровно этот селектор. */
function declarations(selector: string): string {
  const blocks: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  return blocks.join('\n');
}

describe('CSS: у каждого класса из разметки есть правило', () => {
  it('★ нет классов, которые используются, но не описаны', () => {
    const missing = [...usedClasses()]
      .filter(([name]) => !new RegExp(`\\.${name}\\b`).test(css))
      .map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`);

    // Именно эта проверка поймала бы регрессию группы 10 целиком.
    expect(missing).toEqual([]);
  });
});

describe('CSS: оверлей автозапуска не перехватывает управление (задача 11.5)', () => {
  it('★ .gate растянут по рамке — значит обязан лежать в позиционированном родителе', () => {
    const gate = declarations('.gate');

    expect(gate).toMatch(/position\s*:\s*absolute/);
    expect(gate).toMatch(/inset\s*:\s*0/);
  });

  it('★ рамкой служит обёртка сетки, а не вся сцена', () => {
    // Оверлей с `inset: 0` перехватывает клики: накрой он `.room__stage`,
    // подсказка про звук заблокировала бы «Выйти» и тумблеры устройств.
    expect(declarations('.stage__video')).toMatch(/position\s*:\s*relative/);
    expect(declarations('.room__stage')).not.toMatch(/position\s*:\s*relative/);
  });

  it('★ в разметке кнопки управления лежат ВНЕ обёртки с оверлеем', () => {
    const source = readFileSync(path.join(srcDir, 'components/RoomPage.tsx'), 'utf8');
    const gate = source.indexOf('<UnmuteAudioGate');
    const wrapperEnd = source.indexOf('</div>', gate);
    const controls = source.indexOf('<Controls');

    expect(gate).toBeGreaterThan(0);
    expect(controls).toBeGreaterThan(wrapperEnd);
  });
});

describe('CSS: плитка участника (ФТ-11, ФТ-18, риск R5)', () => {
  it('★ размер плитки задаёт контейнер, а не поток: aspect-ratio на .tile__media', () => {
    // Без этого высоту диктует собственный размер <video>, и плитка растёт
    // сама по себе, пока WebRTC поднимает разрешение.
    expect(declarations('.tile__media')).toMatch(/aspect-ratio\s*:/);
  });

  it('★ .tile__media позиционирован — иначе оверлеи считаются от всей страницы', () => {
    expect(declarations('.tile__media')).toMatch(/position\s*:\s*relative/);
  });

  it('★ .tile__video выведен из потока раскладки и заполняет контейнер', () => {
    const video = declarations('.tile__video');

    expect(video).toMatch(/position\s*:\s*absolute/);
    expect(video).toMatch(/inset\s*:\s*0/);
    expect(video).toMatch(/object-fit\s*:/);
  });

  it('★ .tile__media обрезает содержимое — иначе подпиксельная полоска (группа 9)', () => {
    expect(declarations('.tile__media')).toMatch(/overflow\s*:\s*hidden/);
  });

  it('★ оверлеи растягиваются на контейнер: absolute + inset', () => {
    for (const selector of ['.tile__placeholder']) {
      const rule = declarations(selector);

      expect(rule).toMatch(/position\s*:\s*absolute/);
      expect(rule).toMatch(/inset\s*:\s*0/);
    }
  });

  it('★ высота плитки ограничена экраном — заголовок и кнопки не уезжают', () => {
    // Аспект даёт высоту от ширины; предел от экрана нужен, чтобы сетка 2×2
    // и одиночная плитка не выталкивали управление за пределы окна.
    expect(css).toMatch(/\.grid--quad\s+\.tile__media\s*\{[^}]*max-height/);
    expect(css).toMatch(/\.grid--(single|pair)[^{]*\.tile__media\s*\{[^}]*max-height/);
  });

  it('подпись плитки не пустая по стилю и переносит длинное имя', () => {
    expect(declarations('.tile__caption')).toMatch(/overflow-wrap\s*:/);
  });
});
