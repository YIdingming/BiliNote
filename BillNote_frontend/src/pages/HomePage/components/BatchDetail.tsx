import { FC, useMemo, useState } from 'react'
import { ChevronLeft, Download, Loader2, RotateCcw, Trash } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import { useTaskStore, type Task } from '@/store/taskStore'
import { useBatchStore } from '@/store/batchStore'
import {
  exportBatchZip,
  downloadBlob,
  latestMarkdownOf,
  type BatchExportOptions,
} from '@/utils/export'

interface BatchDetailProps {
  batchId: string
  /** 关闭详情，回到笔记预览 */
  onClose: () => void
  /** 预览批次内的某条笔记 */
  onPreviewTask: (taskId: string) => void
}

const isDone = (status: string) => status === 'SUCCESS' || status === 'FAILED'

/** 主页右侧的批次详情：进度总览 + 导出配置 + 逐条笔记管理（宽栏专属视图） */
export const BatchDetail: FC<BatchDetailProps> = ({ batchId, onClose, onPreviewTask }) => {
  const batch = useBatchStore(state => state.batches.find(b => b.id === batchId))
  const tasks = useTaskStore(state => state.tasks)
  const removeTask = useTaskStore(state => state.removeTask)
  const retryTask = useTaskStore(state => state.retryTask)

  const groupTasks = useMemo(() => {
    if (!batch) return [] as Task[]
    return batch.taskIds.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t)
  }, [batch, tasks])

  const allDone = groupTasks.length > 0 && groupTasks.every(t => isDone(t.status))
  const doneCount = groupTasks.filter(t => isDone(t.status)).length
  const failedTasks = groupTasks.filter(t => t.status === 'FAILED')
  const remaining = groupTasks.length - doneCount

  const etaText = useMemo(() => {
    if (remaining <= 0) return null
    const doneWithTime = groupTasks.filter(t => t.completedAt)
    if (!doneWithTime.length) return null
    const avgMs =
      doneWithTime.reduce(
        (sum, t) => sum + (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()),
        0
      ) / doneWithTime.length
    const minutes = Math.ceil((remaining * avgMs) / 60000)
    return minutes >= 1 ? `预计还需约 ${minutes} 分钟` : '即将完成'
  }, [groupTasks, remaining])

  const [options, setOptions] = useState<BatchExportOptions>({
    markdown: true,
    transcript: true,
    xmind: true,
    merged: false,
    withTimestamp: false,
  })
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set(groupTasks.map(t => t.id)))
  const [exporting, setExporting] = useState(false)

  const allChecked = checkedIds.size === groupTasks.length

  const toggleCheck = (taskId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleExport = async () => {
    if (!batch) return
    const selected = groupTasks
      .map((task, i) => ({ task, order: i + 1 }))
      .filter(({ task }) => checkedIds.has(task.id))
    if (!selected.length) return
    // 仅已完成笔记有可导出内容；进行中/失败的条目跳过并告知
    const exportable = selected.filter(({ task }) => isDone(task.status) && task.status === 'SUCCESS')
    const skipped = selected.length - exportable.length
    if (!exportable.length) {
      toast.error('选中的条目都没有可导出的内容（仅已完成笔记可导出）')
      return
    }
    const items = exportable.map(({ task, order }) => ({
      index: order,
      taskId: task.id,
      title: task.audioMeta?.title || `视频 ${order}`,
      markdown: latestMarkdownOf(task.markdown),
      transcript: task.transcript,
    }))
    setExporting(true)
    try {
      const blob = await exportBatchZip(items, options, batch.name)
      downloadBlob(blob, `${batch.name}.zip`)
      toast.success(`导出完成${skipped ? `（已跳过 ${skipped} 条未完成）` : ''}`)
    } catch (e) {
      console.error('批次导出失败:', e)
      toast.error('导出失败，请查看控制台')
    } finally {
      setExporting(false)
    }
  }

  const handleRemoveTask = (taskId: string) => {
    removeTask(taskId)
    // 删掉批次内最后一条时同步清理批次对象并退出详情，避免 0/0 空详情
    if (groupTasks.length <= 1) {
      useBatchStore.getState().removeBatch(batchId)
      onClose()
    }
  }

  const handleRetryAllFailed = () => {
    failedTasks.forEach(t => retryTask(t.id))
  }

  if (!batch) return null

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onClose}>
          <ChevronLeft className="h-4 w-4" />
          返回预览
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-gray-800" title={batch.name}>
          {batch.name}
        </h2>
        {!allDone && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />}
        <span className="shrink-0 text-xs text-neutral-500">
          {doneCount}/{groupTasks.length} 完成{etaText ? ` · ${etaText}` : ''}
        </span>
        {failedTasks.length > 0 && (
          <span className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
            失败 {failedTasks.length}
          </span>
        )}
      </div>

      {/* 导出配置 */}
      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium text-gray-700">导出</h3>
          <div className="flex items-center gap-2">
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() =>
                setCheckedIds(allChecked ? new Set() : new Set(groupTasks.map(t => t.id)))
              }
            >
              {allChecked ? '取消全选' : '全选'}
            </button>
            <Button
              type="button"
              size="sm"
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
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={options.markdown}
              onCheckedChange={v => setOptions(o => ({ ...o, markdown: !!v }))}
            />
            笔记 md
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={options.transcript}
              onCheckedChange={v => setOptions(o => ({ ...o, transcript: !!v }))}
            />
            原文 txt
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={options.xmind}
              onCheckedChange={v => setOptions(o => ({ ...o, xmind: !!v }))}
            />
            思维导图 xmind
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={options.merged}
              onCheckedChange={v => setOptions(o => ({ ...o, merged: !!v }))}
            />
            合并合集文档
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={options.withTimestamp}
              onCheckedChange={v => setOptions(o => ({ ...o, withTimestamp: !!v }))}
            />
            原文带时间戳
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          按提交顺序编号导出为单个 zip；仅已完成笔记参与导出。
        </p>
      </section>

      {failedTasks.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 self-start"
          onClick={handleRetryAllFailed}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          重试全部失败（{failedTasks.length}）
        </Button>
      )}

      {/* 逐条笔记 */}
      <div className="mt-4 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 pb-4">
          {groupTasks.map((task, i) => (
            <div
              key={task.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5"
            >
              <Checkbox checked={checkedIds.has(task.id)} onCheckedChange={() => toggleCheck(task.id)} />
              <span className="w-7 shrink-0 text-sm text-neutral-400">
                {String(i + 1).padStart(2, '0')}
              </span>
              <button
                className="min-w-0 flex-1 truncate text-left text-sm text-gray-700 hover:text-primary"
                title={task.audioMeta?.title || task.formData?.video_url}
                onClick={() => onPreviewTask(task.id)}
              >
                {task.audioMeta?.title || task.formData?.video_url || '未命名'}
              </button>
              {task.status === 'SUCCESS' && (
                <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-white">
                  已完成
                </span>
              )}
              {!isDone(task.status) && (
                <>
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                  <span className="shrink-0 text-[10px] text-neutral-500">生成中</span>
                </>
              )}
              {task.status === 'FAILED' && (
                <>
                  <span className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
                    失败
                  </span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    className="h-7 px-1.5"
                    onClick={() => retryTask(task.id)}
                  >
                    <RotateCcw className="h-4 w-4 text-blue-500" />
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="small"
                variant="ghost"
                className="h-7 px-1.5"
                onClick={() => handleRemoveTask(task.id)}
              >
                <Trash className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
