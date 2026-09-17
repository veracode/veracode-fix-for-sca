const fs = require('fs');
const path = require('path');
const os = require('os');
const core = require('@actions/core');
const exec = require('@actions/exec');

async function runFixSca(workspaceDir, actionPath, fixScaParams, githubContext) {
  try {
    const projectRootDir = '';
    const projectPath = path.join(workspaceDir, 'source-code', projectRootDir);

    core.info(`Project path: ${projectPath}`);

    // Set up environment for veracode CLI
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'veracode.exe' : 'veracode';
    const veracodeBinary = path.join(`${process.env.CLI_PATH}`, binaryName);

    core.info(`Veracode binary: ${veracodeBinary}`);
    core.info(`Binary exists: ${fs.existsSync(veracodeBinary)}`);

    // Find SCA results file
    const artifactDir = path.join(workspaceDir, 'veracode_artifact_directory');
    const possiblePaths = [
      path.join(artifactDir, 'Veracode Agent Based SCA Results', 'scaResults.json'),
      path.join(artifactDir, 'scaResults.json'),
    ];

    let scaResultsPath = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        scaResultsPath = possiblePath;
        core.info(`Found SCA results at: ${scaResultsPath}`);
        break;
      }
    }

    if (!scaResultsPath) {
      throw new Error(`Could not find SCA results file in ${artifactDir}`);
    }

    // Build command arguments
    const args = [
      'fix',
      'sca',
      projectPath,
      '--results',
      scaResultsPath,
    ];

    // Conditionally add --transitive flag (default: true)
    const fixTransitive = core.getInput('fix-transitive');
    if (fixTransitive?.toLowerCase() !== 'false') {
      args.push('--transitive');
    }

    // Conditionally add --remote flag (default: false)
    const fixRemote = core.getInput('fix-remote');
    if (fixRemote?.toLowerCase() === 'true') {
      core.info(`remote argument appended`)
      args.push('--remote');
    }

    if (fixScaParams && fixScaParams.trim() && fixScaParams !== 'SCA-*') {
      core.info(`Fix SCA params: ${fixScaParams}`);
      args.push('-i', fixScaParams);
    }

    // Run veracode fix sca command with async mode
    core.info(`Running: ${veracodeBinary} ${args.join(' ')}`);

    let cliOutput = '';
    let jobId = null;
    let cliExitCode = 0;

    // Pass GitHub context via environment variables (4 required fields only)
    const env = { ...process.env };
    if (githubContext && githubContext.repository) {
      env.GITHUB_REPOSITORY = githubContext.repository.full_name;
      env.GITHUB_REF_NAME = githubContext.repository.branch;
      if (githubContext.issue_number) {
        env.GITHUB_ISSUE_NUMBER = githubContext.issue_number.toString();
      }
      if (githubContext.run_id) {
        env.GITHUB_RUN_ID = githubContext.run_id.toString();
      }
    }

    try {
      cliExitCode = await exec.exec(veracodeBinary, args, {
        env: env,
        listeners: {
          stdout: (data) => {
            cliOutput += data.toString();
            // CLI output goes directly to GitHub Actions console
            // Don't re-log via core.info to avoid duplication
          },
          stderr: (data) => {
            cliOutput += data.toString();
            // CLI errors go directly to GitHub Actions console
            // Don't re-log via core.warning to avoid duplication
          }
        },
        ignoreReturnCode: true,
      });
    } catch (error) {
      core.error(`[CLI_ERROR] Failed to execute veracode CLI: ${error.message}`);
      throw error;
    }

    // Check for CLI errors - if exit code is non-zero, submission likely failed
    if (cliExitCode !== 0) {
      // Extract error details from CLI output
      const errorLines = cliOutput
        .split('\n')
        .filter((line) => line.includes('ERR') || line.includes('Error'))
        .slice(-5)
        .join('\n');

      core.error(
        `[CLI_SUBMISSION_FAILED] CLI exited with code ${cliExitCode}`
      );
      core.error(`[CLI_SUBMISSION_FAILED] Recent errors:\n${errorLines}`);

      // Check for specific HTTP error codes in output
      const has500Error = cliOutput.includes('500 Internal Server Error');
      const has400Error = cliOutput.includes('400') || cliOutput.includes('Bad Request');
      const has401Error = cliOutput.includes('401') || cliOutput.includes('Unauthorized');
      const has403Error = cliOutput.includes('403') || cliOutput.includes('Forbidden');

      if (has500Error) {
        core.error(
          '[BACKEND_ERROR] Backend service returned 500 Internal Server Error'
        );
      } else if (has400Error) {
        core.error('[BACKEND_ERROR] Backend service returned 400 Bad Request');
      } else if (has401Error) {
        core.error('[BACKEND_ERROR] Backend service returned 401 Unauthorized');
      } else if (has403Error) {
        core.error('[BACKEND_ERROR] Backend service returned 403 Forbidden');
      }

      // In fire-and-forget mode, still fail if submission didn't succeed
      if (githubContext && githubContext.repository) {
        core.error(
          '[FIRE_AND_FORGET_FAILURE] Job submission failed. Backend was not reached.'
        );
        core.setOutput('run-next-step', 'false');
        throw new Error(
          `Fix SCA job submission failed with exit code ${cliExitCode}`
        );
      }

      // For polling mode, also fail
      core.setOutput('run-next-step', 'false');
      throw new Error(
        `Fix SCA job submission failed with exit code ${cliExitCode}`
      );
    }

    // Extract conversation ID from response headers (works for both modes)
    const conversationIdMatch = cliOutput.match(/X-Conversation-Id=\["([a-f0-9\-]+)"\]/);
    const conversationId = conversationIdMatch ? conversationIdMatch[1] : null;

    // Fire-and-forget mode: backend handles job polling, PR creation, etc.
    if (githubContext && githubContext.repository) {
      core.debug('Fire-and-forget mode: backend will handle processing');
      if (conversationId) {
        core.debug(
          `Conversation ID: ${conversationId} (use for debugging)`
        );
        core.setOutput('conversation-id', conversationId);
      }
      core.setOutput('run-next-step', 'false');
      return { hasChanges: false, fireAndForget: true };
    }

    // Fallback: log job submission for debugging if no GitHub context
    if (conversationId) {
      core.info(`Conversation ID: ${conversationId}`);
      core.setOutput('conversation-id', conversationId);
    }
    return { hasChanges: false };
  } catch (error) {
    throw new Error(`Failed to run Fix for SCA: ${error.message}`);
  }
}

module.exports = runFixSca;
