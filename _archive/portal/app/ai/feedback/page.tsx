'use client'
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { aiApi } from '@/lib/api/ai'

interface FeedbackItem {
  id: string
  aiResponse: string
  rating: number
  comment?: string
  createdAt: string
}

export default function AIFeedbackPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const feedback = await aiApi.listFeedback(user.clientId, 50)
        setItems(feedback)
      } catch (err) {
        setError('تعذر تحميل تقييمات الذكاء الاصطناعي')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  const stats = useMemo(() => {
    if (items.length === 0) {
      return { average: 0, positive: 0, neutral: 0, negative: 0 }
    }
    const total = items.reduce((sum, item) => sum + item.rating, 0)
    const average = total / items.length
    const positive = items.filter((item) => item.rating >= 4).length
    const neutral = items.filter((item) => item.rating === 3).length
    const negative = items.filter((item) => item.rating <= 2).length
    return { average, positive, neutral, negative }
  }, [items])

  if (loading) {
    return (
      <ProtectedRoute>
        <DashboardLayout>
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute>
      <DashboardLayout>
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">تقييمات الذكاء الاصطناعي</h1>
            <p className="text-slate-500 mt-1">تابع رضا العملاء عن الردود</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="المتوسط" value={stats.average.toFixed(1)} />
            <StatCard label="إيجابي" value={stats.positive} />
            <StatCard label="محايد" value={stats.neutral} />
            <StatCard label="سلبي" value={stats.negative} />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">آخر التقييمات</h2>
            {items.length === 0 ? (
              <div className="text-slate-500">لا توجد تقييمات بعد.</div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-600">
                        {new Date(item.createdAt).toLocaleString('ar-SA')}
                      </div>
                      <div className="text-sm font-semibold text-slate-700">⭐ {item.rating}</div>
                    </div>
                    <div className="mt-2 text-slate-700">{item.aiResponse}</div>
                    {item.comment && (
                      <div className="mt-2 text-sm text-slate-500">{item.comment}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-800 mt-2">{value}</div>
    </div>
  )
}
