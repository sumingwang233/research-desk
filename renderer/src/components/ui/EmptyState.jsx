/**
 * 空状态
 *
 * HanaAgent 的空态层级：一个轻符号 + 一句解释 + 一个可选动作。
 * 不用大插画，让纸面保持安静，动作始终是唯一的高对比元素。
 */
export function EmptyState({ icon, title, hint, action, tone = 'plain' }) {
  return (
    <div className={`empty-state is-${tone}`}>
      {icon && <span className="empty-state-icon" aria-hidden="true">{icon}</span>}
      {title && <p className="empty-state-title">{title}</p>}
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action}
    </div>
  );
}
