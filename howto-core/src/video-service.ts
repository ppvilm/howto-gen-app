import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export interface AudioTrack {
  path: string;
  startTime: number;
  duration?: number;
  label?: string;
}

export interface VideoWithAudioOptions {
  videoPath: string;
  audioFiles: Array<AudioTrack>;
  outputPath: string;
  trimStart?: number; // seconds to trim from the beginning (removes solid color frames)
}

export class VideoService {
  static async combineVideoWithAudio(options: VideoWithAudioOptions): Promise<void> {
    const { videoPath, audioFiles, outputPath, trimStart = 0 } = options;
    
    // Check if ffmpeg is available
    if (!await this.isFFmpegAvailable()) {
      console.warn('FFmpeg not available. Skipping audio integration.');
      // Just copy the video file
      await fs.copyFile(videoPath, outputPath);
      return;
    }

    // Create complex filter for time-aligned audio
    let filterComplex = '';
    let inputs = [];
    
    // Add video input with optional trimming
    if (trimStart > 0) {
      inputs.push(`-ss ${trimStart}`, `-i "${videoPath}"`);
      console.log(`Trimming ${trimStart} seconds from the beginning of video`);
    } else {
      inputs.push(`-i "${videoPath}"`);
    }
    
    // Add audio inputs
    audioFiles.forEach((audio, index) => {
      inputs.push(`-i "${audio.path}"`);
    });

    // Create time-aligned audio filter
    if (audioFiles.length > 0) {
      let filterParts: string[] = [];
      
      // Create delayed audio streams for each audio file
      audioFiles.forEach((audio, index) => {
        const inputIndex = index + 1;
        // Adjust audio start time for video trimming
        const adjustedStartTime = Math.max(0, audio.startTime - trimStart);
        if (adjustedStartTime > 0) {
          // Add delay to position audio at correct time
          filterParts.push(`[${inputIndex}:a]adelay=${Math.round(adjustedStartTime * 1000)}|${Math.round(adjustedStartTime * 1000)}[a${index}]`);
        } else {
          // No delay needed
          filterParts.push(`[${inputIndex}:a]anull[a${index}]`);
        }
      });
      
      // Mix all delayed audio streams
      const mixInputs = audioFiles.map((_, index) => `[a${index}]`).join('');
      filterParts.push(`${mixInputs}amix=inputs=${audioFiles.length}:duration=longest[aout]`);
      
      filterComplex = `-filter_complex "${filterParts.join(';')}"`;
    }

    const ffmpegCommand = [
      'ffmpeg',
      '-y', // Overwrite output file
      ...inputs.join(' ').split(' '),
      filterComplex,
      '-map', '0:v', // Video from first input
      '-map', '[aout]', // Mixed audio
      '-c:v', 'libx264', // Re-encode video to H.264 for MP4 compatibility
      '-c:a', 'aac', // Encode audio as AAC
      '-preset', 'medium', // Encoding speed/quality trade-off
      `"${outputPath}"`
    ].filter(Boolean);

    console.log('Combining video with audio...');
    console.log('FFmpeg command:', ffmpegCommand.join(' '));

    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', ffmpegCommand.slice(1), {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          console.log('Video with audio created successfully');
          resolve();
        } else {
          console.error('FFmpeg error:', stderr);
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }

  static async isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      
      process.on('close', (code) => {
        resolve(code === 0);
      });
      
      process.on('error', () => {
        resolve(false);
      });
    });
  }

  static async detectContentStart(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Use FFmpeg scene detection to find when content actually starts
      // This detects the first significant scene change from solid color
      const ffprobeCommand = [
        'ffprobe',
        '-f', 'lavfi',
        '-i', `movie=${videoPath},select=gt(scene\\,0.1)[out0]`,
        '-show_entries', 'frame=pkt_pts_time',
        '-of', 'csv=p=0',
        '-v', 'quiet'
      ];

      console.log('Detecting content start using scene detection...');
      
      const process = spawn('ffprobe', ffprobeCommand.slice(1), {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      
      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          // Parse the first scene change timestamp
          const lines = stdout.trim().split('\n');
          if (lines.length > 0 && lines[0]) {
            const firstSceneTime = parseFloat(lines[0]);
            if (!isNaN(firstSceneTime) && firstSceneTime > 0) {
              console.log(`Content detected at ${firstSceneTime}s using scene detection`);
              resolve(firstSceneTime);
              return;
            }
          }
        }
        
        // Fallback: try blackdetect for dark/solid backgrounds
        console.log('Scene detection failed, trying blackdetect...');
        this.detectBlackEnd(videoPath)
          .then(blackEndTime => {
            if (blackEndTime > 0) {
              console.log(`Black frames end at ${blackEndTime}s`);
              resolve(blackEndTime);
            } else {
              // Final fallback: no automatic detection, use small default
              console.log('Automatic detection failed, using 1s default trim');
              resolve(1.0);
            }
          })
          .catch(() => {
            console.log('All detection methods failed, using 1s default trim');
            resolve(1.0);
          });
      });

      process.on('error', (error) => {
        console.warn('Scene detection error:', error.message);
        // Try blackdetect as fallback
        this.detectBlackEnd(videoPath)
          .then(resolve)
          .catch(() => resolve(1.0));
      });
    });
  }

  static async detectBlackEnd(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // Detect end of black/dark frames at the beginning
      const ffmpegCommand = [
        'ffmpeg',
        '-i', `"${videoPath}"`,
        '-vf', 'blackdetect=d=0.1:pix_th=0.1',
        '-f', 'null',
        '-t', '10', // Only analyze first 10 seconds
        '-'
      ];

      const process = spawn('ffmpeg', ffmpegCommand.slice(1), {
        shell: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let stderr = '';
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        // Parse blackdetect output
        const blackdetectRegex = /black_end:([\d\.]+)/g;
        let lastBlackEnd = 0;
        let match;
        
        while ((match = blackdetectRegex.exec(stderr)) !== null) {
          const blackEnd = parseFloat(match[1]);
          if (blackEnd > lastBlackEnd) {
            lastBlackEnd = blackEnd;
          }
        }
        
        resolve(lastBlackEnd);
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  static async createVideoWithNarration(
    videoPath: string,
    audioDir: string,
    outputPath: string,
    stepResults?: Array<{ step: any; timestamp?: number; duration?: number }>
  ): Promise<void> {
    try {
      // Get list of audio files
      const audioFiles = await fs.readdir(audioDir);
      const mp3Files = audioFiles.filter(file => file.endsWith('.mp3'));
      
      if (mp3Files.length === 0) {
        console.log('No audio files found, copying video without audio integration');
        await fs.copyFile(videoPath, outputPath);
        return;
      }

      // Create audio tracks with timing information from step results
      const audioTracks: AudioTrack[] = [];
      
      if (stepResults) {
        // Only consider steps that happened during recording
        const videoRecordingSteps = stepResults.filter(r => r.timestamp !== undefined && r.timestamp >= 0);
        console.log(`Video timeline starts at 0s with ${videoRecordingSteps.length} steps during recording`);

        // Helper: find the next actionable step (type/click) timestamp after a given index
        // Find the next typing step (we align narration to actual typing, not clicks)
        const findNextTyping = (fromIndex: number): { index: number; timestamp: number } | undefined => {
          for (let j = fromIndex + 1; j < stepResults.length; j++) {
            const next = stepResults[j];
            if (next.step.type === 'type' && next.timestamp !== undefined && next.timestamp >= 0) {
              return { index: j, timestamp: next.timestamp };
            }
          }
          return undefined;
        };
        const findNextTTSStartIndex = (fromIndex: number): number | undefined => {
          for (let j = fromIndex + 1; j < stepResults.length; j++) {
            if (stepResults[j].step.type === 'tts_start') return j;
          }
          return undefined;
        };

        // Env flag to enable optional alignment to next typing action
        const alignEnv = process.env.TTS_ALIGN_TO_NEXT_TYPING;
        const enableAlign = alignEnv ? !/^0|false$/i.test(alignEnv) : false;

        // Iterate with index to align TTS start with the next typing/click action (opt-in)
        for (let i = 0; i < stepResults.length; i++) {
          const stepResult = stepResults[i];
          const step = stepResult.step;

          if (step.type === 'tts_start' && step.label) {
            const audioFile = `${step.label}.mp3`;
            if (!mp3Files.includes(audioFile)) continue; // no audio generated

            const audioPath = path.join(audioDir, audioFile);
            const ts = stepResult.timestamp;

            // Skip if TTS happened before recording started
            if (ts === undefined || ts < 0) {
              console.log(`Skipping audio "${step.label}" - occurred before video recording started`);
              continue;
            }

            // Base start time is when tts_start was executed plus any configured delayMs
            const baseStart = ts + ((step.delayMs ?? 0) / 1000);
            // Align to next typing start (with a small preroll) ONLY if enabled and no other tts_start occurs before that typing
            const nextType = findNextTyping(i);
            const nextTTSIdx = findNextTTSStartIndex(i);
            const preroll = 0.12; // seconds
            const shouldAlignToTyping = enableAlign && nextType && (nextTTSIdx === undefined || nextType.index < nextTTSIdx);
            const alignedStart = shouldAlignToTyping
              ? Math.max(baseStart, Math.max(0, nextType!.timestamp - preroll))
              : baseStart;

            audioTracks.push({
              path: audioPath,
              startTime: alignedStart,
              duration: stepResult.duration,
              label: step.label
            });

            if (shouldAlignToTyping && nextType) {
              console.log(`Scheduling audio "${step.label}" at ${alignedStart}s (aligned to typing at ${nextType.timestamp}s with ${preroll}s preroll)`);
            } else {
              console.log(`Scheduling audio "${step.label}" at ${alignedStart}s (exact tts_start alignment)`);
            }
          }
        }
      }
      
      // Fallback: if no timing info, space audio files evenly
      if (audioTracks.length === 0) {
        audioTracks.push(...mp3Files.map((file, index) => ({
          path: path.join(audioDir, file),
          startTime: index * 3, // 3 second spacing
          label: file.replace('.mp3', '')
        })));
      }

      // Calculate trim duration using automatic detection or fallback
      let trimDuration = 0;
      
      // Check for environment variable override first
      const envTrim = process.env.VIDEO_TRIM_START;
      if (envTrim !== undefined) {
        const customTrim = parseFloat(envTrim);
        if (!isNaN(customTrim) && customTrim >= 0) {
          trimDuration = customTrim;
          console.log(`Using custom trim duration: ${trimDuration}s (from VIDEO_TRIM_START)`);
        }
      } else {
        // Use automatic detection to find when content starts
        try {
          trimDuration = await this.detectContentStart(videoPath);
          console.log(`Automatic detection: trimming ${trimDuration}s from start`);
        } catch (error) {
          console.warn('Automatic detection failed:', error);
          // Fallback: use step timing analysis
          trimDuration = 2.0; // Default fallback
          
          if (stepResults && stepResults.length > 0) {
            const firstAction = stepResults.find(r => 
              r.timestamp !== undefined && 
              r.timestamp >= 0 && 
              r.step.type !== 'goto' && 
              r.step.type !== 'tts_start'
            );
            
            if (firstAction && firstAction.timestamp !== undefined) {
              trimDuration = Math.max(1.0, Math.min(trimDuration, firstAction.timestamp - 0.5));
            }
          }
          
          console.log(`Using fallback trim duration: ${trimDuration}s`);
        }
      }

      await this.combineVideoWithAudio({
        videoPath,
        audioFiles: audioTracks,
        outputPath,
        trimStart: trimDuration
      });

    } catch (error) {
      console.error('Error creating video with narration:', error);
      // Fallback: just copy the original video
      await fs.copyFile(videoPath, outputPath);
    }
  }
}
