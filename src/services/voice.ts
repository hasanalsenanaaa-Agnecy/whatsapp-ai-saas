import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
export async function transcribeVoiceNote(audioUrl: string, accessToken: string): Promise<string> {
  try {
    // Download audio from WhatsApp
    const audioResponse = await fetch(audioUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    
    // Create file for OpenAI
    const file = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });
    
    // Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      language: 'ar' // Arabic - also handles English
    });

    console.log('🎤 Transcribed:', transcription.text.substring(0, 50) + '...');
    return transcription.text;

  } catch (error) {
    console.error('❌ Transcription error:', error);
    return '';
  }
}
