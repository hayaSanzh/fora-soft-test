/**
 * Передача имени со стартового экрана в комнату (задача IP 5.3, ФТ-28).
 *
 * Почему не `location.state` react-router: состояние навигации сериализуется в
 * запись истории браузера и **переживает перезагрузку страницы**. С ним F5 на
 * `/:roomId` не спрашивал бы имя заново, а ФТ-28 требует ровно обратного —
 * «перезагрузка считается новым входом (с повторным вводом имени)».
 *
 * Почему не `sessionStorage`: PRD §5 запрещает любое сохранение состояния на
 * клиенте; на обращения к web storage стоит ESLint-страж (задача 1.2).
 *
 * Отсюда единственный вариант: **обычная переменная в памяти модуля.** Она
 * живёт ровно до перезагрузки — то есть точно столько, сколько нужно.
 */

interface PendingJoin {
  roomId: string;
  name: string;
}

let pending: PendingJoin | null = null;

/** Запоминает имя перед переходом на URL комнаты. */
export function setPendingJoin(roomId: string, name: string): void {
  pending = { roomId, name };
}

/**
 * Читает имя для указанной комнаты, **не потребляя** его.
 *
 * Чтение специально идемпотентно: в React StrictMode рендер и инициализатор
 * `useReducer` вызываются дважды, и «прочитал — стёр» потеряло бы имя на втором
 * вызове.
 */
export function readPendingJoin(roomId: string): string | null {
  return pending !== null && pending.roomId === roomId ? pending.name : null;
}

/** Забывает имя: пользователь вернулся к вводу или вышел из комнаты. */
export function clearPendingJoin(): void {
  pending = null;
}
