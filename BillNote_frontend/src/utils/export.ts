import JSZip from 'jszip'
import { Transformer } from 'markmap-lib'
import type { Transcript } from '@/store/taskStore'

/* -------------------- 通用 -------------------- */

/** 文件名清洗：替换 Windows 非法字符并截断 */
export const safeFileName = (name: string) =>
  (name || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'untitled'

/** 触发浏览器下载（Tauri webview 下同样可用） */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** task.markdown 兼容旧数据（string）与版本数组（Markdown[]，[0] 为最新），取最新内容 */
export function latestMarkdownOf(markdown: unknown): string {
  if (Array.isArray(markdown)) return markdown[0]?.content || ''
  return typeof markdown === 'string' ? markdown : ''
}

/* -------------------- 原文（转写文本） -------------------- */

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 原文文本：withTimestamp 时每行 `[mm:ss] 文本`，否则纯全文 */
export function buildTranscriptText(
  transcript: Transcript | undefined,
  withTimestamp: boolean
): string {
  if (!transcript?.full_text) return ''
  if (!withTimestamp || !transcript.segments?.length) return transcript.full_text
  return transcript.segments.map(seg => `[${formatTimestamp(seg.start)}] ${seg.text}`).join('\n')
}

/** 单条原文导出为 txt（预览页「导出原文」按钮用） */
export function exportTranscriptTxt(
  transcript: Transcript | undefined,
  title: string,
  withTimestamp = false
) {
  const text = buildTranscriptText(transcript, withTimestamp)
  downloadBlob(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
    `${safeFileName(title)}_原文.txt`
  )
}

/* -------------------- 思维导图（markdown → .xmind） -------------------- */

// markmap-lib 的 Transformer 是无状态纯转换器，独立实例与组件内共享单例等价
const transformer = new Transformer()

function stripMindmapImages(markdown: string) {
  return (markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
}

function decodeHtmlEntities(text: string): string {
  if (!text) return text
  let decoded = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  )
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  const textarea = document.createElement('textarea')
  textarea.innerHTML = decoded
  return textarea.value
}

function stripHtml(html: string): string {
  if (!html) return html
  const text = decodeHtmlEntities(html)
  const div = document.createElement('div')
  div.innerHTML = text
  return div.textContent || div.innerText || text
}

/** markdown → XMind Blob（逻辑与 MarkmapComponent.exportXMind 一致，返回 blob 不触发下载） */
export async function markdownToXMindBlob(markdown: string, title: string): Promise<Blob> {
  const { root } = transformer.transform(stripMindmapImages(markdown))
  const generateId = () => Math.random().toString(36).substring(2, 15)

  const convertToXMindNode = (node: any): any => {
    const rawTitle = node.content || node.payload?.content || '未命名'
    const xmindNode: any = {
      id: generateId(),
      class: 'topic',
      title: stripHtml(rawTitle),
    }
    if (node.children && node.children.length > 0) {
      xmindNode.children = { attached: node.children.map((child: any) => convertToXMindNode(child)) }
    }
    return xmindNode
  }

  const content = [
    {
      id: generateId(),
      class: 'sheet',
      title: stripHtml(title) || '思维导图',
      rootTopic: convertToXMindNode(root),
      topicPositioning: 'fixed',
    },
  ]
  const metadata = { creator: { name: 'BiliNote', version: '1.0.0' } }
  const manifest = { 'file-entries': { 'content.json': {}, 'metadata.json': {} } }

  const zip = new JSZip()
  zip.file('content.json', JSON.stringify(content, null, 2))
  zip.file('metadata.json', JSON.stringify(metadata, null, 2))
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

/* -------------------- 批次打包导出 -------------------- */

export interface BatchExportItem {
  /** 批次内顺序，从 1 起（= 提交/合集顺序，导出文件编号依据） */
  index: number
  taskId: string
  title: string
  markdown: string
  transcript?: Transcript
}

export interface BatchExportOptions {
  markdown: boolean
  transcript: boolean
  xmind: boolean
  /** 合并合集 md（全部笔记按顺序拼成带目录的单文档） */
  merged: boolean
  /** 原文带时间戳 */
  withTimestamp: boolean
}

function buildMergedMarkdown(items: BatchExportItem[], batchName: string): string {
  const toc = items.map(it => `${it.index}. ${it.title}`).join('\n')
  const sections = items
    .map(it => `## ${String(it.index).padStart(2, '0')} ${it.title}\n\n${it.markdown}`)
    .join('\n\n---\n\n')
  return `# ${batchName}\n\n## 目录\n\n${toc}\n\n---\n\n${sections}\n`
}

/** 批次一键导出：勾选类型 × 勾选条目 → 单个 zip Blob */
export async function exportBatchZip(
  items: BatchExportItem[],
  options: BatchExportOptions,
  batchName: string
): Promise<Blob> {
  const zip = new JSZip()
  for (const item of items) {
    const base = `${String(item.index).padStart(2, '0')}_${safeFileName(item.title)}`
    if (options.markdown && item.markdown) zip.file(`${base}.md`, item.markdown)
    if (options.transcript) {
      const text = buildTranscriptText(item.transcript, options.withTimestamp)
      if (text) zip.file(`${base}.txt`, text)
    }
    if (options.xmind && item.markdown) {
      zip.file(`${base}.xmind`, await markdownToXMindBlob(item.markdown, item.title))
    }
  }
  if (options.merged && items.length > 0) {
    zip.file('合集.md', buildMergedMarkdown(items, batchName))
  }
  return zip.generateAsync({ type: 'blob' })
}
