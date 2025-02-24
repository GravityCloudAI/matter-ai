# Matter

![Matter Og Image](https://res.cloudinary.com/dor5uewzz/image/upload/v1740376446/og-image-matter_kfioxu.png)

Matter is open-source AI Code Reviewer Agent. This enables developers to review code changes and provide feedback on the code.

### Supported Platforms
- [X] Github
- [ ] Gitlab
- [ ] Bitbucket
- [ ] Azure DevOps

### Features

| Feature | Status | Pricing |
|---------|--------|---------|
| AI Pull Request Summary | ✅ | <kbd>Free</kbd> / <kbd>Self Hosted</kbd> |
| AI Code Review Comments | ✅ | <kbd>Free</kbd> / <kbd>Self Hosted</kbd> |
| AI Code Suggestions | ✅ | <kbd>Free</kbd> / <kbd>Self Hosted</kbd> |
| AI Code quality score and Suggestions | ✅ | <kbd>Free</kbd> / <kbd>Self Hosted</kbd> |
| AI Pull Request Checklist and Suggestions | ✅ | <kbd>Free</kbd> / <kbd>Self Hosted</kbd> |
| Internal Documentation Support | ✅ | <kbd>Paid</kbd> / <kbd>Enterprise</kbd> |
| Generate AI Release Notes | ✅ | <kbd>Paid</kbd> / <kbd>Enterprise</kbd> |

## Installation

### Cloud Hosted
- You can signup on the Cloud Hosted version here: https://console.gravitycloud.ai

### Kubernetes

#### Prerequisites
1. Create an internal Github App for your Organization
2. Fill the required values in the `matter-values.yaml` file. You can get the template here: [https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml](https://github.com/GravityCloudAI/helm/blob/main/charts/gravity-matter/values.yaml)

#### Helm Chart
1. `helm repo add gravity https://gravitycloudai.github.io/helm`
2. `helm repo update`
3. `helm upgrade --install matter-ai gravity/gravity-matter -f matter-values.yaml -n matter-ai --create-namespace`

### Local Installation

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
