'use client'
import { useState, useEffect } from 'react'
import ProtectedRoute from '../../components/auth/ProtectedRoute'
import DashboardLayout from '../../components/layout/DashboardLayout'
import { useAuth } from '../../contexts/AuthContext'
import { FileText, Filter, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react'
import { mockAuditLogs } from '../../lib/utils/mockData'
import { AuditLog } from '../../lib/api/operations'

export default function AuditLogsPage() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<AuditLog[]>(mockAuditLogs)
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>(mockAuditLogs)
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)

  // Apply filters
  useEffect(() => {
    let filtered = [...logs]

    if (actionFilter !== 'all') {
      filtered = filtered.filter(l => l.action === actionFilter)
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => l.status === statusFilter)
    }

    setFilteredLogs(filtered)
  }, [actionFilter, statusFilter, logs])

  // Get unique actions for filter
  const uniqueActions = Array.from(new Set(logs.map(l => l.action)))

  const handleViewDetails = (log: AuditLog) => {
    setSelectedLog(log)
    setShowDetailModal(true)
  }

  return (
    <ProtectedRoute>
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-slate-800">سجل الأحداث</h1>
            <p className="text-slate-500 mt-1">عرض جميع الأنشطة والأحداث في النظام</p>
          </div>

          {/* Filters Bar */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">نوع الحدث</label>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                >
                  <option value="all">جميع الأحداث</option>
                  {uniqueActions.map(action => (
                    <option key={action} value={action}>{getActionLabel(action)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">الحالة</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                >
                  <option value="all">جميع الحالات</option>
                  <option value="success">نجح</option>
                  <option value="failed">فشل</option>
                  <option value="denied">مرفوض</option>
                </select>
              </div>

              <div className="flex items-end">
                <div className="text-sm text-slate-600">
                  عرض {filteredLogs.length} من أصل {logs.length} حدث
                </div>
              </div>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">التاريخ والوقت</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الحدث</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">المورد</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">عنوان IP</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الحالة</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">تفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log, index) => (
                    <tr key={index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <Clock size={14} />
                          {new Date(log.createdAt).toLocaleString('ar-SA', {
                            dateStyle: 'short',
                            timeStyle: 'short'
                          })}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800">{getActionLabel(log.action)}</div>
                        <div className="text-xs text-slate-500">{log.action}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {log.resourceType && log.resourceId ? (
                          <div>
                            <div className="font-medium">{getResourceTypeLabel(log.resourceType)}</div>
                            <div className="text-xs text-slate-500 font-mono">{log.resourceId}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-slate-600">
                        {log.ipAddress || <span className="text-slate-400">-</span>}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleViewDetails(log)}
                          className="text-primary hover:text-primary-dark text-sm font-medium"
                        >
                          عرض
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredLogs.length === 0 && (
              <div className="text-center py-12">
                <FileText className="mx-auto text-slate-300 mb-4" size={48} />
                <p className="text-slate-500">لا توجد أحداث مطابقة للفلاتر المحددة</p>
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">معلومة:</p>
              <p className="text-blue-700">
                يتم الاحتفاظ بسجلات الأحداث لمدة 90 يوماً. للحصول على سجلات أقدم، يرجى التواصل مع الدعم الفني.
              </p>
            </div>
          </div>
        </div>

        {/* Detail Modal */}
        {showDetailModal && selectedLog && (
          <DetailModal log={selectedLog} onClose={() => setShowDetailModal(false)} />
        )}
      </DashboardLayout>
    </ProtectedRoute>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    success: {
      bg: 'bg-green-100',
      text: 'text-green-700',
      icon: CheckCircle,
      label: 'نجح'
    },
    failed: {
      bg: 'bg-red-100',
      text: 'text-red-700',
      icon: XCircle,
      label: 'فشل'
    },
    denied: {
      bg: 'bg-orange-100',
      text: 'text-orange-700',
      icon: AlertCircle,
      label: 'مرفوض'
    }
  }

  const statusConfig = config[status as keyof typeof config] || config.failed
  const Icon = statusConfig.icon

  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${statusConfig.bg} ${statusConfig.text}`}>
      <Icon size={14} />
      {statusConfig.label}
    </span>
  )
}

function DetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-slate-800">تفاصيل الحدث</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <XCircle size={24} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-500">الحالة</label>
              <div className="mt-1">
                <StatusBadge status={log.status} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">التاريخ والوقت</label>
              <p className="text-slate-800 mt-1">
                {new Date(log.createdAt).toLocaleString('ar-SA', {
                  dateStyle: 'full',
                  timeStyle: 'long'
                })}
              </p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-500">نوع الحدث</label>
            <p className="text-lg font-semibold text-slate-800">{getActionLabel(log.action)}</p>
            <p className="text-sm text-slate-500 font-mono">{log.action}</p>
          </div>

          {log.resourceType && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-500">نوع المورد</label>
                <p className="text-slate-800">{getResourceTypeLabel(log.resourceType)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-500">معرف المورد</label>
                <p className="text-slate-800 font-mono text-sm">{log.resourceId}</p>
              </div>
            </div>
          )}

          {log.clientId && (
            <div>
              <label className="text-sm font-medium text-slate-500">معرف العميل</label>
              <p className="text-slate-800 font-mono">{log.clientId}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-500">عنوان IP</label>
              <p className="text-slate-800 font-mono">{log.ipAddress || '-'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">User Agent</label>
              <p className="text-slate-800 text-sm break-all">{log.userAgent || '-'}</p>
            </div>
          </div>

          {log.changes && Object.keys(log.changes).length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-500 mb-2 block">التغييرات</label>
              <div className="bg-slate-50 rounded-lg p-4">
                <pre className="text-sm text-slate-800 whitespace-pre-wrap">
                  {JSON.stringify(log.changes, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {log.errorMessage && (
            <div>
              <label className="text-sm font-medium text-slate-500 mb-2 block">رسالة الخطأ</label>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800">{log.errorMessage}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper functions
function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'login': 'تسجيل دخول',
    'logout': 'تسجيل خروج',
    'lead_created': 'إضافة عميل',
    'lead_updated': 'تحديث عميل',
    'lead_deleted': 'حذف عميل',
    'api_key_created': 'إنشاء مفتاح API',
    'api_key_revoked': 'إلغاء مفتاح API',
    'client_registered': 'تسجيل عميل جديد',
    'client_registration_failed': 'فشل تسجيل العميل'
  }
  return labels[action] || action
}

function getResourceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'lead': 'عميل',
    'api_key': 'مفتاح API',
    'client': 'عميل (نظام)',
    'user': 'مستخدم'
  }
  return labels[type] || type
}
