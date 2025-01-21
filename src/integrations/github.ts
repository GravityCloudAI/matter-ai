import { Hono } from 'hono'
import { Octokit } from "@octokit/rest"
import { Webhooks } from '@octokit/webhooks';
import { createAppAuth } from "@octokit/auth-app";
import { query, queryWParams } from "../db/psql";

if (!process.env.GITHUB_WEBHOOK_SECRET) {
  throw new Error('GitHub webhook secret is not set');
}

const githubWebhookHandler = async (c: any) => {
  try {
    const body = await c.req.json();
    const signature = c.req.header('x-hub-signature-256');
    const matchesSignature = await webhooks.verify(
      JSON.stringify(body),
      signature
    );

    if (!matchesSignature) {
      return c.json({ error: 'Invalid signature' }, 400);
    }

    await webhooks.receive({
      id: c.req.header('x-github-delivery'),
      name: c.req.header('x-github-event'),
      payload: body,
    });

    return c.json({ status: 'received' });
  } catch (error) {
    console.error('Error handling webhook event:', error);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
};

export default function githubApp(app: Hono) {
  app.post('/webhook', githubWebhookHandler);
}

const webhooks = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

webhooks.onAny(async (event: any) => {
  console.log(event)

  if (event.name === "installation" && event.payload?.action === "created") {
    await queryWParams(`INSERT INTO github_data (payload) VALUES ($1)`, [event.payload])
  } else {
    const githubData = await query(`SELECT * FROM github_data LIMIT 1`)
    await syncUpdatedEventAndStoreInDb(event, githubData?.rows[0]?.payload)
  }
});

export const getGithubInstallationToken = async (installationId: number) => {

  if (!process.env.GITHUB_PRIVATE_KEY) {
    throw new Error('GitHub private key is not set in environment variables');
  }

  const appId = 474549
  const privateKey = process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');

  const auth = createAppAuth({
    appId: appId,
    privateKey: privateKey,
    installationId: installationId,
  });

  const installationAuthentication = await auth({ type: "installation" });
  return installationAuthentication.token;
}

const listRepos = async (token: string, owner: string, repoName?: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    // If repo name is provided, fetch only that repo
    if (repoName) {
      const { data: repo } = await octokit.repos.get({
        owner,
        repo: repoName
      });

      const languages = await octokit.repos.listLanguages({
        owner,
        repo: repoName,
      });

      return [{
        ...repo,
        languages: Object.keys(languages.data),
        primaryLanguage: Object.keys(languages.data)[0] || null
      }];
    }

    // Initialize array to store all repos
    let allRepos: any[] = [];
    let page = 1;

    while (true) {
      const repos = await octokit.repos.listForOrg({
        org: owner,
        type: "all",
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more repos, break the loop
      if (repos.data.length === 0) break;

      // Add this page's repos to our array
      allRepos = [...allRepos, ...repos.data];

      // If we got fewer repos than requested, we've hit the end
      if (repos.data.length < 100) break;

      page++;
    }

    // Process languages for all repos
    const reposWithLanguages = await Promise.all(
      allRepos.map(async (repo) => {
        const languages = await octokit.repos.listLanguages({
          owner,
          repo: repo.name,
        });

        return {
          ...repo,
          languages: Object.keys(languages.data),
          primaryLanguage: Object.keys(languages.data)[0] || null
        };
      })
    );

    return reposWithLanguages;

  } catch (error) {
    console.error("Error listing repositories:", error)
    return null
  }
}

const listAllBranches = async (token: string, repo: string, owner: string) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    })

    let allBranches: any[] = [];
    let page = 1;

    while (true) {
      const response = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more branches, break the loop
      if (response.data.length === 0) break;

      // Add this page's branches to our array
      allBranches = [...allBranches, ...response.data.map(branch => branch.name)];

      // If we got fewer branches than requested, we've hit the end
      if (response.data.length < 100) break;

      page++;
    }

    return allBranches;
  } catch (error) {
    console.error("Error listing branches:", error)
    return null
  }
}

const updateRepoBranches = async (installationId: number, repoName: string, fullName: string, repoId: number, branches: string[]) => {
  const existingData = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
  let repoBranches = existingData?.rows[0]?.branches || []

  const repoIndex = repoBranches.findIndex((r: any) => r.repo === repoName)
  if (repoIndex === -1) {
    repoBranches.push({
      repo: repoName,
      full_name: fullName,
      repoId: repoId,
      branches: branches
    })
  } else {
    repoBranches[repoIndex] = {
      repo: repoName,
      full_name: fullName,
      repoId: repoId,
      branches: branches
    }
  }

  await queryWParams(`INSERT INTO github_branches (installation_id, branches) VALUES ($1, $2)`, [installationId, repoBranches])
}

const removeRepoBranches = async (installationId: number, repoName: string) => {
  const existingData = await queryWParams(`SELECT * FROM github_branches WHERE installation_id = $1`, [installationId])
  let repoBranches = existingData?.rows[0]?.branches || []

  repoBranches = repoBranches.filter((r: any) => r.repo !== repoName)

  await queryWParams(`INSERT INTO github_branches (installation_id, branches) VALUES ($1, $2)`, [installationId, repoBranches])
}

const listPullRequests = async (token: string, repo: string, owner: string, prNumber?: number) => {
  try {
    const octokit = new Octokit({
      auth: token,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    // If PR number is provided, fetch only that PR
    if (prNumber) {
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
    }

    // Initialize an array to store all PRs
    let allPullRequests: any = [];
    let page = 1;

    while (true) {
      const response = await octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        per_page: 100, // Max allowed per page
        page: page
      });

      // If no more PRs, break the loop
      if (response.data.length === 0) break;

      // Add this page's PRs to our array
      allPullRequests = [...allPullRequests, ...response.data];

      // If we got fewer PRs than requested, we've hit the end
      if (response.data.length < 100) break;

      page++;
    }

    const pullRequestsWithFiles = await Promise.all(allPullRequests.map(async (pr: any) => {
      // Get files changed in the PR
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
          status: file.status, // added, modified, removed
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch // The actual code diff
        }))
      };
    }));

    return pullRequestsWithFiles;

  } catch (error) {
    console.error("Error listing pull requests:", error);
    return null;
  }
}

const syncUpdatedEventAndStoreInDb = async (event: any, githubPayload: any) => {

  const installationId = githubPayload?.installation?.id
  const githubToken = await getGithubInstallationToken(installationId)
  const owner = githubPayload?.installation?.account?.login
  const eventType = event?.name
  const eventPayload = event?.payload

  if (eventType?.startsWith('repository')) {
    const repoAction = eventPayload?.action
    const repo = eventPayload?.repository

    const existingData = await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId])
    let allRepos = existingData?.rows[0]?.repositories || []

    if (repoAction === 'created' || repoAction === 'edited' || repoAction === 'publicized' || repoAction === 'privatized') {
      const updatedRepo = await listRepos(githubToken, owner, repo.name)
      if (updatedRepo && updatedRepo[0]) {
        const repoIndex = allRepos.findIndex((r: any) => r.name === repo.name)
        if (repoIndex === -1) {
          allRepos.push(updatedRepo[0])
        } else {
          allRepos[repoIndex] = updatedRepo[0]
        }

        const branches = await listAllBranches(githubToken, repo.name, owner)
        if (branches) {
          await updateRepoBranches(installationId, repo.name, repo.full_name, repo.id, branches)
        }
      }
    } else if (repoAction === 'deleted') {
      allRepos = allRepos.filter((r: any) => r.name !== repo.name)
      await removeRepoBranches(installationId, repo.name)
    }

    // Update database with modified repos data
    await queryWParams(`INSERT INTO github_repositories (installation_id, repositories) VALUES ($1, $2)`, [installationId, allRepos])
  } else if (eventType === 'installation') {
    // For new installations, fetch all repos and their branches
    const allRepos: any = await listRepos(githubToken, owner)
    await queryWParams(`INSERT INTO github_repositories (installation_id, repositories) VALUES ($1, $2)`, [installationId, allRepos])

    for (const repo of allRepos) {
      const branches = await listAllBranches(githubToken, repo.name, owner)
      if (branches) {
        await updateRepoBranches(installationId, repo.name, repo.full_name, repo.id, branches)
      }
    }
  }

  if (eventType?.startsWith('pull_request')) {
    const prAction = eventPayload?.action
    const repo = eventPayload?.repository?.name
    const prNumber = eventPayload?.pull_request?.number

    // Get existing PRs from database
    const existingData = await queryWParams(`SELECT * FROM github_pull_requests WHERE installation_id = $1`, [installationId])
    let allPullRequests = existingData?.rows[0]?.pullRequests || []

    if (prAction === 'opened' || prAction === 'synchronize' || prAction === 'edited' || prAction === 'reopened' || prAction === 'closed') {
      // Fetch only the updated PR
      const updatedPR = await listPullRequests(githubToken, repo, owner, prNumber)
      if (updatedPR) {

        // Update or add the PR in the existing data
        const repoIndex = allPullRequests.findIndex((r: any) => r.repo === repo)
        if (repoIndex === -1) {
          allPullRequests.push({
            repo,
            prs: [updatedPR[0]]
          })
        } else {
          const prIndex = allPullRequests[repoIndex].prs.findIndex((pr: any) => pr.number === prNumber)
          if (prIndex === -1) {
            allPullRequests[repoIndex].prs.push(updatedPR[0])
          } else {
            allPullRequests[repoIndex].prs[prIndex] = updatedPR[0]
          }
        }
      }
    }

    // Update database with modified PR data
    await queryWParams(`INSERT INTO github_pull_requests (installation_id, pullRequests) VALUES ($1, $2)`, [installationId, allPullRequests])
  } else if (eventType === 'installation') {
    // For new installations, fetch all PRs
    const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId]))?.rows[0]?.repositories
    if (allRepos) {
      let allPullRequests: any[] = [];
      // fetch all PRs for all repos
      for (const repo of allRepos) {
        const prs = await listPullRequests(githubToken, repo.name, owner)
        if (prs) {
          allPullRequests.push({
            repo: repo.name,
            prs: prs
          });
        }
      }
      // Insert all PRs at once after collecting them
      await queryWParams(`INSERT INTO github_pull_requests (installation_id, pullRequests) VALUES ($1, $2)`, [installationId, allPullRequests])
    }
  }

  if (!eventType || eventType === 'installation' || eventType === 'member' || eventType === 'organization') {
    const octokit = new Octokit({
      auth: githubToken,
      userAgent: "wave-self-hosted-github-agent v0.1"
    });

    const users = await octokit.paginate(octokit.orgs.listMembers, {
      org: owner,
      per_page: 100
    });

    // Skip detailed user info gathering if it's not an installation event
    if (!eventType || eventType === 'installation' || eventType === 'member') {
      // Initialize maps to store user info
      const userEmails = new Map(users.map(user => [user.login, null]));
      const userNames = new Map(users.map(user => [user.login, null]));

      // Only process repos if we need to gather user details
      const allRepos = (await queryWParams(`SELECT * FROM github_repositories WHERE installation_id = $1`, [installationId]))?.rows[0]?.repositories
      if (allRepos) {
        // Search through repos until we find info for all users
        for (const repo of allRepos) {
          // Skip if we've found all info
          if ([...userEmails.values()].every(email => email !== null) &&
            [...userNames.values()].every(name => name !== null)) {
            break;
          }

          try {
            // Get all commits for the repo
            const commits = await octokit.paginate(octokit.repos.listCommits, {
              owner: owner,
              repo: repo.name,
              per_page: 100
            });

            // Process commits to find user info
            for (const commit of commits) {
              const authorLogin = commit.author?.login;
              if (authorLogin && userEmails.has(authorLogin)) {
                // Set email if not already found
                if (!userEmails.get(authorLogin)) {
                  const commitEmail: any = commit.commit?.author?.email;
                  if (commitEmail) {
                    userEmails.set(authorLogin, commitEmail);
                  }
                }

                // Set name if not already found
                if (!userNames.get(authorLogin)) {
                  const commitName: any = commit.commit?.author?.name;
                  if (commitName) {
                    userNames.set(authorLogin, commitName);
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error processing repo ${repo.name}:`, error);
            continue;
          }
        }
      }

      const usersWithDetails = users.map(user => ({
        ...user,
        email: userEmails.get(user.login) || null,
        name: userNames.get(user.login) || null
      }));

      await queryWParams(`INSERT INTO github_users (installation_id, users) VALUES ($1, $2)`, [installationId, usersWithDetails])
    } else {
      // For non-installation events, just store basic user info
      await queryWParams(`INSERT INTO github_users (installation_id, users) VALUES ($1, $2)`, [installationId, users])
    }
  }
}
