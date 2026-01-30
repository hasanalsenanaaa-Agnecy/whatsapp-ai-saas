import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import { config } from '../config.js';
import type { LeadData } from '../types.js';

// ============================================================
// GOOGLE SHEETS SERVICE
// ============================================================

let sheetsClient: sheets_v4.Sheets | null = null;
let isInitialized = false;

/**
 * Initialize Google Sheets connection
 */
export async function initGoogleSheets(): Promise<boolean> {
  // Skip if already initialized
  if (isInitialized) {
    return !!sheetsClient;
  }

  try {
    // Try to get credentials from environment or file
    let credentials: any = null;

    if (config.google.credentials) {
      // From environment variable
      credentials = JSON.parse(config.google.credentials);
    } else if (fs.existsSync(config.google.credentialsPath)) {
      // From file
      credentials = JSON.parse(fs.readFileSync(config.google.credentialsPath, 'utf8'));
    } else {
      console.warn('⚠️ Google Sheets credentials not found - lead saving disabled');
      isInitialized = true;
      return false;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    
    // Verify connection by checking sheet exists
    if (config.google.sheetId) {
      await sheetsClient.spreadsheets.get({
        spreadsheetId: config.google.sheetId
      });
      console.log('✅ Google Sheets connected');
    } else {
      console.warn('⚠️ GOOGLE_SHEET_ID not set');
    }

    isInitialized = true;
    return true;

  } catch (error) {
    console.error('❌ Google Sheets initialization failed:', error);
    isInitialized = true;
    return false;
  }
}

/**
 * Save lead to Google Sheet
 */
export async function saveLeadToSheet(lead: LeadData): Promise<boolean> {
  if (!sheetsClient) {
    console.warn('⚠️ Google Sheets not initialized - skipping lead save');
    return false;
  }

  if (!config.google.sheetId) {
    console.warn('⚠️ GOOGLE_SHEET_ID not configured');
    return false;
  }

  try {
    // Format row data
    const timestamp = new Date().toLocaleString('en-US', { 
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const values = [[
      timestamp,
      lead.name,
      lead.phone,
      lead.email,
      lead.whatsappPhone,
      lead.propertyType,
      lead.city,
      lead.budget,
      lead.bedrooms,
      'New',  // Status
      ''      // Notes (for agent to fill)
    ]];

    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: `${config.google.sheetName}!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });

    console.log(`✅ Lead saved: ${lead.name} (${lead.whatsappPhone})`);
    return true;

  } catch (error: any) {
    // Handle specific Google API errors
    if (error.code === 403) {
      console.error('❌ Google Sheets permission denied. Check service account access.');
    } else if (error.code === 404) {
      console.error('❌ Google Sheet not found. Check GOOGLE_SHEET_ID.');
    } else {
      console.error('❌ Failed to save lead:', error.message);
    }
    return false;
  }
}

/**
 * Get all leads from sheet (useful for admin/dashboard)
 */
export async function getLeadsFromSheet(limit: number = 100): Promise<LeadData[]> {
  if (!sheetsClient || !config.google.sheetId) {
    return [];
  }

  try {
    const response = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: `${config.google.sheetName}!A2:K${limit + 1}` // Skip header row
    });

    const rows = response.data.values || [];
    
    return rows.map(row => ({
      timestamp: row[0] || '',
      name: row[1] || '',
      phone: row[2] || '',
      email: row[3] || '',
      whatsappPhone: row[4] || '',
      propertyType: row[5] || '',
      city: row[6] || '',
      budget: row[7] || '',
      bedrooms: row[8] || ''
    })) as LeadData[];

  } catch (error) {
    console.error('❌ Failed to fetch leads:', error);
    return [];
  }
}

/**
 * Update lead status in sheet
 */
export async function updateLeadStatus(
  rowIndex: number, 
  status: string, 
  notes?: string
): Promise<boolean> {
  if (!sheetsClient || !config.google.sheetId) {
    return false;
  }

  try {
    const values = [[status, notes || '']];
    
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: `${config.google.sheetName}!J${rowIndex}:K${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to update lead status:', error);
    return false;
  }
}

/**
 * Check if Google Sheets is available
 */
export function isSheetsAvailable(): boolean {
  return !!sheetsClient && !!config.google.sheetId;
}
