const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const setupAstGrep = require('./setup-ast-grep');
const runFixSca = require('./run-fix-sca');

async function main() {
  try {
    // Get inputs
    const repository = core.getInput('repository');
    const branch = core.getInput('branch');
    const prNumber = core.getInput('pr-number');
    const fixScaParams = core.getInput('fix-sca-params');

    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const actionPath = `${__dirname}/..`
    const sourceCodeDir = path.join(workspaceDir, 'source-code');

    core.info('Starting Veracode Fix for SCA action...');

    // Setup ast-grep
    core.info('Setting up ast-grep...');
    await setupAstGrep(actionPath);

    // Run Fix for SCA
    core.info('Running Fix for SCA...');
    let fixScaOutput;
    try {
      // GitHub context is always passed — both /auto-fix and /fix-sessions support fire-and-forget
      // Backend detects fire-and-forget based on presence of github_context
      const githubContext = {
        repository: {
          full_name: repository,
          owner: repository.split('/')[0],
          name: repository.split('/')[1],
          branch: branch,
        },
        issue_number: prNumber ? parseInt(prNumber) : null,
        run_id: process.env.GITHUB_RUN_ID,
      };
      fixScaOutput = await runFixSca(workspaceDir, actionPath, fixScaParams, githubContext);
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
