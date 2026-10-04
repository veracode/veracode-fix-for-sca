const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const github = require('@actions/github');
const setupAstGrep = require('./setup-ast-grep');
const runFixSca = require('./run-fix-sca');
const createPr = require('./create-pr');
const uploadPrComment = require('./upload-pr-comment');

async function main() {
  try {
    // Get inputs
    const githubToken = core.getInput('github-token');
    const repository = core.getInput('repository');
    const branch = core.getInput('branch');
    const githubApiUrl = core.getInput('github-api-url');
    const prNumber = core.getInput('pr-number');
    const fnfFeatureFlag = core.getInput('fnf-feature-flag');

    // Extract FNF context from payload for correlation and validation
    const fixContext = github.context.payload.client_payload?.fix_context;
    const correlationId = fixContext?.correlation_id || 'unknown';
    const fixScaParams = fixContext?.fix_sca_params;
    const scaScanRunId = github.context.payload.client_payload?.workflow_run_id;


    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const statusFilePath = path.join(workspaceDir, 'source-code', 'sca-fix-status');
    const actionPath = `${__dirname}/..`
    const sourceCodeDir = path.join(workspaceDir, 'source-code');

    core.info('Starting Veracode Fix for SCA action...');

    // Determine mode early (artifact handling differs by mode)
    const enableFnf = fnfFeatureFlag === 'true';

    // Setup ast-grep
    core.info('Setting up ast-grep...');
    await setupAstGrep(actionPath);

    // Run Fix for SCA
    core.info('Running Fix for SCA...');
    let fixScaOutput;
    try {
      fixScaOutput = await runFixSca(workspaceDir, actionPath, fixScaParams, enableFnf, scaScanRunId, correlationId);
    } catch (fixScaError) {
      core.error(`Fix for SCA failed: ${fixScaError.message}`);
      core.setOutput('run-next-step', 'false');
      throw fixScaError;
    }

    // Fire-and-forget mode: exit early, backend handles everything
    if (enableFnf) {
      return;
    }

    // Polling mode: check for changes and create PR if needed
    if (!fixScaOutput.hasChanges) {
      core.info('No changes detected. Skipping PR creation.');
      fs.writeFileSync(statusFilePath, 'NO_CHANGES_DETECTED');
      return;
    }

    // Create Pull Request
    core.info('Creating pull request...');
    const prCreateOutput = await createPr(
      workspaceDir,
      repository,
      branch,
      githubToken,
      githubApiUrl,
      sourceCodeDir
    );

    // Post PR comment on original PR
    core.info('Posting comment on original PR...');
    await uploadPrComment(
      workspaceDir,
      repository,
      prNumber,
      githubToken,
      githubApiUrl
    );

    core.info('Veracode Fix for SCA action completed successfully.');
  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
