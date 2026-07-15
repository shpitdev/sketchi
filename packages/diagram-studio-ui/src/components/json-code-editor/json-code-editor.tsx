import { json } from "@codemirror/lang-json";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { useHotkey } from "@tanstack/react-hotkeys";
import CodeMirror from "@uiw/react-codemirror";
import type {
  ReactCodeMirrorProps,
  ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import type { CSSProperties } from "react";
import { useCallback, useMemo, useRef } from "react";

export interface JsonCodeEditorProps {
  id?: string;
  label: string;
  maxHeight?: string;
  minHeight?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  value: string;
}

export function JsonCodeEditor({
  id,
  label,
  maxHeight = "min(560px, 62vh)",
  minHeight = "220px",
  onChange,
  readOnly = false,
  value,
}: JsonCodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const shellRef = useRef<HTMLElement>(null);
  const openSearch = useCallback(() => {
    const view = editorRef.current?.view;

    if (!view) {
      return;
    }

    openSearchPanel(view);
    view.focus();
  }, []);

  useHotkey("Mod+F", openSearch, {
    preventDefault: true,
    target: shellRef,
  });

  const extensions = useMemo(
    () => [
      json(),
      search({ top: true }),
      keymap.of(searchKeymap),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          backgroundColor: "#ffffff",
          color: "#111827",
          display: "grid",
          fontSize: "12px",
          gridTemplateRows: "auto minmax(0, 1fr)",
          maxHeight,
          overflow: "hidden",
        },
        ".cm-content": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          lineHeight: "1.45",
          minHeight,
          padding: "10px",
        },
        ".cm-gutters": {
          backgroundColor: "#f8fafc",
          borderRight: "1px solid #dbe3ef",
          color: "#64748b",
        },
        ".cm-scroller": {
          maxHeight,
        },
        "&.cm-focused": {
          outline: "2px solid #0f766e",
          outlineOffset: "-2px",
        },
      }),
    ],
    [maxHeight, minHeight],
  );
  const editableProps: Pick<ReactCodeMirrorProps, "editable" | "readOnly"> = {
    editable: !readOnly,
    readOnly,
  };
  const editorSizeStyle = {
    "--sketchi-json-editor-max-height": maxHeight,
    "--sketchi-json-editor-min-height": minHeight,
  } as CSSProperties;

  return (
    <section
      className="sketchi-json-code-editor"
      ref={shellRef}
      style={editorSizeStyle}
    >
      <div className="sketchi-json-code-editor__header">
        <label {...(id ? { htmlFor: id } : {})}>{label}</label>
        <button
          aria-label={`Search ${label}`}
          onClick={openSearch}
          title="Search JSON (Ctrl/Cmd+F)"
          type="button"
        >
          Search
        </button>
      </div>
      <CodeMirror
        {...editableProps}
        {...(onChange ? { onChange } : {})}
        aria-label={label}
        basicSetup={{
          autocompletion: false,
          bracketMatching: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          lineNumbers: true,
        }}
        className="sketchi-json-code-editor__editor"
        extensions={extensions}
        id={id}
        ref={editorRef}
        value={value}
      />
    </section>
  );
}
