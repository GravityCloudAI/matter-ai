import { AIGateway } from "./gateway.js";
import { getPrompt } from "./prompts.js";
import * as dotenv from 'dotenv'
dotenv.config()

const aiGateway = new AIGateway({
    apiKey: process.env.AI_API_KEY!!,
    model: process.env.AI_MODEL!!,
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

    console.log('Response from AI:', response);

    try {

        const contentWithoutSuggestions = response.replace(
            /"body": "```suggestion[\s\S]*?```"/g,
            () => `"body": "CODE_BLOCK_REMOVED"`
        );

        const parsedContent = JSON.parse(contentWithoutSuggestions);

        // Put the original code blocks back
        const codeBlocks = [...response.matchAll(/"body": ("```suggestion[\s\S]*?```")/g)];
        let codeBlockIndex = 0;

        if (parsedContent?.codeChangeGeneration?.reviewComments) {
            parsedContent.codeChangeGeneration.reviewComments.forEach((comment: any) => {
                if (comment.body === "CODE_BLOCK_REMOVED" && codeBlockIndex < codeBlocks.length) {
                    const cleanedCodeBlock = codeBlocks[codeBlockIndex][1].replace(/\n/g, "\\n")  // Escape newlines
                        .replace(/\t/g, "\\t")  // Escape tabs
                        .replace(/\r/g, "\\r")
                    comment.body = JSON.parse(cleanedCodeBlock)
                    codeBlockIndex++;
                }
            });
        }

        return parsedContent;
    } catch (error) {
        console.error('Error parsing response:', error);
        return null;
    }
};

