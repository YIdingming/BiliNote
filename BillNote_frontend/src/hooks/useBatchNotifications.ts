import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useTaskStore } from '@/store/taskStore'
import { useBatchStore } from '@/store/batchStore'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const isDone = (status: string) => status === 'SUCCESS' || status === 'FAILED'

/**
 * 批次完成通知：某批次在本会话内从「未完成」迁移到「全部终态」时，
 * toast + 桌面系统通知。
 *
 * 用「上次见到的完成数」做迁移检测而不是模块级已通知集合——IndexedDB 异步恢复
 * 的历史批次在首次观察到时只登记基线，绝不在应用启动时轰炸历史通知。
 */
export function useBatchNotifications() {
  const tasks = useTaskStore(state => state.tasks)
  const batches = useBatchStore(state => state.batches)
  const seenDone = useRef(new Map<string, number>())

  useEffect(() => {
    for (const batch of batches) {
      const groupTasks = batch.taskIds
        .map(id => tasks.find(t => t.id === id))
        .filter((t): t is NonNullable<typeof t> => !!t)
      if (!groupTasks.length) continue

      const total = groupTasks.length
      const done = groupTasks.filter(t => isDone(t.status)).length
      const prev = seenDone.current.get(batch.id)

      if (prev === undefined) {
        // 首次见到（应用启动恢复 / 刚创建）：登记基线，不通知
        seenDone.current.set(batch.id, done)
        continue
      }

      seenDone.current.set(batch.id, done)
      // 只在本会话内观察到「未完成 → 全部完成」的迁移时通知一次
      if (!(prev < total && done >= total)) continue

      const ok = groupTasks.filter(t => t.status === 'SUCCESS').length
      const failed = groupTasks.length - ok
      const msg = `批次「${batch.name}」已完成：${ok} 条成功${failed ? `，${failed} 条失败` : ''}`
      toast(msg, { icon: failed ? '⚠️' : '✅' })

      if (isTauri) {
        import('@tauri-apps/plugin-notification')
          .then(async m => {
            let granted = await m.isPermissionGranted()
            if (!granted) {
              const perm = await m.requestPermission()
              granted = perm === 'granted'
            }
            if (granted) {
              m.sendNotification({ title: 'BiliNote 批量任务', body: msg })
            }
          })
          .catch(err => console.warn('[useBatchNotifications] 系统通知不可用:', err))
      }
    }
  }, [tasks, batches])
}
