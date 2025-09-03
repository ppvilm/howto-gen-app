import path from 'path';
import { MarkdownParser } from './parser';
import { StepValidator } from './validator';
import { PlaywrightRunner } from './runner';
import { ArtifactManager } from './artifact-manager';
import { MarkdownRenderer } from './renderer';
import { VideoService } from './video-service';
import { SecretsManager } from './secrets';
import { VariablesManager } from './variables';
import { WorkspaceManager } from './workspace-manager';
import { sessionManager } from './session-manager';
import { GuideResult, StepResult, RunEvent, SessionStatus } from './types';

export interface GenerateOptions {
  outputDir?: string;
  headful?: boolean;
  dryRun?: boolean;
  secrets?: Record<string, string>;
  variables?: Record<string, any>;
  workspaceManager?: WorkspaceManager;
}

export class HowtoGenerator {
  async generate(markdownPath: string, options: GenerateOptions = {}): Promise<GuideResult> {
    const markdownContent = await ArtifactManager.readFile(markdownPath);
    const parsed = MarkdownParser.parse(markdownContent);
    const config = StepValidator.validateConfig(parsed.frontmatter);

    // Setup workspace if provided
    let workspaceManager = options.workspaceManager;
    let outputDir: string;
    let screenshotDir: string;
    let domSnapshotDir: string;
    let audioDir: string;

    if (workspaceManager) {
      // Workspace mode: use session-based paths
      await workspaceManager.ensureWorkspace();
      outputDir = workspaceManager.getSessionOutputPath();
      screenshotDir = workspaceManager.getSessionScreenshotsPath();
      domSnapshotDir = workspaceManager.getSessionDOMSnapshotsPath();
      audioDir = workspaceManager.getSessionAudioPath();
      
      // Load secrets and variables from workspace config if not provided
      if (!options.secrets) {
        try {
          const secrets = await workspaceManager.loadConfig<Record<string, string>>('secrets.json');
          options.secrets = secrets;
        } catch {
          // No workspace secrets, use empty
        }
      }
      
      if (!options.variables) {
        try {
          const variables = await workspaceManager.loadConfig<Record<string, any>>('variables.json');
          options.variables = variables;
        } catch {
          // No workspace variables, use empty
        }
      }
    } else {
      // Legacy mode: use provided or default paths
      outputDir = options.outputDir || config.outputDir || 'dist';
      await ArtifactManager.ensureOutputDir(outputDir);
      screenshotDir = await ArtifactManager.ensureScreenshotDir(outputDir);
      domSnapshotDir = await ArtifactManager.ensureDOMSnapshotDir(outputDir);
      audioDir = path.join(outputDir, 'audio');
      await ArtifactManager.ensureOutputDir(audioDir);
    }

    // Initialize managers
    const secretsManager = new SecretsManager(options.secrets);
    const variablesManager = new VariablesManager(options.variables);
    
    // Resolve secret placeholders in all steps
    if (options.secrets || options.variables) {
      config.steps = config.steps.map(step => {
        if (step.type !== 'type' || !step.value) return step;
        // Secrets first
        const secret = secretsManager.resolvePlaceholder(step.value);
        if (secret.isSecretRef) {
          if (!secret.resolved) throw new Error(`Secret key not found: ${secret.key}`);
          return { ...step, value: secret.resolved, sensitive: true };
        }
        // Variables next (non-sensitive)
        const vari = variablesManager.resolvePlaceholder(step.value);
        if (vari.isVarRef) {
          if (vari.resolved === undefined) throw new Error(`Variable key not found: ${vari.key}`);
          return { ...step, value: vari.resolved };
        }
        return step;
      });
    }

    let stepResults: StepResult[] = [];
    let videoPath: string | undefined;

    if (!options.dryRun) {
      const runner = new PlaywrightRunner();
      
      try {
        // Initialize without video recording first for TTS preprocessing
        await runner.initialize(options.headful, false);

        // Preprocess all TTS requests at the beginning (no video recording)
        await runner.preprocessAllTTS(config.steps, audioDir);

        for (let i = 0; i < config.steps.length; i++) {
          const step = config.steps[i];
          console.log(`Executing step ${i + 1}/${config.steps.length}: ${step.type} ${step.label || step.url || ''}`);
          
          // Start video recording after first navigation is complete
          if (step.type === 'goto' && i === 0 && config.recordVideo) {
            const result = await runner.executeStep(step, i, config, screenshotDir, domSnapshotDir, config.steps);
            stepResults.push(result);
            
            if (result.success) {
              console.log('First navigation complete, starting video recording...');
              await runner.startVideoRecording(path.join(outputDir, 'recording.webm'));
            }
          } else {
            const result = await runner.executeStep(step, i, config, screenshotDir, domSnapshotDir, config.steps);
            stepResults.push(result);
          }

          if (!stepResults[stepResults.length - 1].success) {
            console.warn(`Step ${i + 1} failed: ${stepResults[stepResults.length - 1].error}`);
          }
        }
      } finally {
        videoPath = await runner.close();
      }
      
      // Process video with audio if recording was enabled
      if (config.recordVideo && videoPath) {
        const videoDir = workspaceManager ? workspaceManager.getSessionVideosPath() : outputDir;
        const finalVideoPath = path.join(videoDir, 'guide-video.mp4');
        await VideoService.createVideoWithNarration(videoPath, audioDir, finalVideoPath, stepResults);
        console.log(`Video with narration created: ${finalVideoPath}`);
      }
    } else {
      stepResults = config.steps.map((step, index) => ({
        step,
        index,
        success: true,
        screenshot: `step-${String(index + 1).padStart(2, '0')}.png`
      }));
    }

    const videoDir = workspaceManager ? workspaceManager.getSessionVideosPath() : outputDir;
    const result: GuideResult = {
      config,
      originalBody: parsed.body,
      stepResults,
      screenshotDir,
      videoPath: config.recordVideo ? path.join(videoDir, 'guide-video.mp4') : undefined
    };

    const finalMarkdown = MarkdownRenderer.generateCompleteGuide(result);
    const outputFileName = path.basename(markdownPath);
    
    // Choose output location based on mode
    const guidesDir = workspaceManager ? workspaceManager.getSessionGuidesPath() : outputDir;
    const outputPath = path.join(guidesDir, outputFileName);
    
    await ArtifactManager.writeFile(outputPath, finalMarkdown);

    const logPath = path.join(outputDir, 'guide-log.json');
    await ArtifactManager.writeJson(logPath, {
      timestamp: new Date().toISOString(),
      source: markdownPath,
      output: outputPath,
      screenshots: screenshotDir,
      stepResults: stepResults.map(r => ({
        step: r.step,
        success: r.success,
        error: r.error,
        screenshot: r.screenshot
      }))
    });

    // Save session metadata if using workspace
    if (workspaceManager) {
      const startTime = Date.now(); // This should ideally be captured at the beginning
      const isSuccess = stepResults.every(r => r.success);
      const errors = stepResults.filter(r => !r.success).map(r => r.error || 'Unknown error');
      
      await workspaceManager.saveSessionMetadata({
        sessionId: workspaceManager.getSessionId(),
        flowName: workspaceManager.getFlowName(),
        createdAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        inputFile: markdownPath,
        configuration: {
          headful: options.headful,
          dryRun: options.dryRun,
          recordVideo: config.recordVideo
        },
        success: isSuccess,
        stepCount: stepResults.length,
        errorLogs: errors.length > 0 ? errors : undefined,
        duration: Date.now() - startTime
      });
    }

    console.log(`Guide generated successfully!`);
    console.log(`Output: ${outputPath}`);
    console.log(`Screenshots: ${screenshotDir}`);
    console.log(`Log: ${logPath}`);
    if (result.videoPath) {
      console.log(`Video: ${result.videoPath}`);
    }
    if (workspaceManager) {
      console.log(`Session: ${workspaceManager.getSessionId()}`);
    }

    return result;
  }

  /**
   * Generate guide asynchronously with event emission
   * Returns immediately after starting the background execution
   */
  async generateAsync(
    scriptId: string,
    markdownPath: string, 
    options: GenerateOptions = {}
  ): Promise<void> {
    // Create session for this execution
    const session = sessionManager.createSession(scriptId, 'run');
    
    // Set cleanup function to cancel runner if session is cancelled
    let runner: PlaywrightRunner | undefined;
    sessionManager.setSessionCleanup(scriptId, () => {
      if (runner) {
        runner.close().catch(console.warn);
      }
    });

    // Start execution in background
    setImmediate(async () => {
      try {
        const startTime = Date.now();
        
        // Start the session
        sessionManager.startSession(scriptId);
        
        // Parse and validate
        const markdownContent = await ArtifactManager.readFile(markdownPath);
        const parsed = MarkdownParser.parse(markdownContent);
        const config = StepValidator.validateConfig(parsed.frontmatter);

        // Update session with total steps
        sessionManager.updateSessionProgress(scriptId, 0, 0);
        const session = sessionManager.getSession(scriptId);
        if (session) {
          session.totalSteps = config.steps.length;
        }

        // Emit script loaded event
        sessionManager.emitEvent(scriptId, {
          type: 'script_loaded',
          scriptId,
          totalSteps: config.steps.length,
          config
        });

        // Setup workspace similar to generate method
        let workspaceManager = options.workspaceManager;
        let outputDir: string;
        let screenshotDir: string;
        let domSnapshotDir: string;
        let audioDir: string;

        if (workspaceManager) {
          await workspaceManager.ensureWorkspace();
          outputDir = workspaceManager.getSessionOutputPath();
          screenshotDir = workspaceManager.getSessionScreenshotsPath();
          domSnapshotDir = workspaceManager.getSessionDOMSnapshotsPath();
          audioDir = workspaceManager.getSessionAudioPath();
          
          if (!options.secrets) {
            try {
              const secrets = await workspaceManager.loadConfig<Record<string, string>>('secrets.json');
              options.secrets = secrets;
            } catch {}
          }
          
          if (!options.variables) {
            try {
              const variables = await workspaceManager.loadConfig<Record<string, any>>('variables.json');
              options.variables = variables;
            } catch {}
          }
        } else {
          outputDir = options.outputDir || config.outputDir || 'dist';
          await ArtifactManager.ensureOutputDir(outputDir);
          screenshotDir = await ArtifactManager.ensureScreenshotDir(outputDir);
          domSnapshotDir = await ArtifactManager.ensureDOMSnapshotDir(outputDir);
          audioDir = path.join(outputDir, 'audio');
          await ArtifactManager.ensureOutputDir(audioDir);
        }

        // Initialize managers
        const secretsManager = new SecretsManager(options.secrets);
        const variablesManager = new VariablesManager(options.variables);
        
        // Resolve secret placeholders
        if (options.secrets || options.variables) {
          config.steps = config.steps.map(step => {
            if (step.type !== 'type' || !step.value) return step;
            const secret = secretsManager.resolvePlaceholder(step.value);
            if (secret.isSecretRef) {
              if (!secret.resolved) throw new Error(`Secret key not found: ${secret.key}`);
              return { ...step, value: secret.resolved, sensitive: true };
            }
            const vari = variablesManager.resolvePlaceholder(step.value);
            if (vari.isVarRef) {
              if (vari.resolved === undefined) throw new Error(`Variable key not found: ${vari.key}`);
              return { ...step, value: vari.resolved };
            }
            return step;
          });
        }

        let stepResults: StepResult[] = [];
        let videoPath: string | undefined;

        // Emit config validated
        sessionManager.emitEvent(scriptId, {
          type: 'config_validated',
          config
        });

        // Execute steps if not dry run
        if (!options.dryRun) {
          runner = new PlaywrightRunner();
          
          try {
            await runner.initialize(options.headful, false);

            // Emit video recording started if enabled
            if (config.recordVideo) {
              const videoRecordingPath = path.join(outputDir, 'recording.webm');
              sessionManager.emitEvent(scriptId, {
                type: 'video_recording_started',
                path: videoRecordingPath
              });
            }

            // Preprocess TTS
            await runner.preprocessAllTTS(config.steps, audioDir);

            for (let i = 0; i < config.steps.length; i++) {
              // Check if session was cancelled
              const currentSession = sessionManager.getSessionStatus(scriptId);
              if (currentSession?.status === 'cancelled') {
                console.log(`Session ${scriptId} was cancelled, stopping execution`);
                return;
              }

              const step = config.steps[i];
              
              // Emit step started event
              sessionManager.emitEvent(scriptId, {
                type: 'step_started',
                stepIndex: i,
                step
              });

              // Update progress
              const progress = ((i + 1) / config.steps.length) * 100;
              sessionManager.updateSessionProgress(scriptId, progress, i + 1);

              let result: StepResult;
              
              // Handle first navigation + video recording
              if (step.type === 'goto' && i === 0 && config.recordVideo) {
                result = await runner.executeStep(step, i, config, screenshotDir, domSnapshotDir, config.steps);
                stepResults.push(result);
                
                if (result.success) {
                  await runner.startVideoRecording(path.join(outputDir, 'recording.webm'));
                }
              } else {
                result = await runner.executeStep(step, i, config, screenshotDir, domSnapshotDir, config.steps);
                stepResults.push(result);
              }

              // Emit step completion events
              if (result.success) {
                sessionManager.emitEvent(scriptId, {
                  type: 'step_completed',
                  stepIndex: i,
                  duration: result.duration || 0,
                  result
                });

                // Emit screenshot event if screenshot was taken
                if (result.screenshot) {
                  sessionManager.emitEvent(scriptId, {
                    type: 'screenshot_captured',
                    stepIndex: i,
                    path: result.screenshot,
                    step
                  });
                }

                // Emit DOM snapshot event if taken
                if (result.domSnapshot) {
                  sessionManager.emitEvent(scriptId, {
                    type: 'dom_snapshot_captured',
                    stepIndex: i,
                    path: result.domSnapshot,
                    step
                  });
                }

                // Emit TTS events
                if (step.type === 'tts_start' && step.text) {
                  sessionManager.emitEvent(scriptId, {
                    type: 'tts_started',
                    stepIndex: i,
                    text: step.text,
                    voice: step.voice
                  });

                  // For completed TTS, emit completion
                  sessionManager.emitEvent(scriptId, {
                    type: 'tts_completed',
                    stepIndex: i,
                    duration: result.duration || 0
                  });
                }
              } else {
                sessionManager.emitEvent(scriptId, {
                  type: 'step_failed',
                  stepIndex: i,
                  error: result.error || 'Unknown error',
                  canRetry: false // Could be enhanced with retry logic
                });
              }
            }
          } finally {
            if (runner) {
              videoPath = await runner.close();
              
              if (config.recordVideo && videoPath) {
                sessionManager.emitEvent(scriptId, {
                  type: 'video_recording_stopped',
                  path: videoPath,
                  duration: Date.now() - startTime
                });
              }
            }
          }
          
          // Process video with audio if recording was enabled
          if (config.recordVideo && videoPath) {
            const videoDir = workspaceManager ? workspaceManager.getSessionVideosPath() : outputDir;
            const finalVideoPath = path.join(videoDir, 'guide-video.mp4');
            await VideoService.createVideoWithNarration(videoPath, audioDir, finalVideoPath, stepResults);
          }
        } else {
          // Dry run - create mock results
          stepResults = config.steps.map((step, index) => ({
            step,
            index,
            success: true,
            screenshot: `step-${String(index + 1).padStart(2, '0')}.png`
          }));
        }

        // Create final result
        const videoDir = workspaceManager ? workspaceManager.getSessionVideosPath() : outputDir;
        const result: GuideResult = {
          config,
          originalBody: parsed.body,
          stepResults,
          screenshotDir,
          videoPath: config.recordVideo ? path.join(videoDir, 'guide-video.mp4') : undefined
        };

        // Generate and save files
        const finalMarkdown = MarkdownRenderer.generateCompleteGuide(result);
        const outputFileName = path.basename(markdownPath);
        const guidesDir = workspaceManager ? workspaceManager.getSessionGuidesPath() : outputDir;
        const outputPath = path.join(guidesDir, outputFileName);
        
        await ArtifactManager.writeFile(outputPath, finalMarkdown);

        const logPath = path.join(outputDir, 'guide-log.json');
        await ArtifactManager.writeJson(logPath, {
          timestamp: new Date().toISOString(),
          source: markdownPath,
          output: outputPath,
          screenshots: screenshotDir,
          stepResults: stepResults.map(r => ({
            step: r.step,
            success: r.success,
            error: r.error,
            screenshot: r.screenshot
          }))
        });

        // Save session metadata if using workspace
        if (workspaceManager) {
          const isSuccess = stepResults.every(r => r.success);
          const errors = stepResults.filter(r => !r.success).map(r => r.error || 'Unknown error');
          
          await workspaceManager.saveSessionMetadata({
            sessionId: workspaceManager.getSessionId(),
            flowName: workspaceManager.getFlowName(),
            createdAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            inputFile: markdownPath,
            configuration: {
              headful: options.headful,
              dryRun: options.dryRun,
              recordVideo: config.recordVideo
            },
            success: isSuccess,
            stepCount: stepResults.length,
            errorLogs: errors.length > 0 ? errors : undefined,
            duration: Date.now() - startTime
          });
        }

        // Emit final report generated event
        sessionManager.emitEvent(scriptId, {
          type: 'report_generated',
          report: result
        });

        // Complete the session successfully
        sessionManager.completeSession(scriptId, true);

      } catch (error) {
        console.error(`Async execution failed for session ${scriptId}:`, error);
        
        // Complete the session with error
        const errorMessage = error instanceof Error ? error.message : String(error);
        sessionManager.completeSession(scriptId, false, errorMessage);
      }
    });
  }
}
