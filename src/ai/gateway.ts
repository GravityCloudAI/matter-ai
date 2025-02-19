import * as dotenv from 'dotenv'
dotenv.config()
import OpenAI from 'openai';
import { query } from '../db/psql.js';

export interface AIConfig {
  endpoint?: string;
  apiKey: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'gemini';
}

export interface AIPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export class AIGateway {
  private client: OpenAI;
  private config: AIConfig;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required but was not provided');
    }
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey.trim(),
      baseURL: this.getBaseURL(),
    });
  }

  private getBaseURL(): string {
    switch (this.config.provider) {
      case 'anthropic':
        return 'https://api.anthropic.com/v1';
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1';
      case 'openai':
      default:
        return this.config.endpoint || 'https://api.openai.com/v1';
    }
  }

  async createCompletion(prompt: AIPrompt) {
    return this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt },
      ],
      response_format: { type: "json_object" }
    });
  }
}

export const getLogsFromDb = async () => {
  const logs = await query(`SELECT * FROM llm_logs ORDER BY created_at DESC`)
  return logs?.rows
}
