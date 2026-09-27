import { FC, useEffect, useState } from 'react'
import HomeLayout from '@/layouts/HomeLayout.tsx'
import NoteForm from '@/pages/HomePage/components/NoteForm.tsx'
import MarkdownViewer from '@/pages/HomePage/components/MarkdownViewer.tsx'
import { BatchDetail } from '@/pages/HomePage/components/BatchDetail.tsx'
import { useTaskStore } from '@/store/taskStore'
import { useBatchStore } from '@/store/batchStore'
import History from '@/pages/HomePage/components/History.tsx'
type ViewStatus = 'idle' | 'loading' | 'success' | 'failed'
export const HomePage: FC = () => {
  const tasks = useTaskStore(state => state.tasks)
  const currentTaskId = useTaskStore(state => state.currentTaskId)
  const setCurrentTask = useTaskStore(state => state.setCurrentTask)
  const batches = useBatchStore(state => state.batches)

  const currentTask = tasks.find(t => t.id === currentTaskId)

  // 右侧宽栏当前查看的批次（null = 常规笔记预览）
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  // 被查看的批次被删除后自动回到笔记预览
  useEffect(() => {
    if (activeBatchId && !batches.some(b => b.id === activeBatchId)) {
      setActiveBatchId(null)
    }
  }, [batches, activeBatchId])

  const [status, setStatus] = useState<ViewStatus>('idle')

  const content = currentTask?.markdown || ''

  useEffect(() => {
    if (!currentTask) {
      setStatus('idle')
    } else if (currentTask.status === 'SUCCESS') {
      setStatus('success')
    } else if (currentTask.status === 'FAILED') {
      setStatus('failed')
    } else {
      // PENDING、PARSING、DOWNLOADING、TRANSCRIBING、SUMMARIZING 等所有进行中状态
      setStatus('loading')
    }
  }, [currentTask, currentTask?.status])

  return (
    <HomeLayout
      NoteForm={<NoteForm />}
      Preview={
        activeBatchId ? (
          <BatchDetail
            batchId={activeBatchId}
            onClose={() => setActiveBatchId(null)}
            onPreviewTask={taskId => {
              setActiveBatchId(null)
              setCurrentTask(taskId)
            }}
          />
        ) : (
          <MarkdownViewer status={status} />
        )
      }
      History={<History onSelectBatch={setActiveBatchId} />}
    />
  )
}
