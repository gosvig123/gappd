import { Fragment, type ReactNode } from 'react'

type Block =
  | { kind: 'heading'; depth: number; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; indent: number; checked?: boolean }> }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'paragraph'; text: string }

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/
const BULLET_PATTERN = /^(\s*)[*+-]\s+(.*)$/
const ORDERED_PATTERN = /^(\s*)\d+[.)]\s+(.*)$/
const QUOTE_PATTERN = /^>\s?(.*)$/
const RULE_PATTERN = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const CHECKBOX_PATTERN = /^\[([ xX])\]\s+(.*)$/

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
      paragraph = []
    }
  }

  for (const line of source.split('\n')) {
    const heading = HEADING_PATTERN.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', depth: heading[1].length, text: heading[2] })
      continue
    }
    if (RULE_PATTERN.test(line)) {
      flushParagraph()
      blocks.push({ kind: 'rule' })
      continue
    }
    const quote = QUOTE_PATTERN.exec(line)
    if (quote) {
      flushParagraph()
      const previous = blocks[blocks.length - 1]
      if (previous?.kind === 'quote') previous.text += `\n${quote[1]}`
      else blocks.push({ kind: 'quote', text: quote[1] })
      continue
    }
    const bullet = BULLET_PATTERN.exec(line) ?? ORDERED_PATTERN.exec(line)
    if (bullet) {
      flushParagraph()
      const ordered = !BULLET_PATTERN.test(line)
      const checkbox = CHECKBOX_PATTERN.exec(bullet[2])
      const item = { text: checkbox?.[2] ?? bullet[2], indent: bullet[1].length >= 2 ? 1 : 0, checked: checkbox ? checkbox[1].toLowerCase() === 'x' : undefined }
      const previous = blocks[blocks.length - 1]
      if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(item)
      else blocks.push({ kind: 'list', ordered, items: [item] })
      continue
    }
    if (line.trim() === '') flushParagraph()
    else paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>))
}

function renderListItem(item: { text: string; indent: number; checked?: boolean }, index: number): ReactNode {
  const className = [item.indent > 0 ? 'nested' : '', item.checked !== undefined ? 'checklist-item' : '', item.checked ? 'checked' : ''].filter(Boolean).join(' ') || undefined
  if (item.checked === undefined) return <li key={index} className={className}>{renderInline(item.text)}</li>
  return <li key={index} className={className}><span className="markdown-checkbox" aria-hidden="true">{item.checked ? '✓' : ''}</span><span>{renderInline(item.text)}</span></li>
}

export function Markdown({ value }: { value: string }) {
  return (
    <div className="markdown">
      {parseBlocks(value).map((block, index) => {
        if (block.kind === 'heading') {
          return block.depth <= 2
            ? <h3 key={index}>{renderInline(block.text)}</h3>
            : <h4 key={index}>{renderInline(block.text)}</h4>
        }
        if (block.kind === 'rule') return <hr key={index} className="markdown-rule" />
        if (block.kind === 'quote') return <blockquote key={index}>{renderInline(block.text)}</blockquote>
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={index}>
              {block.items.map(renderListItem)}
            </List>
          )
        }
        return <p key={index}>{renderInline(block.text)}</p>
      })}
    </div>
  )
}
