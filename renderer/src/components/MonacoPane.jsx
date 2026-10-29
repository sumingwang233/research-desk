import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.main.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

/**
 * Monaco 单文件编辑器
 *
 * 这个模块是懒加载的：主界面不该为编辑器付 2 MB 的首屏代价，
 * 只有进到工作区并且真的打开文本文件时才下载并实例化。
 *
 * 主题按纸本暖色重写，默认的 vs 深色侧栏放在这个界面里会很突兀。
 */
let prepared = false;
function prepare() {
  if (prepared) return;
  prepared = true;
  self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
  monaco.editor.defineTheme('yanxu', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a8073', fontStyle: 'italic' },
      { token: 'keyword', foreground: '9a5b4a' },
      { token: 'string', foreground: '4f7a58' },
      { token: 'number', foreground: '8a6a2f' },
      { token: 'type', foreground: '3f6b8a' },
      { token: 'tag', foreground: '9a5b4a' }
    ],
    colors: {
      'editor.background': '#fbf7ee',
      'editor.foreground': '#2a2622',
      'editorLineNumber.foreground': '#b8ab97',
      'editorLineNumber.activeForeground': '#6b6158',
      'editor.selectionBackground': '#e4d9c3',
      'editor.inactiveSelectionBackground': '#efe6d4',
      'editor.lineHighlightBackground': '#f7f1e4',
      'editorCursor.foreground': '#537d96',
      'editorIndentGuide.background1': '#e6dcc9',
      'editorIndentGuide.activeBackground1': '#d3c6ae',
      'editorWidget.background': '#fbf7ee',
      'editorWidget.border': '#d8cfbe',
      'editorSuggestWidget.selectedBackground': '#efe4d0',
      'scrollbarSlider.background': '#d8cfbe88',
      'scrollbarSlider.hoverBackground': '#c9bda6aa'
    }
  });
}

export default function MonacoPane({ path, language, value, onChange, onSave }) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    prepare();
    const editor = monaco.editor.create(hostRef.current, {
      value,
      language,
      theme: 'yanxu',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      fontSize: 13,
      lineHeight: 22,
      fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
      fontLigatures: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 14, bottom: 24 },
      tabSize: 2,
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 }
    });
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => onChange?.(editor.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current?.(editor.getValue()));
    return () => { subscription.dispose(); editor.dispose(); editorRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 换文件复用同一个编辑器实例：重建会丢掉滚动位置与撤销栈的开销 */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
    if (model) monaco.editor.setModelLanguage(model, language);
    editor.setScrollTop(0);
    editor.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <div className="monaco-host" ref={hostRef} />;
}
