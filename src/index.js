const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const setupAstGrep = require('./setup-ast-grep');
const runFixSca = require('./run-fix-sca');

async function main() {
  try {
    // Record action startup time
    const actionStartTime = Date.now();

    // Get inputs
    const repository = core.getInput('repository');
    const branch = core.getInput('branch');
    const prNumber = core.getInput('pr-number');
    const fixScaParams = core.getInput('fix-sca-params');
    const fixTransitive = core.getInput('fix-transitive');
    const fixRemote = core.getInput('fix-remote');

    const workspaceDir = process.env.GITHUB_WORKSPACE;
    const statusFilePath = path.join(workspaceDir, 'source-code', 'sca-fix-status');
    const actionPath = `${__dirname}/..`

    core.info('Starting Veracode Fix for SCA action...');

    // Log all inputs from action.yml
    core.info('=== ACTION INPUTS (from action.yml) ===');
    core.info(`repository: ${repository}`);
    core.info(`branch: ${branch}`);
    core.info(`pr-number: ${prNumber}`);
    core.info(`fix-sca-params: ${fixScaParams || 'NOT SET'}`);
    core.info(`fix-transitive: ${fixTransitive}`);
    core.info(`fix-remote: ${fixRemote}`);
    core.info('=====================================');

    core.info(`GITHUB_WORKSPACE: ${workspaceDir}`);
    core.info(`CLI_PATH: ${process.env.CLI_PATH}`);

    // Setup ast-grep
    core.info('Setting up ast-grep...');
    try {
      await setupAstGrep(actionPath);
      core.info('ast-grep setup completed successfully');
    } catch (astGrepError) {
      core.error(`ast-grep setup failed: ${astGrepError.message}`);
      throw astGrepError;
    }

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
      // Messages are logged by the sca-fix library (especially important in fire-and-forget mode)
    } catch (fixScaError) {
      core.error(`Fix for SCA failed: ${fixScaError.message}`);
      core.setOutput('run-next-step', 'false');
      throw fixScaError;
    }

    // Calculate action execution time
    const actionEndTime = Date.now();
    const executionTimeMs = actionEndTime - actionStartTime;
    const executionTimeSec = (executionTimeMs / 1000).toFixed(2);

    core.info('════════════════════════════════════════════════════════════════');
    core.info('🔴 GITHUB RUNNER RELEASED - Action exiting');
    core.info(`    Action completed at: ${new Date(actionEndTime).toISOString()}`);
    core.info(`    Total action execution time: ${executionTimeSec}s`);
    core.info(`    ⚡ Runner released IMMEDIATELY after job submission`);
    core.info(`    ⚡ Backend processes job asynchronously while runner is freed`);
    core.info('════════════════════════════════════════════════════════════════');
  } catch (error) {
    core.setFailed(error.message);
    process.exit(1);
  }
}

main();
