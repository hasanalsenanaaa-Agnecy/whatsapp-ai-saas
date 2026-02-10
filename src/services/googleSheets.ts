import { google } from 'googleapis';

let sheets: any = null;
let sheetsInitialized = false;

export async function initGoogleSheets() {
  try {
    const credentials = process.env.GOOGLE_CREDENTIALS;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!credentials || !sheetId) { console.log('⚠️ Google Sheets not configured'); return; }
    
    const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(credentials), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    sheets = google.sheets({ version: 'v4', auth });
    sheetsInitialized = true;
    console.log('✅ Google Sheets initialized');
  } catch (error) { console.error('❌ Sheets init failed:', error); }
}

export async function saveLeadToSheet(lead: Record<string, any>) {
  if (!sheetsInitialized || !sheets) { console.log('⚠️ Sheets not initialized'); return false; }
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return false;
  
  try {
    const row = [lead.timestamp || new Date().toISOString(), lead.name || '', lead.phone || '', lead.property_type || lead.car_type || '', lead.city || '', lead.budget || ''];
    await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: 'Sheet1!A:Z', valueInputOption: 'USER_ENTERED', requestBody: { values: [row] } });
    console.log('✅ Lead saved to Sheets');
    return true;
  } catch (error) { console.error('❌ Sheets error:', error); return false; }
}
