import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  FileWarning,
  Loader2,
  ListOrdered,
  Play,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert.tsx'
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
import { Input } from '@/components/ui/input.tsx'
import { generateNotesBatch, parseCollection } from '@/services/note.ts'
import { useModelStore } from '@/store/modelStore'
import { useTaskStore } from '@/store/taskStore'
import { useBatchStore } from '@/store/batchStore'
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

/** 可被后端展开为多条的链接：B 站合集/收藏夹主页、带分 P 的视频链接 */
const isParsableUrl = (url: string): boolean => {
  const u = url.toLowerCase()
  if (u.includes('space.bilibili.com')) return true
  return /bilibili\.com\/video\/[a-z0-9]+.*[?&]p=\d+/i.test(u)
}

const PLATFORM_LABEL: Record<string, string> = {
  bilibili: '哔哩哔哩',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
}

interface ParsedEntry {
  url: string
  platform: string | null
}

const BatchPage = () => {
  const [rawInput, setRawInput] = useState('')
  const [batchName, setBatchName] = useState('')
  const [modelName, setModelName] = useState('')
  const [style, setStyle] = useState<string>(noteStyles[0].value)
  const [formats, setFormats] = useState<string[]>([])
  const [videoUnderstanding, setVideoUnderstanding] = useState(false)
  const [videoInterval, setVideoInterval] = useState(6)
  const [gridCols, setGridCols] = useState(2)
  const [gridRows, setGridRows] = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [parsing, setParsing] = useState(false)

  const { loadEnabledModels, modelList } = useModelStore()
  const { addPendingTask } = useTaskStore()
  const { addBatch } = useBatchStore()

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

  const handleParseCollection = async () => {
    const targets = validEntries.filter(e => isParsableUrl(e.url))
    if (!targets.length) {
      toast.error('清单里没有可解析的合集/收藏夹/分 P 链接')
      return
    }
    setParsing(true)
    try {
      const expanded: string[] = []
      const keep: string[] = []
      for (const target of targets) {
        const items = await parseCollection({ url: target.url, platform: target.platform })
        expanded.push(...items.map(it => it.url))
      }
      // 展开结果替换被解析的行，其余行保留；追加到清单末尾
      const targetSet = new Set(targets.map(t => t.url))
      for (const line of rawInput.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && targetSet.has(withScheme(trimmed))) continue
        keep.push(line)
      }
      const merged = [...keep.filter(l => l.trim()), ...expanded].join('\n')
      setRawInput(merged)
      toast.success(`已展开 ${expanded.length} 条链接`)
    } catch (e) {
      console.error('解析合集失败：', e)
    } finally {
      setParsing(false)
    }
  }

  const handleGenerate = async () => {
    if (!validEntries.length || !modelName) return
    const provider = modelList.find(m => m.model_name === modelName)
    if (!provider) return
    setSubmitting(true)
    try {
      const results = await generateNotesBatch({
        items: validEntries.map(e => ({ video_url: e.url, platform: e.platform })),
        quality: 'medium',
        model_name: modelName,
        provider_id: provider.provider_id,
        format: formats,
        style,
        screenshot: false,
        link: false,
        video_understanding: videoUnderstanding,
        video_interval: videoUnderstanding ? videoInterval : 0,
        grid_size: videoUnderstanding ? [gridCols, gridRows] : [],
      })
      const ok = results.filter(r => r.task_id)
      const batchId = addBatch(batchName, ok.map(r => r.task_id))
      ok.forEach(r => {
        addPendingTask(
          r.task_id,
          r.platform,
          {
            video_url: r.video_url,
            platform: r.platform,
            quality: 'medium',
            model_name: modelName,
            provider_id: provider.provider_id,
            link: false,
            screenshot: false,
          },
          batchId,
        )
      })
      const failed = results.length - ok.length
      toast.success(
        `批次已提交：${ok.length} 条任务${failed ? `，${failed} 条链接无效被跳过` : ''}，进度见主页生成历史`,
      )
      setRawInput('')
      setBatchName('')
    } catch (e) {
      // request 拦截器已弹过错误 toast（含转写模型未就绪提示）
      console.error('批量提交失败：', e)
    } finally {
      setSubmitting(false)
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={handleParseCollection}
                disabled={parsing}
              >
                {parsing ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListOrdered className="mr-1 h-3.5 w-3.5" />
                )}
                解析合集/收藏夹/分P
              </Button>
            </div>
            <Textarea
              rows={8}
              placeholder={'https://www.bilibili.com/video/BVxxxx\nhttps://space.bilibili.com/xxx/favlist?fid=xxx（可点击上方按钮展开）'}
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
                <label className="mb-1.5 block text-sm text-neutral-600">批次名称（可选）</label>
                <Input
                  value={batchName}
                  onChange={e => setBatchName(e.target.value)}
                  placeholder="输入批次名称，留空自动生成"
                />
              </div>
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
                      disabled={f.value === 'screenshot' && !videoUnderstanding}
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

          {/* 视频理解 */}
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-700">视频理解</h2>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={videoUnderstanding}
                  onCheckedChange={checked => setVideoUnderstanding(!!checked)}
                />
                启用
              </label>
            </div>
            <div
              className={`mt-3 grid grid-cols-2 gap-4 transition-opacity ${videoUnderstanding ? '' : 'pointer-events-none opacity-40'}`}
            >
              <div>
                <label className="mb-1.5 block text-sm text-neutral-600">采样间隔（秒）</label>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={videoInterval}
                  onChange={e => setVideoInterval(Number(e.target.value) || 6)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-neutral-600">拼图尺寸（列 × 行）</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={gridCols}
                    onChange={e => setGridCols(Number(e.target.value) || 2)}
                  />
                  <span className="text-neutral-400">×</span>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={gridRows}
                    onChange={e => setGridRows(Number(e.target.value) || 2)}
                  />
                </div>
              </div>
            </div>
            {videoUnderstanding && (
              <Alert variant="warning" className="mt-3">
                <AlertDescription>
                  提示：视频理解功能必须使用多模态模型，且每条视频会完整下载（批量时明显更慢）。
                </AlertDescription>
              </Alert>
            )}
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
            <span className="text-xs text-neutral-400">进度与导出请到主页「生成历史」的批次卡片</span>
          </div>
        </div>
      </main>
    </div>
  )
}

export default BatchPage
