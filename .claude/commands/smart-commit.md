Analyze all uncommitted changes (staged, unstaged, and untracked) in the working directory and organize them into logical, well-scoped commits.

## Steps

1. **Survey changes**: Run `git status` and `git diff` (staged + unstaged) to understand every pending change. Include untracked files.

2. **Group into logical units**: Cluster related changes into commit groups. Use these signals:
   - Files in the same feature area or module
   - Changes that reference the same types, functions, or APIs
   - Test files grouped with the code they test
   - Config/infra changes grouped together
   - Documentation changes related to code changes grouped with them
   - Unrelated small fixes can be a single "chores" commit

3. **Present the plan and execute immediately**: Show a brief summary of the commit groups (message + files), then execute all commits without waiting for confirmation. Stage only the relevant files per commit. Do NOT add a co-author trailer. Use `git add <specific files>` — never `git add -A` or `git add .`. Quote paths containing brackets or special characters.

## Rules
- Never commit files that look like secrets (.env, credentials, tokens)
- If a file has both related and unrelated hunks, note this in the summary and commit the whole file with the most relevant group
- Keep commits atomic — each should be independently meaningful
- Order commits logically (e.g., refactors before features that depend on them)
- Use conventional commit prefixes where appropriate (feat, fix, refactor, docs, test, chore)
- **Commit message style**: Write messages that are readable at a glance by someone skimming a git log. Describe the *effect* or *problem solved*, not the implementation mechanism. Avoid internal jargon, CS terminology, or naming code constructs (like "singleton", "registry", "mutation") — the reader shouldn't need to know the code to understand the message. If a body is needed, keep it to one short sentence max.
  - Good: `fix: prevent skipped resets during test cleanup`
  - Good: `refactor: share line-item helpers across purchase modules`
  - Bad: `fix: snapshot singleton registry before resetting to avoid mutation during iteration`
  - Bad: `refactor: consolidate purchase line-item utilities into shared module`
