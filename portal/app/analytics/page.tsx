'use client'
import { useEffect, useMemo, useState } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { leadsApi, AdvancedAnalytics } from '@/lib/api/leads'

export default function AdvancedAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AdvancedAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const analytics = await leadsApi.getAdvancedAnalytics(user.clientId)
        setData(analytics)
      } catch (err) {
        setError('تعذر تحميل التحليلات المتقدمة')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  const totalAttribution = useMemo(() => {
    return data?.attribution.reduce((sum, item) => sum + item.count, 0) || 0
  }, [data])

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
            <h1 className="text-3xl font-bold text-slate-800">تحليلات متقدمة</h1>
            <p className="text-slate-500 mt-1">نظرة أعمق على القنوات والتحويلات وتأثير الذكاء الاصطناعي</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="إجمالي التقييمات" value={data.aiImpact.feedbackCount} />
              <StatCard label="متوسط التقييم" value={data.aiImpact.avgRating.toFixed(1)} />
              <StatCard label="نسبة التقييمات الإيجابية" value={`${data.aiImpact.positiveRate}%`} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">توزيع المصادر</h2>
              {data?.attribution.length ? (
                <div className="space-y-3">
                  {data.attribution.map((item) => (
                    <div key={item.source} className="flex items-center justify-between">
                      <div className="text-slate-600">{item.source}</div>
                      <div className="font-semibold text-slate-800">{item.count}</div>
                    </div>
                  ))}
                  <div className="border-t pt-3 text-sm text-slate-500">
                    إجمالي المصادر: {totalAttribution}
                  </div>
                </div>
              ) : (
                <div className="text-slate-500">لا توجد بيانات مصادر بعد.</div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">قمع التحويل</h2>
              {data ? (
                <div className="space-y-2">
                  <FunnelRow label="إجمالي العملاء" value={data.funnel.total} />
                  <FunnelRow label="جديد" value={data.funnel.new} />
                  <FunnelRow label="تم التواصل" value={data.funnel.contacted} />
                  <FunnelRow label="تم البيع" value={data.funnel.converted} />
                  <FunnelRow label="ملغي" value={data.funnel.lost} />
                </div>
              ) : (
                <div className="text-slate-500">لا توجد بيانات بعد.</div>
              )}
            </div>
          </div>

          {data && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">تأثير الذكاء الاصطناعي</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard label="تقييمات إيجابية" value={data.aiImpact.positive} />
                <StatCard label="تقييمات محايدة" value={data.aiImpact.neutral} />
                <StatCard label="تقييمات سلبية" value={data.aiImpact.negative} />
                <StatCard label="عملاء لديهم تقييم" value={data.aiImpact.leadsWithFeedback} />
              </div>
            </div>
          )}
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

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-slate-600">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  )
}
