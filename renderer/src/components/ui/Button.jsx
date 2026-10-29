/**
 * 基础按钮
 *
 * 参照 HanaAgent desktop/src/react/ui/Button.tsx 的语义分级：
 * variant = primary | secondary | ghost | danger，size = sm | md | lg。
 * 类名同时输出 variant 名（primary / secondary），
 * 因为既有测试脚本按 `.primary`、`.secondary` 选择元素。
 */

const SIZE_CLASS = { sm: 'btn-sm', md: '', lg: 'btn-lg' };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    variant === 'primary' || variant === 'secondary' ? variant : '',
    SIZE_CLASS[size] || '',
    className
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} disabled={rest.disabled || loading} {...rest}>
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
