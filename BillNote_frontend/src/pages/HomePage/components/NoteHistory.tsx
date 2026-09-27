import { useTaskStore, type Task } from '@/store/taskStore'
import { useBatchStore, type Batch } from '@/store/batchStore'
import { cn } from '@/lib/utils.ts'
import { Trash, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import Fuse from 'fuse.js'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import LazyImage from "@/components/LazyImage.tsx";
import { FC, useState, useEffect, useMemo } from 'react'

interface NoteHistoryProps {
  onSelect: (taskId: string) => void
  /** 点击批次行：右侧宽栏切换为批次详情 */
  onSelectBatch?: (batchId: string) => void
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
}

const NoteCard: FC<NoteCardProps> = ({ task, selected, baseURL, onSelect, onRemove }) => {
  return (
    <div
      onClick={() => onSelect(task.id)}
      className={cn(
        'flex cursor-pointer flex-col rounded-md border border-neutral-200 p-3',
        selected && 'border-primary bg-primary-light'
      )}
    >
      <div className={cn('flex items-center gap-4')}>
        {/* 封面图 */}
        {task.platform === 'local' ? (
          <img
            src={
              task.audioMeta.cover_url ? `${task.audioMeta.cover_url}` : '/placeholder.png'
            }
            alt="封面"
            className="h-10 w-12 rounded-md object-cover"
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
        <div className="shrink-0">
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

        <div>
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

/* -------------------- 批次行（点击进入右侧批次详情） -------------------- */

interface BatchRowProps {
  batch: Batch
  tasks: Task[]
  onOpen: (batchId: string) => void
  onRemoveBatch: (batchId: string) => void
}

const BatchRow: FC<BatchRowProps> = ({ batch, tasks, onOpen, onRemoveBatch }) => {
  const allDone = tasks.every(t => isDone(t.status))
  const doneCount = tasks.filter(t => isDone(t.status)).length
  const failedCount = tasks.filter(t => t.status === 'FAILED').length

  const handleRemoveBatch = () => {
    if (window.confirm(`删除整个批次「${batch.name}」及其全部 ${tasks.length} 条笔记？`)) {
      onRemoveBatch(batch.id)
    }
  }

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50/60 p-2.5 hover:border-neutral-300"
      onClick={() => onOpen(batch.id)}
    >
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700" title={batch.name}>
        {batch.name}
      </span>
      {!allDone && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />}
      <span className="shrink-0 text-[10px] text-neutral-500">
        {doneCount}/{tasks.length} 完成
      </span>
      {failedCount > 0 && (
        <span className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
          失败 {failedCount}
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
  )
}

/* -------------------- 主列表（分组混排 + 搜索） -------------------- */

const NoteHistory: FC<NoteHistoryProps> = ({ onSelect, onSelectBatch, selectedId }) => {
  const tasks = useTaskStore(state => state.tasks)
  const removeTask = useTaskStore(state => state.removeTask)
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
            <BatchRow
              key={entry.key}
              batch={entry.batch}
              tasks={entry.batchTasks}
              onOpen={id => onSelectBatch?.(id)}
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
