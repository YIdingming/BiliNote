import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import JSZip from 'jszip'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileWarning,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { generateNotesBatch } from '@/services/note.ts'
import { useModelStore } from '@/store/modelStore'
import { useTaskStore } from '@/store/taskStore'
import { noteFormats, noteStyles } from '@/constant/note.ts'

/** 用户粘贴的链接常缺协议头，无 scheme 时自动补 https://（与 NoteForm 同款逻辑） */
const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`)

const detectPlatform = (url: string): string | null => {
  const u = url.toLowerCase()
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.includes('douyin')) return 'douyin'
  if (u.includes('kuaishou')) return 'kuaishou'
  return null
}

const PLATFORM_LABEL: Record<string, string> = {
  bilibili: '哔哩哔哩',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: '排队中', className: 'text-neutral-500 bg-neutral-100' },
  PARSING: { label: '解析中', className: 'text-blue-600 bg-blue-50' },
  DOWNLOADING: { label: '下载中', className: 'text-blue-600 bg-blue-50' },
  TRANSCRIBING: { label: '转写中', className: 'text-blue-600 bg-blue-50' },
  SUMMARIZING: { label: '总结中', className: 'text-blue-600 bg-blue-50' },
  SAVING: { label: '保存中', className: 'text-blue-600 bg-blue-50' },
  SUCCESS: { label: '完成', className: 'text-green-600 bg-green-50' },
  FAILED: { label: '失败', className: 'text-red-600 bg-red-50' },
}

interface ParsedEntry {
  url: string
  platform: string | null
}

interface BatchEntry {
  task_id: string
  video_url: string
  platform: string
}

/** 文件名里替换 Windows 非法字符并截断 */
const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'untitled'

const latestMarkdown = (markdown: unknown): string => {
  if (Array.isArray(markdown)) return markdown[0]?.content || ''
  return typeof markdown === 'string' ? markdown : ''
}

const BatchPage = () => {
  const [rawInput, setRawInput] = useState('')
  const [modelName, setModelName] = useState('')
  const [style, setStyle] = useState<string>(noteStyles[0].value)
  const [formats, setFormats] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [batch, setBatch] = useState<BatchEntry[]>([])
  const [zipping, setZipping] = useState(false)

  const { loadEnabledModels, modelList } = useModelStore()
  const { addPendingTask, tasks } = useTaskStore()

  useEffect(() => {
    loadEnabledModels()
  }, [])

  useEffect(() => {
    if (!modelName && modelList.length > 0) setModelName(modelList[0].model_name)
  }, [modelList])

  const entries = useMemo<ParsedEntry[]>(() => {
    const seen = new Set<string>()
    return rawInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        if (!line || seen.has(line)) return false
        seen.add(line)
        return true
      })
      .map(line => ({ url: withScheme(line), platform: detectPlatform(line) }))
  }, [rawInput])

  const validEntries = entries.filter(e => e.platform !== null) as Array<{ url: string; platform: string }>
  const invalidCount = entries.length - validEntries.length

  const batchTasks = batch.map(b => ({
    ...b,
    task: tasks.find(t => t.id === b.task_id),
  }))
  const successCount = batchTasks.filter(x => x.task?.status === 'SUCCESS').length
  const doneCount = batchTasks.filter(x => ['SUCCESS', 'FAILED'].includes(x.task?.status || '')).length

  const handleGenerate = async () => {
    if (!validEntries.length || !modelName) return
    setSubmitting(true)
    try {
      const results = await generateNotesBatch({
        items: validEntries.map(e => ({ video_url: e.url, platform: e.platform })),
        quality: 'medium',
        model_name: modelName,
        provider_id: modelList.find(m => m.model_name === modelName)!.provider_id,
        format: formats,
        style,
      })
      const ok = results.filter(r => r.task_id)
      ok.forEach(r => {
        addPendingTask(r.task_id, r.platform, {
          video_url: r.video_url,
          platform: r.platform,
          quality: 'medium',
          model_name: modelName,
          provider_id: modelList.find(m => m.model_name === modelName)!.provider_id,
          link: false,
          screenshot: false,
        })
      })
      setBatch(prev => [
        ...prev,
        ...ok.map(r => ({ task_id: r.task_id, video_url: r.video_url, platform: r.platform })),
      ])
      const failed = results.length - ok.length
      toast.success(`已提交 ${ok.length} 条任务${failed ? `，${failed} 条链接无效被跳过` : ''}`)
    } catch (e) {
      // request 拦截器已弹过错误 toast（含转写模型未就绪提示）
      console.error('批量提交失败：', e)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDownloadZip = async () => {
    const done = batchTasks.filter(x => x.task?.status === 'SUCCESS')
    if (!done.length) return
    setZipping(true)
    try {
      const zip = new JSZip()
      done.forEach((x, i) => {
        const title = x.task?.audioMeta?.title || x.video_url
        zip.file(`${String(i + 1).padStart(2, '0')}_${safeFileName(title)}.md`, latestMarkdown(x.task?.markdown))
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `BiliNote_批量笔记_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-50">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-6">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>
        <h1 className="text-lg font-bold text-gray-800">批量笔记</h1>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-6">
          {/* 输入区 */}
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium text-gray-700">视频链接清单</h2>
              <span className="text-xs text-neutral-400">
                每行一个链接，自动识别平台（B站 / YouTube / 抖音 / 快手）
              </span>
            </div>
            <Textarea
              rows={8}
              placeholder={'https://www.bilibili.com/video/BVxxxx\nhttps://www.bilibili.com/video/BVyyyy'}
              value={rawInput}
              onChange={e => setRawInput(e.target.value)}
              className="resize-y font-mono text-sm"
            />
            {invalidCount > 0 && (
              <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
                <FileWarning className="h-3.5 w-3.5" />
                有 {invalidCount} 条链接无法识别平台，提交时将被跳过
              </p>
            )}
          </section>

          {/* 配置区 */}
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="mb-3 font-medium text-gray-700">生成配置</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm text-neutral-600">生成模型</label>
                <Select value={modelName} onValueChange={setModelName}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={modelList.length ? '选择模型' : '请先在设置中添加模型'} />
                  </SelectTrigger>
                  <SelectContent>
                    {modelList.map(m => (
                      <SelectItem key={m.model_name} value={m.model_name}>
                        {m.model_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-neutral-600">笔记风格</label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {noteStyles.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-sm text-neutral-600">附加内容</label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {noteFormats.map(f => (
                  <label key={f.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formats.includes(f.value)}
                      onCheckedChange={checked =>
                        setFormats(
                          checked ? [...formats, f.value] : formats.filter(x => x !== f.value),
                        )
                      }
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          {/* 提交 */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleGenerate}
              disabled={submitting || !validEntries.length || !modelName || modelList.length === 0}
            >
              {submitting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              开始生成（{validEntries.length} 条）
            </Button>
            {batch.length > 0 && (
              <Button
                variant="outline"
                onClick={handleDownloadZip}
                disabled={zipping || successCount === 0}
              >
                {zipping ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                打包下载 Markdown（{successCount} 条）
              </Button>
            )}
          </div>

          {/* 进度区 */}
          {batch.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-medium text-gray-700">任务进度</h2>
                <span className="text-xs text-neutral-400">
                  {doneCount}/{batch.length} 已结束
                </span>
              </div>
              <ul className="space-y-2">
                {batchTasks.map(x => {
                  const status = x.task?.status || 'PENDING'
                  const meta = STATUS_META[status] || STATUS_META.PENDING
                  const title = x.task?.audioMeta?.title
                  return (
                    <li
                      key={x.task_id}
                      className="flex items-center gap-3 rounded-lg border border-neutral-100 px-3 py-2 text-sm"
                    >
                      {status === 'SUCCESS' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      ) : status === 'FAILED' ? (
                        <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
                      )}
                      <span className="min-w-0 flex-1 truncate" title={x.video_url}>
                        {title || x.video_url}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">
                        {PLATFORM_LABEL[x.platform] || x.platform}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${meta.className}`}>
                        {meta.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default BatchPage
