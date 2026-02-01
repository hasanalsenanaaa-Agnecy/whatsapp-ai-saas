'use client'
import { useState, useEffect, useMemo } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { Users, MessageSquare, Calendar, TrendingUp, Phone, Clock, ArrowUp, ArrowDown } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { leadsApi, Lead, DashboardStats, LeadAnalytics } from '@/lib/api/leads'

const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#6B7280']

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [analytics, setAnalytics] = useState<LeadAnalytics | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const [statsResponse, leadsResponse, analyticsResponse] = await Promise.all([
          leadsApi.getDashboardStats(user.clientId),
          leadsApi.getLeads(user.clientId, { limit: 50 }),
          leadsApi.getAnalytics(user.clientId)
        ])
        setStats(statsResponse)
        setLeads(leadsResponse.items || [])
        setAnalytics(analyticsResponse)
      } catch (err) {
        setError('تعذر تحميل بيانات لوحة التحكم')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  // Calculate lead status breakdown
  const statusData = useMemo(() => {
    const breakdown = analytics?.statusBreakdown
    if (breakdown) {
      return [
        { name: 'جديد', value: breakdown.new || 0, color: '#10B981' },
        { name: 'تم التواصل', value: breakdown.contacted || 0, color: '#3B82F6' },
        { name: 'تم البيع', value: breakdown.converted || 0, color: '#8B5CF6' },
        { name: 'ملغي', value: breakdown.lost || 0, color: '#6B7280' }
      ]
    }
    return [
      { name: 'جديد', value: leads.filter(l => l.status === 'new').length, color: '#10B981' },
      { name: 'تم التواصل', value: leads.filter(l => l.status === 'contacted').length, color: '#3B82F6' },
      { name: 'تم البيع', value: leads.filter(l => l.status === 'converted').length, color: '#8B5CF6' },
      { name: 'ملغي', value: leads.filter(l => l.status === 'lost').length, color: '#6B7280' }
    ]
  }, [analytics, leads])

  // Calculate score breakdown
  const scoreData = useMemo(() => {
    const breakdown = analytics?.scoreBreakdown
    if (breakdown) {
      return [
        { name: 'مهتم جداً', count: breakdown.hot || 0 },
        { name: 'مهتم', count: breakdown.warm || 0 },
        { name: 'بارد', count: breakdown.cold || 0 }
      ]
    }
    return [
      { name: 'مهتم جداً', count: leads.filter(l => l.score === 'hot').length },
      { name: 'مهتم', count: leads.filter(l => l.score === 'warm').length },
      { name: 'بارد', count: leads.filter(l => l.score === 'cold').length }
    ]
  }, [analytics, leads])

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
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-slate-800">لوحة التحكم</h1>
            <p className="text-slate-500 mt-1">مرحباً بك، تابع أداء عملك من هنا</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatCard
              icon={<Users />}
              label="إجمالي العملاء"
              value={stats?.totalLeads ?? 0}
              color="bg-primary"
              trend={{ value: 12, isPositive: true }}
            />
            <StatCard
              icon={<TrendingUp />}
              label="عملاء اليوم"
              value={stats?.todayLeads ?? 0}
              color="bg-green-500"
              trend={{ value: 8, isPositive: true }}
            />
            <StatCard
              icon={<Clock />}
              label="هذا الأسبوع"
              value={stats?.weekLeads ?? 0}
              color="bg-blue-500"
              trend={{ value: 5, isPositive: true }}
            />
            <StatCard
              icon={<Phone />}
              label="عملاء مهتمين"
              value={stats?.hotLeads ?? 0}
              color="bg-red-500"
            />
            <StatCard
              icon={<Calendar />}
              label="مواعيد معلقة"
              value={stats?.pendingAppointments ?? 0}
              color="bg-gold"
            />
            <StatCard
              icon={<MessageSquare />}
              label="نسبة التحويل"
              value={`${stats?.conversionRate ?? 0}%`}
              color="bg-purple-500"
              trend={{ value: 3, isPositive: true }}
            />
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Lead Status Pie Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">توزيع حالة العملاء</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {statusData.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-sm text-slate-600">{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Score Bar Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4">تقييم اهتمام العملاء</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0D9488" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Recent Leads Preview */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">أحدث العملاء</h2>
              <a href="/leads" className="text-sm text-primary hover:text-primary-dark font-medium">
                عرض الكل ←
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الاسم</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الجوال</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">التقييم</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leads.slice(0, 5).map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-800">{lead.name}</td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-sm">{lead.phone}</td>
                      <td className="px-6 py-4">
                        <ScoreBadge score={lead.score} />
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={lead.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: number | string
  color: string
  trend?: { value: number; isPositive: boolean }
}

function StatCard({ icon, label, value, color, trend }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 ${color} rounded-lg flex items-center justify-center text-white mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-1">{value}</div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">{label}</div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {trend.value}%
          </div>
        )}
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: string }) {
  const colors = {
    hot: 'bg-red-100 text-red-700',
    warm: 'bg-yellow-100 text-yellow-700',
    cold: 'bg-blue-100 text-blue-700'
  }
  const labels = {
    hot: '🔥 مهتم جداً',
    warm: '⚡ مهتم',
    cold: '❄️ بارد'
  }
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[score as keyof typeof colors]}`}>
      {labels[score as keyof typeof labels]}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    new: 'bg-green-100 text-green-700',
    contacted: 'bg-blue-100 text-blue-700',
    converted: 'bg-purple-100 text-purple-700',
    lost: 'bg-gray-100 text-gray-700'
  }
  const labels = {
    new: 'جديد',
    contacted: 'تم التواصل',
    converted: 'تم البيع',
    lost: 'ملغي'
  }
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[status as keyof typeof colors]}`}>
      {labels[status as keyof typeof labels]}
    </span>
  )
}
