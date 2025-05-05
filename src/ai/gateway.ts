import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
dotenv.config()

export interface AIConfig {
  endpoint?: string;
  apiKey: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'google';
}

export interface AIPrompt {
  systemPrompt: string;
  userPrompt?: string;
  messages?: { role: string; content: string }[];
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
      case 'google':
        this.client = new GoogleGenerativeAI(config.apiKey.trim());
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
        const stream = this?.client?.messages
          .stream({
            model: this.config.model,
            max_tokens: 32768,
            temperature: 0.6,
            top_p: 0.1,
            top_k: 0,
            system: prompt.systemPrompt,
            messages: prompt?.messages ? prompt.messages : [
              {
                role: 'user',
                content: prompt.userPrompt,
              },
            ],
          })

        const message = await stream.finalMessage();
        return message;
      case 'google':
        return await this.client?.models?.generateContent({
          model: this.config.model,
          config: {
            systemInstruction: prompt.systemPrompt,
            temperature: 0.6,
            maxTokens: 32768,
            topP: 0.1,
            topK: 0,
            responseMimeType: "application/json"
          },
          contents: prompt.messages ? prompt.messages : prompt.userPrompt
        });
      case 'openai':
      default:
        return await this.client.chat.completions.create({
          model: this.config.model,
          ...(this.config.model.startsWith('gpt') ? { max_tokens: 16384 } : { max_completion_tokens: 16384 }),
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt },
          ],
          response_format: { type: "json_object" }
        });
    }
  }
}