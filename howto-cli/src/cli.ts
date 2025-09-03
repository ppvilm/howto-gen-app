#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { 
  Markdown, 
  Prompt, 
  type MarkdownResult, 
  type PromptResult, 
  type SessionMetadata,
  type SessionStatus,
  type RunStreamEvent,
  type PromptStreamEventCombined
} from 'howto-sdk';
import path from 'path';
import fs from 'fs';
import ora from 'ora';

const program = new Command();

program
  .name('howto')
  .description('Generate How-to guides from markdown with automated screenshots')
  .version('0.1.0');

program
  .command('run <markdown-file-or-uuid>')
  .description('Execute a markdown guide from file path or script UUID')
  .option('--out <dir>', 'Output directory (overrides workspace mode)')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--session <id>', 'Resume existing session (UUID)')
  .option('--headful', 'Run browser in headful mode (visible)', false)
  .option('--dry-run', 'Parse and validate without executing browser steps', false)
  .option('--secrets <file>', 'JSON file containing secrets for placeholder resolution')
  .option('--vars <file>', 'JSON file containing variables for placeholder resolution')
  .option('--variables <file>', 'Alias for --vars (variables file)')
  .option('--async', 'Run asynchronously and return script ID immediately', false)
  .option('--json', 'Output events as JSON (useful with --async)', false)
  .action(async (markdownFileOrUuid: string, options: any) => {
    // Handle async vs sync modes
    if (options.async) {
      // === ASYNC MODE ===
      try {
        if (!options.json) {
          console.log(`🔄 Starting async execution of: ${markdownFileOrUuid}`);
        }

        // Load secrets/variables if provided
        let secrets: Record<string, any> | undefined;
        let variables: Record<string, any> | undefined;
        if (options.secrets) {
          try {
            const secretsPath = path.resolve(options.secrets);
            const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
            secrets = JSON.parse(secretsContent);
          } catch (error) {
            console.error('Failed to load secrets file:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }
        const varsPathArg = options.vars || options.variables;
        if (varsPathArg) {
          try {
            const varsPath = path.resolve(varsPathArg);
            const varsContent = fs.readFileSync(varsPath, 'utf-8');
            variables = JSON.parse(varsContent);
          } catch (error) {
            console.error('Failed to load variables file:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }

        const generateOptions = {
          headful: options.headful,
          dryRun: options.dryRun,
          secrets,
          variables,
          workspacePath: options.workspace,
          flowName: options.flow,
          sessionId: options.session,
          outputDir: options.out,
          useWorkspace: !options.out
        };

        // Generate a sessionId and spawn background worker to run execution
        const { randomUUID } = await import('crypto');
        const sessionId = randomUUID();

        const { spawn } = await import('child_process');
        const workerArgs: string[] = [
          path.join(__dirname, 'cli.js'),
          'run-worker',
          sessionId,
          markdownFileOrUuid,
          ...(options.headful ? ['--headful'] : []),
          ...(options.dryRun ? ['--dry-run'] : []),
          ...(options.out ? ['--out', options.out] : []),
          ...(options.workspace ? ['--workspace', options.workspace] : []),
          ...(options.flow ? ['--flow', options.flow] : []),
          ...(options.session ? ['--session', options.session] : []),
          ...(options.secrets ? ['--secrets', options.secrets] : []),
          ...(varsPathArg ? ['--vars', varsPathArg] : [])
        ];

        const child = spawn(process.execPath, workerArgs, {
          detached: true,
          stdio: 'ignore',
          env: process.env
        });
        child.unref();
        
        if (options.json) {
          // Output session ID as JSON and exit
          console.log(JSON.stringify({ sessionId }));
          process.exit(0);
        } else {
          console.log(`Session ID: ${sessionId}`);
          console.log(`Use 'howto subscribe-run ${sessionId}' to monitor progress`);
          process.exit(0);
        }

      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        } else {
          console.error('Failed to start async execution:', error instanceof Error ? error.message : String(error));
        }
        process.exit(1);
      }
    } else {
      // === SYNC MODE (existing behavior) ===
      const spinner = ora('Initializing HowTo Generator...').start();
      
      try {
        const markdownPath = path.resolve(markdownFileOrUuid);
        
        spinner.text = 'Setting up configuration...';
        console.log(`Running HowTo Generator on: ${markdownPath}`);
        
        if (options.workspace) {
          console.log(`Workspace: ${options.workspace}`);
        }
        if (options.flow) {
          console.log(`Flow: ${options.flow}`);
        }
        if (options.session) {
          console.log(`Session: ${options.session}`);
        }
        if (options.out) {
          console.log(`Output directory: ${options.out}`);
        }
        
        console.log(`Headful mode: ${options.headful}`);
        console.log(`Dry run: ${options.dryRun}`);
        if (options.secrets) {
          console.log(`Secrets file: ${options.secrets}`);
        }
        console.log('');

        // Load secrets/variables if provided
        let secrets: Record<string, any> | undefined;
        let variables: Record<string, any> | undefined;
        if (options.secrets) {
          try {
            const secretsPath = path.resolve(options.secrets);
            const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
            secrets = JSON.parse(secretsContent);
            console.log(`Loaded ${Object.keys(secrets || {}).length} secrets from ${secretsPath}`);
          } catch (error) {
            spinner.fail('Failed to load secrets file');
            console.error('Error loading secrets:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }
        const varsPathArg = options.vars || options.variables;
        if (varsPathArg) {
          try {
            const varsPath = path.resolve(varsPathArg);
            const varsContent = fs.readFileSync(varsPath, 'utf-8');
            variables = JSON.parse(varsContent);
            console.log(`Loaded ${Object.keys(variables || {}).length} variables from ${varsPath}`);
          } catch (error) {
            spinner.fail('Failed to load variables file');
            console.error('Error loading variables:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }

        const generateOptions = {
          headful: options.headful,
          dryRun: options.dryRun,
          secrets,
          variables,
          // Workspace options
          workspacePath: options.workspace,
          flowName: options.flow,
          sessionId: options.session,
          // Legacy output dir option
          outputDir: options.out,
          // Default to workspace mode unless explicit output dir
          useWorkspace: !options.out
        };
        
        spinner.text = 'Generating guide...';
        const result: MarkdownResult = await Markdown.run(markdownFileOrUuid, generateOptions);
        
        if (result.sessionId) {
          console.log(`Session ID: ${result.sessionId}`);
        }
        if (result.workspacePath) {
          console.log(`Workspace: ${result.workspacePath}`);
        }
        
        spinner.succeed('Guide generation completed successfully!');

      } catch (error) {
        spinner.fail('Guide generation failed');
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }
  });

// Internal: background worker to run execution in a separate process and write events to file
program
  .command('run-worker <session-id> <markdown-file-or-uuid>')
  .description('[internal] Run execution in background worker')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--out <dir>', 'Output directory (legacy mode)')
  .option('--headful', 'Run browser in headful mode (visible)', false)
  .option('--dry-run', 'Parse and validate without executing browser steps', false)
  .option('--secrets <file>', 'JSON file containing secrets for placeholder resolution')
  .option('--vars <file>', 'JSON file containing variables for placeholder resolution')
  .option('--variables <file>', 'Alias for --vars (variables file)')
  .action(async (sessionId: string, markdownFileOrUuid: string, options: any) => {
    try {
      // Load secrets/variables if provided
      let secrets: Record<string, any> | undefined;
      let variables: Record<string, any> | undefined;
      if (options.secrets) {
        const secretsPath = path.resolve(options.secrets);
        const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
        secrets = JSON.parse(secretsContent);
      }
      const varsPathArg = options.vars || options.variables;
      if (varsPathArg) {
        const varsPath = path.resolve(varsPathArg);
        const varsContent = fs.readFileSync(varsPath, 'utf-8');
        variables = JSON.parse(varsContent);
      }

      const generateOptions = {
        headful: options.headful,
        dryRun: options.dryRun,
        secrets,
        variables,
        workspacePath: options.workspace,
        flowName: options.flow,
        sessionId,
        outputDir: options.out,
        useWorkspace: !options.out
      };

      // Ensure events path
      const pathModule = await import('path');
      const fsPromises = await import('fs/promises');
      const baseDir = options.out
        ? pathModule.join(pathModule.resolve(options.out), 'sessions', sessionId)
        : pathModule.join(pathModule.resolve(options.workspace || require('os').homedir() + '/.howto'), 'sessions', sessionId);
      const eventsPath = pathModule.join(baseDir, 'events.ndjson');
      await fsPromises.mkdir(baseDir, { recursive: true });
      const appendEvent = async (evt: any) => {
        try { await fsPromises.appendFile(eventsPath, JSON.stringify(evt) + '\n', 'utf-8'); } catch {}
      };

      // Start async execution
      await Markdown.startRunAsync(markdownFileOrUuid, generateOptions);

      // Subscribe in-process and mirror to file for cross-process streaming
      try {
        for await (const event of Markdown.subscribeRunAsync(sessionId)) {
          await appendEvent(event);
          if (event.type === 'session_completed' || event.type === 'session_failed' || event.type === 'session_cancelled') {
            break;
          }
        }
      } catch (err) {
        await appendEvent({ type: 'session_failed', sessionId, error: err instanceof Error ? err.message : String(err) });
      }
      process.exit(0);
    } catch (error) {
      console.error('[run-worker] Failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('prompt <user-prompt>')
  .description('Generate howto guide from natural language prompt')
  .requiredOption('--base-url <url>', 'Base URL for the application')
  .option('--model <model>', 'LLM model to use (gemini-2.5-flash)', 'gemini-2.5-flash')
  .option('--headful', 'Run browser in visible mode', false)
  .option('--out <dir>', 'Output directory (overrides workspace mode)')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--session <id>', 'Resume existing session (UUID)')
  .option('--max-steps <n>', 'Maximum steps to generate', '30')
  .option('--max-refines <n>', 'Maximum refinement attempts per step', '3')
  .option('--language <lang>', 'Language for the generated guide (e.g., en, de, fr)', 'en')
  .option('--interactive', 'Prompt user for input when planner is uncertain', false)
  .option('--secrets <file>', 'JSON file containing secrets for placeholder resolution')
  .option('--vars <file>', 'JSON file containing variables for placeholder resolution')
  .option('--variables <file>', 'Alias for --vars (variables file)')
  .option('--tts', 'Enhance generated script with TTS', false)
  .option('--async', 'Generate asynchronously and return script ID immediately', false)
  .option('--json', 'Output events as JSON (useful with --async)', false)
  .action(async (userPrompt: string, options: any) => {
    // Handle async vs sync modes
    if (options.async) {
      // === ASYNC MODE ===
      try {
        if (!options.json) {
          console.log(`🤖 Starting async generation from prompt: "${userPrompt}"`);
        }

        // Load secrets/variables if provided
        let secrets: Record<string, any> | undefined;
        let variables: Record<string, any> | undefined;
        if (options.secrets) {
          try {
            const secretsPath = path.resolve(options.secrets);
            const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
            secrets = JSON.parse(secretsContent);
          } catch (error) {
            console.error('Failed to load secrets file:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }
        const varsPathArg2 = options.vars || options.variables;
        if (varsPathArg2) {
          try {
            const varsPath = path.resolve(varsPathArg2);
            const varsContent = fs.readFileSync(varsPath, 'utf-8');
            variables = JSON.parse(varsContent);
          } catch (error) {
            console.error('Failed to load variables file:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }

        const promptOptions = {
          baseUrl: options.baseUrl,
          model: options.model,
          headful: options.headful,
          outputDir: options.out,
          maxSteps: parseInt(options.maxSteps),
          maxRefines: parseInt(options.maxRefines),
          language: options.language,
          interactive: options.interactive,
          secrets,
          variables,
          workspacePath: options.workspace,
          flowName: options.flow,
          sessionId: options.session,
          useWorkspace: !options.out
        };

        // Generate a scriptId now and start background worker process
        const { randomUUID } = await import('crypto');
        const scriptId = randomUUID();

        // Spawn detached worker to run generation in a separate process
        const { spawn } = await import('child_process');
        const workerArgs: string[] = [
          path.join(__dirname, 'cli.js'),
          'prompt-worker',
          scriptId,
          userPrompt,
          '--base-url', options.baseUrl,
          '--model', options.model,
          ...(options.headful ? ['--headful'] : []),
          ...(options.out ? ['--out', options.out] : []),
          ...(options.workspace ? ['--workspace', options.workspace] : []),
          ...(options.flow ? ['--flow', options.flow] : []),
          ...(options.session ? ['--session', options.session] : []),
          '--max-steps', String(options.maxSteps),
          '--max-refines', String(options.maxRefines),
          '--language', options.language,
          ...(options.interactive ? ['--interactive'] : []),
          ...(options.secrets ? ['--secrets', options.secrets] : []),
          ...(varsPathArg2 ? ['--vars', varsPathArg2] : []),
          ...(options.tts ? ['--tts'] : [])
        ];

        const child = spawn(process.execPath, workerArgs, {
          detached: true,
          stdio: 'ignore',
          env: process.env
        });
        child.unref();
        
        if (options.json) {
          // Output script ID as JSON and exit
          console.log(JSON.stringify({ scriptId }));
          process.exit(0);
        } else {
          console.log(`Script ID: ${scriptId}`);
          console.log(`Use 'howto subscribe-prompt ${scriptId}' to monitor progress`);
          process.exit(0);
        }

      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        } else {
          console.error('Failed to start async generation:', error instanceof Error ? error.message : String(error));
        }
        process.exit(1);
      }
    } else {
      // === SYNC MODE (existing behavior with streaming) ===
      const spinner = ora('Initializing AI-powered guide generation...').start();
      
      try {
        spinner.text = 'Setting up configuration...';
        console.log(`Generating howto guide from prompt: "${userPrompt}"`);
        console.log(`Base URL: ${options.baseUrl}`);
        console.log(`Model: ${options.model}`);
        console.log(`Language: ${options.language}`);
        console.log(`Output directory: ${options.out}`);
        console.log(`Headful mode: ${options.headful}`);
        console.log(`Max steps: ${options.maxSteps}`);
        console.log(`Interactive mode: ${options.interactive}`);
        if (options.secrets) {
          console.log(`Secrets file: ${options.secrets}`);
        }
        console.log('');

        // Load secrets/variables if provided
        let secrets: Record<string, any> | undefined;
        let variables: Record<string, any> | undefined;
        if (options.secrets) {
          try {
            const secretsPath = path.resolve(options.secrets);
            const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
            secrets = JSON.parse(secretsContent);
            console.log(`Loaded ${Object.keys(secrets || {}).length} secrets from ${secretsPath}`);
          } catch (error) {
            spinner.fail('Failed to load secrets file');
            console.error('Error loading secrets:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }
        const varsPathArg2 = options.vars || options.variables;
        if (varsPathArg2) {
          try {
            const varsPath = path.resolve(varsPathArg2);
            const varsContent = fs.readFileSync(varsPath, 'utf-8');
            variables = JSON.parse(varsContent);
            console.log(`Loaded ${Object.keys(variables || {}).length} variables from ${varsPath}`);
          } catch (error) {
            spinner.fail('Failed to load variables file');
            console.error('Error loading variables:', error instanceof Error ? error.message : String(error));
            process.exit(1);
          }
        }

        spinner.text = 'Loading AI modules...';
        const { Prompt } = await import('howto-sdk');
        
        const promptOptions = {
          baseUrl: options.baseUrl,
          model: options.model,
          headful: options.headful,
          outputDir: options.out,
          maxSteps: parseInt(options.maxSteps),
          maxRefines: parseInt(options.maxRefines),
          language: options.language,
          interactive: options.interactive,
          secrets,
          variables,
          // Workspace options
          workspacePath: options.workspace,
          flowName: options.flow,
          sessionId: options.session,
          // Default to workspace mode unless explicit output dir
          useWorkspace: !options.out,
          tts: options.tts
        };

        // Stream events for live updates
        spinner.stop();
        console.log('🤖 Starting AI-powered guide generation...\n');
        
        try {
          let result: any;
          for await (const event of Prompt.generateStream(userPrompt, promptOptions)) {
            switch (event.type) {
              case 'planning_started':
                console.log(`📋 Planning: ${event.prompt}`);
                break;
              case 'goal_analyzed':
                console.log(`🎯 Goal analyzed with ${event.confidence * 100}% confidence`);
                break;
              case 'step_planned':
                console.log(`📝 Planned: ${event.step.type}${event.step.label ? ` (${event.step.label})` : ''}`);
                break;
              case 'step_executed':
                console.log(`✅ Step ${event.stepIndex + 1} executed successfully`);
                break;
              case 'step_refined':
                console.log(`🔧 Step ${event.stepIndex + 1} refined with strategy: ${event.strategy.type}`);
                break;
              case 'goal_progress':
                const progressPercent = Math.round(event.progress * 100);
                console.log(`📈 Progress: ${progressPercent}%`);
                if (event.nextObjective) {
                  console.log(`   Next: ${event.nextObjective}`);
                }
                break;
              case 'completed':
                console.log(`\n🎉 Generation completed!`);
                console.log(`📄 Generated ${event.steps.length} steps`);
                console.log(`📝 Markdown guide: ${options.out || 'workspace'}/generated-guide.md`);
                result = event; // This should be the final result
                break;
            }
          }
          
          // Show workspace/script info
          if (result && 'sessionId' in result && result.sessionId) {
            console.log(`Session ID: ${result.sessionId}`);
          }
          if (result && 'scriptPath' in result && result.scriptPath) {
            console.log(`📜 Script saved: ${path.basename(result.scriptPath as string)}`);
          }
          if (result && 'workspacePath' in result && result.workspacePath) {
            console.log(`Workspace: ${result.workspacePath}`);
          }
        } catch (streamError) {
          console.error('Error during streaming:', streamError);
          // Fall back to non-streaming generation
          const fallbackSpinner = ora('Falling back to non-streaming generation...').start();
          const result = await Prompt.generate(userPrompt, promptOptions);
          fallbackSpinner.stop();
          
          console.log('\n📊 Generation Summary:');
          console.log(`   Success: ${result.success}`);
          console.log(`   Total steps: ${result.report.totalSteps}`);
          console.log(`   Duration: ${(result.report.duration / 1000).toFixed(1)}s`);
          
          if (result.success) {
            console.log(`\n✅ Guide generated successfully!`);
            
            // Show workspace/script info
            if (result && 'sessionId' in result && result.sessionId) {
              console.log(`Session ID: ${result.sessionId}`);
            }
            if (result && 'scriptPath' in result && result.scriptPath) {
              console.log(`📜 Script saved: ${path.basename(result.scriptPath)}`);
            }
            if (result && 'workspacePath' in result && result.workspacePath) {
              console.log(`Workspace: ${result.workspacePath}`);
            }
          } else {
            console.log(`\n❌ Generation failed:`);
            result.report.errors.forEach((error: string) => console.log(`   - ${error}`));
          }
        }

      } catch (error) {
        spinner.fail('AI guide generation failed');
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }
  });

// Internal: background worker to run prompt generation in a separate process
program
  .command('prompt-worker <script-id> <user-prompt>')
  .description('[internal] Run prompt generation in background worker')
  .requiredOption('--base-url <url>', 'Base URL for the application')
  .option('--model <model>', 'LLM model to use (gemini-2.5-flash)', 'gemini-2.5-flash')
  .option('--headful', 'Run browser in visible mode', false)
  .option('--out <dir>', 'Output directory (overrides workspace mode)')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--session <id>', 'Resume existing session (UUID)')
  .option('--max-steps <n>', 'Maximum steps to generate', '30')
  .option('--max-refines <n>', 'Maximum refinement attempts per step', '3')
  .option('--language <lang>', 'Language for the generated guide (e.g., en, de, fr)', 'en')
  .option('--interactive', 'Prompt user for input when planner is uncertain', false)
  .option('--secrets <file>', 'JSON file containing secrets for placeholder resolution')
  .option('--vars <file>', 'JSON file containing variables for placeholder resolution')
  .option('--variables <file>', 'Alias for --vars (variables file)')
  .option('--tts', 'Enhance generated script with TTS', false)
  .action(async (scriptId: string, userPrompt: string, options: any) => {
    try {
      // Load secrets/variables if provided
      let secrets: Record<string, any> | undefined;
      let variables: Record<string, any> | undefined;
      if (options.secrets) {
        const secretsPath = path.resolve(options.secrets);
        const secretsContent = fs.readFileSync(secretsPath, 'utf-8');
        secrets = JSON.parse(secretsContent);
      }
      const varsPathArg = options.vars || options.variables;
      if (varsPathArg) {
        const varsPath = path.resolve(varsPathArg);
        const varsContent = fs.readFileSync(varsPath, 'utf-8');
        variables = JSON.parse(varsContent);
      }

      const promptOptions = {
        baseUrl: options.baseUrl,
        model: options.model,
        headful: options.headful,
        outputDir: options.out,
        maxSteps: parseInt(options.maxSteps),
        maxRefines: parseInt(options.maxRefines),
        language: options.language,
        interactive: options.interactive,
        secrets,
        variables,
        workspacePath: options.workspace,
        flowName: options.flow,
        sessionId: options.session,
        useWorkspace: !options.out,
        scriptId,
        tts: options.tts
      };

      // Start async generation in-process so worker stays alive
      await Prompt.startGenerateAsync(userPrompt, promptOptions);
      // Wait until script markdown exists to keep worker alive
      if (options.out) {
        // Legacy mode: check outputDir/scriptId for any .md file
        const fsPromises = await import('fs/promises');
        const checkLegacy = async (): Promise<boolean> => {
          try {
            const dir = path.join(path.resolve(options.out), scriptId);
            const stat = await fsPromises.stat(dir);
            if (!stat.isDirectory()) return false;
            const files = await fsPromises.readdir(dir);
            return files.some(f => f.endsWith('.md'));
          } catch {
            return false;
          }
        };
        const start = Date.now();
        const timeoutMs = 5 * 60 * 1000;
        while (Date.now() - start < timeoutMs) {
          if (await checkLegacy()) break;
          await new Promise(r => setTimeout(r, 1000));
        }
      } else {
        await Prompt.waitForScriptGeneration(scriptId, options.flow, options.workspace);
      }
      process.exit(0);
    } catch (error) {
      console.error('[prompt-worker] Failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Script management commands
program
  .command('scripts')
  .description('List all available scripts from generated-scripts folder')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .action(async (options) => {
    try {
      const scripts = await Markdown.listScripts(options.flow, options.workspace);
      
      if (scripts.length === 0) {
        console.log('No scripts found in generated-scripts folder.');
        console.log('Use the prompt command to generate scripts first.');
        return;
      }
      
      console.log(`\nFound ${scripts.length} scripts:\n`);
      scripts.forEach((script: { name: string; scriptId: string; path: string }, index: number) => {
        console.log(`${index + 1}. ${script.name}`);
        console.log(`   Script ID: ${script.scriptId}`);
        console.log(`   Path: ${script.path}`);
        console.log('');
      });
      
      console.log(`To run a script, use: howto run <script-name>`);
    } catch (error) {
      console.error('Error listing scripts:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Session management commands
program
  .command('sessions')
  .description('Session management commands')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .action(async (options) => {
    try {
      const sessions = await Markdown.listSessions(options.flow, options.workspace);
      
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      
      console.log(`\nFound ${sessions.length} sessions:\n`);
      sessions.forEach((session: SessionMetadata, index: number) => {
        const duration = session.duration ? `(${Math.round(session.duration / 1000)}s)` : '';
        const status = session.success ? '✅' : '❌';
        console.log(`${index + 1}. ${status} ${session.sessionId}`);
        console.log(`   Flow: ${session.flowName}`);
        console.log(`   Created: ${new Date(session.createdAt).toLocaleString()}`);
        if (session.completedAt) {
          console.log(`   Completed: ${new Date(session.completedAt).toLocaleString()} ${duration}`);
        }
        if (session.inputFile) {
          console.log(`   Input: ${session.inputFile}`);
        }
        if (session.inputPrompt) {
          console.log(`   Prompt: ${session.inputPrompt}`);
        }
        if (session.stepCount) {
          console.log(`   Steps: ${session.stepCount}`);
        }
        console.log('');
      });
    } catch (error) {
      console.error('Error listing sessions:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// TTS enhancement command
program
  .command('tts <script-id> <prompt>')
  .description('Enhance an existing generated script with TTS steps')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--language <lang>', 'Language for narration (e.g., en, de)', 'en')
  .option('--out <file>', 'Write enhanced markdown to this file instead of in-place')
  .option('--json', 'Output result as JSON', false)
  .action(async (scriptId: string, userPrompt: string, options: any) => {
    try {
      const { TTS } = await import('howto-sdk');
      const res = await TTS.enhanceScript(scriptId, userPrompt, {
        flowName: options.flow,
        workspacePath: options.workspace,
        language: options.language,
        inPlace: !options.out,
        outputPath: options.out
      });
      if (options.json) {
        console.log(JSON.stringify(res));
      } else {
        console.log(`✅ TTS enhanced script saved: ${res.scriptPath}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('TTS enhancement failed:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program
  .command('session <session-id>')
  .description('Show details for a specific session')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .action(async (sessionId: string, options) => {
    try {
      const session = await Markdown.getSession(sessionId, options.flow, options.workspace);
      
      if (!session) {
        console.log(`Session ${sessionId} not found.`);
        process.exit(1);
      }
      
      console.log(`\nSession Details:\n`);
      console.log(`ID: ${session.sessionId}`);
      console.log(`Flow: ${session.flowName}`);
      console.log(`Status: ${session.success ? '✅ Success' : '❌ Failed'}`);
      console.log(`Created: ${new Date(session.createdAt).toLocaleString()}`);
      
      if (session.completedAt) {
        console.log(`Completed: ${new Date(session.completedAt).toLocaleString()}`);
      }
      if (session.duration) {
        console.log(`Duration: ${Math.round(session.duration / 1000)}s`);
      }
      if (session.inputFile) {
        console.log(`Input File: ${session.inputFile}`);
      }
      if (session.inputPrompt) {
        console.log(`Input Prompt: ${session.inputPrompt}`);
      }
      if (session.stepCount) {
        console.log(`Steps: ${session.stepCount}`);
      }
      
      console.log(`\nConfiguration:`);
      console.log(JSON.stringify(session.configuration, null, 2));
      
      if (session.errorLogs && session.errorLogs.length > 0) {
        console.log(`\nErrors:`);
        session.errorLogs.forEach((error: string, index: number) => {
          console.log(`${index + 1}. ${error}`);
        });
      }
    } catch (error) {
      console.error('Error getting session:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean old sessions')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--max-age <days>', 'Maximum age in days (default: 30)', '30')
  .action(async (options) => {
    try {
      const maxAgeMs = parseInt(options.maxAge) * 24 * 60 * 60 * 1000;
      const cleaned = await Markdown.cleanSessions(maxAgeMs, options.flow, options.workspace);
      
      console.log(`Cleaned ${cleaned} old sessions.`);
    } catch (error) {
      console.error('Error cleaning sessions:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize workspace for current flow')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .action(async (options) => {
    try {
      const result = await Markdown.initWorkspace(options.flow, options.workspace);
      
      console.log('Workspace initialized successfully!');
      console.log(`Workspace: ${result.workspacePath}`);
      console.log(`Flow: ${result.flowName}`);
    } catch (error) {
      console.error('Error initializing workspace:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Script export command
program
  .command('export <script-uuid>')
  .description('Export a script to JSON format')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--output <file>', 'Output JSON file (default: <script-uuid>.json)')
  .action(async (scriptUuid: string, options: any) => {
    const spinner = ora('Exporting script...').start();
    
    try {
      const exportData = await Markdown.exportScriptToJson(scriptUuid, options.flow, options.workspace);
      
      const outputFile = options.output || `${scriptUuid}.json`;
      const outputPath = path.resolve(outputFile);
      
      await fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
      
      spinner.succeed(`Script exported successfully!`);
      console.log(`Script: ${exportData.metadata.title}`);
      console.log(`Script ID: ${exportData.scriptId}`);
      console.log(`Output: ${outputPath}`);
      console.log(`Steps: ${exportData.config.steps?.length || 0}`);
    } catch (error) {
      spinner.fail('Script export failed');
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Script import command  
program
  .command('import <json-file>')
  .description('Import a script from JSON format')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--uuid <uuid>', 'Override script UUID (replaces existing script)')
  .option('--overwrite', 'Allow overwriting existing script', false)
  .action(async (jsonFile: string, options: any) => {
    const spinner = ora('Importing script...').start();
    
    try {
      const jsonPath = path.resolve(jsonFile);
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      
      const result = await Markdown.importScriptFromJson(
        jsonContent,
        options.uuid,
        options.flow,
        options.workspace,
        options.overwrite
      );
      
      spinner.succeed(`Script imported successfully!`);
      console.log(`Script ID: ${result.scriptId}`);
      console.log(`Script Path: ${result.scriptPath}`);
    } catch (error) {
      spinner.fail('Script import failed');
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// New async session management commands
program
  .command('subscribe <session-id>')
  .description('Subscribe to events for a running execution session')
  .option('--json', 'Output events as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      // Check if it's a run session (session ID)
      const runStatus = await Markdown.getRunStatus(id);
      
      if (!runStatus) {
        console.error(`Session ${id} not found`);
        process.exit(1);
      }

      if (!options.json) {
        console.log(`🔄 Subscribing to execution events for session: ${id}\n`);
      }

      try {
        // Subscribe to run events (using session ID)
        for await (const event of Markdown.subscribeRunAsync(id)) {
            if (options.json) {
              console.log(JSON.stringify(event));
            } else {
              // Human-readable output
              switch (event.type) {
                case 'session_started':
                  console.log(`🚀 Execution started`);
                  break;
                case 'step_started':
                  console.log(`📝 Step ${event.stepIndex + 1}: ${event.step.type}${event.step.label ? ` (${event.step.label})` : ''}`);
                  break;
                case 'step_completed':
                  console.log(`✅ Step ${event.stepIndex + 1} completed in ${event.duration}ms`);
                  break;
                case 'step_failed':
                  console.log(`❌ Step ${event.stepIndex + 1} failed: ${event.error}`);
                  break;
                case 'screenshot_captured':
                  console.log(`📸 Screenshot: ${event.path}`);
                  break;
                case 'tts_started':
                  console.log(`🔊 TTS: "${event.text}"`);
                  break;
                case 'session_completed':
                  console.log(`🎉 Execution completed successfully!`);
                  break;
                case 'session_failed':
                  console.log(`💥 Execution failed: ${event.error}`);
                  break;
                case 'session_cancelled':
                  console.log(`⏹️ Execution cancelled`);
                  break;
              }
            }
          }
      } catch (subscriptionError) {
        console.error('Error subscribing to events:', subscriptionError instanceof Error ? subscriptionError.message : String(subscriptionError));
        process.exit(1);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// New: subscribe to prompt generation events (by script-id)
program
  .command('subscribe-prompt <script-id>')
  .description('Subscribe to events for a prompt generation (Script-ID)')
  .option('--workspace <path>', 'Workspace directory (default: ~/.howto)')
  .option('--flow <name>', 'Flow name (default: current directory name)')
  .option('--out <dir>', 'Output directory (legacy mode)')
  .option('--json', 'Output events as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const status = await Prompt.getGenerateStatus(id);
      if (!status) {
        // Fallback: try to tail events file from worker process for live streaming
        if (!options.json) {
          console.log(`No live session found. Attaching to event log (file tail)...`);
        } else {
          console.log(JSON.stringify({ type: 'info', message: 'no_session_found_using_file_tail' }));
        }

        const pathModule = await import('path');
        const fsPromises = await import('fs/promises');
        const eventsDir = options.out
          ? pathModule.join(pathModule.resolve(options.out), id)
          : pathModule.join(pathModule.resolve(options.workspace || require('os').homedir() + '/.howto'), 'scripts', id);
        const eventsPath = pathModule.join(eventsDir, 'events.ndjson');

        // Wait for events file to appear
        const waitForFile = async (filePath: string, timeoutMs = 5 * 60 * 1000) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            try { await fsPromises.access(filePath); return true; } catch {}
            await new Promise(r => setTimeout(r, 500));
          }
          return false;
        };

        const found = await waitForFile(eventsPath);
        if (!found) {
          if (options.json) {
            console.log(JSON.stringify({ type: 'error', message: 'events_file_not_found' }));
          } else {
            console.error('Events file not found. Worker may have failed to start.');
          }
          process.exit(1);
        }

        // Tail the NDJSON events file
        let lastSize = 0;
        const fs = await import('fs');
        const printEvent = (event: any) => {
          if (options.json) {
            console.log(JSON.stringify(event));
            return;
          }
          switch (event.type) {
            case 'session_started':
              console.log('🚀 Generation started');
              break;
            case 'goal_set':
              console.log(`🎯 Goal set: ${event.prompt}`);
              break;
            case 'step_planning':
              console.log(`🧠 Planning step ${event.stepIndex + 1} (url: ${event.currentUrl || 'n/a'})`);
              break;
            case 'step_planned':
              console.log(`📝 Planned: ${event.step.type}${event.step.label ? ` (${event.step.label})` : ''} [conf: ${event.confidence ?? 'n/a'}]`);
              break;
            case 'step_executing':
              console.log(`▶️ Executing: ${event.step.type}${event.step.label ? ` (${event.step.label})` : ''}`);
              break;
            case 'step_executed':
              console.log(`✅ Executed step ${event.stepIndex + 1}${event.result?.success === false ? ' (failed)' : ''}`);
              break;
            case 'goal_progress':
              console.log(`📈 Progress: ${Math.round((event.progress || 0) * 100)}%`);
              break;
            case 'validation_performed':
              console.log(`🧪 Validation: fulfilled=${(event.fulfilled||[]).length} pending=${(event.pending||[]).length}`);
              break;
            case 'step_refinement_started':
              console.log(`🔁 Retry/Refine attempt #${event.attempts}: ${event.reason}`);
              break;
            case 'step_refined':
              console.log(`🛠️ Refined step using ${event.strategy?.type || 'unknown'} strategy`);
              break;
            case 'step_refinement_failed':
              console.log(`⚠️ Refinement failed after ${event.attempts} attempts`);
              break;
            case 'markdown_generating':
              console.log('📝 Generating markdown...');
              break;
            case 'markdown_generated':
              console.log(`📝 Markdown generated (steps: ${event.stepCount})`);
              break;
            case 'script_saving':
              console.log('💾 Saving script...');
              break;
            case 'script_saved':
              console.log(`✅ Script saved: ${event.path}`);
              break;
            case 'completed':
              console.log(`🎉 Generation ${event.success ? 'succeeded' : 'failed'}`);
              break;
            case 'session_completed':
              console.log('🏁 Session completed');
              break;
            case 'session_failed':
              console.log(`💥 Generation failed: ${event.error || ''}`);
              break;
          }
        };

        const isTerminal = (e: any) => ['session_completed', 'session_failed', 'session_cancelled'].includes(e.type);

        // Initial size
        try { const st = await fsPromises.stat(eventsPath); lastSize = st.size; } catch { lastSize = 0; }
        // Read existing lines first
        if (lastSize > 0) {
          const content = await fsPromises.readFile(eventsPath, 'utf-8');
          content.split('\n').filter(Boolean).forEach(line => {
            try { const ev = JSON.parse(line); printEvent(ev); } catch {}
          });
        }

        // Now poll for new data
        while (true) {
          await new Promise(r => setTimeout(r, 500));
          let st;
          try { st = await fsPromises.stat(eventsPath); } catch { continue; }
          if (st.size > lastSize) {
            const stream = fs.createReadStream(eventsPath, { encoding: 'utf-8', start: lastSize, end: st.size - 1 });
            let buf = '';
            await new Promise<void>((resolve) => {
              stream.on('data', chunk => { buf += chunk; });
              stream.on('end', () => resolve());
              stream.on('error', () => resolve());
            });
            lastSize = st.size;
            const lines = buf.split('\n').filter(Boolean);
            for (const line of lines) {
              let ev: any;
              try { ev = JSON.parse(line); } catch { continue; }
              printEvent(ev);
              if (isTerminal(ev)) {
                process.exit(ev.type === 'session_completed' ? 0 : 1);
              }
            }
          }
        }
      }

      if (!options.json) {
        console.log(`🔄 Subscribing to prompt generation events for script: ${id}\n`);
      }

      try {
        for await (const event of (Prompt as any).subscribeGenerateAsync(id) as AsyncGenerator<PromptStreamEventCombined>) {
          if (options.json) {
            console.log(JSON.stringify(event));
          } else {
            switch ((event as any).type) {
              case 'session_started':
                console.log('🚀 Generation started');
                break;
              case 'markdown_generated':
                console.log(`📝 Markdown generated (steps: ${(event as any).stepCount})`);
                break;
              case 'script_saving':
                console.log('💾 Saving script...');
                break;
              case 'script_saved':
                console.log(`✅ Script saved: ${(event as any).path}`);
                break;
              case 'completed':
                console.log(`🎉 Generation ${((event as any).success ? 'succeeded' : 'failed')}`);
                break;
              case 'session_completed':
                console.log('🏁 Session completed');
                break;
              case 'session_failed':
                console.log(`💥 Generation failed: ${(event as any).error}`);
                break;
              case 'session_cancelled':
                console.log('⏹️ Generation cancelled');
                break;
              default:
                // Optionally show other planning events if they occur
                break;
            }
          }
        }
      } catch (subscriptionError) {
        console.error('Error subscribing to prompt events:', subscriptionError instanceof Error ? subscriptionError.message : String(subscriptionError));
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// New: subscribe to run execution events (by session-id)
program
  .command('subscribe-run <session-id>')
  .description('Subscribe to events for a run execution (Session-ID)')
  .option('--workspace <path>', 'Workspace directory (optional, not required for run streaming)')
  .option('--flow <name>', 'Flow name (optional)')
  .option('--json', 'Output events as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const runStatus = await Markdown.getRunStatus(id);
      if (!runStatus) {
        // Fallback to file tail if no live session in this process
        if (!options.json) {
          console.log(`No live session found. Attaching to event log (file tail)...`);
        } else {
          console.log(JSON.stringify({ type: 'info', message: 'no_session_found_using_file_tail' }));
        }

        const pathModule = await import('path');
        const fsPromises = await import('fs/promises');
        const baseDir = options.out
          ? pathModule.join(pathModule.resolve(options.out), 'sessions', id)
          : pathModule.join(pathModule.resolve(options.workspace || require('os').homedir() + '/.howto'), 'sessions', id);
        const eventsPath = pathModule.join(baseDir, 'events.ndjson');

        const waitForFile = async (filePath: string, timeoutMs = 2 * 60 * 1000) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            try { await fsPromises.access(filePath); return true; } catch {}
            await new Promise(r => setTimeout(r, 500));
          }
          return false;
        };

        const found = await waitForFile(eventsPath);
        if (!found) {
          if (options.json) console.log(JSON.stringify({ type: 'error', message: 'events_file_not_found' }));
          else console.error('Events file not found. Worker may not have started yet.');
          process.exit(1);
        }

        // Helper to render run events
        const renderRunEvent = (ev: any) => {
          if (options.json) {
            console.log(JSON.stringify(ev));
            return;
          }
          switch (ev.type) {
            case 'session_started':
              console.log('🚀 Execution started');
              break;
            case 'script_loaded':
              console.log(`📜 Script loaded: ${ev.config?.title || 'Untitled'} (${ev.totalSteps} steps)`);
              break;
            case 'config_validated':
              console.log(`✅ Config validated: ${ev.config?.title || 'Untitled'} @ ${ev.config?.baseUrl || ''}`);
              break;
            case 'video_recording_started':
              console.log(`🎥 Video recording started: ${ev.path}`);
              break;
            case 'video_recording_stopped':
              console.log(`🛑 Video recording stopped (${Math.round((ev.duration||0)/1000)}s): ${ev.path}`);
              break;
            case 'step_started': {
              const s = ev.step || {};
              const target = s.label || s.url || s.key || '';
              console.log(`📝 Step ${ev.stepIndex + 1}: ${s.type}${target ? ` (${target})` : ''}`);
              break; }
            case 'step_progress':
              console.log(`⏳ Step ${ev.stepIndex + 1} progress: ${ev.message}`);
              break;
            case 'step_completed': {
              const r = ev.result || {};
              const extras = [] as string[];
              if (r.screenshot) extras.push('📸');
              if (r.domSnapshot) extras.push('🧾 DOM');
              console.log(`✅ Step ${ev.stepIndex + 1} completed in ${ev.duration}ms ${extras.join(' ')}`.trim());
              break; }
            case 'step_failed':
              console.log(`❌ Step ${ev.stepIndex + 1} failed: ${ev.error}${ev.canRetry ? ' (will retry)' : ''}`);
              break;
            case 'screenshot_captured':
              console.log(`📸 Screenshot (step ${ev.stepIndex + 1}): ${ev.path}`);
              break;
            case 'dom_snapshot_captured':
              console.log(`🧾 DOM snapshot (step ${ev.stepIndex + 1}): ${ev.path}`);
              break;
            case 'tts_started':
              console.log(`🔊 TTS: "${ev.text}"`);
              break;
            case 'tts_completed':
              console.log(`🔇 TTS completed in ${Math.round((ev.duration||0))}ms`);
              break;
            case 'report_generated': {
              const rep = ev.report || {};
              console.log(`📄 Report generated: ${rep.config?.title || 'Untitled'} (${(rep.stepResults||[]).length} steps)`);
              if (rep.videoPath) console.log(`🎬 Final video: ${rep.videoPath}`);
              break; }
            case 'session_completed':
              console.log('🎉 Execution completed successfully!');
              break;
            case 'session_failed':
              console.log(`💥 Execution failed: ${ev.error}`);
              break;
            case 'session_cancelled':
              console.log('⏹️ Execution cancelled');
              break;
            default:
              console.log(ev.type || 'event');
          }
        };

        // Tail file identically to prompt tailer
        const fs = await import('fs');
        let lastSize = 0;
        try { const st = await fsPromises.stat(eventsPath); lastSize = st.size; } catch { lastSize = 0; }
        if (lastSize > 0) {
          const content = await fsPromises.readFile(eventsPath, 'utf-8');
          content.split('\n').filter(Boolean).forEach(line => {
            try { const ev = JSON.parse(line); renderRunEvent(ev); } catch {}
          });
        }
        while (true) {
          await new Promise(r => setTimeout(r, 500));
          let st;
          try { st = await fsPromises.stat(eventsPath); } catch { continue; }
          if (st.size > lastSize) {
            const stream = fs.createReadStream(eventsPath, { encoding: 'utf-8', start: lastSize, end: st.size - 1 });
            let buf = '';
            await new Promise<void>((resolve) => {
              stream.on('data', chunk => { buf += chunk; });
              stream.on('end', () => resolve());
              stream.on('error', () => resolve());
            });
            lastSize = st.size;
            const lines = buf.split('\n').filter(Boolean);
            for (const line of lines) {
              let ev: any; try { ev = JSON.parse(line); } catch { continue; }
              renderRunEvent(ev);
              if (['session_completed','session_failed','session_cancelled'].includes(ev.type)) process.exit(ev.type==='session_completed'?0:1);
            }
          }
        }
      }

      if (!options.json) {
        console.log(`🔄 Subscribing to execution events for session: ${id}\n`);
      }

      try {
        for await (const event of Markdown.subscribeRunAsync(id)) {
          if (options.json) {
            console.log(JSON.stringify(event));
          } else {
            switch (event.type) {
              case 'session_started':
                console.log(`🚀 Execution started`);
                break;
              case 'step_started':
                console.log(`📝 Step ${event.stepIndex + 1}: ${event.step.type}${event.step.label ? ` (${event.step.label})` : ''}`);
                break;
              case 'step_completed':
                console.log(`✅ Step ${event.stepIndex + 1} completed in ${event.duration}ms`);
                break;
              case 'step_failed':
                console.log(`❌ Step ${event.stepIndex + 1} failed: ${event.error}`);
                break;
              case 'screenshot_captured':
                console.log(`📸 Screenshot: ${event.path}`);
                break;
              case 'tts_started':
                console.log(`🔊 TTS: "${event.text}"`);
                break;
              case 'session_completed':
                console.log(`🎉 Execution completed successfully!`);
                break;
              case 'session_failed':
                console.log(`💥 Execution failed: ${event.error}`);
                break;
              case 'session_cancelled':
                console.log(`⏹️ Execution cancelled`);
                break;
            }
          }
        }
      } catch (subscriptionError) {
        console.error('Error subscribing to events:', subscriptionError instanceof Error ? subscriptionError.message : String(subscriptionError));
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('status <session-id>')
  .description('Get status of a running or completed execution session')
  .option('--json', 'Output status as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      // Check run session status
      const status = await Markdown.getRunStatus(id);
      
      if (!status) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Session not found' }));
        } else {
          console.log(`Session ${id} not found`);
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(status));
      } else {
        console.log(`\nSession Status:\n`);
        console.log(`Session ID: ${status.sessionId}`);
        if (status.scriptId) {
          console.log(`Script ID: ${status.scriptId}`);
        }
        console.log(`Type: ${status.type}`);
        console.log(`Status: ${status.status}`);
        console.log(`Progress: ${status.progress}%`);
        if (status.currentStep !== undefined && status.totalSteps !== undefined) {
          console.log(`Steps: ${status.currentStep}/${status.totalSteps}`);
        }
        console.log(`Created: ${status.createdAt.toLocaleString()}`);
        if (status.startedAt) {
          console.log(`Started: ${status.startedAt.toLocaleString()}`);
        }
        if (status.completedAt) {
          console.log(`Completed: ${status.completedAt.toLocaleString()}`);
        }
        if (status.error) {
          console.log(`Error: ${status.error}`);
        }
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

// New: status for prompt generation
program
  .command('status-prompt <script-id>')
  .description('Get status of a running or completed prompt generation (Script-ID)')
  .option('--json', 'Output status as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const status = await Prompt.getGenerateStatus(id);
      if (!status) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Script not found' }));
        } else {
          console.log(`Script ${id} not found`);
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(status));
      } else {
        console.log(`\nPrompt Generation Status:\n`);
        console.log(`Script ID: ${status.sessionId}`);
        console.log(`Type: ${status.type}`);
        console.log(`Status: ${status.status}`);
        console.log(`Progress: ${status.progress}%`);
        if (status.currentStep !== undefined && status.totalSteps !== undefined) {
          console.log(`Steps: ${status.currentStep}/${status.totalSteps}`);
        }
        console.log(`Created: ${status.createdAt.toLocaleString()}`);
        if (status.startedAt) {
          console.log(`Started: ${status.startedAt.toLocaleString()}`);
        }
        if (status.completedAt) {
          console.log(`Completed: ${status.completedAt.toLocaleString()}`);
        }
        if (status.error) {
          console.log(`Error: ${status.error}`);
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program
  .command('cancel <session-id>')
  .description('Cancel a running execution session')
  .option('--json', 'Output result as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      // Check if it's a run session
      const runStatus = await Markdown.getRunStatus(id);
      
      if (!runStatus) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Session not found' }));
        } else {
          console.error(`Session ${id} not found`);
        }
        process.exit(1);
      }

      // Cancel the session
      await Markdown.cancelRun(id);

      if (options.json) {
        console.log(JSON.stringify({ cancelled: true, id }));
      } else {
        console.log(`✅ Cancelled session: ${id}`);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error cancelling session:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

// New: cancel for prompt generation
program
  .command('cancel-prompt <script-id>')
  .description('Cancel a running prompt generation (Script-ID)')
  .option('--json', 'Output result as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const status = await Prompt.getGenerateStatus(id);
      if (!status) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Script not found' }));
        } else {
          console.error(`Script ${id} not found`);
        }
        process.exit(1);
      }

      await Prompt.cancelGenerate(id);
      if (options.json) {
        console.log(JSON.stringify({ cancelled: true, id }));
      } else {
        console.log(`✅ Cancelled prompt generation: ${id}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error cancelling prompt:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

// New: status alias for run sessions
program
  .command('status-run <session-id>')
  .description('Get status of a run execution (Session-ID)')
  .option('--workspace <path>', 'Workspace directory (optional)')
  .option('--flow <name>', 'Flow name (optional)')
  .option('--json', 'Output status as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const status = await Markdown.getRunStatus(id);
      if (!status) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Session not found' }));
        } else {
          console.log(`Session ${id} not found`);
        }
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(status));
      } else {
        console.log(`\nSession Status:\n`);
        console.log(`Session ID: ${status.sessionId}`);
        if (status.scriptId) {
          console.log(`Script ID: ${status.scriptId}`);
        }
        console.log(`Type: ${status.type}`);
        console.log(`Status: ${status.status}`);
        console.log(`Progress: ${status.progress}%`);
        if (status.currentStep !== undefined && status.totalSteps !== undefined) {
          console.log(`Steps: ${status.currentStep}/${status.totalSteps}`);
        }
        console.log(`Created: ${status.createdAt.toLocaleString()}`);
        if (status.startedAt) {
          console.log(`Started: ${status.startedAt.toLocaleString()}`);
        }
        if (status.completedAt) {
          console.log(`Completed: ${status.completedAt.toLocaleString()}`);
        }
        if (status.error) {
          console.log(`Error: ${status.error}`);
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

// New: cancel alias for run sessions
program
  .command('cancel-run <session-id>')
  .description('Cancel a run execution (Session-ID)')
  .option('--workspace <path>', 'Workspace directory (optional)')
  .option('--flow <name>', 'Flow name (optional)')
  .option('--json', 'Output result as JSON', false)
  .action(async (id: string, options: any) => {
    try {
      const runStatus = await Markdown.getRunStatus(id);
      if (!runStatus) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'Session not found' }));
        } else {
          console.error(`Session ${id} not found`);
        }
        process.exit(1);
      }

      await Markdown.cancelRun(id);
      if (options.json) {
        console.log(JSON.stringify({ cancelled: true, id }));
      } else {
        console.log(`✅ Cancelled session: ${id}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } else {
        console.error('Error cancelling session:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program.parse();
