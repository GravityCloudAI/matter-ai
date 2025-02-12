import { AIGateway } from "./gateway";
import { getPrompt } from "./prompts";

const aiGateway = new AIGateway({
    apiKey: process.env.AI_API_KEY!,
    model: process.env.AI_MODEL!,
    provider: process.env.AI_PROVIDER as 'openai' | 'anthropic' | 'gemini',
});

export const analyzePullRequest = async (prData: any) => {
    const prompt = await getPrompt('pull-request-analysis');

    const analysis = await aiGateway.createCompletion({
        systemPrompt: prompt.system,
        userPrompt: prompt.user.replace('{{prData}}', JSON.stringify(prData))
    });

    const response = analysis?.choices[0]?.message?.content;

    if (!response) {
        console.error('No response from AI');
        return null;
    }

    try {
        const parsedResponse = JSON.parse(response);
        return parsedResponse;
    } catch (error) {
        console.error('Error parsing response:', error);
        return null;
    }
};

