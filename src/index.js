const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const github = require('@actions/github');
const setupAstGrep = require('./setup-ast-grep');
const runFixSca = require('./run-fix-sca');
const createPr = require('./create-pr');
const uploadPrComment = require('./upload-pr-comment');
const { DefaultArtifactClient } = require('@actions/artifact');

async function main() {
  try {
    // Get inputs
    const githubToken = core.getInput('github-token');
    const repository = core.getInput('repository');
    const branch = core.getInput('branch');
    const githubApiUrl = core.getInput('github-api-url');
    const prNumber = core.getInput('pr-number');
    const fixScaParams = core.getInput('fix-sca-params');
    const fnfFeatureFlag = core.getInput('fnf-feature-flag');
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

    // Upload artifact: fix_workflow_run_id + correlation_id for veracode-github-app to match dispatch to workflow
    try {
      // Get correlation_id from dispatch payload
      const correlationId = github.context.payload.client_payload?.correlation_id || 'unknown';
      const artifactDir = path.join(workspaceDir, 'veracode_artifact_directory');
      fs.mkdirSync(artifactDir, { recursive: true });

      const workflowIdPath = path.join(artifactDir, 'fix-workflow-run-id.json');
      fs.writeFileSync(workflowIdPath, JSON.stringify({
        fix_workflow_run_id: process.env.GITHUB_RUN_ID,
        correlation_id: correlationId,
        status: 'started'
      }, null, 2));

      const artifactClient = new DefaultArtifactClient();
      await artifactClient.uploadArtifact(
        'fix-workflow-run-id',
        [workflowIdPath],
        workspaceDir,
        { continueOnError: false }
      );
      core.info(`[FIX_WORKFLOW_ID_UPLOADED] Uploaded artifact with correlation=${correlationId}, runId=${process.env.GITHUB_RUN_ID}`);
    } catch (artifactError) {
      const errorMsg = `Failed to upload fix workflow run ID artifact: ${artifactError.message}`;
      if (enableFnf) {
        core.setFailed(`[FIX_WORKFLOW_ID_ERROR] ${errorMsg} (required for fire-and-forget mode)`);
        throw artifactError;
      }
      core.warning(`[FIX_WORKFLOW_ID_ERROR] ${errorMsg} (continuing in polling mode)`);
    }

    // Run Fix for SCA
    core.info('Running Fix for SCA...');
    let fixScaOutput;
    try {
      fixScaOutput = await runFixSca(workspaceDir, actionPath, fixScaParams, enableFnf, scaScanRunId);
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
      fs.writeFileSync(statusFilePath, 'NO_CHANGES_DETECTED', null, 2);
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
