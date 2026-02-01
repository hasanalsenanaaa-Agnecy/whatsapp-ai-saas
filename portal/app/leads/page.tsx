'use client'
import { useState, useEffect } from 'react'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { Portal } from '@/components/Portal'
import { useAuth } from '@/contexts/AuthContext'
import { Search, Plus, Edit2, Trash2, Eye, X, Filter } from 'lucide-react'
import { Lead, leadsApi } from '@/lib/api/leads'

export default function LeadsPage() {
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [scoreFilter, setScoreFilter] = useState<string>('all')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!user?.clientId) return
      try {
        setLoading(true)
        const response = await leadsApi.getLeads(user.clientId, { limit: 200 })
        setLeads(response.items || [])
      } catch (err) {
        setError('تعذر تحميل العملاء')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.clientId])

  // Apply filters
  useEffect(() => {
    let filtered = [...leads]

    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      filtered = filtered.filter(
        l => l.name.toLowerCase().includes(search) || l.phone.includes(search)
      )
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => l.status === statusFilter)
    }

    if (scoreFilter !== 'all') {
      filtered = filtered.filter(l => l.score === scoreFilter)
    }

    setFilteredLeads(filtered)
  }, [searchTerm, statusFilter, scoreFilter, leads])

  const handleViewLead = (lead: Lead) => {
    setSelectedLead(lead)
    setShowDetailModal(true)
  }

  const handleEditLead = (lead: Lead) => {
    setSelectedLead(lead)
    setShowEditModal(true)
  }

  const handleDeleteLead = (lead: Lead) => {
    setSelectedLead(lead)
    setShowDeleteConfirm(true)
  }

  const confirmDelete = () => {
    if (!selectedLead || !user?.clientId) return
    leadsApi.deleteLead(user.clientId, selectedLead.id)
      .then(() => {
        setLeads(leads.filter(l => l.id !== selectedLead.id))
      })
      .catch(() => {
        setError('تعذر حذف العميل')
      })
      .finally(() => {
        setShowDeleteConfirm(false)
        setSelectedLead(null)
      })
  }

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          </div>
        ) : (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800">إدارة العملاء</h1>
              <p className="text-slate-500 mt-1">عرض وإدارة جميع العملاء المحتملين</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-lg font-medium transition"
            >
              <Plus size={20} />
              إضافة عميل
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Filters Bar */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Search */}
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
                  <input
                    type="text"
                    placeholder="البحث بالاسم أو رقم الجوال..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pr-10 pl-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                >
                  <option value="all">جميع الحالات</option>
                  <option value="new">جديد</option>
                  <option value="contacted">تم التواصل</option>
                  <option value="converted">تم البيع</option>
                  <option value="lost">ملغي</option>
                </select>
              </div>

              {/* Score Filter */}
              <div>
                <select
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                >
                  <option value="all">جميع التقييمات</option>
                  <option value="hot">مهتم جداً</option>
                  <option value="warm">مهتم</option>
                  <option value="cold">بارد</option>
                </select>
              </div>
            </div>

            {/* Results Count */}
            <div className="mt-4 text-sm text-slate-600">
              عرض {filteredLeads.length} من أصل {leads.length} عميل
            </div>
          </div>

          {/* Leads Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الاسم</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الجوال</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الاهتمام</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">التقييم</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">الحالة</th>
                    <th className="px-6 py-3 text-right text-sm font-medium text-slate-600">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-800">{lead.name}</td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-sm">{lead.phone}</td>
                      <td className="px-6 py-4 text-slate-600 text-sm">{lead.data?.interest || '-'}</td>
                      <td className="px-6 py-4">
                        <ScoreBadge score={lead.score} />
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewLead(lead)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="عرض"
                          >
                            <Eye size={18} />
                          </button>
                          <button
                            onClick={() => handleEditLead(lead)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                            title="تعديل"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => handleDeleteLead(lead)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="حذف"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredLeads.length === 0 && (
              <div className="text-center py-12">
                <p className="text-slate-500">لا توجد نتائج مطابقة للبحث</p>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Modals */}
        {showDetailModal && selectedLead && (
          <Portal>
            <DetailModal lead={selectedLead} onClose={() => setShowDetailModal(false)} />
          </Portal>
        )}
        {showEditModal && selectedLead && (
          <Portal>
            <EditModal
              lead={selectedLead}
              onClose={() => setShowEditModal(false)}
              onSave={(updated) => {
                if (!user?.clientId) return
                leadsApi.updateLead(user.clientId, updated.id, {
                  name: updated.name,
                  phone: updated.phone,
                  score: updated.score,
                  status: updated.status,
                  data: updated.data
                })
                  .then(() => {
                    setLeads(leads.map(l => l.id === updated.id ? updated : l))
                  })
                  .catch(() => {
                    setError('تعذر تحديث العميل')
                  })
                  .finally(() => {
                    setShowEditModal(false)
                  })
              }}
            />
          </Portal>
        )}
        {showAddModal && (
          <Portal>
            <AddModal
              onClose={() => setShowAddModal(false)}
              onAdd={(newLead) => {
                if (!user?.clientId) return
                leadsApi.createLead(user.clientId, {
                  name: newLead.name,
                  phone: newLead.phone,
                  email: newLead.email,
                  data: newLead.data
                })
                  .then((created) => {
                    const createdLead: Lead = {
                      ...newLead,
                      id: created.id || newLead.id,
                      status: created.status || newLead.status,
                      score: created.score || newLead.score,
                      createdAt: newLead.createdAt
                    }
                    setLeads([createdLead, ...leads])
                  })
                  .catch(() => {
                    setError('تعذر إضافة العميل')
                  })
                  .finally(() => {
                    setShowAddModal(false)
                  })
              }}
            />
          </Portal>
        )}
        {showDeleteConfirm && selectedLead && (
          <Portal>
            <DeleteConfirmModal
              leadName={selectedLead.name}
              onConfirm={confirmDelete}
              onCancel={() => setShowDeleteConfirm(false)}
            />
          </Portal>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  )
}

// Badge Components
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

// Modal Components
function DetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-slate-800">تفاصيل العميل</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-500">الاسم</label>
            <p className="text-lg font-semibold text-slate-800">{lead.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-500">رقم الجوال</label>
            <p className="text-lg font-mono text-slate-800">{lead.phone}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-500">التقييم</label>
              <div className="mt-1">
                <ScoreBadge score={lead.score} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">الحالة</label>
              <div className="mt-1">
                <StatusBadge status={lead.status} />
              </div>
            </div>
          </div>
          {lead.data && Object.keys(lead.data).length > 0 && (
            <div>
              <label className="text-sm font-medium text-slate-500 mb-2 block">معلومات إضافية</label>
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                {Object.entries(lead.data).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-slate-600">{key}:</span>
                    <span className="font-medium text-slate-800">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-500">تاريخ الإنشاء</label>
            <p className="text-slate-800">{new Date(lead.createdAt).toLocaleString('ar-SA')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (lead: Lead) => void }) {
  const [formData, setFormData] = useState(lead)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-slate-800">تعديل العميل</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">الاسم</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">رقم الجوال</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">التقييم</label>
              <select
                value={formData.score}
                onChange={(e) => setFormData({ ...formData, score: e.target.value as any })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              >
                <option value="hot">مهتم جداً</option>
                <option value="warm">مهتم</option>
                <option value="cold">بارد</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">الحالة</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              >
                <option value="new">جديد</option>
                <option value="contacted">تم التواصل</option>
                <option value="converted">تم البيع</option>
                <option value="lost">ملغي</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 bg-primary hover:bg-primary-dark text-white py-3 rounded-lg font-medium transition"
            >
              حفظ التعديلات
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddModal({ onClose, onAdd }: { onClose: () => void; onAdd: (lead: Lead) => void }) {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    score: 'warm' as Lead['score'],
    status: 'new' as Lead['status'],
    interest: '',
    budget: '',
    notes: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newLead: Lead = {
      id: Date.now(),
      name: formData.name,
      phone: formData.phone,
      score: formData.score,
      status: formData.status,
      data: {
        interest: formData.interest,
        budget: formData.budget,
        notes: formData.notes
      },
      createdAt: new Date().toISOString()
    }
    onAdd(newLead)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-slate-800">إضافة عميل جديد</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <X size={24} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">الاسم *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">رقم الجوال *</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="05xxxxxxxx"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">التقييم</label>
              <select
                value={formData.score}
                onChange={(e) => setFormData({ ...formData, score: e.target.value as any })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              >
                <option value="hot">مهتم جداً</option>
                <option value="warm">مهتم</option>
                <option value="cold">بارد</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">الحالة</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              >
                <option value="new">جديد</option>
                <option value="contacted">تم التواصل</option>
                <option value="converted">تم البيع</option>
                <option value="lost">ملغي</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">الاهتمام</label>
            <input
              type="text"
              value={formData.interest}
              onChange={(e) => setFormData({ ...formData, interest: e.target.value })}
              placeholder="مثال: سيدان، جيب"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">الميزانية</label>
            <input
              type="text"
              value={formData.budget}
              onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
              placeholder="مثال: 50 - 100 ألف"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">ملاحظات</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="flex-1 bg-primary hover:bg-primary-dark text-white py-3 rounded-lg font-medium transition"
            >
              إضافة العميل
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ leadName, onConfirm, onCancel }: { leadName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4">تأكيد الحذف</h2>
        <p className="text-slate-600 mb-6">
          هل أنت متأكد من حذف العميل <strong>{leadName}</strong>؟ لا يمكن التراجع عن هذا الإجراء.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-medium transition"
          >
            حذف
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
