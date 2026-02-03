#!/bin/bash
git add README.md docker-compose.yml src/abilities/email.service.ts src/config/index.ts src/llm/openai.client.ts package.json .env.example
git add docker-compose.portable.yml setup_luna.sh sanhedrin/
git commit -m "Refactor: Make installation portable and generic

- Update docker-compose.yml to use relative paths for secrets and remove hardcoded user paths.
- Replace specific email domain (bitwarelabs.com) with generic example.com in config and docker-compose.
- Remove hardcoded HTTP-Referer header in OpenAI client.
- Update email tool descriptions to be generic.
- Include sanhedrin source code in the repository.
- Add docker-compose.portable.yml for standalone portable deployments.
- Add setup_luna.sh for automated setup on new machines.
- Update README.md with generic clone instructions but kept author info."
git push origin main
