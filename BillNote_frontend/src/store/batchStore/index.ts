import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import { get, set, del } from 'idb-keyval'

/** 一次批量提交 = 一个批次；taskIds 顺序即提交/合集顺序，导出编号依据它 */
export interface Batch {
  id: string
  name: string
  createdAt: string
  taskIds: string[]
}

interface BatchStore {
  batches: Batch[]
  addBatch: (name: string, taskIds: string[]) => string
  removeBatch: (id: string) => void
  getBatch: (id: string) => Batch | undefined
  getBatchOfTask: (taskId: string) => Batch | undefined
}

export const useBatchStore = create<BatchStore>()(
  persist(
    (set, get) => ({
      batches: [],

      addBatch: (name, taskIds) => {
        const id = uuidv4()
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const ts = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
        set(state => ({
          batches: [
            {
              id,
              name: name.trim() || `批量任务 ${ts} · ${taskIds.length} 条`,
              createdAt: now.toISOString(),
              taskIds,
            },
            ...state.batches,
          ],
        }))
        return id
      },

      removeBatch: id =>
        set(state => ({ batches: state.batches.filter(b => b.id !== id) })),

      getBatch: id => get().batches.find(b => b.id === id),

      getBatchOfTask: taskId => get().batches.find(b => b.taskIds.includes(taskId)),
    }),
    {
      name: 'batch-storage',
      storage: createJSONStorage(() => ({
        getItem: async (name: string): Promise<string | null> => {
          const value = await get(name)
          return value ?? null
        },
        setItem: async (name: string, value: string): Promise<void> => {
          await set(name, value)
        },
        removeItem: async (name: string): Promise<void> => {
          await del(name)
        },
      })),
    }
  )
)
