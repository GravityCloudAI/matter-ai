import OpenAI from 'openai';

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

  constructor(private config: AIConfig) {
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
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
    });
  }
}
