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

/** 
 * Below is the static analysis for the old Pull Requests
 */

interface PRQualityResult {
    score: number;
    recommendations: string[];
}

interface PRChecklistResult {
    score: number;
    recommendations: string[];
}

interface PRAnalysisResult {
    quality: PRQualityResult;
    checklist: PRChecklistResult;
}

interface PullRequestData {
    title: string;
    body: string;
    reviewers: string[];
    changedFiles: Array<{
        filename: string;
        additions: number;
        deletions: number;
        changes: number;
        status: string;
    }>;
}

export function analyzePullRequestStatic(prData: PullRequestData): PRAnalysisResult {
    // Analyze PR quality
    const quality: PRQualityResult = analyzePRQualityStatic(prData);

    // Check PR requirements
    const checklist: PRChecklistResult = validatePRChecklistStatic(prData);

    return {
        quality,
        checklist,
    };
}

function analyzePRQualityStatic(prData: PullRequestData): PRQualityResult {
    let score = 100;
    const recommendations: string[] = [];

    const totalLinesChanged = prData?.changedFiles?.reduce((total: number, file) => {
        return total + file?.additions + file?.deletions;
    }, 0);

    // Evaluate based on lines changed
    if (totalLinesChanged > 100) {
        score -= 10;
        recommendations.push('Consider breaking down the PR into smaller chunks');
    }

    // Evaluate based on files changed
    if (prData?.changedFiles?.length > 3) {
        score -= 10;
        recommendations.push('Large number of files changed - consider splitting the changes');
    }

    return {
        score,
        recommendations,
    };
}

function validatePRChecklistStatic(prData: PullRequestData): PRChecklistResult {
    let score = 3; // Start with max score of 3 instead of 4
    const recommendations: string[] = [];

    // Check title
    if (!prData?.title || prData.title.length === 0) {
        score--;
        recommendations.push('Add a title to the pull request');
    }

    // Check description/body
    if (!prData?.body || prData.body.length === 0) {
        score--;
        recommendations.push('Add a body to the pull request to provide context, this will increase collaboration and code review effectiveness');
    }

    // Check reviewers
    if (!prData?.reviewers || prData.reviewers.length === 0) {
        score--;
        recommendations.push('Assign at least one reviewer to the pull request');
    }

    return {
        score,
        recommendations,
    };
}