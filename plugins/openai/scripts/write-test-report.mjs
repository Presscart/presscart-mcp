// Retired historical smoke-report generator. Its original implementation is
// preserved in git history along with the immutable smoke evidence in results/.
// Current reports require manual grading of isolated runs and must not be
// regenerated from the older wrapped smoke tests.
console.error('Historical smoke-report generator is retired. Refusing to overwrite TEST-RESULTS.md; update the current report from manually graded isolated evaluation evidence.');
process.exitCode = 1;
