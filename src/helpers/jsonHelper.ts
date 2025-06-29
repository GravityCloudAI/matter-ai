import JSONbig from 'json-bigint';
import { jsonrepair } from 'jsonrepair';

const JSONbigString = JSONbig({ storeAsString: true, strict: false });

export const repairAndParseJSON = (jsonString: string) => {

    // Instead of replacing entire body content, we'll only extract and replace the suggestion blocks
    // Find all suggestion blocks within body content
    const suggestionRegex = /```suggestion([\s\S]*?)```/g;
    const suggestionBlocks: Array<string> = [];

    // First, find all suggestion blocks and store them
    let suggestionMatch: RegExpExecArray | null;
    let tempJsonString = jsonString;
    while ((suggestionMatch = suggestionRegex.exec(jsonString)) !== null) {
        if (suggestionMatch[1]) {
            suggestionBlocks.push(suggestionMatch[0]); // Store the entire match including ```suggestion and ```
        }
    }
    // console.log(`Found ${suggestionBlocks.length} suggestion blocks to replace`);

    // Extract mermaid diagrams using a more reliable approach
    let mermaidDiagram = null;
    const mermaidMatch = /"mermaidDiagram":\s*"((?:\\.|[^\\"])*)"/m.exec(jsonString);
    if (mermaidMatch && mermaidMatch[1]) {
        mermaidDiagram = mermaidMatch[1];
    }

    // Replace all suggestion blocks with placeholders
    let processedContent = jsonString;

    // Replace each suggestion block with a placeholder
    for (let i = 0; i < suggestionBlocks.length; i++) {
        processedContent = processedContent.replace(
            suggestionBlocks[i],
            `SUGGESTION_BLOCK_${i}_PLACEHOLDER`
        );
    }

    // Remove all mermaid diagrams and replace with placeholder
    const contentWithoutBodies = processedContent.replace(
        /"mermaidDiagram":\s*"((?:\\.|[^\\"])*)"/m,
        () => `"mermaidDiagram": "MERMAID_DIAGRAM_REMOVED"`
    );

    // console.log("contentWithoutBodies: ", contentWithoutBodies)

    let rezz: any = ""

    try {
        const repairedJSON = jsonrepair(processedContent);
        rezz = JSONbigString.parse(repairedJSON);
    } catch (error) {
        console.error('Error repairing and parsing JSON:', error);
        try {
            rezz = JSONbigString.parse(processedContent);
        } catch (error) {
            console.error('Error parsing JSON:', error);

            try {
                rezz = JSON.parse(processedContent.replace(/\\n/g, '\n'));
            } catch (error) {
                console.error('Error parsing JSON:', error);
                return null;
            }
        }
    }

    // Restore suggestion blocks in the parsed JSON
    if (rezz?.codeChangeGeneration?.reviewComments && suggestionBlocks.length > 0) {
        rezz.codeChangeGeneration.reviewComments.forEach((comment: any) => {
            if (typeof comment.body === 'string') {
                // Check for each suggestion placeholder and replace it with the original content
                for (let i = 0; i < suggestionBlocks.length; i++) {
                    const placeholder = `SUGGESTION_BLOCK_${i}_PLACEHOLDER`;
                    if (comment.body.includes(placeholder)) {

                        const trimmedSuggestion = suggestionBlocks[i].replace(/^\n+|\n+$/g, '');
                        let formattedSuggestion = trimmedSuggestion.replace(/\\n/g, '\n');
                        formattedSuggestion = formattedSuggestion.replace(/\\"/g, '"');

                        comment.body = comment.body.replace(placeholder, formattedSuggestion);
                    }
                }
            }
        });
    }

    // Restore mermaid diagram if present
    if (rezz && mermaidDiagram && rezz.mermaidDiagram === "MERMAID_DIAGRAM_REMOVED") {
        const trimmedMermaidDiagram = mermaidDiagram.replace(/^\n+|\n+$/g, '');
        const formattedMermaidDiagram = trimmedMermaidDiagram.replace(/\\n/g, '\n');

        rezz.mermaidDiagram = formattedMermaidDiagram;
    }

    return rezz
}