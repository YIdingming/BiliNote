import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useTaskStore } from '@/store/taskStore'
import { useBatchStore } from '@/store/batchStore'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// 每个批次只提醒一次（内存级即可：持久化会让重启后重复打扰或永久静音）
const notified = new Set<string>()

const isDone = (status: string) => status === 'SUCCESS' || status === 'FAILED'

/**
 * 批次完成通知：某批次内全部任务到达终态时，toast + 桌面系统通知。
 * 批量通常挂在后台跑，完成时用户大概率不在盯着界面。
 */
export function useBatchNotifications() {
  const tasks = useTaskStore(state => state.tasks)
  const batches = useBatchStore(state => state.batches)

  useEffect(() => {
    for (const batch of batches) {
      if (notified.has(batch.id)) continue
      const groupTasks = batch.taskIds
        .map(id => tasks.find(t => t.id === id))
        .filter((t): t is NonNullable<typeof t> => !!t)
      if (!groupTasks.length) continue
      if (!groupTasks.every(t => isDone(t.status))) continue

      notified.add(batch.id)
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
