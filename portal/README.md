# WhatsApp AI SaaS - Frontend Dashboard

Modern, responsive React dashboard for managing WhatsApp AI SaaS operations.

## Features

### 🔐 Authentication System
- Secure JWT-based login
- Protected routes
- Session management with localStorage
- Password reset placeholder

### 👥 Lead Management
- View all leads with pagination
- Search by name or phone number
- Filter by status (new, contacted, converted, lost)
- Filter by score (hot, warm, cold)
- CRUD operations (Create, Read, Update, Delete)
- Detailed lead information modals

### 📊 Analytics & Insights Dashboard
- Key metrics cards (Total leads, Today's leads, Weekly leads, Hot leads, Pending appointments, Conversion rate)
- Lead status distribution pie chart
- Lead interest level bar chart
- Trend indicators

### 🔑 API Key Management
- View all API keys
- Create new API keys
- Revoke keys
- Security best practices warnings
- Last used tracking

### 📝 Audit Logs
- Complete audit trail of all system activities
- Filter by action type
- Filter by status (success, failed, denied)
- Detailed event information
- IP address and user agent tracking

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: TailwindCSS
- **Charts**: Recharts
- **HTTP Client**: Axios
- **Icons**: Lucide React
- **State Management**: React Context API

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
cd portal
npm install
```

### Configuration

Create a `.env.local` file based on `.env.local.example`:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000

# Mock Data (set to 'true' for development without backend)
NEXT_PUBLIC_USE_MOCK_DATA=true
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
portal/
├── app/                    # Next.js App Router pages
│   ├── login/             # Login page
│   ├── dashboard/         # Main dashboard
│   ├── leads/             # Lead management
│   ├── api-keys/          # API key management
│   └── audit-logs/        # Audit logs viewer
├── components/            # React components
│   ├── auth/             # Authentication components
│   └── layout/           # Layout components
├── contexts/             # React contexts
│   └── AuthContext.tsx   # Authentication context
├── lib/                  # Utility libraries
│   ├── api/             # API client and endpoints
│   └── utils/           # Helper functions and mock data
└── public/              # Static assets
```

## Features in Detail

### Authentication Flow
1. User enters client ID on login page
2. System validates and generates JWT token
3. Token stored in localStorage
4. Protected routes check authentication status
5. Automatic redirect to login if unauthenticated

### Lead Management
- **Search**: Real-time search across names and phone numbers
- **Filters**: Status and score filters with live updates
- **Actions**: View, Edit, Delete operations
- **Modals**: Clean modal interfaces for all CRUD operations

### Dashboard Analytics
- **Real-time Stats**: Up-to-date metrics on lead performance
- **Visual Charts**: Interactive charts using Recharts
- **Trend Indicators**: Visual indicators showing performance trends

## Mock Data

The application includes comprehensive mock data for development and testing:
- 5 sample leads with varied statuses and scores
- 3 API keys (2 active, 1 revoked)
- 4 audit log entries

Mock data can be enabled/disabled via the `NEXT_PUBLIC_USE_MOCK_DATA` environment variable.

## RTL Support

The entire interface is designed for Arabic (RTL) with:
- Right-to-left text direction
- Mirrored layouts
- Arabic translations throughout
- Proper date formatting for Arabic locale

## Responsive Design

- Mobile-first approach
- Breakpoints: sm, md, lg, xl
- Hamburger menu for mobile navigation
- Touch-friendly interfaces

## Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## License

ISC
