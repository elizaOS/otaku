# Contributing to Otaku

Thanks for your interest in improving Otaku! We welcome pull requests, bug reports, and feature proposals from the community. This document outlines how to get started.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Before You Start](#before-you-start)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Style Guidelines](#style-guidelines)
- [Submitting Changes](#submitting-changes)

## Code of Conduct
All contributors are expected to follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be respectful, inclusive, and collaborative when engaging with the community.

## Before You Start
- **Discuss first:** For new features or significant refactors, please open an issue to align on scope and approach before writing code.
- **Check existing issues:** Someone may already be working on a similar idea.
- **Set up your environment:** Follow the instructions in `README.md` to install Bun, copy `.env.sample`, and run the project locally.

## Development Workflow
1. **Fork & clone** the repository (or create a branch if you have write access).
2. Create a feature branch from `main` using a descriptive name (e.g. `feature/improve-wallet-card`).
3. Run `bun install` to ensure dependencies are up to date.
4. Make changes with incremental commits.
5. Keep your branch up to date with `main` by rebasing when needed.
6. Verify formatting and type safety (see [Testing](#testing) and [Style Guidelines](#style-guidelines)).

## Testing
- Run `bun run type-check` to ensure TypeScript types remain sound.
- Execute package-specific tests when you touch them:
  - `cd src/packages/api-client && bun test`
  - `cd src/packages/server && bun test`
- Add or update tests for new functionality when feasible.

## Style Guidelines
- Use the existing ESLint, Prettier, and TypeScript configurations in the repo.
- Prefer strict typing—avoid `any` or `unknown` types.
- Keep commits focused and descriptive. Conventional Commit prefixes (`feat:`, `fix:`, `docs:`) are encouraged.
- Update documentation (`README.md`, `docs/`, etc.) when user-facing behavior changes.

## Submitting Changes
1. Ensure your branch passes type checks and relevant tests.
2. Open a pull request using the provided template in `.github/pull_request_template.md`.
3. Link related issues and clearly describe the motivation, approach, and testing.
4. Respond to review feedback promptly and courteously.
5. A maintainer will merge the PR once it meets the project standards.

Thank you for contributing!

