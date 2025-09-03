import OpenAI from 'openai';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// LLM Task Types
export type LLMTaskType = 
  | 'rag_query_generation'
  | 'step_planning'
  | 'subgoal_planning'
  | 'combined_planning'
  | 'evidence_planning'
  | 'step_refinement'
  | 'goal_analysis'
  | 'success_criteria_check'
  | 'task_replanning'
  | 'selector_resolution'
  | 'secret_mapping'
  | 'variable_mapping'
  | 'tts_enhancement';

// Provider Types
export type LLMProviderType = 'openai' | 'cloudflare' | 'anthropic' | 'bedrock' | 'local' | 'google';

// Model Configuration
export interface ModelConfig {
  provider: LLMProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  fallback?: ModelConfig;
}

// Task Assignment Configuration
export type LLMTaskConfig = {
  [K in LLMTaskType]?: ModelConfig;
};

// LLM Request/Response Types
export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json' | 'text';
  // For multimodal requests
  images?: Array<{
    data: string; // base64 encoded image data
    mediaType: string; // e.g., "image/png", "image/jpeg"
  }>;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: LLMProviderType;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// Default Configuration - Sonnet 4 for all tasks except selector resolution (Haiku)
const DEFAULT_CONFIG: LLMTaskConfig = {
  rag_query_generation: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 300
  },
  step_planning: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 2000
  },
  subgoal_planning: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 3000
  },
  combined_planning: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4000
  },
  evidence_planning: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 300
  },
  step_refinement: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 200
  },
  goal_analysis: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 150
  },
  success_criteria_check: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1200
  },
  task_replanning: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1000
  },
  selector_resolution: {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 500
  },
  secret_mapping: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 400
  },
  variable_mapping: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 400
  },
  tts_enhancement: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 2000
  }
};

export class LLMManager {
  private config: LLMTaskConfig;
  private clients: Map<string, any> = new Map();
  
  constructor(config?: Partial<LLMTaskConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeClients();
  }

  private initializeClients() {
    // Initialize OpenAI client
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      this.clients.set('openai', new OpenAI({ apiKey: openaiKey }));
    }

    // Initialize Cloudflare client
    const cloudflareKey = process.env.CLOUDFLARE_API_KEY;
    const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (cloudflareKey && cloudflareAccountId) {
      this.clients.set('cloudflare', {
        apiKey: cloudflareKey,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1`
      });
    }

    // Initialize Anthropic client
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      // We'll use OpenAI-compatible client for now, but will need to implement Anthropic-specific handling
      this.clients.set('anthropic', { apiKey: anthropicKey });
    }

    // Initialize Bedrock client
    const awsRegion = process.env.AWS_REGION || 'us-east-1';
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    
    if (awsAccessKeyId && awsSecretAccessKey) {
      this.clients.set('bedrock', new BedrockRuntimeClient({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey
        }
      }));
    } else {
      // Try to use default AWS credentials (IAM role, etc.)
      this.clients.set('bedrock', new BedrockRuntimeClient({ region: awsRegion }));
    }

    // Initialize Google Gemini client
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (googleApiKey) {
      this.clients.set('google', { apiKey: googleApiKey });
    }
  }

  public updateConfig(taskType: LLMTaskType, config: ModelConfig) {
    (this.config as any)[taskType] = config;
  }

  public getConfig(taskType: LLMTaskType): ModelConfig | undefined {
    return (this.config as any)[taskType];
  }

  private getClient(provider: LLMProviderType): any {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`LLM client not initialized for provider: ${provider}`);
    }
    return client;
  }

  private shouldDisableThinking(config: ModelConfig): boolean {
    // Disable thinking for short-response tasks (like selector resolution)
    return config.maxTokens !== undefined && config.maxTokens <= 500;
  }

  public async execute(taskType: LLMTaskType, request: LLMRequest): Promise<LLMResponse> {
    const config = (this.config as any)[taskType];
    if (!config) {
      throw new Error(`No configuration found for task type: ${taskType}`);
    }

    return await this.executeWithRetry(config, request, taskType);
  }

  private async executeWithRetry(config: ModelConfig, request: LLMRequest, taskType: LLMTaskType, attempt: number = 1): Promise<LLMResponse> {
    try {
      return await this.executeWithConfig(config, request);
    } catch (error) {
      const errorStr = String(error);

      // Extract HTTP status if available
      const responseObj = (error as any)?.response;
      const headerObj = responseObj?.headers || {};
      let status: number | null = null;
      if (typeof responseObj?.status === 'number') {
        status = responseObj.status;
      } else if (typeof (error as any)?.status === 'number') {
        status = (error as any).status;
      } else {
        const m = errorStr.match(/\b(4\d\d|5\d\d|408)\b/);
        if (m) status = parseInt(m[0], 10);
      }

      // Detect retryable scenarios
      const shouldRetryHeader = String(headerObj['x-should-retry'] || '').toLowerCase() === 'true';
      const isNetworkError = /ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed|network error|socket hang up/i.test(errorStr);
      const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524, 529]);
      const isRetryableStatus = status != null && retryableStatuses.has(status);
      const isRetryable = shouldRetryHeader || isRetryableStatus || isNetworkError;

      // Configurable attempts and backoff
      const maxAttempts = parseInt(process.env.LLM_RETRY_MAX_ATTEMPTS || '3', 10);
      const baseMs = parseInt(process.env.LLM_RETRY_BASE_MS || '1000', 10);
      const jitterMs = parseInt(process.env.LLM_RETRY_JITTER_MS || '250', 10);
      const maxDelayMs = parseInt(process.env.LLM_RETRY_MAX_MS || '15000', 10);

      if (isRetryable && attempt <= maxAttempts) {
        // Try to extract retry timing from API-specific headers
        let retryAfterSeconds: number | null = null;

        if ((error as any).response) {
          const headers = headerObj as Record<string, string>;

          if (headers['retry-after']) {
            const v = parseInt(headers['retry-after']);
            if (!Number.isNaN(v)) retryAfterSeconds = v;
          }

          // Anthropic-specific headers
          if (config.provider === 'anthropic') {
            if (!retryAfterSeconds && headers['anthropic-ratelimit-requests-reset']) {
              const requestsRemaining = parseInt(headers['anthropic-ratelimit-requests-remaining'] || '0');
              const tokensRemaining = parseInt(headers['anthropic-ratelimit-tokens-remaining'] || '0');
              if (requestsRemaining > 0 && tokensRemaining > 0) {
                retryAfterSeconds = Math.min(3, attempt); // short retry when capacity appears available
              } else {
                const resetTime = new Date(headers['anthropic-ratelimit-requests-reset']).getTime();
                const timeDiff = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
                retryAfterSeconds = Math.min(timeDiff, 60);
              }
            }
          }
        }

        // Fallback to exponential backoff with jitter
        const delayMs = retryAfterSeconds
          ? retryAfterSeconds * 1000
          : Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * jitterMs), maxDelayMs);

        const reason = shouldRetryHeader
          ? 'x-should-retry header'
          : isRetryableStatus
            ? `HTTP ${status}`
            : 'network error';

        console.warn(`🔄 [LLM Manager] Transient error for ${taskType} (${reason}). Retry ${attempt}/${maxAttempts} in ${Math.round(delayMs/100)/10}s.`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return await this.executeWithRetry(config, request, taskType, attempt + 1);
      }

      // Try fallback if available and not a rate limit/transient scenario (or retries exhausted)
      const isRateLimitOrTransient = isRetryable;
      if (config.fallback && (!isRateLimitOrTransient || attempt > (parseInt(process.env.LLM_RETRY_MAX_ATTEMPTS || '3', 10)))) {
        console.warn(`⚠️ Primary model failed for ${taskType}${status ? ` (status ${status})` : ''}. Trying fallback.`);
        return await this.executeWithRetry(config.fallback, request, taskType, attempt);
      }

      throw error;
    }
  }

  private async executeWithConfig(config: ModelConfig, request: LLMRequest): Promise<LLMResponse> {
    const client = this.getClient(config.provider);
    const maxTokens = request.maxTokens || config.maxTokens || 1000;
    const temperature = request.temperature ?? config.temperature;

    // Determine API type based on model and provider
    const isGPT5 = config.model.toLowerCase().includes('gpt-5');
    const isCloudflare = config.provider === 'cloudflare';
    const isAnthropic = config.provider === 'anthropic';
    const isBedrock = config.provider === 'bedrock';
    const isGoogle = config.provider === 'google';
    
    if (isBedrock) {
      // Use AWS Bedrock API
      const client = this.getClient(config.provider) as BedrockRuntimeClient;
      
      const messages: any[] = [];
      if (request.systemPrompt) {
        messages.push({
          role: 'user',
          content: `${request.systemPrompt}\n\nHuman: ${request.prompt}\n\nAssistant:`
        });
      } else {
        messages.push({
          role: 'user',
          content: `Human: ${request.prompt}\n\nAssistant:`
        });
      }

      try {
        const body = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          messages: [{
            role: 'user',
            content: request.systemPrompt 
              ? `${request.systemPrompt}\n\nHuman: ${request.prompt}\n\nAssistant:`
              : `Human: ${request.prompt}\n\nAssistant:`
          }],
          ...(temperature !== undefined && { temperature })
        });

        const command = new InvokeModelCommand({
          modelId: config.model,
          contentType: 'application/json',
          accept: 'application/json',
          body
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        
        return {
          content: responseBody.content[0]?.text || '',
          model: config.model,
          provider: config.provider,
          tokens: {
            prompt: responseBody.usage?.input_tokens || 0,
            completion: responseBody.usage?.output_tokens || 0,
            total: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
          }
        };
      } catch (bedrockError) {
        console.error(`🔍 [LLM Manager] Bedrock error:`, bedrockError);
        throw bedrockError;
      }
    } else if (isGoogle) {
      // Use Google Gemini API
      const client = this.getClient(config.provider);
      
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${client.apiKey}`;
        
        // Combine system prompt and user prompt for Gemini
        const combinedPrompt = request.systemPrompt 
          ? `${request.systemPrompt}\n\n${request.prompt}`
          : request.prompt;
        
        const parts: any[] = [{ text: combinedPrompt }];
        
        // Add images if provided (pass-through of base64 screenshot)
        if (request.images && request.images.length > 0) {
          for (const image of request.images) {
            let mediaType = image.mediaType || 'image/png';
            let data: string = typeof image.data === 'string' ? image.data : String(image.data);

            try {
              // If a data URL was passed, extract the payload and the MIME type
              if (data.startsWith('data:')) {
                const commaIdx = data.indexOf(',');
                if (commaIdx > 0) {
                  const meta = data.substring(5, commaIdx); // after 'data:'
                  const payload = data.substring(commaIdx + 1);
                  const semiIdx = meta.indexOf(';');
                  const mime = semiIdx >= 0 ? meta.substring(0, semiIdx) : meta;
                  if (mime) mediaType = mime.trim();
                  data = payload;
                }
              }

              // Trim whitespace/newlines only; do not re-encode or validate via regex
              data = data.replace(/\s+/g, '');
              const preview = data.substring(0, 12);
              console.log(`🖼️ [LLM Manager] Attaching image (${mediaType}), base64 preview: ${preview}, length: ${data.length}`);
            } catch (e) {
              console.warn('⚠️ [LLM Manager] Failed to sanitize image for Gemini:', e);
            }

            parts.push({
              inline_data: {
                mime_type: mediaType,
                data
              }
            });
          }
        }
        
        const payload = {
          contents: [{
            role: 'user',
            parts: parts
          }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            ...(temperature !== undefined && { temperature })
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_CIVIC_INTEGRITY",
              threshold: "BLOCK_NONE"
            }
          ],
          // Conditional system instruction based on task type
          ...(this.shouldDisableThinking(config) && {
            systemInstruction: {
              parts: [{ text: "Respond directly without showing your thinking process or reasoning steps." }]
            }
          })
        };
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          const err: any = new Error(`Google Gemini API error: ${response.status} - ${errorText}`);
          err.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
          };
          throw err;
        }
        
        const data = await response.json();
        
        // Debug: Log the actual response structure
        console.log('🔍 [Gemini API] Full response:', JSON.stringify(data, null, 2));
        
        if (!data.candidates || data.candidates.length === 0) {
          console.error('🔍 [Gemini API] No candidates in response:', data);
          throw new Error(`No candidates in Gemini response. Response: ${JSON.stringify(data)}`);
        }
        
        const candidate = data.candidates[0];
        if (!candidate || !candidate.content) {
          console.error('🔍 [Gemini API] No content in first candidate:', candidate);
          throw new Error(`No content in first candidate. Candidate: ${JSON.stringify(candidate)}`);
        }
        
        // Check for MAX_TOKENS or other finish reasons that indicate incomplete response
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn('🔍 [Gemini API] Response truncated due to MAX_TOKENS');
          throw new Error(`Gemini response truncated due to MAX_TOKENS. Increase maxTokens limit.`);
        }
        
        if (!candidate.content.parts || candidate.content.parts.length === 0) {
          console.error('🔍 [Gemini API] No parts in content:', candidate.content);
          console.error('🔍 [Gemini API] Finish reason:', candidate.finishReason);
          throw new Error(`No parts in content. Content: ${JSON.stringify(candidate.content)}, FinishReason: ${candidate.finishReason}`);
        }
        
        const content = candidate.content.parts[0].text;
        
        return {
          content,
          model: config.model,
          provider: config.provider,
          tokens: {
            prompt: data.usageMetadata?.promptTokenCount || 0,
            completion: data.usageMetadata?.candidatesTokenCount || 0,
            total: data.usageMetadata?.totalTokenCount || 0
          }
        };
      } catch (googleError) {
        console.error(`🔍 [LLM Manager] Google Gemini error:`, googleError);
        throw googleError;
      }
    } else if (isAnthropic) {
      // Use Anthropic Messages API
      const client = this.getClient(config.provider);
      
      const messages: any[] = [];
      if (request.systemPrompt) {
        // For Anthropic, system message is separate parameter
      }
      
      // Build message content with text and optional images
      const content: any[] = [{
        type: 'text',
        text: request.prompt
      }];
      
      // Add images if provided
      if (request.images && request.images.length > 0) {
        for (const image of request.images) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType,
              data: image.data
            }
          });
        }
      }
      
      messages.push({
        role: 'user',
        content: content
      });

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': client.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            messages,
            ...(request.systemPrompt && { system: request.systemPrompt }),
            ...(temperature !== undefined && { temperature })
          })
        });

        if (!response.ok) {
          // Create enhanced error with response headers for rate limit handling
          const error = new Error(`Anthropic API error: ${response.status} ${response.statusText}`) as any;
          error.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
          };
          throw error;
        }

        const data = await response.json();
        
        return {
          content: data.content[0]?.text || '',
          model: config.model,
          provider: config.provider,
          tokens: {
            prompt: data.usage?.input_tokens || 0,
            completion: data.usage?.output_tokens || 0,
            total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
          }
        };
      } catch (anthropicError) {
        console.error(`🔍 [LLM Manager] Anthropic error:`, anthropicError);
        throw anthropicError;
      }
    } else if (isGPT5) {
      // Use standard OpenAI chat completions API for GPT-5
      const messages: any[] = [];
      
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Build message content with text and optional images
      const content: any[] = [{
        type: 'text',
        text: request.prompt
      }];
      
      // Add images if provided for multimodal requests
      if (request.images && request.images.length > 0) {
        for (const image of request.images) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${image.mediaType};base64,${image.data}`
            }
          });
        }
      }
      
      messages.push({
        role: 'user',
        content: content.length === 1 ? content[0].text : content
      });

      const requestParams: any = {
        model: config.model,
        messages,
        max_completion_tokens: maxTokens
      };

      // Only add temperature if specified
      if (temperature !== undefined) {
        requestParams.temperature = temperature;
      }

      // Add response format if specified
      if (request.responseFormat === 'json') {
        requestParams.response_format = { type: 'json_object' };
      }

      const response = await client.chat.completions.create(requestParams);

      // Debug GPT-5 response structure
      console.log(`🔍 [LLM Manager] GPT-5 Full Response:`, JSON.stringify(response, null, 2));
      
      const responseContent = response.choices[0]?.message?.content || '';
      console.log(`🔍 [LLM Manager] GPT-5 Content:`, responseContent);

      return {
        content: responseContent,
        model: config.model,
        provider: config.provider,
        tokens: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        }
      };
    } else if (isCloudflare) {
      // Use Cloudflare Workers AI API with direct HTTP requests
      const client = this.getClient(config.provider);
      const messages: any[] = [];
      
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Build message content with text and optional images
      const content: any[] = [{
        type: 'text',
        text: request.prompt
      }];
      
      // Add images if provided (convert to data URL format for Cloudflare)
      if (request.images && request.images.length > 0) {
        for (const image of request.images) {
          const dataUrl = `data:${image.mediaType};base64,${image.data}`;
          content.push({
            type: 'image_url',
            image_url: {
              url: dataUrl
            }
          });
        }
      }
      
      messages.push({
        role: 'user',
        content: content.length === 1 ? content[0].text : content
      });

      try {
        // Use direct HTTP request instead of OpenAI client
        const response = await fetch(client.baseURL + '/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${client.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            max_tokens: maxTokens,
            ...(temperature !== undefined && { temperature })
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err: any = new Error(`Cloudflare API error: ${response.status} - ${errorText}`);
          err.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
          };
          throw err;
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '';

        return {
          content,
          model: config.model,
          provider: config.provider,
          tokens: {
            prompt: data.usage?.prompt_tokens || 0,
            completion: data.usage?.completion_tokens || 0,
            total: data.usage?.total_tokens || 0
          }
        };
      } catch (cloudflareError) {
        console.error(`🔍 [LLM Manager] Cloudflare error:`, cloudflareError);
        throw cloudflareError;
      }
    } else {
      // Use traditional OpenAI chat.completions.create API
      const messages: any[] = [];
      
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      messages.push({
        role: 'user',
        content: request.prompt
      });

      const requestParams: any = {
        model: config.model,
        messages,
        max_completion_tokens: maxTokens
      };

      // Only add temperature if specified (GPT-5 doesn't support it)
      if (temperature !== undefined) {
        requestParams.temperature = temperature;
      }

      // Add response format if specified
      if (request.responseFormat === 'json') {
        requestParams.response_format = { type: 'json_object' };
      }

      const response = await client.chat.completions.create(requestParams);

      return {
        content: response.choices[0]?.message?.content || '',
        model: config.model,
        provider: config.provider,
        tokens: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        }
      };
    }
  }

  public async executeRAGQuery(prompt: string): Promise<any> {
    const response = await this.execute('rag_query_generation', {
      prompt,
      systemPrompt: `Generate a JSON query to find relevant UI elements for web automation.

CRITICAL: Respond with ONLY a JSON object in this format:
{
  "intent": "navigate|click|type|assert",
  "keywords": ["keyword1", "keyword2"],
  "filters": {
    "role": ["button", "textbox", "link"],
    "sectionHint": "Settings"
  },
  "constraints": {
    "mustBeVisible": true
  },
  "k": 30,
  "diversity": true
}

Return ONLY the JSON, no other text.`,
      responseFormat: 'json'
    });

    // Parse JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`No JSON in query response: ${response.content}`);
      return {
        intent: 'click',
        keywords: ['button', 'click'],
        k: 30,
        diversity: true
      };
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.warn(`Failed to parse JSON query:`, error);
      return {
        intent: 'click',
        keywords: ['button', 'click'],
        k: 30,
        diversity: true
      };
    }
  }

  public async executePlanning(prompt: string): Promise<any> {
    const response = await this.execute('step_planning', {
      prompt,
      systemPrompt: `You are an expert at web automation planning. Plan ONE step at a time based on the current page state.

CRITICAL RULES:
1. Plan only the NEXT step, never multiple steps ahead
2. Use only LABELS from the provided UI inventory, never CSS selectors
3. Focus on the immediate goal from the user prompt
4. Be precise with labels - use exact text from UI inventory

Return JSON with this exact structure:
{
  "type": "goto" | "type" | "click" | "assert_page" | "keypress",
  "label": "exact label from UI inventory",
  "value": "text to type (if type action) OR 'NEEDS_USER_INPUT' if you don't know what to type",
  "url": "URL (if goto/assert_page)",
  "key": "key to press (if keypress action, e.g., 'Escape', 'Enter', 'Tab')",
  "sensitive": boolean (if password/sensitive field),
  "reasoning": "why this step",
  "confidence": 0.7,
  "matchesGoal": true/false (whether this step directly helps achieve the current goal),
  "alternatives": [{"type": "click", "label": "alternative option"}]
}`,
      responseFormat: 'json'
    });

    // Parse and return structured response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in planning response: ${response.content}`);
    }

    return JSON.parse(jsonMatch[0]);
  }

  public async executeSubgoalPlanning(prompt: string): Promise<any> {
    const response = await this.execute('subgoal_planning', {
      prompt: `Convert this goal into JSON subgoals: ${prompt}

Example output:
{"subgoals":[{"id":"login","short":"Log into application","detail":"Enter credentials and authenticate","successCriteria":["url_contains:/dashboard"],"hints":["Use login form"],"risks":["2FA required"],"priority":1}],"reasoning":"Need login first","confidence":0.8,"fallbackStrategy":"Manual steps"}

Your JSON output:`,
      responseFormat: 'json'
    });

    // Parse JSON with robust error handling for Llama responses
    let jsonText = response.content.trim();
    
    // Strategy 1: Look for a complete JSON object anywhere in the response
    let jsonMatch = jsonText.match(/\{[\s\S]*?\}(?=\s*$|\s*\n|$)/);
    if (!jsonMatch) {
      // Strategy 2: Try to find JSON in code blocks
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
      }
    }
    
    if (!jsonMatch) {
      // Strategy 3: Try to extract just the outermost JSON object
      const startIdx = jsonText.indexOf('{');
      if (startIdx !== -1) {
        let braceCount = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < jsonText.length; i++) {
          if (jsonText[i] === '{') braceCount++;
          if (jsonText[i] === '}') braceCount--;
          if (braceCount === 0) {
            endIdx = i;
            break;
          }
        }
        if (braceCount === 0) {
          jsonMatch = [jsonText.substring(startIdx, endIdx + 1)];
        }
      }
    }
    
    if (!jsonMatch) {
      throw new Error(`No JSON found in subgoal response: ${response.content.substring(0, 500)}...`);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    } catch (parseError) {
      throw new Error(`Invalid JSON in subgoal response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
  }

  public async executeTTSEnhancement(steps: any[], prompt?: string, language: string = 'en'): Promise<string> {
    const systemPrompt = `
Analyze the following automated UI steps and suggest tts_start and tts_wait steps for text-to-speech narration in video generation.

IMPORTANT RULES:
- Create a tutorial experience that teaches and guides, not just a UI walkthrough
- Explain the purpose and context of actions, not just what to click
- tts_start steps should ALWAYS be placed BEFORE the action they describe
- tts_wait steps should ALWAYS be placed AFTER actions that need waiting time
- Tone: sound like a friendly tutorial narrator, guiding the viewer step by step
- Style: short, clear, imperative sentences (8–14 words), present tense
- Perspective: speak to the viewer ("Now", "Next", "Let's", "Now we'll"), avoid jargon
- Content: mention what appears or why it matters when helpful (briefly)
- Keep narration concise and helpful for video viewers
- Focus on the most important steps that benefit from verbal explanation
- Every tts_start MUST include a unique label via label=<id> (letters, numbers, dash/underscore). Example: label=intro, label=login_click
- Every related tts_wait MUST reuse the same label as its paired tts_start

EXCLUSION RULES - NEVER NARRATE:
- Escape key presses - skip these completely
- assert_page verification steps - these are internal checks
- Specific values or data being entered - use generic descriptions like 'Enter your username' instead of 'Enter john@example.com'

Focus on WHY actions are taken and what they achieve. When describing form fields, mention what type of information is needed, not the actual values.

Return suggestions in EXACTLY this format:
- Before step X: tts_start label=<label> "narration text"
- After step Y: tts_wait label=<label> <milliseconds>

Example (tutorial tone):
- Before step 1: tts_start label=intro "Now let's open the login page to get started."
- Before step 2: tts_start label=type_user "Next, we'll enter your username in this field."
- After step 2: tts_wait label=type_user 1500
- Before step 4: tts_start label=login_click "Now we'll click Log In to access the system."
- After step 4: tts_wait label=login_click 3000

Keep suggestions minimal, one sentence per tts_start, tutorial-style.
`;

    const stepsDescription = steps.map((step, i) => {
      const getStepDescription = (step: any): string => {
        switch (step.type) {
          case 'goto':
            return `Navigate to ${step.url}`;
          case 'type':
            return `Enter ${step.sensitive ? 'sensitive data' : `"${step.value}"`} in ${step.label}`;
          case 'click':
            return `Click ${step.label}`;
          case 'assert_page':
            return `Verify page is ${step.url}`;
          case 'keypress':
            return `Press ${step.key} key`;
          default:
            return step.type;
        }
      };
      return `${i+1}. ${getStepDescription(step)}`;
    }).join('\n');

    const response = await this.execute('tts_enhancement', {
      prompt: `Steps to analyze:\n${stepsDescription}`,
      systemPrompt,
      maxTokens: 2000
    });

    return response.content;
  }
}

// Singleton instance
let llmManager: LLMManager | null = null;

export function getLLMManager(config?: Partial<LLMTaskConfig>): LLMManager {
  if (!llmManager) {
    llmManager = new LLMManager(config);
  }
  return llmManager;
}

export function resetLLMManager() {
  llmManager = null;
}
