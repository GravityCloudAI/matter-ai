interface Prompt {
    id: string;
    system: string;
    user: string;
}

const GRAVITY_API_URL = process.env.GRAVITY_API_URL;

/**
 * Fetches a prompt from the Gravity API
 * @param promptId - The ID of the prompt to fetch
 * @returns Promise containing the prompt data
 */
export async function getPrompt(promptId: string): Promise<Prompt> {
    try {
        const response = await fetch(`${GRAVITY_API_URL}/api/gravity/prompts/${promptId}`);

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

/**
 * Fetches all available prompts from the Gravity API
 * @returns Promise containing an array of prompts
 */
export async function getAllPrompts(): Promise<Prompt[]> {
    try {
        const response = await fetch(`${GRAVITY_API_URL}/api/gravity/prompts`);

        if (!response.ok) {
            throw new Error(`Failed to fetch prompts: ${response.statusText}`);
        }

        const prompts = await response.json();
        return prompts;
    } catch (error) {
        console.error('Error fetching prompts:', error);
        throw error;
    }
}
