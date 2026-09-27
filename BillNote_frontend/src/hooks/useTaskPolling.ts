import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { get_task_status } from '@/services/note.ts'
import toast from 'react-hot-toast'

/** 网络类失败连续多少次才把任务判为 FAILED（一次后端抖动不应误判） */
const MAX_CONSECUTIVE_ERRORS = 5

export const useTaskPolling = (interval = 3000) => {
  const tasks = useTaskStore(state => state.tasks)
  const updateTaskContent = useTaskStore(state => state.updateTaskContent)

  const tasksRef = useRef(tasks)
  const runningRef = useRef(false)
  const errorCountsRef = useRef(new Map<string, number>())

  // 每次 tasks 更新，把最新的 tasks 同步进去
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  useEffect(() => {
    const timer = setInterval(async () => {
      // 上一轮还没轮完就不再叠加（批量任务多时一轮可能超过 interval）
      if (runningRef.current) return
      const pendingTasks = tasksRef.current.filter(
        task => task.status != 'SUCCESS' && task.status != 'FAILED'
      )

      // 无活跃任务时跳过轮询
      if (pendingTasks.length === 0) return

      runningRef.current = true
      try {
        for (const task of pendingTasks) {
          try {
            const res = await get_task_status(task.id)
            const { status } = res
            errorCountsRef.current.delete(task.id)

            if (status && status !== task.status) {
              if (status === 'SUCCESS') {
                const { markdown, transcript, audio_meta } = res.result
                toast.success('笔记生成成功')
                updateTaskContent(task.id, {
                  status,
                  markdown,
                  transcript,
                  audioMeta: audio_meta,
                })
              } else if (status === 'FAILED') {
                updateTaskContent(task.id, { status })
                console.warn(`⚠️ 任务 ${task.id} 失败`)
              } else {
                updateTaskContent(task.id, { status })
              }
            }
          } catch (e) {
            // 网络抖动/后端短暂不可达不应立刻把任务判死：连续多次失败才标 FAILED
            const count = (errorCountsRef.current.get(task.id) || 0) + 1
            errorCountsRef.current.set(task.id, count)
            console.error(`❌ 任务轮询失败（${count}/${MAX_CONSECUTIVE_ERRORS}）：`, e)
            if (count >= MAX_CONSECUTIVE_ERRORS) {
              updateTaskContent(task.id, { status: 'FAILED' })
              errorCountsRef.current.delete(task.id)
            }
          }
        }
      } finally {
        runningRef.current = false
      }
    }, interval)

    return () => clearInterval(timer)
  }, [interval])
}
