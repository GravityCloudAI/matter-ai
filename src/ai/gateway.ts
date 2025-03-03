import * as dotenv from 'dotenv'
dotenv.config()
import OpenAI from 'openai';
import { query } from '../db/psql.js';
import Anthropic from '@anthropic-ai/sdk';

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
  private client: OpenAI | Anthropic | any;
  private config: AIConfig;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required but was not provided');
    }
    this.config = config;
    
    switch (this.config.provider) {
      case 'anthropic':
        this.client = new Anthropic({
          apiKey: config.apiKey.trim(),
        });
        break;
      case 'gemini':
        // Initialize Gemini client
        this.client = null; // Replace with actual Gemini client initialization
        break;
      case 'openai':
      default:
        this.client = new OpenAI({
          apiKey: config.apiKey.trim(),
        });
    }
  }

  async createCompletion(prompt: AIPrompt) {
    switch (this.config.provider) {
      case 'anthropic':
        return this.client.messages.create({
          model: this.config.model,
          system: prompt.systemPrompt,
          max_tokens: 8096,
          temperature: 0.6,
          top_p: 0.1,
          stream: false,
          top_k: 0,
          messages: [
            { role: 'user', content: prompt.userPrompt }
          ]
        });
      case 'gemini':
        // Implement Gemini API call
        throw new Error('Gemini implementation not completed');
      case 'openai':
      default:
        return this.client.chat.completions.create({
          model: this.config.model,
          max_tokens: 8096,
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt },
          ],
          response_format: { type: "json_object" }
        });
    }
  }
}

export const getLogsFromDb = async () => {
  const logs = await query(`SELECT * FROM llm_logs ORDER BY created_at DESC`)
  return logs?.rows
}