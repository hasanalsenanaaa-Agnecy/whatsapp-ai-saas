import { google } from 'googleapis';
import type { ClientConfig } from '../types/client.js';

let sheets: any = null;
let sheetsInitialized = false;

export async function initGoogleSheets() {
  try {
    const credentials = process.env.GOOGLE_CREDENTIALS;
    if (!credentials) {
      console.log('⚠️ Google Sheets not configured');
      return;
    }
    const auth = new google.auth.GoogleAuth({ 
      credentials: JSON.parse(credentials), 
      scopes: ['https://www.googleapis.com/auth/spreadsheets'] 
    });
    sheets = google.sheets({ version: 'v4', auth });
    sheetsInitialized = true;
    console.log('✅ Google Sheets initialized');
  } catch (error) { 
    console.error('❌ Sheets init failed:', error); 
  }
}

export async function saveLeadToSheet(client: ClientConfig, leadData: Record<string, any>) {
  if (!sheetsInitialized || !sheets) return false;

  const sheetId = client.settings?.googleSheetId || process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return false;

  try {
    const timestamp = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
    const internalFields = ['name', 'phone', 'whatsappPhone', 'nameAsked', 'leadId'];
    const answers = Object.entries(leadData)
      .filter(([key]) => !internalFields.includes(key))
      .map(([_, value]) => String(value || ''));

    const row = [timestamp, leadData.name || '', leadData.phone || '', ...answers];
    console.log('📊 Saving lead:', row.join(' | '));

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Leads!A:Z',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
    console.log('✅ Saved lead to Sheets');
    return true;
  } catch (error) {
    console.error('❌ Sheets error:', error);
    return false;
  }
}

// ============================================================
// ORDER LOGGING
// Appends a row to the "Orders" tab of the client's sheet.
// Creates the tab with headers if it doesn't exist.
// ============================================================

export interface OrderRow {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  products: string;  // multi-line description
  total: string;
  currency: string;
  checkoutUrl?: string;
  status: string;    // "paid", "pending", etc.
}

export async function saveOrderToSheet(client: ClientConfig, order: OrderRow): Promise<boolean> {
  if (!sheetsInitialized || !sheets) return false;

  const sheetId = client.settings?.googleSheetId || process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return false;

  try {
    await ensureOrdersTab(sheetId);

    const timestamp = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
    const row = [
      timestamp,
      order.orderNumber,
      order.customerName,
      order.customerPhone,
      order.products,
      order.total,
      order.currency,
      order.status,
      order.checkoutUrl || '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Orders!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    console.log(`✅ Saved order ${order.orderNumber} to Sheets`);
    return true;
  } catch (error) {
    console.error('❌ Sheets order save error:', error);
    return false;
  }
}

async function ensureOrdersTab(sheetId: string): Promise<void> {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabs = meta.data.sheets?.map((s: any) => s.properties?.title) || [];
    if (tabs.includes('Orders')) return;

    // Create Orders tab with headers
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Orders' } } }],
      },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Orders!A1:I1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['التاريخ', 'رقم الطلب', 'الاسم', 'الجوال', 'المنتجات', 'المبلغ', 'العملة', 'الحالة', 'رابط الطلب']],
      },
    });
  } catch (error) {
    // Tab may already exist — non-fatal
    console.warn('ensureOrdersTab warning:', error);
  }
}
