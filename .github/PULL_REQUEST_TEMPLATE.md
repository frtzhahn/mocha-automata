## Summary

Provide a concise explanation of the architectural motivations, bug fixes, or enhancements introduced by this pull request.

---

## Related Issues

Closes #

---

## Type of Change

Select all that apply by marking `[x]`:

- [ ] Bug fix (non-breaking change resolving an operational or logic error)
- [ ] New feature (non-breaking change introducing new capability or command)
- [ ] Breaking change (fix or feature modifying existing contract, schema, or command API)
- [ ] Documentation update (guides, architectural diagrams, or configuration templates)
- [ ] Refactoring / Performance (code optimization without behavior alteration)
- [ ] Continuous Integration / Automation (workflows, linting, toolchain scripts)

---

## Local Validation Steps

Detail the deterministic steps executed locally to verify that this change operates correctly and introduces no regressions.

Example verification commands:
1. Syntax validation:
   ```bash
   node --check packages/<package-name>/bot.js
   ```
2. Dependency installation:
   ```bash
   cd packages/<package-name> && npm install
   ```
3. Smoke test verification logs:
   - Output / logs observed during test executions.

---

## Security Checklist

Confirm each compliance item before requesting review:

- [ ] Confirmed no `.env` or credential files are staged or committed.
- [ ] Verified that all secrets are injected solely through environment variables.
- [ ] Verified that input sanitization and directory traversal guards remain intact.
- [ ] Verified that file operations preserve atomic write patterns (`.tmp` to target rename).
- [ ] Verified zero unhandled promise rejections or unhandled exceptions in newly added handlers.
