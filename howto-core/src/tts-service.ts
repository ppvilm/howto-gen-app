import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs/promises';
import path from 'path';

export interface TTSRequest {
  text: string;
  voice?: string;
  outputPath: string;
}

export class TTSService {
  private elevenlabs: ElevenLabsClient | null = null;
  private activeRequests: Map<string, Promise<void>> = new Map();
  private completedRequests: Set<string> = new Set();
  private audioDurations: Map<string, number> = new Map();

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
      this.elevenlabs = new ElevenLabsClient({
        apiKey: apiKey
      });
      console.log('ElevenLabs TTS service initialized');
    } else {
      console.log('ElevenLabs TTS not available (set ELEVENLABS_API_KEY to enable)');
    }
  }

  async startTTS(request: TTSRequest): Promise<string> {
    if (!this.elevenlabs) {
      throw new Error('ElevenLabs API not initialized. Set ELEVENLABS_API_KEY environment variable.');
    }

    const requestId = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`Starting TTS generation: ${requestId}`);
    console.log(`Text: "${request.text.substring(0, 100)}${request.text.length > 100 ? '...' : ''}"`);
    console.log(`Voice: ${request.voice || 'default'}`);
    console.log(`Output: ${request.outputPath}`);

    const ttsPromise = this.generateAudio(request, requestId);
    this.activeRequests.set(requestId, ttsPromise);

    // Track completed requests
    ttsPromise.finally(() => {
      this.activeRequests.delete(requestId);
      this.completedRequests.add(requestId);
    });

    return requestId;
  }

  async waitForTTS(requestId: string): Promise<void> {
    // Check if already completed
    if (this.completedRequests.has(requestId)) {
      console.log(`TTS already completed: ${requestId}`);
      return;
    }

    const request = this.activeRequests.get(requestId);
    if (!request) {
      throw new Error(`TTS request ${requestId} not found. Use tts_start before tts_wait.`);
    }

    console.log(`Waiting for TTS completion: ${requestId}`);
    await request;
    console.log(`TTS completed: ${requestId}`);
  }

  async waitForTTSGeneration(requestId: string): Promise<void> {
    // Just wait for TTS file generation (no playback duration)
    await this.waitForTTS(requestId);
  }

  async waitForTTSAndPlayback(requestId: string): Promise<void> {
    // First wait for TTS generation to complete
    await this.waitForTTS(requestId);
    
    // Then wait for the estimated audio duration (simulating full playback)
    const audioDuration = this.audioDurations.get(requestId);
    if (audioDuration && audioDuration > 0) {
      console.log(`Waiting for audio playback duration: ${audioDuration.toFixed(1)}s`);
      await new Promise(resolve => setTimeout(resolve, audioDuration * 1000));
      console.log(`Audio playback simulation completed`);
    }
  }

  private async generateAudio(request: TTSRequest, requestId: string): Promise<void> {
    if (!this.elevenlabs) {
      throw new Error('ElevenLabs API not initialized');
    }

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(request.outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Generate audio using the correct API
      const audioResponse = await this.elevenlabs.textToSpeech.convert(
        request.voice || 'FTNCalFNG5bRnkkaP5Ug', // Voice ID
        {
          text: request.text,
          modelId: 'eleven_multilingual_v2'
        }
      );

      // Convert stream to buffer and save
      const chunks: Uint8Array[] = [];
      const reader = audioResponse.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      
      const audioBuffer = Buffer.concat(chunks);
      await fs.writeFile(request.outputPath, audioBuffer);

      console.log(`Audio saved to: ${request.outputPath}`);
      
      // Estimate audio duration (very rough calculation)
      // ElevenLabs typically generates ~150-200 words per minute
      const wordCount = request.text.split(' ').length;
      const estimatedDuration = (wordCount / 170) * 60; // seconds
      console.log(`Estimated audio duration: ${estimatedDuration.toFixed(1)}s for ${wordCount} words`);
      
      // Store duration for this request
      this.audioDurations.set(requestId, estimatedDuration);
    } catch (error) {
      console.error('TTS generation failed:', error);
      throw error;
    }
  }

  static isAvailable(): boolean {
    return !!process.env.ELEVENLABS_API_KEY;
  }

  static create(): TTSService {
    return new TTSService();
  }
}