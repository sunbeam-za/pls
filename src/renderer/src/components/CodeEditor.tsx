import CodeMirror, { type Extension } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { useMemo } from 'react'

type Language = 'json' | 'html' | 'xml' | 'text'

interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: Language
  readOnly?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
  className?: string
}

function detectLanguage(s: string): Language {
  const t = s.trim()
  if (!t) return 'text'
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    return 'json'
  }
  if (t.startsWith('<?xml')) return 'xml'
  if (t.startsWith('<')) return 'html'
  return 'text'
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  minHeight = '180px',
  maxHeight,
  className
}: CodeEditorProps): React.JSX.Element {
  const lang = language ?? detectLanguage(value)

  const extensions = useMemo<Extension[]>(() => {
    switch (lang) {
      case 'json':
        return [json()]
      case 'html':
        return [html()]
      case 'xml':
        return [xml()]
      default:
        return []
    }
  }, [lang])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={vscodeDark}
      extensions={extensions}
      readOnly={readOnly}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: !readOnly,
        bracketMatching: true,
        closeBrackets: !readOnly,
        indentOnInput: !readOnly
      }}
      minHeight={minHeight}
      maxHeight={maxHeight}
      className={className}
      style={{
        fontSize: 12.5,
        fontFamily:
          "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
        borderRadius: 8,
        overflow: 'hidden'
      }}
    />
  )
}
