import { useTaskStore, type Task } from '@/store/taskStore'
import { useBatchStore, type Batch } from '@/store/batchStore'
import { cn } from '@/lib/utils.ts'
import { Trash, ChevronDown, ChevronRight, RotateCcw, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import Fuse from 'fuse.js'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import LazyImage from "@/components/LazyImage.tsx";
import { FC, useState, useEffect, useMemo } from 'react'
import {
  exportBatchZip,
  downloadBlob,
  latestMarkdownOf,
  type BatchExportOptions,
} from '@/utils/export'

interface NoteHistoryProps {
  onSelect: (taskId: string) => void
  selectedId: string | null
}

const isDone = (status: string) => status === 'SUCCESS' || status === 'FAILED'

/* -------------------- 单条笔记卡片（普通 + 批次内复用） -------------------- */

interface NoteCardProps {
  task: Task
  selected: boolean
  baseURL: string
  onSelect: (taskId: string) => void
  onRemove: (taskId: string) => void
  onRetry?: (taskId: string) => void
  /** 批次内渲染时的勾选框插槽 */
  leading?: React.ReactNode
}

const NoteCard: FC<NoteCardProps> = ({
  task,
  selected,
  baseURL,
  onSelect,
  onRemove,
  onRetry,
  leading,
}) => {
  return (
    <div
      onClick={() => onSelect(task.id)}
      className={cn(
        'flex cursor-pointer flex-col rounded-md border border-neutral-200 p-3',
        selected && 'border-primary bg-primary-light'
      )}
    >
      <div className={cn('flex items-center gap-2')}>
        {leading}
        {/* 封面图 */}
        {task.platform === 'local' ? (
          <img
            src={
              task.audioMeta.cover_url ? `${task.audioMeta.cover_url}` : '/placeholder.png'
            }
            alt="封面"
            className="h-10 w-12 shrink-0 rounded-md object-cover"
          />
        ) : (
          <LazyImage
            src={
              task.audioMeta.cover_url
                ? `${baseURL}/image_proxy?url=${encodeURIComponent(task.audioMeta.cover_url)}`
                : '/placeholder.png'
            }
            alt="封面"
          />
        )}

        {/* 标题 + 状态 */}

        <div className="flex w-full items-center justify-between gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="line-clamp-2 max-w-[180px] flex-1 overflow-hidden text-sm text-ellipsis">
                  {task.audioMeta.title || '未命名笔记'}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{task.audioMeta.title || '未命名笔记'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className={'mt-2 flex items-center justify-between text-[10px]'}>
        <div className="flex shrink-0 items-center gap-1">
          {task.status === 'SUCCESS' && (
            <div className={'bg-primary w-10 rounded p-0.5 text-center text-white'}>
              已完成
            </div>
          )}
          {task.status !== 'SUCCESS' && task.status !== 'FAILED' ? (
            <div className={'w-10 rounded bg-green-500 p-0.5 text-center text-white'}>
              等待中
            </div>
          ) : (
            <></>
          )}
          {task.status === 'FAILED' && (
            <div className={'w-10 rounded bg-red-500 p-0.5 text-center text-white'}>失败</div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {task.status === 'FAILED' && onRetry && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={e => {
                      e.stopPropagation()
                      onRetry(task.id)
                    }}
                    className="shrink-0"
                  >
                    <RotateCcw className="h-4 w-4 text-blue-500" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>重试</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={e => {
                    e.stopPropagation()
                    onRemove(task.id)
                  }}
                  className="shrink-0"
                >
                  <Trash className="text-muted-foreground h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>删除</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}

/* -------------------- 批次卡片（可折叠分组） -------------------- */

interface BatchCardProps {
  batch: Batch
  tasks: Task[]
  selectedId: string | null
  baseURL: string
  onSelect: (taskId: string) => void
  onRemoveTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onRemoveBatch: (batchId: string) => void
}

const BatchCard: FC<BatchCardProps> = ({
  batch,
  tasks,
  selectedId,
  baseURL,
  onSelect,
  onRemoveTask,
  onRetryTask,
  onRemoveBatch,
}) => {
  const allDone = tasks.every(t => isDone(t.status))
  // 进行中的批次默认展开，全部结束自动折叠
  const [expanded, setExpanded] = useState(() => !allDone)
  useEffect(() => {
    if (allDone) setExpanded(false)
  }, [allDone])

  const doneCount = tasks.filter(t => isDone(t.status)).length
  const failedTasks = tasks.filter(t => t.status === 'FAILED')
  const remaining = tasks.length - doneCount

  // 剩余时间预估：已完成条目的平均耗时 × 剩余条数
  const doneWithTime = tasks.filter(t => t.completedAt)
  const etaText = useMemo(() => {
    if (remaining <= 0 || doneWithTime.length === 0) return null
    const avgMs =
      doneWithTime.reduce(
        (sum, t) => sum + (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()),
        0
      ) / doneWithTime.length
    const minutes = Math.ceil((remaining * avgMs) / 60000)
    return minutes >= 1 ? `约剩 ${minutes} 分钟` : '即将完成'
  }, [tasks, remaining, doneWithTime.length])

  // 导出：产物类型勾选 + 逐条勾选（默认全选）
  const [options, setOptions] = useState<BatchExportOptions>({
    markdown: true,
    transcript: true,
    xmind: true,
    merged: false,
    withTimestamp: false,
  })
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(tasks.map(t => t.id)))
  const [exporting, setExporting] = useState(false)

  const toggleCheck = (taskId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }
  const allChecked = checkedIds.size === tasks.length

  const handleExport = async () => {
    const items = tasks
      .map((task, i) => ({ task, order: i + 1 }))
      .filter(({ task }) => checkedIds.has(task.id))
      .map(({ task, order }) => ({
        index: order,
        taskId: task.id,
        title: task.audioMeta?.title || `视频 ${order}`,
        markdown: latestMarkdownOf(task.markdown),
        transcript: task.transcript,
      }))
    if (!items.length) return
    setExporting(true)
    try {
      const blob = await exportBatchZip(items, options, batch.name)
      downloadBlob(blob, `${batch.name}.zip`)
    } catch (e) {
      console.error('批次导出失败:', e)
    } finally {
      setExporting(false)
    }
  }

  const handleRemoveBatch = () => {
    if (window.confirm(`删除整个批次「${batch.name}」及其全部 ${tasks.length} 条笔记？`)) {
      onRemoveBatch(batch.id)
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50/60">
      {/* 折叠行 */}
      <div
        className="flex cursor-pointer items-center gap-2 p-2.5"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-gray-700" title={batch.name}>
          {batch.name}
        </span>
        {!allDone && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />}
        <span className="shrink-0 text-[10px] text-neutral-500">
          {doneCount}/{tasks.length} 完成{etaText ? ` · ${etaText}` : ''}
        </span>
        {failedTasks.length > 0 && (
          <span className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
            失败 {failedTasks.length}
          </span>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={e => {
                  e.stopPropagation()
                  handleRemoveBatch()
                }}
                className="shrink-0"
              >
                <Trash className="text-muted-foreground h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>删除整个批次</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* 展开区 */}
      {expanded && (
        <div className="border-t border-neutral-100 p-2">
          {/* 工具行 */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded bg-white p-2 text-xs text-neutral-600">
            <label className="flex items-center gap-1">
              <Checkbox
                checked={options.markdown}
                onCheckedChange={v => setOptions(o => ({ ...o, markdown: !!v }))}
              />
              笔记 md
            </label>
            <label className="flex items-center gap-1">
              <Checkbox
                checked={options.transcript}
                onCheckedChange={v => setOptions(o => ({ ...o, transcript: !!v }))}
              />
              原文 txt
            </label>
            <label className="flex items-center gap-1">
              <Checkbox
                checked={options.xmind}
                onCheckedChange={v => setOptions(o => ({ ...o, xmind: !!v }))}
              />
              思维导图
            </label>
            <label className="flex items-center gap-1">
              <Checkbox
                checked={options.merged}
                onCheckedChange={v => setOptions(o => ({ ...o, merged: !!v }))}
              />
              合并合集
            </label>
            <label className="flex items-center gap-1">
              <Checkbox
                checked={options.withTimestamp}
                onCheckedChange={v => setOptions(o => ({ ...o, withTimestamp: !!v }))}
              />
              原文带时间戳
            </label>
            <span className="h-4 w-px bg-neutral-200" />
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() =>
                setCheckedIds(allChecked ? new Set() : new Set(tasks.map(t => t.id)))
              }
            >
              {allChecked ? '取消全选' : '全选'}
            </button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={handleExport}
              disabled={exporting || checkedIds.size === 0}
            >
              {exporting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              导出选中（{checkedIds.size}）
            </Button>
            {failedTasks.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => failedTasks.forEach(t => onRetryTask(t.id))}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                重试全部失败
              </Button>
            )}
          </div>

          {/* 笔记卡片列表（批次内顺序 = 提交/合集顺序） */}
          <div className="flex flex-col gap-2">
            {tasks.map(task => (
              <NoteCard
                key={task.id}
                task={task}
                selected={selectedId === task.id}
                baseURL={baseURL}
                onSelect={onSelect}
                onRemove={onRemoveTask}
                onRetry={task.status === 'FAILED' ? onRetryTask : undefined}
                leading={
                  <span onClick={e => e.stopPropagation()}>
                    <Checkbox checked={checkedIds.has(task.id)} onCheckedChange={() => toggleCheck(task.id)} />
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------- 主列表（分组混排 + 搜索） -------------------- */

const NoteHistory: FC<NoteHistoryProps> = ({ onSelect, selectedId }) => {
  const tasks = useTaskStore(state => state.tasks)
  const removeTask = useTaskStore(state => state.removeTask)
  const retryTask = useTaskStore(state => state.retryTask)
  const batches = useBatchStore(state => state.batches)
  const removeBatch = useBatchStore(state => state.removeBatch)
  // 确保baseURL没有尾部斜杠
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || 'api')).replace(/\/$/, '')
  const [rawSearch, setRawSearch] = useState('')
  const [search, setSearch] = useState('')
  const fuse = useMemo(() => new Fuse(tasks, {
    keys: ['audioMeta.title'],
    threshold: 0.4 // 匹配精度（越低越严格）
  }), [tasks])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (rawSearch === '') return
      setSearch(rawSearch)
    }, 300) // 300ms 防抖

    return () => clearTimeout(timer)
  }, [rawSearch])

  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])

  interface Entry {
    key: string
    createdAt: string
    taskId?: string
    batch?: Batch
    batchTasks?: Task[]
  }

  // 分组混排：批次为一个条目，普通任务（不属于任何现存批次）逐条
  const entries = useMemo<Entry[]>(() => {
    const inBatch = new Set<string>()
    const batchEntries: Entry[] = batches
      .map(batch => {
        const groupTasks = batch.taskIds
          .map(id => taskMap.get(id))
          .filter((t): t is Task => !!t)
        groupTasks.forEach(t => inBatch.add(t.id))
        return { key: `batch-${batch.id}`, createdAt: batch.createdAt, batch, batchTasks: groupTasks }
      })
      // 批次内任务已全部被删掉的空批次不显示
      .filter(e => (e.batchTasks?.length ?? 0) > 0)
    const soloEntries: Entry[] = tasks
      .filter(t => !inBatch.has(t.id))
      .map(t => ({ key: t.id, createdAt: t.createdAt, taskId: t.id }))
    return [...batchEntries, ...soloEntries].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )
  }, [tasks, batches, taskMap])

  // 搜索：普通任务按标题（Fuse 模糊），批次按批次名或组内任一标题命中
  const filteredEntries = useMemo<Entry[]>(() => {
    if (!search.trim()) return entries
    const q = search.trim().toLowerCase()
    const fuseHits = new Set(fuse.search(search).map(r => r.item.id))
    return entries.filter(e => {
      if (e.batch) {
        return (
          e.batch.name.toLowerCase().includes(q) ||
          (e.batchTasks || []).some(
            t => fuseHits.has(t.id) || (t.audioMeta.title || '').toLowerCase().includes(q)
          )
        )
      }
      return fuseHits.has(e.taskId!)
    })
  }, [entries, search, fuse])

  const handleRemoveBatch = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId)
    if (!batch) return
    batch.taskIds.forEach(id => {
      if (taskMap.has(id)) removeTask(id)
    })
    removeBatch(batchId)
  }

  return (
    <>
      <div className="mb-2">
        <input
            type="text"
            placeholder="搜索笔记标题..."
            className="w-full rounded border border-neutral-300 px-3 py-1 text-sm outline-none focus:border-primary"
            value={search}
            onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2 overflow-hidden">
        {filteredEntries.map(entry =>
          entry.batch && entry.batchTasks ? (
            <BatchCard
              key={entry.key}
              batch={entry.batch}
              tasks={entry.batchTasks}
              selectedId={selectedId}
              baseURL={baseURL}
              onSelect={onSelect}
              onRemoveTask={removeTask}
              onRetryTask={id => retryTask(id)}
              onRemoveBatch={handleRemoveBatch}
            />
          ) : (
            <NoteCard
              key={entry.key}
              task={taskMap.get(entry.taskId!)!}
              selected={selectedId === entry.taskId}
              baseURL={baseURL}
              onSelect={onSelect}
              onRemove={removeTask}
            />
          )
        )}
      </div>
    </>
  )
}

export default NoteHistory
