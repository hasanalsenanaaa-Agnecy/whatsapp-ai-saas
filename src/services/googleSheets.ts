import { google } from 'googleapis';

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

export async function saveLeadToSheet(client: any, leadData: Record<string, any>) {
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
    console.log('📊 Saving:', row.join(' | '));
    
    await sheets.spreadsheets.values.append({ 
      spreadsheetId: sheetId, 
      range: 'Sheet1!A:Z', 
      valueInputOption: 'USER_ENTERED', 
      requestBody: { values: [row] } 
    });
    console.log('✅ Saved to Sheets');
    return true;
  } catch (error) { 
    console.error('❌ Sheets error:', error); 
    return false; 
  }
}
