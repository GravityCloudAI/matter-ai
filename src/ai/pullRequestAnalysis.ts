import { queryWParams } from "../db/psql.js";
import { AIGateway } from "./gateway.js";
import { getPrompt } from "./prompts.js";
import * as dotenv from 'dotenv'
dotenv.config()

const aiGateway = new AIGateway({
    apiKey: process.env.AI_API_KEY!!,
    model: process.env.AI_MODEL!!,
    provider: process.env.AI_PROVIDER as 'openai' | 'anthropic' | 'gemini',
});

interface AdditionalVariables {
    documentVector: any | null // Enterprise feature
    pullRequestTemplate: string | null
}

export const analyzePullRequest = async (installationId: number, repo: string, prId: number, prData: any, additionalVariables: AdditionalVariables) => {
    let prompt: { system: string, user: string } | null = null;
    if (process.env.CUSTOM_PROMPT_USER && process.env.CUSTOM_PROMPT_SYSTEM) {
        prompt = {
            system: process.env.CUSTOM_PROMPT_SYSTEM,
            user: process.env.CUSTOM_PROMPT_USER
        }
    } else {
        if (additionalVariables.pullRequestTemplate && additionalVariables.documentVector) {
            prompt = await getPrompt('pull-request-analysis-with-template-and-document');
        } else if (additionalVariables.pullRequestTemplate) {
            prompt = await getPrompt('pull-request-analysis-with-template');
        } else if (additionalVariables.documentVector) {
            prompt = await getPrompt('pull-request-analysis-with-document');
        } else {
            prompt = await getPrompt('pull-request-analysis');
        }
    }

    let userPrompt = prompt.user.replace('{{prData}}', JSON.stringify(prData));
    if (additionalVariables.documentVector) {
        userPrompt = userPrompt.replace('{{documentVector}}', JSON.stringify(additionalVariables.documentVector));
    }
    if (additionalVariables.pullRequestTemplate) {
        userPrompt = userPrompt.replace('{{pullRequestTemplate}}', additionalVariables.pullRequestTemplate);
    }

    const analysis = await aiGateway.createCompletion({
        systemPrompt: prompt.system,
        userPrompt: userPrompt
    });

    const response = analysis?.choices[0]?.message?.content;

    if (!response) {
        console.error('No response from AI');
        return null;
    }

    await queryWParams(
        `INSERT INTO llm_logs (installation_id, repo, pr_id, request, response) 
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [installationId, repo, prId, JSON.stringify(prompt), JSON.stringify(response)]
    );

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

