import { Octokit } from "@octokit/rest";
import * as dotenv from 'dotenv';
import { analyzePullRequest, getPRExplanation } from "../ai/pullRequestAnalysis.js";
dotenv.config()

let currentCommandsProcessing: number[] = [];

export const REPO_COLORS = ['green', 'orange', 'red', 'yellow', 'limegreen', 'info', 'lightblue'];

const USER_AGENT = "github-api"
let pollingInterval: NodeJS.Timeout | null = null;

export const initGithubPolling = async () => {

  if (process.env.GITHUB_ORG_TOKEN && process.env.GITHUB_ORG_NAME) {
    console.log("Using GitHub Organization Token - setting up polling mechanism");

    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    await pollGitHubWithPAT();

    pollingInterval = setInterval(pollGitHubWithPAT, 30000);
    return;
  }
}

const pollGitHubWithPAT = async () => {
  try {
    const token = process.env.GITHUB_ORG_TOKEN!!;
    const owner = process.env.GITHUB_ORG_NAME!!;

    console.log(`[POLLING] Starting GitHub data sync for org: ${owner}`);

    // 1. Sync repositories
    const allRepos: string[] = process?.env?.GITHUB_REPOS?.split(',') || []
    if (allRepos) {
      // 2. For each repo, sync branches and PRs
      for (const repo of allRepos) {
        // list the comments for the PRs and check for /matter summary OR /matter review
        const prs = await listPullRequests(token, repo, owner);
        if (prs && prs.length > 0) {
          for (const pr of prs) {
            await checkPRForCommands(token, owner, repo, pr.number);
          }
        }
      }
      console.log(`[POLLING] GitHub data sync completed for org: ${owner}`);
    }
  } catch (error) {
    console.log("[POLLING] Error in GitHub polling:", error);
  }
};

const listPullRequests = async (token: string, repo: string, owner: string, prNumber?: number) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: USER_AGENT,
      request: {
        timeout: 10000 // 10 second timeout
      }
    });

    // If PR number is provided, fetch only that PR
    if (prNumber) {
      try {
        const { data: pr } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber
        });

        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100
        });

        return [{
          ...pr,
          changed_files: files.map(file => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch
          }))
        }];
      } catch (error: any) {
        console.log("[PULL_REQUEST] Error fetching PR #", prNumber)
        if (error.status === 403) {
          console.log("Rate limit exceeded for PR fetch:", error.message);
          throw new Error("GitHub API rate limit exceeded");
        }
        if (error.status === 404) {
          console.log("Pull request not found:", prNumber);
          return null;
        }
        if (error.timeout) {
          console.log("Request timeout while fetching PR details");
          return null
        }
        return null
      }
    }

    // Initialize an array to store all PRs
    const response = await octokit.pulls.list({
      owner,
      repo,
      state: 'all',
      per_page: 10,
    });

    await Promise.all(response.data.map(async (pr) => {
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100
      });

      return {
        ...pr,
        changed_files: files.map(file => ({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch
        }))
      };
    }));

    return response.data;

  } catch (error: any) {
    if (error.status === 403) {
      console.log("Rate limit exceeded:", error.message);
    }
    if (error.timeout) {
      console.log("Request timeout while fetching pull requests");
    }
    console.log("Error listing pull requests:", error);
    return null;
  }
}

const getPullRequestTemplate = async (token: string, repo: string, owner: string): Promise<string | null> => {
  const octokit = new Octokit({
    auth: token,
    userAgent: USER_AGENT,
    request: {
      timeout: 10000
    }
  })

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: '.github/pull_request_template.md'
    });

    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString();
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) {
      // Template doesn't exist, which is fine
      return null;
    }
    console.log("Error fetching PR template:", error);
    return null;
  }
}

const addCommentToPullRequest = async (
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  comment: string
) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "gravitonAI v0.1",
    });

    const response = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment,
    });

    return response.data;
  } catch (error) {
    console.error("Error adding comment to PR:", error);
    throw error;
  }
};

const filterPRFiles = (files: any[]) => {
  return files.filter((file: any) => {
    if (!file?.filename) return false;

    const skipPatterns = [
      // Package managers
      /package-lock\.json$/,
      /yarn\.lock$/,
      /pnpm-lock\.yaml$/,
      /Podfile\.lock$/,
      /Gemfile\.lock$/,
      /composer\.lock$/,
      /cargo\.lock$/,

      // Build directories
      /dist\//,
      /build\//,
      /\.next\//,
      /node_modules\//,
      /out\//,
      /\.gradle\//,
      /\.dart_tool\//,
      /\.pub-cache\//,
      /\.pub\//,
      /\.nuxt\//,
      /\.output\//,

      // Minified files
      /\.min\.js$/,
      /\.min\.css$/,

      // iOS/Xcode
      /\.pbxproj$/,
      /\.xcworkspacedata$/,
      /\.xcscheme$/,
      /\.xcuserstate$/,
      /\.plist$/,

      // Android
      /\.apk$/,
      /\.aab$/,
      /R\.java$/,
      /BuildConfig\.java$/,
      /\.iml$/,

      // Flutter
      /\.g\.dart$/,
      /\.freezed\.dart$/,
      /flutter_export_environment\.sh$/,
      /Flutter\.podspec$/,

      // Generated files across frameworks
      /generated\//,
      /\.generated\//,
      /\.gen\//,

      // Config and metadata files
      /\.DS_Store$/,
      /Thumbs\.db$/,
      /desktop\.ini$/,
      /\.idea\//,
      /\.vscode\//,

      // Compiled binaries
      /\.so$/,
      /\.dylib$/,
      /\.dll$/,
      /\.class$/,
      /\.pyc$/,
      /\.pyo$/,
      // Filter all files with .cursor in their path
      /\.cursor/,
      // Skip Go files generated by protoc-gen
      /\.pb\.go$/,
      // Skip gRPC-Gateway generated Go files
      /\.pb\.gw\.go$/,
      // Skip other common generated Go files
      /\.gen\.go$/,
      /mock_.+\.go$/,
      /_string\.go$/,
      /go\.sum$/,
      /swagger\.json$/
    ];

    return !skipPatterns.some(pattern => pattern.test(file.filename));
  });
};

const handleReviewRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
) => {
  try {
    // Add a comment acknowledging the request
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm reviewing this PR now. I'll provide feedback shortly."
    );

    // Get PR details to analyze
    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = preparePRForAnalysis(prDetails[0])

    // Get PR template if it exists
    const pullRequestTemplate = await getPullRequestTemplate(githubToken, repo, owner);

    // Perform the analysis
    const analysis = await analyzePullRequest(prForAnalysis, {
      documentVector: null,
      pullRequestTemplate: pullRequestTemplate
    })

    if (!analysis) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't complete the analysis of this PR. Please try again later."
      );
      return;
    }
    // Submit the review
    const codeChangeComments = analysis?.codeChangeGeneration?.reviewComments || [];

    await addReviewToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "COMMENT",
      analysis?.codeChangeGeneration?.reviewBody,
      codeChangeComments
    );

  } catch (error) {
    try {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I encountered an error while trying to review this PR. Please try again later."
      );
    } catch (commentError) {
    }
  } finally {
    currentCommandsProcessing = currentCommandsProcessing.filter((pr) => pr !== prNumber);
  }
};

const handleSummaryRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
) => {
  try {
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm generating a summary for this PR. I'll post it shortly."
    );

    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = preparePRForAnalysis(prDetails[0])

    console.log("[POLLING] Found PR for analysis:", prForAnalysis);

    // Get PR template if it exists
    const pullRequestTemplate = await getPullRequestTemplate(githubToken, repo, owner);

    console.log("[POLLING] Found PR template:", pullRequestTemplate);

    // Perform the analysis
    const analysis = await analyzePullRequest(prForAnalysis, {
      documentVector: null,
      pullRequestTemplate: pullRequestTemplate
    })

    if (!analysis) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't generate a summary for this PR. Please try again later."
      );
      return;
    }

    // Simply use the existing summary description
    if (analysis?.checklist?.completedChecklist) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        analysis.checklist.completedChecklist
      );

    } else {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't generate a summary for this PR. No summary data was available."
      );
    }

  } catch (error) {
    console.log("Failed to generate summary:", error);
    try {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I encountered an error while trying to generate a summary for this PR. Please try again later."
      );
    } catch (commentError) {
      console.log("Failed to add error comment:", commentError);
    }
  } finally {
    currentCommandsProcessing = currentCommandsProcessing.filter((pr) => pr !== prNumber);
  }
}

const preparePRForAnalysis = (prDetails: any) => {
  return {
    title: prDetails.title,
    changed_files: filterPRFiles(prDetails.changed_files)
  };
}

export const handleExplainRequest = async (
  githubToken: string,
  owner: string,
  repo: string,
  prNumber: number,
) => {
  try {
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      "I'm generating a detailed explanation for this PR. I'll post it shortly."
    );

    const prDetails = await listPullRequests(githubToken, repo, owner, prNumber);

    if (!prDetails || !prDetails[0]) {
      await addCommentToPullRequest(
        githubToken,
        owner,
        repo,
        prNumber,
        "I couldn't fetch the details of this PR. Please try again later."
      );
      return;
    }

    const prForAnalysis = preparePRForAnalysis(prDetails[0])

    const explanationRes: any = await getPRExplanation(prForAnalysis);

    const explanationObj: any = JSON.parse(explanationRes);
    await addCommentToPullRequest(
      githubToken,
      owner,
      repo,
      prNumber,
      explanationObj?.explanation || "I couldn't generate a detailed explanation for this PR. Please try again later."
    );
  } catch (error) {
    console.log(`Error handling explain request for PR #${prNumber}:`, error);
  }
}

export const addReviewToPullRequest = async (
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  event: "COMMENT",
  reviewBody?: string,
  reviewComments?: { path: string; body: string; startPosition: number; endPosition: number }[]
) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "matter-ai-oss v1",
    });

    // Fetch the pull request to get the latest commit id
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    const response = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: pr.head.sha,
      body: reviewBody || "Your PR has been reviewed by Matter AI.",
      comments: reviewComments?.map(comment => {

        const comm: any = {
          path: comment.path,
          body: comment.body,
          line: comment.endPosition,
          side: 'RIGHT'
        }

        if (comment.startPosition !== comment.endPosition) {
          comm.start_line = comment.startPosition
        }

        return comm
      }),
      event,
    });

    console.log(
      `Review submitted to PR #${prNumber} in repo ${repo}: ${response.data.html_url}`
    );
    return response.data;

  } catch (error) {
    console.log('Error adding review to PR:', error);
    throw error;
  }
};

/**
 * Fetches comments from a PR and checks for /matter commands
 * @param token GitHub token
 * @param owner Repository owner
 * @param repo Repository name
 * @param prNumber PR number to check
 */
const checkPRForCommands = async (
  token: string,
  owner: string,
  repo: string,
  prNumber: number
) => {
  try {

    const octokit = new Octokit({
      auth: token,
      userAgent: USER_AGENT,
    });

    // Get all comments and sort them client-side to ensure we get the latest
    // This avoids potential API caching issues
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100  // Get more comments to ensure we have the latest
    });

    // Sort comments by creation date, newest first
    const sortedComments = [...comments].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // If we have comments, check if the newest is recent (within last 3 minutes)
    const filteredComments = [];

    if (sortedComments.length > 0) {
      const latestComment = sortedComments[0]; // Get the newest comment after sorting
      const commentDate = new Date(latestComment.created_at);

      // Check if comment is within the last 3 minutes
      const threeMinutesAgo = new Date();
      threeMinutesAgo.setMinutes(threeMinutesAgo.getMinutes() - 3);

      const isRecent = commentDate > threeMinutesAgo;

      // Only process if it's recent
      if (isRecent) {
        filteredComments.push(latestComment);
      }
    }

    // Look for command comments
    for (const comment of filteredComments) {
      // Skip if comment body is undefined
      if (!comment.body) continue;

      const commentBody = comment.body.trim();

      // Check for /matter summary command
      if (commentBody.startsWith('/matter summary')) {

        if (currentCommandsProcessing.includes(prNumber)) {
          return;
        }

        currentCommandsProcessing.push(prNumber);
        await handleSummaryRequest(token, owner, repo, prNumber);
        break; // Process only the most recent command
      }

      // Check for /matter review command
      else if (commentBody.startsWith('/matter review')) {

        if (currentCommandsProcessing.includes(prNumber)) {
          return;
        }

        currentCommandsProcessing.push(prNumber);

        console.log(`[POLLING] Found /matter review command in PR #${prNumber} in repo ${repo}`);
        await handleReviewRequest(token, owner, repo, prNumber);
        break; // Process only the most recent command
      }

      // Check for /matter explain command
      else if (commentBody.startsWith('/matter explain')) {

        if (currentCommandsProcessing.includes(prNumber)) {
          return;
        }

        currentCommandsProcessing.push(prNumber);

        console.log(`[POLLING] Found /matter explain command in PR #${prNumber} in repo ${repo}`);
        await handleExplainRequest(token, owner, repo, prNumber);
        break; // Process only the most recent command
      }
    }
  } catch (error) {
    console.log(`[POLLING] Error checking PR #${prNumber} for commands:`, error);
    currentCommandsProcessing = currentCommandsProcessing.filter((pr) => pr !== prNumber);
  }
};

const updatePRDescription = async (githubToken: string, owner: string, repo: string, prId: number, description: string) => {
  try {
    const octokit = new Octokit({
      auth: githubToken,
      userAgent: USER_AGENT,
    });

    const response = await octokit.pulls.update({
      owner,
      repo,
      pull_number: prId,
      body: description
    });

    console.log(`Updated PR #${prId} description in repo ${repo}`);
    return response.data;
  } catch (error) {
    console.log('Error updating PR description:', error);
    throw error;
  }
}
