# Matter AI

![GitHub Workflow Status (with event)](https://github.com/GravityCloudAI/matter-ai/actions/workflows/main.yml/badge.svg?branch=main)
![Docker Pulls](https://img.shields.io/docker/pulls/gravitycloud/matter.svg?maxAge=604800)
[![GitHub License](https://img.shields.io/github/license/GravityCloudAI/matter-ai)](https://github.com/GravityCloudAI/matter/blob/matter-ai/LICENSE)
![Security Compliance](https://img.shields.io/badge/Compliance-SOC2_Type_II-818aff)

![Matter Og Image](https://res.cloudinary.com/dor5uewzz/image/upload/v1740649715/og-image-matter_lr7gsi.png)

Matter is open-source AI Code Reviewer Agent. This enables developers to review code changes and provide feedback on the code.

## Features

### AI Generated Summaries
- Automatically generates AI Summaries and updates the PR description.
- If you are using any PR template, the PR template will be used and updated accordingly with summary.
- Generate static AI Summary as a comment by using <kbd>/matter summary</kbd> command in the PR.

![Matter AI Generated Summary](https://res.cloudinary.com/dor5uewzz/image/upload/v1740649715/generate-ai-summary_fmzjie.png)

### AI Review
- Code quality and Bug fix recommendation in the PR
- Code change suggestion patches in the PR
- Generate static AI Review by using <kbd>/matter review</kbd> command in the PR.

![Matter AI Code Review](https://res.cloudinary.com/dor5uewzz/image/upload/v1740649715/generate-ai-review_mqz3gy.png)

### Supported Platforms
- [X] Github
- [ ] Gitlab
- [ ] Bitbucket
- [ ] Azure DevOps

### Features

| Feature | Status | Pricing |
|---------|--------|---------|
| AI Pull Request Summary | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code Review Comments | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code Suggestions | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Code quality score and Suggestions | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| AI Pull Request Checklist and Suggestions | ✅ | ![Free Plan](https://img.shields.io/badge/Free_/_Self_Hosted-3AFFA3) |
| Internal Documentation Support | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Release Notes | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Security Vulnerability | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |
| Generate AI Tests | ✅ | ![Paid Plan](https://img.shields.io/badge/Paid_/_Enterprise-818aff) |

## Differentiators
1. 1-click installation for all(or selected) org-level repositories. No need to integrate for each one.
2. Runs a stack of generation from Summary, Reviews, Bugs, Security and Tests together.
3. Day-0 ready self-hosted Helm Charts.

## Installation

### 1. Cloud Hosted
- You can signup on the Cloud Hosted version here: https://app.gravitycloud.ai

### 2. Kubernetes

#### Prerequisites
1. Create an internal Github App for your Organization
2. Fill the required values in the `matter-values.yaml` file. You can get the template here: [https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml](https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml)

#### Helm Chart
1. `helm repo add gravity https://gravitycloudai.github.io/helm`
2. `helm repo update`
3. `helm upgrade --install matter-ai gravity/gravity-matter -f matter-values.yaml -n matter-ai --create-namespace`

### 3. Local Installation

#### Prerequisites
1. Node.js
2. Update .env file with the required values. You can get the template here: [https://github.com/GravityCloudAI/matter/blob/main/.env.example](https://github.com/GravityCloudAI/matter/blob/main/.env.example)

#### Installation
1. `npm install`
2. `npm run dev`
3. Tunnel the local server to the cloud using [ngrok](https://ngrok.com/)
4. Update the webhook url in the Github App settings with the ngrok url

### Community
- Join our Discord Server here: https://discord.gg/fJU5DvanU3
