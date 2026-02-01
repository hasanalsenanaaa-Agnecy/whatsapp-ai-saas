export const mockClient = {
  id: 'client_123',
  name: 'Test Agency',
  email: 'test@example.com',
  phone: '+966501234567',
  industry: 'real-estate',
  created_at: new Date(),
  updated_at: new Date()
};

export const mockLead = {
  id: 1,
  clientId: 'client_123',
  name: 'John Doe',
  phone: '+966509876543',
  email: 'john@example.com',
  status: 'new',
  score: 'hot',
  created_at: new Date(),
  updated_at: new Date()
};

export const mockLeads = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  clientId: 'client_123',
  name: `Lead ${i + 1}`,
  phone: `+966501234${String(i).padStart(3, '0')}`,
  email: `lead${i + 1}@example.com`,
  status: ['new', 'contacted', 'converted'][i % 3],
  score: ['hot', 'warm', 'cold'][i % 3],
  created_at: new Date(Date.now() - i * 86400000),
  updated_at: new Date(Date.now() - i * 86400000)
}));

export const mockStats = {
  totalLeads: 50,
  todayLeads: 5,
  weekLeads: 20,
  hotLeads: 15,
  convertedLeads: 10,
  pendingAppointments: 8,
  conversionRate: 20,
  leadsByStatus: {
    new: 25,
    contacted: 15,
    converted: 10
  },
  leadsByScore: {
    hot: 15,
    warm: 20,
    cold: 15
  }
};
