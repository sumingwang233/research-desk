/**
 * 线性图标集
 *
 * 统一 24 视框、stroke 1.75、圆头圆角，与 HanaAgent desktop/src/react/ui 的
 * 图标语言一致：同一套光学重量，跨字符不会漂移。
 * 全部使用 currentColor，尺寸由 size 控制（默认 14，与 fs-caption 视觉重量对齐）。
 *
 * 约定：图标本身不带外边距；需要与文字并排时由父级 gap 控制。
 */

function Icon({ size = 14, strokeWidth = 1.75, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── 发送 / 提交 ── */
export function SubmitIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 19V5" />
      <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
    </Icon>
  );
}

/* ── 插话发送：折返进流的箭头 ── */
export function SteerIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M20 20v-6a4 4 0 0 0-4-4H4" />
    </Icon>
  );
}

/* ── 停止：实心方 ── */
export function StopIcon(props) {
  return (
    <svg width={props.size || 14} height={props.size || 14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    </svg>
  );
}

export function ArrowDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="m5.5 12.5 6.5 6.5 6.5-6.5" />
    </Icon>
  );
}

export function ArrowUpIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 19V5" />
      <path d="m5.5 11.5 6.5-6.5 6.5 6.5" />
    </Icon>
  );
}

/* ── 结构与导航 ── */
export function PlusIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Icon>
  );
}

export function ChevronRightIcon(props) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <Icon {...props}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  );
}

/* ── 状态 ── */
export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  );
}

export function AlertIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 8.5v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </Icon>
  );
}

/* ── 动作 ── */
export function EditIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20h4l10-10a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 6.5 3 3" />
    </Icon>
  );
}

export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

export function ExternalIcon(props) {
  return (
    <Icon {...props}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Icon>
  );
}

export function CopyIcon(props) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1.5" />
    </Icon>
  );
}

/* ── 对象 ── */
export function BookIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20Z" />
    </Icon>
  );
}

export function NoteIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M13 3.5V9h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 17h4.5" />
    </Icon>
  );
}

export function LibraryIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="4" height="16" rx="1" />
      <rect x="10" y="4" width="4" height="16" rx="1" />
      <path d="m17.2 5.2 3.6 14.2" />
    </Icon>
  );
}

export function GearIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 8.5h5" />
      <path d="M15 8.5h5" />
      <circle cx="12" cy="8.5" r="2.5" />
      <path d="M4 15.5h9" />
      <path d="M19 15.5h1" />
      <circle cx="16" cy="15.5" r="2.5" />
    </Icon>
  );
}

export function PanelIcon(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </Icon>
  );
}

export function FolderIcon(props) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8A1.5 1.5 0 0 1 20.5 10v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z" />
    </Icon>
  );
}

export function FileIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h7l5 5V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
      <path d="M13 3.6V9h5" />
    </Icon>
  );
}

export function SaveIcon(props) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h11L19.5 8v11.5h-15Z" />
      <path d="M8.5 4.5v5h6v-5" />
      <path d="M8.5 19.5v-5h7v5" />
    </Icon>
  );
}

export function ComposeIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}
