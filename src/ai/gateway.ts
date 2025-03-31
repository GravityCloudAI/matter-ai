import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
dotenv.config()

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
        try {
          const geminiModel = this.client.getGenerativeModel({ model: this.config.model });
          const result = await geminiModel.generateContent({
            contents: [
              { role: 'user', parts: [{ text: prompt.systemPrompt + '\n\n' + prompt.userPrompt }] }
            ],
            generationConfig: {
              temperature: 0.6,
              topP: 0.1,
              maxOutputTokens: 8096,
            }
          });
          return result.response;
        } catch (error) {
          console.error('Gemini API error:', error);
          throw error;
        }
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