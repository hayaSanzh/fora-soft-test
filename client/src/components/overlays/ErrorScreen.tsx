/**
 * Общая оболочка полноэкранных сообщений (группа 11, TDD §8.1).
 *
 * Требование PRD: пользователь никогда не должен упираться в белый экран. Все
 * терминальные и промежуточные состояния машины §3.3 показывают карточку одного
 * вида: заголовок — что произошло, текст — что делать, действие — как выйти из
 * состояния. Оболочка выделена в отдельный компонент, чтобы формулировки и
 * разметка не расходились между пятью экранами.
 *
 * ★ Здесь намеренно нет `react-router`: `UnsupportedScreen` рендерится в
 * `main.tsx` **до** монтирования `App`, то есть вне контекста роутера (ФТ-36).
 * Ссылка на главную живёт только в `InvalidLinkScreen`.
 */
import type { ReactNode } from 'react';

export interface ErrorScreenProps {
  title: string;
  text: string;
  /** Кнопка или ссылка выхода из состояния; у экрана несовместимости её нет. */
  children?: ReactNode;
}

export function ErrorScreen({ title, text, children }: ErrorScreenProps) {
  return (
    <main className="screen screen--center">
      <div className="card">
        <h1>{title}</h1>
        <p>{text}</p>
        {children}
      </div>
    </main>
  );
}
