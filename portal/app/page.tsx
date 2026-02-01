'use client'
import { useState, useEffect } from 'react'
import { Users, MessageSquare, Calendar, TrendingUp, Phone, Clock } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Stats {
  totalLeads: number
  todayLeads: number
  weekLeads: number
  hotLeads: number
  pendingAppointments: number
  conversionRate: number
}

interface Lead {
  id: number
  name: string
  phone: string
  score: string
  status: string
  data: any
  createdAt: string
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter() // Retained from the other branch of the merge

  useEffect(() => {
    // Simulate fetching data
    setStats({
      totalLeads: 47,
      todayLeads: 5,
      weekLeads: 23,
      hotLeads: 8,
      pendingAppointments: 3,
      conversionRate: 34
    })
    setLeads([
      { id: 1, name: 'محمد العلي', phone: '0501234567', score: 'hot', status: 'new', data: { interest: 'جيب / SUV', budget: '100 - 150 ألف' }, createdAt: new Date().toISOString() },
      { id: 2, name: 'أحمد السعيد', phone: '0551234567', score: 'warm', status: 'contacted', data: { interest: 'سيدان', budget: '50 - 100 ألف' }, createdAt: new Date().toISOString() },
    ])
    setLoading(false)

    // Check if user is authenticated (from the other side of the merge)
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  const scoreColors: Record<string, string> = {
    hot: 'bg-red-100 text-red-700',
    warm: 'bg-yellow-100 text-yellow-700',
    cold: 'bg-blue-100 text-blue-700'
  }

  const statusColors: Record<string, string> = {
    new: 'bg-green-100 text-green-700',
    contacted: 'bg-blue-100 text-blue-700',
    converted: 'bg-purple-100 text-purple-700',
    lost: 'bg-gray-100 text-gray-700'
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>
  }

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">لوحة التحكم</h1>
        <p className="text-slate-500">مرحباً بك في نظام إدارة العملاء</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard icon={<Users />} label="إجمالي العملاء" value={stats?.totalLeads || 0} color="bg-primary" />
        <StatCard icon={<TrendingUp />} label="اليوم" value={stats?.todayLeads || 0} color="bg-green-500" />
        <StatCard icon={<Clock />} label="هذا الأسبوع" value={stats?.weekLeads || 0} color="bg-blue-500" />
        <StatCard icon={<Phone />} label="عملاء مهتمين" value={stats?.hotLeads || 0} color="bg-red-500" />
        <StatCard icon={<Calendar />} label="مواعيد معلقة" value={stats?.pendingAppointments || 0} color="bg-gold" />
        <StatCard icon={<MessageSquare />} label="نسبة التحويل" value={`${stats?.conversionRate || 0}%`} color="bg-purple-500" />
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">أحدث العملاء</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">الاسم</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">الجوال</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">الاهتمام</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">الميزانية</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">التقييم</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map(lead => (
                <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{lead.name}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono">{lead.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.data?.interest || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.data?.budget || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${scoreColors[lead.score]}`}>
                      {lead.score === 'hot' ? '🔥 مهتم جداً' : lead.score === 'warm' ? '⚡ مهتم' : '❄️ بارد'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[lead.status]}`}>
                      {lead.status === 'new' ? 'جديد' : lead.status === 'contacted' ? 'تم التواصل' : lead.status === 'converted' ? 'تم البيع' : 'ملغي'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: number | string, color: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
      <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center text-white mb-3`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  )
}