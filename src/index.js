const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const setupAstGrep = require('./setup-ast-grep');
const runFixSca = require('./run-fix-sca');

async function main() {
  try {
    // Get inputs
    const fixScaParams = core.getInput('fix-sca-params');
    const workflowRunId = core.getInput('workflow-run-id');
    const fnfFeatureFlag = core.getInput('fnf-feature-flag');

    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const actionPath = `${__dirname}/..`;

    core.info('Starting Veracode Fix for SCA action...');

    // Setup ast-grep
    core.info('Setting up ast-grep...');
    await setupAstGrep(actionPath);

    // Run Fix for SCA
    core.info('Running Fix for SCA...');
    let fixScaOutput;
    try {
      const gitWorkflowRunId = workflowRunId || process.env.GITHUB_RUN_ID;
      const enableFnf = fnfFeatureFlag?.toLowerCase() === 'true';
      fixScaOutput = await runFixSca(workspaceDir, actionPath, fixScaParams, gitWorkflowRunId, enableFnf);
    } catch (fixScaError) {
      core.error(`Fix for SCA failed: ${fixScaError.message}`);
      core.setOutput('run-next-step', 'false');
      throw fixScaError;
    }
  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
