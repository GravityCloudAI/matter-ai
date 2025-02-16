import * as dotenv from 'dotenv'
dotenv.config()

interface Prompt {
    id: string;
    system: string;
    user: string;
}

const GRAVITY_API_URL = process.env.GRAVITY_API_URL;
const GRAVITY_API_KEY = process.env.GRAVITY_API_KEY;

/**
 * Fetches a prompt from the Gravity API
 * @param promptId - The ID of the prompt to fetch
 * @returns Promise containing the prompt data
 */
export async function getPrompt(promptId: string): Promise<Prompt> {
    try {
        const response = await fetch(`${GRAVITY_API_URL}/v1/api/prompts/${promptId}`, {
            headers: {
                'Authorization': `Bearer ${GRAVITY_API_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch prompt: ${response.statusText}`);
        }

        const prompt = await response.json();
        return prompt;
    } catch (error) {
        console.error('Error fetching prompt:', error);
        throw error;
    }
}
